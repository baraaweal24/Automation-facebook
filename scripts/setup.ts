import { randomBytes } from 'node:crypto';
import { access, mkdir, open, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
try {
  await access(envPath);
  console.log('.env already exists; leaving it unchanged.');
} catch {
  const example = await readFile(resolve(root, '.env.example'), 'utf8');
  const secret = randomBytes(48).toString('base64url');
  await writeFile(envPath, example.replace('replace-with-at-least-32-random-characters', secret).replace('DATABASE_URL=file:../../../data/app.db', `DATABASE_URL=file:${resolve(root,'data/app.db').replace(/\\/g,'/')}`), { encoding: 'utf8', flag: 'wx' });
  console.log('Created .env with a cryptographically random session secret.');
}
// The original repository shipped an empty lock without a browser profile.
try {
  await access(resolve(root,'data/browser-profile'));
} catch {
  const lock=resolve(root,'data/facebook-profile.lock');
  if (await stat(lock).then(s=>s.size===0).catch(()=>false)) await rename(lock,lock+'.legacy-'+Date.now());
}
for (const directory of ['data', 'data/browser-profile', 'data/chatgpt-profile', 'data/screenshots', 'data/uploads']) await mkdir(resolve(root, directory), { recursive: true });
await (await open(resolve(root, 'data/app.db'), 'a')).close();
console.log('Runtime directories are ready.');
