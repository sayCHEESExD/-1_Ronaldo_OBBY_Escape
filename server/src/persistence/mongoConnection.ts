import { MongoClient, type Db } from 'mongodb';
import { logger } from '../util/logger.js';

const SCOPE = 'persistence/mongo';

/**
 * ONE client per process for the managed database, shared by every store.
 *
 * Profiles and Bux grants live in the same database, and a `MongoClient` is a
 * connection POOL - two would be twice the sockets against a managed server
 * for no benefit.
 *
 * Connected lazily, and a failed attempt is NOT cached: the next request tries
 * again, which is what lets a pod that booted with the database down recover
 * without a restart.
 */
export class MongoConnection {
  private readonly client: MongoClient;
  private database: Db | null = null;
  private connecting: Promise<Db> | null = null;

  constructor(uri: string) {
    this.client = new MongoClient(uri, {
      // Fail a request in seconds rather than hang a join for a minute.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      retryWrites: true,
      retryReads: true,
      appName: 'anime-backflip-escape',
    });
  }

  db(): Promise<Db> {
    if (this.database) return Promise.resolve(this.database);
    this.connecting ??= this.client
      .connect()
      .then((client) => {
        // The URI names this game+channel's own database; `db()` with no
        // argument uses exactly that one.
        const database = client.db();
        this.database = database;
        logger.info(SCOPE, `connected to database "${database.databaseName}"`);
        return database;
      })
      .catch((error: unknown) => {
        this.connecting = null;
        throw error;
      });
    return this.connecting;
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}

let shared: MongoConnection | null = null;

/** The process's one connection to `uri`. */
export const mongoConnection = (uri: string): MongoConnection => {
  shared ??= new MongoConnection(uri);
  return shared;
};
