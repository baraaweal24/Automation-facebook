import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, restoreDatabase, verifyBackup } from './sqlite-backup.js';

const root=resolve(import.meta.dirname,'..');
if (existsSync(resolve(root,'.env'))) process.loadEnvFile(resolve(root,'.env'));
const database=resolve(root,'packages/database/prisma',(process.env.DATABASE_URL ?? 'file:../../../data/app.db').replace(/^file:/,''));
const uploads=resolve(root,process.env.UPLOAD_PATH ?? './data/uploads');
const backups=resolve(root,'data/backups');
const mode=process.argv[2] ?? 'create';const source=process.argv[3];
if (mode==='verify') {
  if (!source) throw new Error('Usage: backup:verify <backup-directory>');
  verifyBackup(resolve(source));console.log('Backup checksums and SQLite integrity verified.');
} else {
  for (const name of ['api','worker']) {
    const path=resolve(root,'data',`${name}.pid`);
    if(!existsSync(path))continue;
    const pid=Number(readFileSync(path,'utf8'));
    let alive=true;try{process.kill(pid,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}
    if(alive)throw new Error(`Stop ${name} process ${pid} before backup or restore.`);
  }
  for (const name of ['facebook-profile.lock','chatgpt-profile.lock']) if(existsSync(resolve(root,'data',name))) throw new Error('Close browser sessions and stop API/worker before backup or restore.');
  const db=new DatabaseSync(database,{readOnly:true});
  try {
    const setting=db.prepare("SELECT valueJson FROM SystemSetting WHERE key='automationState'").get();
    const running=db.prepare("SELECT COUNT(*) AS n FROM AutomationTask WHERE status='RUNNING'").get();
    if (setting?.valueJson==='"RUNNING"' || Number(running?.n)>0) throw new Error('Stop automation, then stop API and worker first.');
  } finally {db.close();}
  if(mode==='restore') {
    if (!source || !process.argv.includes('--replace')) throw new Error('Usage: backup:restore <backup-directory> --replace (stop API/worker first)');
    console.log(restoreDatabase(resolve(source),database,uploads,backups));
  } else if(mode==='create') console.log(backupDatabase(database,uploads,backups));
  else throw new Error('Unknown backup operation.');
}
