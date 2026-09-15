import { existsSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../data');
if (!process.argv.includes('--confirm-closed')) throw new Error('Close API, worker and all application browser windows, then run browser:unlock --confirm-closed.');
for(const name of ['facebook-profile.lock','chatgpt-profile.lock']) {
  const path=resolve(root,name);
  if (!existsSync(path)) continue;
  let pid: number | undefined;
  try {pid=JSON.parse(readFileSync(path,'utf8')).pid;} catch { /* Legacy empty lock. */ }
  if (pid) {
    let alive=true;try{process.kill(pid,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}
    if(alive)throw new Error(`Process ${pid} still owns ${name}. Close it first.`);
  }
  renameSync(path,path+'.legacy-'+Date.now());
  console.log(`Archived stale lock: ${name}`);
}
