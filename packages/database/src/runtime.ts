import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function acquireProcessLock(name: 'api' | 'worker') {
  const directory=resolve('data');mkdirSync(directory,{recursive:true});
  const path=resolve(directory,`${name}.pid`);
  if(existsSync(path)) {
    const owner=Number(readFileSync(path,'utf8'));
    if(!Number.isInteger(owner) || owner<=0)throw new Error(`Invalid process lock: ${path}`);
    let alive=true;try{process.kill(owner,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}
    if(alive)throw new Error(`${name} already runs as process ${owner}.`);
    unlinkSync(path);
  }
  writeFileSync(path,String(process.pid),{flag:'wx'});
  process.once('exit',()=>{try{if(readFileSync(path,'utf8')===String(process.pid))unlinkSync(path);}catch{/* Already released. */}});
}
