const $ = id => document.getElementById(id);
let current = null, history = [], ready = false;
async function api(route, method = 'GET', body) {
  const r = await fetch(route, { method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir o teste.');
  return data;
}
function busy(value) {
  for (const id of ['test','new','refresh','conversations','prompt','send','export']) $(id).disabled = value || !ready;
}
async function action(fn) {
  busy(true);
  try { await fn(); } catch (e) { $('status').textContent = e.message; }
  finally { busy(false); }
}
function render(rows) {
  history = rows;
  $('messages').replaceChildren();
  for (const m of rows) {
    const box = document.createElement('div');box.className = 'message ' + m.papel;
    const label = document.createElement('strong');label.textContent = m.papel === 'user' ? 'Você' : 'Criot';
    box.append(label, document.createTextNode(m.conteudo));$('messages').append(box);
  }
}
async function list() {
  const rows = await api('/api/criot/conversas');
  $('conversations').replaceChildren();
  for (const c of rows) {
    const option = document.createElement('option');option.value = c.id;option.textContent = c.titulo + ' · #' + c.id;
    $('conversations').append(option);
  }
  if (!rows.some(c => c.id === current)) current = rows[0]?.id || null;
  $('conversations').value = current || '';
}
async function load() {
  if (!current) { render([]); return; }
  render(await api(`/api/criot/conversas/${current}/historico`));
}
async function create() {
  const c = await api('/api/criot/conversas','POST',{titulo:'Teste ' + new Date().toLocaleString('pt-BR')});
  current = c.id;await list();await load();
  $('status').textContent = 'Conversa #' + current + ' criada. Pode enviar uma mensagem.';
}
function result(text) { const li = document.createElement('li');li.textContent = text;$('results').append(li); }
$('new').onclick = () => action(create);
$('refresh').onclick = () => action(async () => { await list();await load();$('status').textContent = 'Histórico recuperado do servidor.'; });
$('conversations').onchange = () => action(async () => { current=Number($('conversations').value);await load(); });
$('form').onsubmit = e => { e.preventDefault();action(async () => {
  const prompt = $('prompt').value.trim();if (!prompt) return;
  if (!current) await create();
  const data = await api('/api/criot/chat','POST',{conversa_id:current,prompt});
  $('prompt').value='';await load();$('status').textContent = 'Resposta recebida · provedor: ' + data.provedor;
}); };
$('test').onclick = () => action(async () => {
  $('results').replaceChildren();
  await create();result('✓ Conversa criada pela API.');
  const reply = await api('/api/criot/chat','POST',{conversa_id:current,prompt:'Olá, Criot! Este é um teste do histórico.'});
  result('✓ Resposta recebida — ' + reply.provedor + '.');
  await load();
  if (history.length !== 2 || history[0].papel !== 'user' || history[1].papel !== 'criot') throw Error('O histórico retornado não corresponde ao teste.');
  result('✓ Mensagem e resposta recuperadas do SQLite.');
  result('Agora atualize esta página para conferir a leitura novamente.');
  $('status').textContent='Teste concluído. API, resposta e histórico funcionando nesta sessão.';
});
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({conversa_id:current,mensagens:history},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='criot-historico.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
action(async () => {
  const me = await api('/api/me');
  if (!me.user) await api('/api/auth/guest','POST',{});
  const health = await api('/api/criot/health');
  ready = true;await list();await load();
  $('status').textContent='API pronta · provedor: ' + health.provedor + '. Toque em Executar teste completo.';
});
