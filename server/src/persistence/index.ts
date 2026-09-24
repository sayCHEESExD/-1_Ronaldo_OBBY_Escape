import { join } from 'node:path';
import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';
import type { GrantStore } from './GrantStore.js';
import { JsonFilePersistence } from './JsonFilePersistence.js';
import { JsonGrantStore } from './JsonGrantStore.js';
import { mongoConnection } from './mongoConnection.js';
import { MongoGrantStore } from './MongoGrantStore.js';
import { MongoPersistence } from './MongoPersistence.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';

export type { PersistenceAdapter, StoredProfile } from './PersistenceAdapter.js';
export type { GrantRecord, GrantStore } from './GrantStore.js';

const SCOPE = 'persistence';

/**
 * The ONLY place a concrete profile adapter is named.
 *
 * `MONGODB_URI` set - which Bloxity Legion does for every deployed pod - means
 * the managed database, the only store there that outlives a pod. Unset means
 * the JSON file under `dataDir`: local development.
 *
 * With the database selected, a `profiles.json` left in `dataDir` by an earlier
 * build is imported on boot - inserting only, never replacing.
 */
export const createPersistence = (): PersistenceAdapter => {
  if (serverConfig.mongoUri) {
    logger.info(SCOPE, 'using Bloxity managed MongoDB (MONGODB_URI)');
    return new MongoPersistence(
      mongoConnection(serverConfig.mongoUri),
      join(serverConfig.dataDir, 'profiles.json'),
    );
  }
  logger.warn(
    SCOPE,
    `MONGODB_URI not set - using a local JSON file in ${serverConfig.dataDir} ` +
      '(development store; it does not survive a redeploy on Bloxity Hosting)',
  );
  return new JsonFilePersistence(serverConfig.dataDir);
};

/**
 * Where Bux purchases wait until they are handed over - ALWAYS the same store
 * as the profiles, chosen by the same rule. "Was this grant paid out" is
 * answered by reading a profile, so the two must live on the same machine.
 */
export const createGrantStore = (): GrantStore => {
  if (serverConfig.mongoUri) return new MongoGrantStore(mongoConnection(serverConfig.mongoUri));
  return new JsonGrantStore(serverConfig.dataDir);
};
