/** Проверка набора файлов игры по нормализованным путям (до чтения содержимого). */

export interface Check {
  id: 'valve-liblist' | 'cstrike-liblist' | 'valve-wad' | 'cstrike-maps';
  label: string;
  ok: boolean;
  /** Что сделать, если проверка не прошла. */
  hint: string;
}

export interface Validation {
  ok: boolean;
  checks: Check[];
  /** Имена карт без «.bsp», отсортированы. */
  maps: string[];
  hasValve: boolean;
  hasCstrike: boolean;
}

/** Имена карт, которые можно безопасно передать в `map <имя>`. */
const SAFE_MAP_NAME = /^[A-Za-z0-9_.+-]{1,64}$/;

export function validateGamePaths(paths: Iterable<string>): Validation {
  let valveLiblist = false;
  let cstrikeLiblist = false;
  let hasValve = false;
  let hasCstrike = false;
  let wadCount = 0;
  const maps = new Set<string>();

  for (const path of paths) {
    const lower = path.toLowerCase();
    if (lower.startsWith('valve/')) hasValve = true;
    if (lower.startsWith('cstrike/')) hasCstrike = true;
    if (lower === 'valve/liblist.gam') valveLiblist = true;
    else if (lower === 'cstrike/liblist.gam') cstrikeLiblist = true;
    else if (/^valve\/[^/]+\.wad$/.test(lower)) wadCount++;
    else if (/^cstrike\/maps\/[^/]+\.bsp$/.test(lower)) {
      const file = path.slice('cstrike/maps/'.length);
      const name = file.slice(0, -'.bsp'.length);
      // Имя идёт в консольную команду `map <имя>`: пробелы, кавычки и `;` её ломают.
      if (SAFE_MAP_NAME.test(name)) maps.add(name);
    }
  }

  const checks: Check[] = [
    {
      id: 'valve-liblist',
      label: 'valve/liblist.gam',
      ok: valveLiblist,
      hint: hasValve
        ? 'В папке valve нет liblist.gam. Похоже, выбрана не та папка или копия неполная.'
        : 'Не найдена папка valve. Выберите папку Half-Life целиком или папку valve отдельно.',
    },
    {
      id: 'cstrike-liblist',
      label: 'cstrike/liblist.gam',
      ok: cstrikeLiblist,
      hint: hasCstrike
        ? 'В папке cstrike нет liblist.gam. Похоже, выбрана не та папка или копия неполная.'
        : 'Не найдена папка cstrike. Выберите папку Half-Life целиком или папку cstrike отдельно.',
    },
    {
      id: 'valve-wad',
      label: 'Текстуры (*.wad) в valve',
      ok: wadCount > 0,
      hint: 'В valve нет ни одного .wad-файла — без них не загрузятся текстуры карт.',
    },
    {
      id: 'cstrike-maps',
      label: 'Карты (*.bsp) в cstrike/maps',
      ok: maps.size > 0,
      hint: 'В cstrike/maps нет ни одной карты .bsp.',
    },
  ];

  return {
    ok: checks.every((c) => c.ok),
    checks,
    maps: [...maps].sort((a, b) => a.localeCompare(b, 'en')),
    hasValve,
    hasCstrike,
  };
}

/** Карта по умолчанию для офлайн-режима. */
export function defaultMap(maps: readonly string[]): string | undefined {
  return maps.find((m) => m.toLowerCase() === 'de_dust2') ?? maps.find((m) => m.toLowerCase().startsWith('de_')) ?? maps[0];
}
