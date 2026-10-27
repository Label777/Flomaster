/** Логи с префиксом. debug — только в dev-сборке. */
const PREFIX = '[cs16-web]';

export const log = {
  debug(...args: unknown[]): void {
    if (import.meta.env.DEV) console.debug(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
