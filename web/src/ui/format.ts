const MB = 1024 * 1024;

export function formatMB(bytes: number): string {
  const mb = bytes / MB;
  const digits = mb < 10 ? 1 : 0;
  return `${mb.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })} МБ`;
}

/** Русское склонение: plural(5, ['файл', 'файла', 'файлов']) → «файлов». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function countFiles(n: number): string {
  return `${n.toLocaleString('ru-RU')} ${plural(n, ['файл', 'файла', 'файлов'])}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Неизвестная ошибка';
}
