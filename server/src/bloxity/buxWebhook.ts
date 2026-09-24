import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../util/logger.js';
import type { BuxFulfilmentService, BuxWebhookPayload } from '../progression/BuxFulfilmentService.js';

const SCOPE = 'BuxWebhook';

/** Where Bloxity delivers confirmed purchases. */
export const BUX_WEBHOOK_PATH = '/bloxity/bux-webhook';

/** Refuse anything larger; a purchase notification is a few hundred bytes. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * The server-to-server fulfilment endpoint.
 *
 * Bloxity charges the player and then POSTs here. The contract is blunt and
 * worth stating: ANYTHING OTHER THAN A 2xx REFUNDS THE PLAYER. So the only
 * things that answer with an error are the cases where granting would be
 * wrong - an unrecognised SKU, a payload naming nobody, a bad secret - and a
 * duplicate delivery answers 200, because the first one already paid out and
 * refunding a granted purchase is the worse failure.
 *
 * The shared secret is compared in full rather than trusted from a prefix, and
 * when `BLOXITY_WEBHOOK_SECRET` is unset the endpoint refuses everything: an
 * unauthenticated route that mints currency is not a thing to leave open by
 * default on a public host.
 *
 * @returns true if the request was handled here.
 */
export const handleBuxWebhook = (
  req: IncomingMessage,
  res: ServerResponse,
  fulfilment: BuxFulfilmentService,
  secret: string,
): boolean => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== BUX_WEBHOOK_PATH) return false;

  if (req.method !== 'POST') {
    send(res, 405, { error: 'method not allowed' });
    return true;
  }

  if (!secret) {
    logger.error(SCOPE, 'BLOXITY_WEBHOOK_SECRET is not set - refusing to fulfil');
    send(res, 503, { error: 'fulfilment not configured' });
    return true;
  }

  const provided = req.headers['x-legion-webhook-secret'];
  if (typeof provided !== 'string' || !timingSafeEqual(provided, secret)) {
    logger.warn(SCOPE, 'rejected a webhook with a bad or missing secret');
    send(res, 401, { error: 'unauthorised' });
    return true;
  }

  readBody(req)
    .then(async (body) => {
      let payload: BuxWebhookPayload;
      try {
        payload = JSON.parse(body) as BuxWebhookPayload;
      } catch {
        send(res, 400, { error: 'invalid json' });
        return;
      }

      // Awaited: 200 is only sent once the grant is durably recorded. If
      // storage is unreachable this throws, and the 5xx below makes Bloxity
      // retry rather than refund.
      const outcome = await fulfilment.fulfil(payload);
      if (outcome.status === 'rejected') {
        // A 4xx here is deliberate: the sale cannot be honoured, so the
        // player should get their Bux back rather than pay for nothing.
        logger.warn(SCOPE, `rejected: ${outcome.reason}`);
        send(res, 422, { error: outcome.reason });
        return;
      }

      // 200 only now: the grant is DURABLY recorded (or was already).
      send(res, 200, {
        status: outcome.status,
        userId: outcome.userId,
        ...(outcome.status === 'granted' ? { wins: outcome.wins } : {}),
      });
    })
    .catch((error: unknown) => {
      // A read or storage failure is OUR fault, not the sale's, so this
      // answers 5xx - which asks Bloxity to retry rather than refunding.
      logger.error(SCOPE, 'could not fulfil webhook', error);
      send(res, 500, { error: 'temporarily unable to fulfil' });
    });

  return true;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * Compare two secrets without leaking their length through timing.
 *
 * `crypto.timingSafeEqual` throws on a length mismatch, which is itself a
 * signal, so the lengths are folded into the same constant-time comparison.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
};
