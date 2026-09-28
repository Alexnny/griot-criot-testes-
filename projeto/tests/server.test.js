import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawn } from 'node:child_process';

let provider, child, temp, port, mockOrigin, base, cookieA, cookieB, convId;
let seenChat, seenToken;
async function call(route, options = {}) {
  const res = await fetch(base + route, { ...options, headers: { 'Content-Type':'application/json', ...(options.cookie ? { Cookie:options.cookie } : {}), ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status:res.status, data:await res.json(), headers:res.headers };
}
before(async () => {
  provider = http.createServer(async (req,res) => {
    assert.equal(req.headers['x-goog-api-key'],'TEST-GEMINI-KEY');
    const chunks=[];for await (const chunk of req) chunks.push(chunk);
    const rawBody=Buffer.concat(chunks).toString();
    const body=rawBody ? JSON.parse(rawBody) : {};
    res.setHeader('Content-Type','application/json');
    if(req.url === '/v1beta/models?pageSize=1') {res.end(JSON.stringify({models:[{name:'models/mock'}]}));return;}
    if(req.url === '/v1beta/auth_tokens') {
      seenToken=body;
      if (body.liveConnectConstraints || !body.bidiGenerateContentSetup?.model || body.fieldMask !== 'model') {
        res.statusCode=400;res.end(JSON.stringify({error:{message:'Invalid JSON payload: token setup incorrect.'}}));return;
      }
      res.end(JSON.stringify({name:'mock-ephemeral-token'}));return;
    }
    if(req.url.includes('generateContent')) {seenChat=body;res.end(JSON.stringify({candidates:[{content:{parts:[{text:'Olá! Teste com o Gemini mockado.'}]}}]}));return;}
    res.statusCode=404;res.end(JSON.stringify({error:{message:'Invalid mock route'}}));
  });
  await new Promise(resolve => provider.listen(0,'127.0.0.1',resolve));
  mockOrigin=`http://127.0.0.1:${provider.address().port}`;
  const tmpRoot=await fs.mkdtemp(path.join(os.tmpdir(),'nova-test-'));
  temp=tmpRoot;port=38000+Math.floor(Math.random()*15000);base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('../', import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:temp,GEMINI_API_KEY:'TEST-GEMINI-KEY',GEMINI_API_BASE:mockOrigin,SESSION_SECRET:'test-secret'.repeat(6)},stdio:['ignore','pipe','pipe']});
  let message='';child.stderr.on('data',data=>message+=data.toString());
  for(let i=0;i<100;i++) {await new Promise(r=>setTimeout(r,45));if(child.exitCode!==null)throw new Error('Server failed: '+message);try{const r=await fetch(base+'/api/status');if(r.ok)return;}catch{}}
  throw new Error('Server did not start');
});
after(async () => { child?.kill();provider?.close();if(temp)await fs.rm(temp,{recursive:true,force:true}); });

