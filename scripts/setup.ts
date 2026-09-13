import { randomBytes } from 'node:crypto';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
try {
  await access(envPath);
  console.log('.env already exists; leaving it unchanged.');
} catch {
  const example = await readFile(resolve(root, '.env.example'), 'utf8');
  const secret = randomBytes(48).toString('base64url');
  await writeFile(envPath, example.replace('replace-with-at-least-32-random-characters', secret), { encoding: 'utf8', flag: 'wx' });
  console.log('Created .env with a cryptographically random session secret.');
}
for (const directory of ['data', 'data/browser-profile', 'data/screenshots', 'data/uploads']) await mkdir(resolve(root, directory), { recursive: true });
await (await open(resolve(root, 'data/app.db'), 'a')).close();
console.log('Runtime directories are ready.');
