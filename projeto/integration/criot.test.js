import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort() {
  const s = net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));
  const port=s.address().port;await new Promise(r=>s.close(r));return port;
}
test('Node + FastAPI + SQLite: fluxo, isolamento e reinício', {timeout:60000}, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(),'criot-integration-'));
  const port=await freePort(), internal=await freePort(), base=`http://127.0.0.1:${port}`;
  let child, logs='';
  async function start() {
    child=spawn(process.execPath,['start.js'],{cwd:root,env:{...process.env,
      CRIOT_ENABLED:'true', AI_PROVIDER:'mock', PORT:String(port), CRIOT_PORT:String(internal),
      GEMINI_API_KEY:'', DATABASE_URL:'', DATA_DIR:temp, SESSION_SECRET:'integration-secret-only-test-1234567890',
      PYTHON_BIN:process.env.PYTHON_BIN || 'python3'},stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
    for(let i=0;i<200;i++) {
      if(child.exitCode!==null)throw Error('Startup failed: '+logs);
      try {if((await fetch(base+'/api/status')).ok)return;}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error('Startup timeout: '+logs);
  }
  async function stop() {
    if(!child || child.exitCode!==null)return;
    const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;
  }
  async function call(route,cookie,method='GET',body,extra={}) {
    const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  try {
    await start();
    assert.equal((await call('/api/criot/health')).status,401);
    const a=(await call('/api/auth/guest',null,'POST',{})).cookie;
    const b=(await call('/api/auth/guest',null,'POST',{})).cookie;
    assert.equal((await call('/api/criot/health',a)).data.provedor,'mock');
    const c=await call('/api/criot/conversas',a,'POST',{titulo:'Meu teste'});
    assert.equal(c.status,201);const id=c.data.id;
    const route=`/api/criot/conversas/${id}/historico`;
    assert.equal((await call(route,b)).status,404);
    assert.deepEqual((await call('/api/criot/conversas',b)).data,[]);
    assert.equal((await call('/api/criot/chat',b,'POST',{conversa_id:id,prompt:'Espiar'})).status,404);
    const userA=(await call('/api/me',a)).data.user.id;
    assert.equal((await call(route,b,'GET',undefined,{'X-Criot-Owner':userA})).status,404);
    assert.equal((await call('/api/criot/chat',a,'POST',{conversa_id:id,prompt:' '})).status,422);
    const chat=await call('/api/criot/chat',a,'POST',{conversa_id:id,prompt:'Meu nome é Igor'});
    assert.equal(chat.status,200);assert.equal(chat.data.provedor,'mock');
    assert.match(chat.data.resposta,/SIMULAÇÃO/);
    assert.equal((await call(route,a)).data.length,2);
    const page=await fetch(base+'/laboratorio.html');assert.equal(page.status,200);
    assert.match(await page.text(),/Executar teste completo/);
    for(const asset of ['/laboratorio.js','/laboratorio.css'])assert.equal((await fetch(base+asset)).status,200);
    assert.equal((await fetch(base+'/criot/app/main.py')).status,404);
    await stop();await start();
    assert.equal((await call(route,a)).data.length,2);
    const next=await call('/api/criot/chat',a,'POST',{conversa_id:id,prompt:'Segundo turno'});
    assert.match(next.data.resposta,/número 2/);
    assert.equal((await call(route,a)).data.length,4);
    assert.equal((await call(route,b)).status,404);
    await stop();
    // O supervisor também deve encerrar o processo Python.
    await assert.rejects(fetch(`http://127.0.0.1:${internal}/health`));
  } finally {await stop();await rm(temp,{recursive:true,force:true});}
});
