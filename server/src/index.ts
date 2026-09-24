import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@obby/shared';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { BuxFulfilmentService } from './progression/BuxFulfilmentService.js';
import { buxGrants } from './progression/BuxGrants.js';
import { profileStore } from './progression/ProfileStore.js';
import { GorgeRoom } from './rooms/GorgeRoom.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

// Prepare storage in the BACKGROUND, retrying until it answers. The server
// listens at once so the host's health check keeps passing even with the
// database down; each join reads storage itself in `GorgeRoom.onAuth` and is
// refused cleanly - never started fresh - while it cannot.
void profileStore.open();
void buxGrants.open();

// Colyseus attaches to OUR http server rather than making its own, so the
// same port answers both the WebSocket upgrade and a plain /health probe -
// which is what a managed host polls to decide the service is up.
// The one place a Bux purchase becomes Wins. It lives beside the store rather
// than inside a room because a purchase can land while the buyer is offline.
const buxFulfilment = new BuxFulfilmentService(serverConfig.gameSlug);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createHttpServer(buxFulfilment) }),
  greet: false,
  // Shutdown is handled below. Colyseus's own handler would exit the process
  // as soon as rooms closed - before the players' final saves were written.
  gracefullyShutdown: false,
});

gameServer.define(ROOM_NAME, GorgeRoom);

gameServer
  .listen(serverConfig.port, serverConfig.host)
  .then(() => {
    logger.info(
      SCOPE,
      `listening on ${serverConfig.host}:${serverConfig.port} ` +
        `room="${ROOM_NAME}" health=/health ` +
        `bux=${serverConfig.bloxityWebhookSecret ? 'configured' : 'DISABLED (no secret)'}`,
    );
  })
  .catch((error: unknown) => {
    logger.error(SCOPE, 'failed to start', error);
    process.exit(1);
  });

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(SCOPE, `received ${signal}, shutting down`);
  void (async () => {
    try {
      // Disconnecting clients saves their profiles (onLeave)...
      await gameServer.gracefullyShutdown(false);
    } catch (error: unknown) {
      logger.error(SCOPE, 'room shutdown failed', error);
    }
    // ...this waits for every save to be written...
    await profileStore.flush();
    // ...so the grants those saves paid can be confirmed before exiting.
    await buxGrants.close();
    await profileStore.close();
    logger.info(SCOPE, `profiles persisted (${profileStore.size})`);
    process.exit(0);
  })();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A last resort for any exit path that skipped the handler above. Only a local
// file can be written synchronously here; the database is flushed above.
process.on('exit', () => profileStore.flushSync());
