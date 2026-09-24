import { resolve } from 'node:path';
import { BLOXITY_GAME_SLUG, DEFAULT_SERVER_PORT, SERVER_TICK_RATE } from '@obby/shared';

/** Runtime server configuration, overridable by environment variables. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly tickRate: number;
  /** Milliseconds between state patches sent to clients. */
  readonly patchRateMs: number;
  /** Directory holding persisted player profiles (local JSON store only). */
  readonly dataDir: string;
  /**
   * Bloxity's managed MongoDB for this game and channel, injected into every
   * pod by Bloxity Hosting. When set, profiles live there - the only store
   * that survives a deploy. Empty in local development.
   */
  readonly mongoUri: string;
  /**
   * The slug this game is registered under on bloxity.io (its /g/<slug> page).
   * Login tokens are verified against it and purchases carry it. NOT the
   * hosting app id Legion injects as BLOXITY_GAME_ID - they differ here.
   */
  readonly gameSlug: string;
  /**
   * Shared secret on Bloxity's purchase webhook.
   *
   * Unset means the fulfilment endpoint refuses every request. That is the
   * safe default for a route that mints currency - an open one would let
   * anyone POST themselves Wins.
   */
  readonly bloxityWebhookSecret: string;
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const serverConfig: ServerConfig = {
  port: int(process.env['PORT'], DEFAULT_SERVER_PORT),
  host: process.env['HOST'] ?? '0.0.0.0',
  tickRate: SERVER_TICK_RATE,
  patchRateMs: 1000 / SERVER_TICK_RATE,
  // Relative to the server package, which is the working directory for both
  // `npm run dev` and `npm start`, so a restart finds the same file either way.
  dataDir: resolve(process.env['OBBY_DATA_DIR'] ?? 'data'),
  mongoUri: process.env['MONGODB_URI']?.trim() ?? '',
  gameSlug: process.env['BLOXITY_GAME_SLUG']?.trim() || BLOXITY_GAME_SLUG,
  bloxityWebhookSecret: process.env['BLOXITY_WEBHOOK_SECRET'] ?? '',
};