test('health and non-secret status',async()=>{
  const r=await call('/api/status');assert.equal(r.status,200);assert.equal(r.data.keyConfigured,true);
  assert.equal(r.data.liveModel,'gemini-3.8-live');assert.ok(!JSON.stringify(r.data).includes('TEST-GEMINI-KEY'));
});
test('Gemini verification requires login',async()=>{
  const r=await call('/api/gemini-check');assert.equal(r.status,401);
});
test('protected endpoint requires authentication',async()=>{
  const r=await call('/api/conversations');assert.equal(r.status,401);
});
test('registration and secure session cookie',async()=>{
  const r=await call('/api/auth/register',{method:'POST',body:{name:'Igor Teste',email:'igor@example.test',password:'SenhaSegura123'}});
  assert.equal(r.status,201);assert.equal(r.data.user.name,'Igor Teste');
  const header=r.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);
  cookieA=header.split(';')[0];assert.ok(cookieA.includes('nova_session='));
});
test('invalid registration and duplicate e-mail rejected',async()=>{
  const bad=await call('/api/auth/register',{method:'POST',body:{name:'A',email:'invalid',password:'123'}});assert.equal(bad.status,400);
  const dup=await call('/api/auth/register',{method:'POST',body:{name:'Igor',email:'igor@example.test',password:'SenhaSegura123'}});assert.equal(dup.status,409);
});
test('login rejects wrong password and accepts correct',async()=>{
  const bad=await call('/api/auth/login',{method:'POST',body:{email:'igor@example.test',password:'wrong'}});assert.equal(bad.status,401);
  const ok=await call('/api/auth/login',{method:'POST',body:{email:'igor@example.test',password:'SenhaSegura123'}});assert.equal(ok.status,200);
});
test('create conversation, save history and user preferences',async()=>{
  let r=await call('/api/conversations',{method:'POST',cookie:cookieA,body:{mode:'text'}});
  assert.equal(r.status,201);convId=r.data.conversation.id;
  r=await call(`/api/conversations/${convId}/messages`,{method:'POST',cookie:cookieA,body:{role:'user',text:'Tudo bem?'}});
  assert.equal(r.status,201);
  r=await call('/api/preferences',{method:'PUT',cookie:cookieA,body:{voice:'Aoede',persona:'Jake',wakeWord:'Jake'}});
  assert.equal(r.data.preferences.voice,'Aoede');assert.equal(r.data.preferences.persona,'Jake');
  r=await call(`/api/conversations/${convId}`,{cookie:cookieA});assert.equal(r.data.conversation.messages[0].text,'Tudo bem?');
});
test('Griot memory saves, deduplicates, and is available across sessions',async()=>{
  let r=await call('/api/memory',{cookie:cookieA});assert.equal(r.status,200);assert.deepEqual(r.data.memories,[]);
  r=await call('/api/memory',{method:'POST',cookie:cookieA,body:{text:'Meu nome é Igor e sou o criador da Griot.'}});
  assert.equal(r.status,201);const id=r.data.memory.id;
  r=await call('/api/memory',{method:'POST',cookie:cookieA,body:{text:'Meu nome é Igor e sou o criador da Griot.'}});
  assert.equal(r.status,200);assert.equal(r.data.alreadySaved,true);
  r=await call('/api/memory',{cookie:cookieA});assert.equal(r.data.memories.length,1);assert.equal(r.data.memories[0].id,id);
});
test('memory endpoints enforce authentication and input length',async()=>{
  let r=await call('/api/memory');assert.equal(r.status,401);
  r=await call('/api/memory',{method:'POST',cookie:cookieA,body:{text:'a'}});assert.equal(r.status,400);
});
test('Gemini text request sends saved context and server-held key',async()=>{
  const r=await call('/api/chat',{method:'POST',cookie:cookieA,body:{conversationId:convId,message:'Me ensine algo.'}});
  assert.equal(r.status,200);assert.match(r.data.reply,/Gemini mockado/);
  assert.equal(seenChat.systemInstruction.parts[0].text.includes('Jake'),true);
  assert.match(seenChat.systemInstruction.parts[0].text,/criador da Griot/);
  assert.equal(seenChat.contents[0].parts[0].text,'Tudo bem?');
  assert.equal(seenChat.contents.at(-1).parts[0].text,'Me ensine algo.');
  assert.ok(!JSON.stringify(r.data).includes('TEST-GEMINI-KEY'));
});
test('Gemini verification checks the provider without exposing the key',async()=>{
  const r=await call('/api/gemini-check',{cookie:cookieA});
  assert.equal(r.status,200);assert.equal(r.data.ok,true);
  assert.ok(!JSON.stringify(r.data).includes('TEST-GEMINI-KEY'));
});
test('HTTPS reverse-proxy origin is accepted and session cookies are secure',async()=>{
  const headers={'X-Forwarded-Proto':'https',Origin:`https://127.0.0.1:${port}`};
  const guest=await call('/api/auth/guest',{method:'POST',headers,body:{}});
  assert.equal(guest.status,201,JSON.stringify(guest.data));
  assert.match(guest.headers.get('set-cookie'),/; Secure/);
  const r=await call('/api/conversations',{method:'POST',cookie:guest.headers.get('set-cookie').split(';')[0],headers,body:{mode:'text'}});
  assert.equal(r.status,201,JSON.stringify(r.data));
});
test('Live API issues only restricted short-lived token, never raw key',async()=>{
  const r=await call('/api/live-token',{method:'POST',cookie:cookieA});
  assert.equal(r.status,200);assert.equal(r.data.token,'mock-ephemeral-token');
  assert.equal(seenToken.uses,1);
  assert.equal(seenToken.fieldMask,'model');
  assert.equal(seenToken.bidiGenerateContentSetup.model,'models/gemini-3.8-live');
  assert.equal(Object.hasOwn(seenToken,'liveConnectConstraints'),false);
  assert.ok(!JSON.stringify(r.data).includes('TEST-GEMINI-KEY'));
});
test('users cannot read each other\'s conversations',async()=>{
  let r=await call('/api/auth/register',{method:'POST',body:{name:'Outro Usuário',email:'other@example.test',password:'SenhaSegura123'}});
  cookieB=r.headers.get('set-cookie').split(';')[0];
  r=await call('/api/conversations/'+convId,{cookie:cookieB});assert.equal(r.status,404);
  r=await call('/api/conversations',{cookie:cookieB});assert.equal(r.data.conversations.length,0);
  r=await call('/api/memory',{cookie:cookieB});assert.equal(r.status,200);assert.deepEqual(r.data.memories,[]);
});
test('Griot memory can be deleted only by its owner',async()=>{
  const list=await call('/api/memory',{cookie:cookieA});const id=list.data.memories[0].id;
  let r=await call('/api/memory/'+id,{method:'DELETE',cookie:cookieB});assert.equal(r.status,404);
  r=await call('/api/memory/'+id,{method:'DELETE',cookie:cookieA});assert.equal(r.status,200);
  r=await call('/api/memory',{cookie:cookieA});assert.deepEqual(r.data.memories,[]);
});
test('cross-site origin rejected',async()=>{
  const r=await call('/api/conversations',{method:'POST',cookie:cookieA,headers:{Origin:'https://example-attacker.test'},body:{mode:'text'}});
  assert.equal(r.status,403);
});
test('static web resources available and sensitive file not exposed',async()=>{
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Griot/);
  const js=await fetch(base+'/app.js');assert.equal(js.status,200);
  const orb=await fetch(base+'/orb.js');assert.equal(orb.status,200);assert.match(await orb.text(),/createGriotOrb/);
  const env=await fetch(base+'/.env');assert.equal(env.status,404);
  const db=await fetch(base+'/.data/store.json');assert.equal(db.status,404);
});
test('conversation delete and logout',async()=>{
  let r=await call('/api/conversations/'+convId,{method:'DELETE',cookie:cookieA});assert.equal(r.status,200);
  r=await call('/api/conversations/'+convId,{cookie:cookieA});assert.equal(r.status,404);
  r=await call('/api/auth/logout',{method:'POST',cookie:cookieA});assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
