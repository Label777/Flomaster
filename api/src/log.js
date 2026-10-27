// @ts-check
/**
 * Структурированные логи: одна строка JSON на событие в stdout.
 * Уровень задаётся переменной LOG_LEVEL (debug | info | warn | error), по умолчанию info.
 */

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */
/** @typedef {(level: LogLevel, msg: string, fields?: Record<string, unknown>) => void} Logger */

/** @type {Record<LogLevel, number>} */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * @param {string | undefined} name
 * @returns {LogLevel}
 */
export function parseLevel(name) {
  const v = String(name ?? '').toLowerCase();
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info';
}

/**
 * @param {{ level?: LogLevel, write?: (line: string) => void }} [opts]
 * @returns {Logger}
 */
export function createLogger(opts = {}) {
  const min = LEVELS[opts.level ?? 'info'];
  const write = opts.write ?? ((line) => process.stdout.write(line));
  return (level, msg, fields) => {
    if (LEVELS[level] < min) return;
    /** @type {Record<string, unknown>} */
    const rec = { ts: new Date().toISOString(), level, msg };
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        rec[k] = v instanceof Error ? { name: v.name, message: v.message, code: /** @type {any} */ (v).code } : v;
      }
    }
    let line;
    try {
      line = JSON.stringify(rec);
    } catch {
      line = JSON.stringify({ ts: rec.ts, level, msg, note: 'unserializable fields' });
    }
    write(line + '\n');
  };
}

/** Логгер, который ничего не пишет (для тестов). @type {Logger} */
export const silentLogger = () => {};
