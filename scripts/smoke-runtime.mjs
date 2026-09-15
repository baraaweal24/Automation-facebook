import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
process.loadEnvFile(resolve(root,'.env'));
const dbPath=resolve(root,'packages/database/prisma',process.env.DATABASE_URL.replace(/^file:/,''));
const db=new DatabaseSync(dbPath,{readOnly:true});
assert.notEqual(db.prepare("SELECT valueJson FROM SystemSetting WHERE key='automationState'").get()?.valueJson,'"RUNNING"','Stop automation before the smoke check');db.close();
const children=[];
try {
  for(const name of ['api','worker']) {
    const child=spawn(process.execPath,['--env-file='+resolve(root,'.env'),resolve(root,`apps/${name}/dist/main.js`)],{cwd:root,env:{...process.env,PORT:'3107'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    children.push({name,child});
    child.stderr.on('data',data=>process.stderr.write(data));
    let logs='';child.stdout.on('data',data=>{logs+=data;});
    const deadline=Date.now()+15000;
    while(!logs.includes(name==='api'?'API started':'worker started')) {
      if(child.exitCode!==null)throw new Error(`${name} exited ${child.exitCode}`);
      if(Date.now()>deadline)throw new Error(`${name} startup timed out`);
      await new Promise(r=>setTimeout(r,100));
    }
  }
  const health=await fetch('http://127.0.0.1:3107/api/health').then(r=>r.json());
  assert.equal(health.status,'ok');assert.equal(health.dryRun,true);
  assert.equal((await fetch('http://127.0.0.1:3107/api/my-groups')).status,401);
  console.log('Built API and worker start successfully; health is OK, data is protected, automation remains stopped.');
} finally {
  for(const {name,child} of children) {
    if(child.exitCode===null) {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    const lock=resolve(root,`data/${name}.pid`);
    if(existsSync(lock) && readFileSync(lock,'utf8')===String(child.pid))unlinkSync(lock);
  }
}
