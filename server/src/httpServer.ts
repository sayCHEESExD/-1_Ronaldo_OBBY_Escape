import { createServer, type Server as HttpServer } from 'node:http';
import { ROOM_NAME } from '@obby/shared';
import { BUX_WEBHOOK_PATH, handleBuxWebhook } from './bloxity/buxWebhook.js';
import { serverConfig } from './config/serverConfig.js';
import type { BuxFulfilmentService } from './progression/BuxFulfilmentService.js';

/**
 * The HTTP server Colyseus is attached to.
 *
 * Colyseus would happily make its own, but a managed host needs a plain HTTP
 * endpoint it can poll to decide whether the service is alive - a WebSocket
 * port answers nothing useful to a health check.
 *
 * Handing Colyseus a server that ALREADY has a request listener is safe by
 * design: `attachMatchMakingRoutes` keeps the existing listeners and calls
 * them for any URL that is not a matchmaking route. So `/health` is answered
 * here and `/matchmake/*` still reaches Colyseus untouched.
 */
export const createHttpServer = (fulfilment: BuxFulfilmentService): HttpServer =>
  createServer((req, res) => {
    // Bloxity's purchase webhook. Checked first because it is the only route
    // here with side effects, and it must never be shadowed by the catch-all.
    if (handleBuxWebhook(req, res, fulfilment, serverConfig.bloxityWebhookSecret)) return;

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      const body = JSON.stringify({
        status: 'ok',
        room: ROOM_NAME,
        uptimeSeconds: Math.round(process.uptime()),
        buxWebhook: BUX_WEBHOOK_PATH,
        buxWebhookConfigured: serverConfig.bloxityWebhookSecret !== '',
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
