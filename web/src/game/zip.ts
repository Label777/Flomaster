/** Чтение .zip с valve/ и cstrike/ в корне (допускается одна обёртывающая папка). */
import JSZip from 'jszip';
import { ScanBuilder, type ScanProgress, type SourceScan } from './files';

export async function scanZip(file: File, onProgress?: ScanProgress): Promise<SourceScan> {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('Не удалось открыть архив. Нужен обычный .zip (не .rar и не .7z).');
  }
  const builder = new ScanBuilder(undefined, onProgress);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    // Размер до распаковки jszip наружу не отдаёт — прогресс считается по числу файлов.
    builder.add(entry.name, null, () => entry.async('uint8array'));
  }
  return builder.finish(file.name);
}
