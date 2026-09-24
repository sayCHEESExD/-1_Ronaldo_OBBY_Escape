/** Minimal prefixed logger so server output is greppable without a dependency. */
const ts = (): string => new Date().toISOString().slice(11, 23);

export const logger = {
  info: (scope: string, ...args: unknown[]): void =>
    console.log(`[${ts()}] [${scope}]`, ...args),
  warn: (scope: string, ...args: unknown[]): void =>
    console.warn(`[${ts()}] [${scope}] WARN`, ...args),
  error: (scope: string, ...args: unknown[]): void =>
    console.error(`[${ts()}] [${scope}] ERROR`, ...args),
};
