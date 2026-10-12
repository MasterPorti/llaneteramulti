import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Solo crea una copia nueva. No elimina ni reemplaza datos de la aplicación.
const root = fileURLToPath(new URL('../', import.meta.url));
const relativeRoots = ['data', 'public', 'lib', 'types', 'app', 'components', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'middleware.ts'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function listFiles(relative) {
  const absolute = path.join(root, relative);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`No se copia un enlace simbólico: ${relative}`);
  if (stat.isFile()) return [relative.replaceAll('\\', '/')];
  if (!stat.isDirectory()) throw new Error(`Tipo de archivo no soportado: ${relative}`);
  const children = await readdir(absolute);
  const groups = await Promise.all(children.sort().map((name) => listFiles(path.join(relative, name))));
  return groups.flat();
}

async function main() {
  const files = (await Promise.all(relativeRoots.map(listFiles))).flat().sort();
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backup = path.join(root, '.migration-backups', `${stamp}-destino-${randomUUID().slice(0, 8)}`);
  await mkdir(backup, { recursive: true });
  const entries = [];
  for (const relative of files) {
    const bytes = await readFile(path.join(root, relative));
    const target = path.join(backup, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    if (sha256(await readFile(target)) !== sha256(bytes)) throw new Error(`Copia inválida: ${relative}`);
    entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const afterFiles = (await Promise.all(relativeRoots.map(listFiles))).flat().sort();
  if (JSON.stringify(files) !== JSON.stringify(afterFiles)) throw new Error('Cambió el conjunto de archivos durante el respaldo. Repetir con el destino detenido.');
  for (const entry of entries) {
    if (sha256(await readFile(path.join(root, entry.path))) !== entry.sha256) {
      throw new Error(`El origen cambió durante la copia: ${entry.path}. Repetir con el destino detenido.`);
    }
  }
  const manifest = { formatVersion: 1, createdAt: new Date().toISOString(), sourceRoot: root, verified: true, note: 'Copia de archivos locales verificada byte por byte. Repetir antes del corte con la aplicación detenida. No incluye secretos ni node_modules.', files: entries };
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ backup, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), verified: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
