import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function files(root: string, prefix=''): string[] {
  return readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not supported in backups.');
    const name=join(prefix,entry.name);return entry.isDirectory()?files(root,name):[name];
  });
}
function checked(root: string, path: string) {
  const target=resolve(root,path);const rel=relative(root,target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Backup contains an invalid path.');
  return target;
}
export function verifyBackup(directory: string) {
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')) as {database:string;uploads:string;files:Record<string,string>};
  const actual=files(directory).filter(name=>name!=='manifest.json').sort();
  if(JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.files).sort()))throw new Error('Backup file inventory does not match the manifest.');
  for (const [name,digest] of Object.entries(manifest.files)) if (hash(checked(directory,name))!==digest) throw new Error(`Backup checksum mismatch: ${name}`);
  if (!manifest.files['app.db']) throw new Error('Database is missing from the manifest.');
  const db=new DatabaseSync(join(directory,'app.db'),{readOnly:true});
  try {
    const result=db.prepare('PRAGMA integrity_check').get();
    if (!result || Object.values(result)[0]!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed.');
  } finally { db.close(); }
  return manifest;
}
export function backupDatabase(database: string, uploads: string, backupRoot: string) {
  const destination=join(backupRoot,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
  mkdirSync(destination,{recursive:true});
  const db=new DatabaseSync(database);
  try { db.prepare('VACUUM INTO ?').run(join(destination,'app.db')); } finally { db.close(); }
  if (existsSync(uploads)) cpSync(uploads,join(destination,'uploads'),{recursive:true,dereference:false});
  const manifest={database:resolve(database),uploads:resolve(uploads),createdAt:new Date().toISOString(),files:Object.fromEntries(files(destination).map(name=>[name,hash(join(destination,name))]))};
  writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
  verifyBackup(destination);
  return destination;
}
export function restoreDatabase(directory: string, database: string, uploads: string, backupRoot: string) {
  const manifest=verifyBackup(directory);
  if (resolve(manifest.database)!==resolve(database) || resolve(manifest.uploads)!==resolve(uploads)) throw new Error('Restore must target the original paths so saved attachment references remain valid.');
  const previous=existsSync(database)?backupDatabase(database,uploads,backupRoot):null;
  const staging=database+'.restore-'+randomUUID();
  copyFileSync(join(directory,'app.db'),staging);
  const db=new DatabaseSync(staging);
  try {
    db.exec(`UPDATE SystemSetting SET valueJson='"STOPPED"' WHERE key='automationState';
      UPDATE AutomationTask SET status='PAUSED', leaseToken=NULL, leaseExpiresAt=NULL WHERE status IN ('RUNNING','QUEUED','RETRY');
      UPDATE Post SET status='MANUAL_ACTION_REQUIRED' WHERE status='POSTING';
      DELETE FROM Session;`);
  } finally { db.close(); }
  if (existsSync(database)) {
    const live=new DatabaseSync(database);
    try { live.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { live.close(); }
  }
  const old=database+'.before-restore-'+randomUUID();
  if (existsSync(database)) renameSync(database,old);
  try {
    renameSync(staging,database);
    if (existsSync(join(directory,'uploads'))) cpSync(join(directory,'uploads'),uploads,{recursive:true});
  } catch(error) { if (!existsSync(database) && existsSync(old)) renameSync(old,database); throw error; }
  return {previous,previousDatabase:old};
}
