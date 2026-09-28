import { criotRequest } from './criot-bridge.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv(filename) {
  if (!existsSync(filename)) return;
  for (const row of readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = row.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnv(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || '.data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(DATA_DIR, 'store.json');
const scrypt = promisify(crypto.scrypt);
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
let secret = process.env.SESSION_SECRET;
if (!secret) {
  const secretPath = path.join(DATA_DIR, '.session-secret');
  if (!existsSync(secretPath)) writeFileSync(secretPath, crypto.randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
  secret = readFileSync(secretPath, 'utf8').trim();
}
let db = { users: [], conversations: [], memories: [] };
if (existsSync(DB_PATH)) db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
if (!Array.isArray(db.memories)) db.memories = [];
// DATABASE_URL + SESSION_SECRET são necessários para persistência entre deploys no Render.
let pgClient = null;
if (process.env.DATABASE_URL) {
  const { Client } = await import('pg');
  pgClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  await pgClient.connect();
  await pgClient.query('CREATE TABLE IF NOT EXISTS griot_store (id INTEGER PRIMARY KEY, payload JSONB NOT NULL)');
  const stored = await pgClient.query('SELECT payload FROM griot_store WHERE id=1');
  if (stored.rows[0]) db = stored.rows[0].payload;
  console.log('Persistência PostgreSQL conectada.');
} else console.warn('ATENÇÃO: sem DATABASE_URL; dados locais podem desaparecer em reinicializações do Render.');
if (!Array.isArray(db.memories)) db.memories = [];
let saveQueue = Promise.resolve();
function saveDb() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const tmp = DB_PATH + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await fs.rename(tmp, DB_PATH);
    if (pgClient) await pgClient.query('INSERT INTO griot_store(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload', [JSON.stringify(db)]);
  });
  return saveQueue;
}
function json(res, code, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
const cookieName = 'nova_session';
const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
function makeSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, expires: Date.now() + 14 * 86400000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function getUser(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(a => a.length === 2));
  const session = cookies[cookieName];
  if (!session) return null;
  const [payload, signature] = session.split('.');
  if (!payload || !signature || signature.length !== sign(payload).length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
  try {
    const sessionData = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (sessionData.expires < Date.now()) return null;
    return db.users.find(user => user.id === sessionData.userId) || null;
  } catch { return null; }
}
function requestProtocol(req) {
  // Render and similar reverse proxies terminate HTTPS before forwarding requests.
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return (req.socket.encrypted || forwarded === 'https') ? 'https' : 'http';
}
function sessionCookie(req, value, maxAge = 14 * 86400) {
  const isSecure = (process.env.PUBLIC_ORIGIN || '').startsWith('https://') || requestProtocol(req) === 'https';
  return `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`;
}
async function getJsonBody(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 80_000) throw Object.assign(new Error('Requisição muito grande.'), { status: 413 });
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
const hitMap = new Map();
function rateLimit(req, label, limit = 30, intervalMs = 60000) {
  const ip = req.socket.remoteAddress || 'unknown';
  const key = `${ip}:${label}`; const now = Date.now();
  const hits = (hitMap.get(key) || []).filter(time => now - time < intervalMs);
  hits.push(now); hitMap.set(key, hits);
  return hits.length <= limit;
}
setInterval(() => { if (hitMap.size > 4000) hitMap.clear(); }, 600000).unref();
const exposeUser = u => ({ id: u.id, name: u.name, email: u.email, guest: u.guest, preferences: u.preferences || {} });
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  return `${salt}:${digest.toString('hex')}`;
}
async function checkPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
function validatePassword(password) { return typeof password === 'string' && password.length >= 8 && password.length <= 128; }
function needAuth(req, res) {
  const user = getUser(req);
  if (!user) json(res, 401, { error: 'Entre na sua conta para continuar.' });
  return user;
}
function checkWriteOrigin(req, res) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') { json(res, 403, { error: 'Origem não permitida.' }); return false; }
  if (req.headers.origin) {
    let origin; try { origin = new URL(req.headers.origin).origin; } catch { origin = ''; }
    const allowed = process.env.PUBLIC_ORIGIN || `${requestProtocol(req)}://${req.headers.host}`;
    const localAllowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    if (origin !== allowed && !localAllowed.includes(origin)) {
      json(res, 403, { error: 'Origem não permitida. Configure PUBLIC_ORIGIN para produção.' }); return false;
    }
  }
  return true;
}
function providerError(status, data) {
  const providerMessage = data?.error?.message || '';
  if (status === 429) return { status: 429, error: 'Limite gratuito do Gemini atingido. Tente novamente mais tarde.' };
  if (status === 400 || status === 404) return { status: 502, error: `Modelo ou parâmetros indisponíveis no projeto Google. ${providerMessage.slice(0, 160)}` };
  if (status === 401 || status === 403) return { status: 502, error: 'Sua chave do Gemini não tem acesso. Verifique a chave, modelo e disponibilidade regional.' };
  return { status: 502, error: `O Gemini retornou um erro (${status}). ${providerMessage.slice(0, 160)}` };
}
function configuredKey() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key && !key.includes('COLE_SUA_CHAVE') && !key.includes('SUA_CHAVE') ? key : null;
}
const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const textModel = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
const geminiApiOrigin = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const persona = name => `Você é ${name}, uma IA pessoal que conversa em português brasileiro quando o usuário falar português e acompanha o idioma dele. Seu estilo é natural, espontâneo, direto e acolhedor, sem fingir ser humana. Responda primeiro à pergunta concreta, sem introduções automáticas. Evite abrir respostas com "Como posso te ajudar hoje?", "Claro!", "Com certeza!" ou repetir o nome do usuário a cada mensagem. Não cumprimente de novo durante a mesma conversa. Evite repetir palavras, perguntas ou trechos de respostas anteriores; só retome um assunto quando isso ajudar. Varie a construção das frases e o comprimento das respostas conforme a situação: breve para perguntas simples, detalhada quando solicitado. Não termine toda resposta com uma pergunta genérica. Seja capaz de discordar com respeito, reconhecer incertezas e mudar de assunto naturalmente. Em conversas por voz, não use Markdown e priorize frases fáceis de ouvir. Não invente ações realizadas, acesso a aplicativos ou informações que não possui. Memórias e histórico servem para contextualizar, não para repetir respostas antigas.`;
function memoryFor(userId) { return db.memories.filter(m => m.userId === userId).sort((a,b) => a.at.localeCompare(b.at)); }
function recentOtherChats(userId, currentId) {
  return getConversations(userId).filter(c => c.id !== currentId).slice(0, 5).map(c => {
    const lines = c.messages.slice(-3).map(m => `${m.role === 'assistant' ? 'Griot' : 'Usuário'}: ${m.text.slice(0, 270)}`).join('\n');
    return `${c.title.slice(0, 70)}\n${lines}`;
  }).join('\n---\n').slice(0, 4400);
}
function getConversations(userId) {
  return db.conversations.filter(c => c.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
const cleanText = (val, n = 2000) => typeof val === 'string' ? val.trim().slice(0, n) : '';
async function api(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { keyConfigured: !!configuredKey(), textModel, liveModel, persistentStorage: !!pgClient });
  }
  if (pathname === '/api/context' && req.method === 'GET') {
    const user = needAuth(req, res); if (!user) return;
    const recent = getConversations(user.id).slice(0, 12).flatMap(c => c.messages.slice(-8).map(m => ({ role: m.role, text: m.text, at: m.at }))).sort((a,b) => a.at.localeCompare(b.at)).slice(-50);
    return json(res, 200, { recent, memories: memoryFor(user.id).slice(-100) });
  }
  if (pathname === '/api/export' && req.method === 'GET') {
    const user = needAuth(req, res); if (!user) return;
    return json(res, 200, { exportedAt: new Date().toISOString(), conversations: getConversations(user.id), memories: memoryFor(user.id), preferences: user.preferences });
  }
  if (pathname === '/api/gemini-check' && req.method === 'GET') {
    const user = needAuth(req, res);
    if (!user) return;
    const key = configuredKey();
    if (!key) return json(res, 503, { ok: false, error: 'A chave Gemini ainda não está configurada.' });
    if (!rateLimit(req, `check-${user.id}`, 4, 60000)) return json(res, 429, { ok: false, error: 'Aguarde antes de verificar novamente.' });
    // Real verification is opt-in. Never return the long-lived credential to the browser.
    const response = await fetch(`${geminiApiOrigin}/v1beta/models?pageSize=1`, {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) { const err = providerError(response.status, data); return json(res, err.status, { ok: false, error: err.error }); }
    return json(res, 200, { ok: true, message: 'Sua chave foi aceita pelo Google. O acesso aos modelos depende da sua conta.' });
  }
  if (pathname === '/api/me' && req.method === 'GET') {
    const user = getUser(req);
    return json(res, 200, { user: user ? exposeUser(user) : null });
  }
  if (pathname === '/api/auth/guest' && req.method === 'POST') {
    if (!rateLimit(req, 'guest', 10, 3600000)) return json(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' });
    const existing = getUser(req);
    if (existing) return json(res, 200, { user: exposeUser(existing) });
    const user = { id: crypto.randomUUID(), name: 'Visitante', email: null, passwordHash: null, guest: true, createdAt: new Date().toISOString(), preferences: { voice: 'Kore', wakeWord: 'Griot', persona: 'Griot' } };
    db.users.push(user); await saveDb();
    return json(res, 201, { user: exposeUser(user) }, { 'Set-Cookie': sessionCookie(req, makeSession(user.id)) });
  }
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (!rateLimit(req, 'register', 5, 3600000)) return json(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' });
    const body = await getJsonBody(req);
    const name = cleanText(body.name, 60); const email = cleanText(body.email, 254).toLowerCase();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validatePassword(body.password)) return json(res, 400, { error: 'Informe nome, e-mail válido e senha de 8 a 128 caracteres.' });
    if (db.users.some(u => u.email === email)) return json(res, 409, { error: 'Este e-mail já está cadastrado.' });
    const user = { id: crypto.randomUUID(), name, email, passwordHash: await hashPassword(body.password), guest: false, createdAt: new Date().toISOString(), preferences: { voice: 'Kore', wakeWord: 'Griot', persona: 'Griot' } };
    db.users.push(user); await saveDb();
    return json(res, 201, { user: exposeUser(user) }, { 'Set-Cookie': sessionCookie(req, makeSession(user.id)) });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!rateLimit(req, 'login', 12, 15 * 60000)) return json(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' });
    const body = await getJsonBody(req);
    const user = db.users.find(u => u.email && u.email === cleanText(body.email, 254).toLowerCase());
    if (!user || !await checkPassword(body.password || '', user.passwordHash)) return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    return json(res, 200, { user: exposeUser(user) }, { 'Set-Cookie': sessionCookie(req, makeSession(user.id)) });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  const user = needAuth(req, res);
  if (!user) return;
  if (pathname.startsWith('/api/criot/')) {
    const route = pathname.slice('/api/criot'.length);
    const read = req.method === 'GET' && (route === '/health' || route === '/conversas' || /^\/conversas\/[1-9][0-9]*\/historico$/.test(route));
    const write = req.method === 'POST' && ['/conversas', '/chat'].includes(route);
    if (!read && !write) return json(res, 404, { error: 'Rota Criot não encontrada.' });
    if (!rateLimit(req, `criot-${user.id}`, 60, 60000)) return json(res, 429, { error: 'Aguarde um minuto antes de continuar.' });
    const body = write ? await getJsonBody(req) : undefined;
    const data = await criotRequest(user.id, route, req.method, body);
    return json(res, route === '/conversas' && write ? 201 : 200, data);
  }
  if (pathname === '/api/memory' && req.method === 'GET') {
    return json(res, 200, { memories: memoryFor(user.id).map(({id,text,at}) => ({id,text,at})) });
  }
  if (pathname === '/api/memory' && req.method === 'POST') {
    const body = await getJsonBody(req);
    const text = cleanText(body.text, 600);
    if (text.length < 3) return json(res, 400, { error: 'Informe uma memória válida.' });
    const memories = memoryFor(user.id);
    const existing = memories.find(m => m.text.toLocaleLowerCase('pt-BR') === text.toLocaleLowerCase('pt-BR'));
    if (existing) return json(res, 200, { memory: { id: existing.id, text: existing.text, at: existing.at }, alreadySaved: true });
    if (memories.length >= 10000) return json(res, 409, { error: 'Limite de memórias atingido. Exporte seus dados antes de excluir.' });
    const memory = { id: crypto.randomUUID(), userId: user.id, text, at: new Date().toISOString() };
    db.memories.push(memory); await saveDb();
    return json(res, 201, { memory: { id: memory.id, text: memory.text, at: memory.at } });
  }
  const memoryDelete = pathname.match(/^\/api\/memory\/([0-9a-f-]+)$/);
  if (memoryDelete && req.method === 'DELETE') {
    const idx = db.memories.findIndex(m => m.id === memoryDelete[1] && m.userId === user.id);
    if (idx === -1) return json(res, 404, { error: 'Memória não encontrada.' });
    db.memories.splice(idx, 1); await saveDb(); return json(res, 200, { ok: true });
  }
  if (pathname === '/api/preferences' && req.method === 'PUT') {
    const body = await getJsonBody(req);
    const voices = ['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir'];
    const voice = voices.includes(body.voice) ? body.voice : 'Kore';
    const wakeWord = cleanText(body.wakeWord, 25).replace(/[<>]/g, '') || 'Nova';
    const chosenPersona = cleanText(body.persona, 25).replace(/[<>]/g, '') || 'Griot';
    user.preferences = { voice, wakeWord, persona: chosenPersona };
    await saveDb(); return json(res, 200, { preferences: user.preferences });
  }
  if (pathname === '/api/conversations' && req.method === 'GET') {
    return json(res, 200, { conversations: getConversations(user.id).map(c => ({ ...c, messages: undefined })) });
  }
  if (pathname === '/api/conversations' && req.method === 'POST') {
    const body = await getJsonBody(req); const now = new Date().toISOString();
    const conv = { id: crypto.randomUUID(), userId: user.id, title: cleanText(body.title, 75) || 'Nova conversa', mode: ['text', 'voice'].includes(body.mode) ? body.mode : 'text', createdAt: now, updatedAt: now, messages: [] };
    db.conversations.push(conv); await saveDb(); return json(res, 201, { conversation: conv });
  }
  const convMatch = pathname.match(/^\/api\/conversations\/([0-9a-f-]+)(?:\/messages)?$/);
  if (convMatch) {
    const conv = db.conversations.find(c => c.id === convMatch[1] && c.userId === user.id);
    if (!conv) return json(res, 404, { error: 'Conversa não encontrada.' });
    if (req.method === 'GET' && !pathname.endsWith('/messages')) return json(res, 200, { conversation: conv });
    if (req.method === 'DELETE' && !pathname.endsWith('/messages')) {
      db.conversations.splice(db.conversations.indexOf(conv), 1); await saveDb(); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname.endsWith('/messages')) {
      const body = await getJsonBody(req); const content = cleanText(body.text, 12000);
      if (!content || !['user', 'assistant'].includes(body.role)) return json(res, 400, { error: 'Mensagem inválida.' });
      const m = { id: crypto.randomUUID(), role: body.role, text: content, at: new Date().toISOString() };
      conv.messages.push(m); // Nunca elimine automaticamente mensagens antigas: o contexto enviado ao modelo é limitado, não o arquivo histórico.
      if (conv.title === 'Nova conversa' && body.role === 'user') conv.title = content.slice(0, 55);
      conv.updatedAt = new Date().toISOString(); await saveDb(); return json(res, 201, { message: m, title: conv.title });
    }
  }
  if (pathname === '/api/live-token' && req.method === 'POST') {
    const key = configuredKey();
    if (!key) return json(res, 503, { error: 'Configure GEMINI_API_KEY no arquivo .env do servidor.' });
    if (!rateLimit(req, `live-${user.id}`, 12, 15 * 60000)) return json(res, 429, { error: 'Limite de sessões atingido. Tente novamente mais tarde.' });
    // Token único e temporário. A chave real nunca sai do servidor.
    const now = Date.now();
    const response = await fetch(geminiApiOrigin + '/v1beta/auth_tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        uses: 1,
        newSessionExpireTime: new Date(now + 60000).toISOString(),
        expireTime: new Date(now + 15 * 60000).toISOString(),
        // Current REST API uses BidiGenerateContentSetup, not liveConnectConstraints.
        // Lock just the model; allow the browser to choose the session voice and instructions.
        fieldMask: 'model',
        bidiGenerateContentSetup: { model: `models/${liveModel}` }
      }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) { const err = providerError(response.status, data); return json(res, err.status, { error: err.error }); }
    if (!data.name) return json(res, 502, { error: 'O provedor não retornou um token de sessão.' });
    return json(res, 200, { token: data.name, model: liveModel });
  }
  // Busca pública em múltiplos provedores, sem chave de IA. Fontes são apresentadas separadamente.
  if (pathname === '/api/public-search' && req.method === 'POST') {
    const user = needAuth(req, res); if (!user) return;
    if (!rateLimit(req, `search-${user.id}`, 12, 60000)) return json(res, 429, { error: 'Muitas pesquisas. Aguarde um minuto.' });
    const body = await getJsonBody(req);
    const query = cleanText(body.query, 180);
    if (query.length < 2) return json(res, 400, { error: 'Digite pelo menos dois caracteres para pesquisar.' });
    const conv = db.conversations.find(c => c.id === body.conversationId && c.userId === user.id);
    const plain = query.toLocaleLowerCase('pt-BR').replace(/[!?.,]/g, '').trim();
    const greeting = /^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|e ai|tudo bem|obrigad[oa]|valeu)$/.test(plain);
    const replyGreeting = /obrigad|valeu/.test(plain) ? 'Por nada! Se quiser continuar o assunto, estou por aqui.' : 'Oi! Estou por aqui. O que você tem em mente?';
    let sources = [];
    if (!greeting) {
      const clean = text => String(text || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
      const wiki = async () => {
        const url = new URL('https://pt.wikipedia.org/w/api.php');
        url.search = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: query, gsrlimit: '3', prop: 'extracts|info', exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url', format: 'json' }).toString();
        const r = await fetch(url, { headers: { 'User-Agent': 'GriotPersonalAssistant/2.0 (educational public search)' }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw Error('Wikipedia indisponível');
        const d = await r.json();
        return Object.values(d.query?.pages || {}).sort((a,b) => (a.index || 0) - (b.index || 0)).map(p => ({ title: p.title, snippet: clean(p.extract).slice(0, 650), url: p.fullurl || `https://pt.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g,'_'))}`, provider: 'Wikipédia' }));
      };
      const bing = async () => {
        const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&setlang=pt-BR`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 GriotSearch/2.0' }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw Error('Busca web indisponível');
        const xml = await r.text();
        return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(([,item]) => {
          const field = tag => item.match(new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`))?.[1] || '';
          const url = clean(field('link'));
          if (!/^https:\/\//.test(url)) return null;
          return { title: clean(field('title')), snippet: clean(field('description')).slice(0, 550), url, provider: new URL(url).hostname.replace(/^www\./,'') };
        }).filter(Boolean);
      };
      const results = await Promise.allSettled([wiki(), bing()]);
      sources = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
      const seen = new Set(); sources = sources.filter(item => { const key = item.url.replace(/\/$/,''); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
    }
    const reply = greeting ? replyGreeting : sources.length ?
      `Encontrei informações sobre ${query.replace(/[?.!]$/,'')}.\n\n` +
      sources.slice(0, 4).map((item,i) => `${i+1}. ${item.title}\n${item.snippet || 'Consulte a fonte para mais informações.'}`).join('\n\n') +
      '\n\nAs fontes estão organizadas logo abaixo. Esta é uma compilação de resultados públicos, não uma síntese gerada por IA; confira as fontes antes de tomar decisões.' :
      `Não consegui encontrar fontes públicas para “${query}” agora. Tente reformular a pesquisa ou volte mais tarde.`;
    const at = new Date().toISOString();
    if (conv) { conv.messages.push({ id: crypto.randomUUID(), role: 'user', text: query, at }, { id: crypto.randomUUID(), role: 'assistant', text: reply, at }); if (conv.title === 'Nova conversa') conv.title = query.slice(0,55); conv.updatedAt = at; await saveDb(); }
    return json(res, 200, { reply, title: conv?.title || query.slice(0,55), sources, mode: 'public-search' });
  }
  if (pathname === '/api/chat' && req.method === 'POST') {
    const key = configuredKey();
    if (!key) return json(res, 503, { error: 'Configure GEMINI_API_KEY no arquivo .env do servidor.' });
    if (!rateLimit(req, `chat-${user.id}`, 25, 60000)) return json(res, 429, { error: 'Muitas mensagens. Aguarde um pouco.' });
    const body = await getJsonBody(req);
    const conv = db.conversations.find(c => c.id === body.conversationId && c.userId === user.id);
    if (!conv) return json(res, 404, { error: 'Conversa não encontrada.' });
    const content = cleanText(body.message, 12000);
    if (!content) return json(res, 400, { error: 'Escreva uma mensagem.' });
    // O contexto é construído exclusivamente com mensagens já persistidas desse usuário.
    const history = conv.messages.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
    const response = await fetch(`${geminiApiOrigin}/v1beta/models/${encodeURIComponent(textModel)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: [persona(user.preferences?.persona || 'Griot'),
        'Memórias explícitas deste usuário (considere-as contexto privado, não divulgue a outras pessoas):',
        ...memoryFor(user.id).slice(-35).map(m => `- ${m.text}`),
        'Trechos recentes de outros chats deste mesmo usuário (use apenas se forem relevantes):',
        recentOtherChats(user.id, conv.id)
      ].join('\n') }] }, contents: [...history, { role: 'user', parts: [{ text: content }] }], generationConfig: { maxOutputTokens: 2048, temperature: 0.8 } }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) { const err = providerError(response.status, data); return json(res, err.status, { error: err.error }); }
    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!reply) return json(res, 502, { error: 'O Gemini não retornou texto. Tente reformular sua mensagem.' });
    const at = new Date().toISOString();
    conv.messages.push({ id: crypto.randomUUID(), role: 'user', text: content, at }, { id: crypto.randomUUID(), role: 'assistant', text: reply, at });
    if (conv.title === 'Nova conversa') conv.title = content.slice(0, 55);
    // Nunca elimine automaticamente mensagens antigas: o contexto enviado ao modelo é limitado, não o arquivo histórico.
    conv.updatedAt = at; await saveDb(); return json(res, 200, { reply, title: conv.title });
  }
  return json(res, 404, { error: 'Rota não encontrada.' });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res, pathname) {
  const safe = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(safe));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Proibido.' });
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return json(res, 404, { error: 'Arquivo não encontrado.' });
    const content = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache, must-revalidate', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { json(res, 404, { error: 'Página não encontrada.' }); }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://generativelanguage.googleapis.com https://generativelanguage.googleapis.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return json(res, 400, { error: 'URL inválida.' }); }
  try {
    if (pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Método não permitido.' });
      if (req.method !== 'GET' && !checkWriteOrigin(req, res)) return;
      return await api(req, res, pathname);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname);
    return json(res, 405, { error: 'Método não permitido.' });
  } catch (e) {
    console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : (e.name === 'TimeoutError' ? 'Tempo de resposta do Gemini esgotado.' : 'Erro no servidor. Confira os logs.') });
  }
});
server.listen(PORT, () => console.log(`Griot Live iniciado em http://localhost:${PORT} | Gemini ${configuredKey() ? 'configurado' : 'sem chave (configure .env)'}`));
export { server };
