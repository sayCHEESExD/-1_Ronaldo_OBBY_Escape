import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import type { PersistenceAdapter, StoredProfile } from './PersistenceAdapter.js';
import { decodeProfile } from './profileCodec.js';
import { writeProfileFields } from './profileFields.js';

const SCOPE = 'persistence/json';

/**
 * Bumped whenever the file's shape changes. A file written by an unknown
 * version is moved aside rather than misread.
 */
const FILE_VERSION = 1;

/** Milliseconds a write waits for more changes before hitting the disk. */
const DEBOUNCE_MS = 750;

/**
 * Profiles in one JSON file - the DEVELOPMENT store, used when there is no
 * `MONGODB_URI`. On Bloxity Legion it is not used for live profiles at all:
 * a pod's disk goes with the pod on every deploy and scale-to-zero.
 *
 * Writes are ATOMIC - a temp file, fsynced, then renamed over the real one -
 * so a crash mid-write leaves either the old file or the new one. A complete
 * temp file with no main file (a crash between fsync and rename) is picked up
 * as the newest save. A file that cannot be parsed is MOVED ASIDE, never
 * overwritten, so one bad byte cannot become everyone's progress gone.
 *
 * One process owns the file, so this adapter keeps the map in memory and
 * rewrites the file from it - fine here, and exactly why the database adapter
 * does NOT work that way.
 */
export class JsonFilePersistence implements PersistenceAdapter {
  readonly kind = 'json-file';

  private readonly path: string;
  private readonly tempPath: string;
  private profiles: Map<string, StoredProfile> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly directory: string) {
    this.path = join(directory, 'profiles.json');
    this.tempPath = join(directory, 'profiles.json.tmp');
  }

  get pendingWrites(): number {
    return this.dirty || this.writing ? 1 : 0;
  }

  async prepare(): Promise<void> {
    this.map();
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    return new Map(this.map());
  }

  async get(key: string): Promise<StoredProfile | undefined> {
    const profile = this.map().get(key);
    return profile ? { ...profile } : undefined;
  }

  put(key: string, profile: StoredProfile): void {
    if (!key) return;
    const profiles = this.map();
    profiles.set(key, writeProfileFields(profiles.get(key), profile));
    this.schedule();
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    const profiles = this.map();
    if (!key || profiles.has(key)) return false;
    profiles.set(key, writeProfileFields(undefined, profile));
    // A migration is the one write whose loss would be noticed: durable now.
    this.dirty = true;
    await this.writeAsync();
    return true;
  }

  whenWritten(_key: string): Promise<void> {
    // One file holds every key, so "this key has landed" is "the file has".
    if (!this.dirty && !this.writing) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async flush(): Promise<void> {
    this.flushSync();
  }

  /** Blocking flush for shutdown and the process `exit` hook. */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || !this.profiles) return;
    try {
      mkdirSync(this.directory, { recursive: true });
      const handle = openSync(this.tempPath, 'w');
      try {
        writeSync(handle, this.serialise());
        try {
          fsyncSync(handle);
        } catch {
          // A filesystem that refuses fsync must not cost us the save.
        }
      } finally {
        closeSync(handle);
      }
      renameSync(this.tempPath, this.path);
      this.dirty = false;
      this.releaseWaiters();
    } catch (error: unknown) {
      logger.error(SCOPE, `failed to write ${this.path}:`, error);
    }
  }

  /** The in-memory map, read from disk the first time it is needed. */
  private map(): Map<string, StoredProfile> {
    if (this.profiles) return this.profiles;
    const profiles = new Map<string, StoredProfile>();
    this.profiles = profiles;

    const source = existsSync(this.path) ? this.path : existsSync(this.tempPath) ? this.tempPath : null;
    if (!source) {
      logger.info(SCOPE, `no save at ${this.path} - starting empty`);
      return profiles;
    }

    let entries: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(source, 'utf8')) as { version?: unknown; profiles?: unknown };
      if (parsed?.version !== FILE_VERSION || !parsed.profiles || typeof parsed.profiles !== 'object') {
        throw new Error(`unrecognised save format (version ${String(parsed?.version)})`);
      }
      entries = parsed.profiles as Record<string, unknown>;
    } catch (error: unknown) {
      const aside = `${source}.corrupt-${Date.now()}`;
      logger.error(SCOPE, `could not read ${source}; moving it to ${aside}:`, error);
      try {
        renameSync(source, aside);
      } catch (moveError: unknown) {
        // Not even that: refuse to run on top of it rather than overwrite it.
        logger.error(SCOPE, `could not move ${source} aside:`, moveError);
        this.profiles = null;
        throw new Error(`profile file ${source} is unreadable and could not be preserved`);
      }
      return profiles;
    }

    for (const [key, value] of Object.entries(entries)) {
      const profile = decodeProfile(value);
      if (key && profile) profiles.set(key, profile);
    }
    logger.info(SCOPE, `loaded ${profiles.size} profile(s) from ${source}`);
    // A recovered temp file becomes the real one on the next write.
    if (source === this.tempPath) this.schedule();
    return profiles;
  }

  private serialise(): string {
    return JSON.stringify(
      { version: FILE_VERSION, profiles: Object.fromEntries(this.profiles ?? []) },
      null,
      2,
    );
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeAsync();
    }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /**
   * The routine write, off the event loop. A save arriving mid-write marks
   * the map dirty again and the loop picks it up; a failed write stays dirty
   * and is retried - nothing is dropped.
   */
  private async writeAsync(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.dirty && this.profiles) {
        this.dirty = false;
        const payload = this.serialise();
        try {
          await mkdir(this.directory, { recursive: true });
          const handle = await open(this.tempPath, 'w');
          try {
            await handle.writeFile(payload);
            await handle.sync().catch(() => undefined);
          } finally {
            await handle.close();
          }
          await rename(this.tempPath, this.path);
        } catch (error: unknown) {
          logger.error(SCOPE, `failed to write ${this.path}; retrying:`, error);
          this.dirty = true;
          this.writing = false;
          this.schedule();
          return;
        }
      }
    } finally {
      this.writing = false;
    }
    this.releaseWaiters();
  }

  private releaseWaiters(): void {
    if (this.dirty || this.writing || this.waiters.length === 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
