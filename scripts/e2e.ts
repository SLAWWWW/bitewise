/** Isolated browser harness. Never resets or migrates the developer's database. */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createMigratedDatabase, loadLocalEnv, rolePasswordsFromEnv } from '@/src/db/migrate-lib';
import { ensureCluster, freePort } from './db/start';
import { seedTenant } from '@/db/seed';

loadLocalEnv();
const children:ChildProcess[]=[];
function start(file:string,args:string[],env:NodeJS.ProcessEnv=process.env) {
  const child=spawn(file,args,{env,stdio:'inherit'});children.push(child);return child;
}
function exited(child:ChildProcess):Promise<number> {
  if(child.exitCode!=null||child.signalCode!=null)return Promise.resolve(child.exitCode??1);
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}
async function stopChildren(){
  for(const child of children)if(child.exitCode==null&&child.signalCode==null)child.kill('SIGTERM');
  await Promise.all(children.map(async child=>{
    if(child.exitCode!=null||child.signalCode!=null)return;
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{await exited(child);}finally{clearTimeout(timer);}
  }));
}
process.once('SIGINT',()=>{void stopChildren();});
process.once('SIGTERM',()=>{void stopChildren();});
async function main(){
  const args=process.argv.slice(2);
  if(process.env.E2E_BASE_URL){process.exitCode=await exited(start(process.execPath,['node_modules/@playwright/test/cli.js','test',...args]));return;}
  const cluster=await ensureCluster([process.env.TEST_DATABASE_ADMIN_URL,process.env.DATABASE_ADMIN_URL],{dirPrefix:'pg-e2e'});
  let db:Awaited<ReturnType<typeof createMigratedDatabase>>|undefined;
  try{
    db=await createMigratedDatabase(cluster.adminUrl,`lumbung_e2e_${process.pid}_${randomBytes(3).toString('hex')}`,rolePasswordsFromEnv());
    await seedTenant(db.ownerUrl,{mode:'TEST',expected:'skip'});
    const port=await freePort();const baseURL=`http://127.0.0.1:${port}`;
    const env={...process.env,APP_MODE:'TEST',DATABASE_URL:db.appUrl,DATABASE_OWNER_URL:'',DATABASE_ADMIN_URL:'',APP_BASE_URL:baseURL,E2E_BASE_URL:baseURL,E2E_MANAGED:'1'};
    if(process.env.E2E_SKIP_BUILD!=='1'){
      const code=await exited(start('npm',['run','build'],env));if(code!==0)throw new Error('Production build failed');
    }
    const server=start(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],env);
    start(process.execPath,['node_modules/tsx/dist/cli.mjs','--conditions=react-server','src/jobs/worker-main.ts'],env);
    let ready=false;
    for(let attempt=0;attempt<120;attempt++){
      if(server.exitCode!=null)throw new Error('Web server stopped before readiness');
      try{const r=await fetch(`${baseURL}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error('Web server readiness timed out');
    process.exitCode=await exited(start(process.execPath,['node_modules/@playwright/test/cli.js','test',...args],env));
  }finally{await stopChildren();await db?.drop();await cluster.stop();}
}
void main().catch(e=>{console.error(e instanceof Error?e.message:'E2E setup failed');process.exitCode=1;});
