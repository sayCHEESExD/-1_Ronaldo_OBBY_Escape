import { DEFAULT_SERVER_PORT } from '@obby/shared';

/** Runtime client configuration, overridable at build time via Vite env vars. */
export interface ClientConfig {
  /** Colyseus endpoint, e.g. ws://localhost:2567 */
  readonly serverUrl: string;
  /** Render the debug overlay and verbose console diagnostics. */
  readonly debug: boolean;
  /** Cap on devicePixelRatio, to protect mobile GPUs. */
  readonly maxPixelRatio: number;
}

const resolveServerUrl = (): string => {
  const fromEnv = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (fromEnv) return fromEnv;

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:${DEFAULT_SERVER_PORT}`;
};

export const clientConfig: ClientConfig = {
  serverUrl: resolveServerUrl(),
  debug: import.meta.env.DEV || import.meta.env['VITE_DEBUG'] === '1',
  maxPixelRatio: 2,
};
