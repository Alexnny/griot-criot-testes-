/*
 * Griot + interface original de Nova-AI-Prototipo.zip.
 * Os IDs, as classes de layout e a folha style.css pertencem ao protótipo;
 * a autenticação, a memória e o protocolo Gemini seguem o servidor Griot.
 */
const $ = selector => document.querySelector(selector);
const VOICES = ['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir'];
const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const MEMORY_KEY = 'griot_personal_memories_v1';
const ARCHIVE_KEY = 'griot_local_voice_history_v1';
const DEVICE_KEY = 'griot_device_shortcuts_consent_v1';
const APP_LINKS = Object.freeze({youtube:{name:'YouTube',url:'https://www.youtube.com/'},whatsapp:{name:'WhatsApp',url:'https://wa.me/'},maps:{name:'Google Maps',url:'https://www.google.com/maps'},spotify:{name:'Spotify',url:'https://open.spotify.com/'},gmail:{name:'Gmail',url:'https://mail.google.com/'}});
const CREATOR_MEMORIES = [
  'Meu nome é Igor Vinícius Souza Santos e gosto de ser chamado de Igor.',
  'Tenho 23 anos.',
  'Sou o criador e desenvolvedor da inteligência artificial Griot.',
  'Prefiro conversar em português brasileiro, a menos que eu peça outro idioma.'
];
const state = {
  user: null, api: null, conversations: [], chatId: null, chat: null, busy: false,
  attachments: [], memories: [], memoryIds: new Map(), archive: [],
  recognition: null, liveOn: false, connecting: false, micMuted: false,
  manuallyStopped: false, ws: null, micStream: null, inputContext: null,
  micSource: null, micProcessor: null, micSink: null, audioContext: null,
  analyser: null, audioData: null, playingSources: new Set(), nextPlayTime: 0,
  turnComplete: false, outputInProgress: false, inputBuffer: '', outputBuffer: '',
  voiceConvId: null, inputQueue: Promise.resolve(), outputQueue: Promise.resolve(),
  transcriptRole: '', lastTranscript: '', fadeTimer: 0, frame: 0, orbRaf: 0,
  pendingApp: null, voiceChangeBusy: false, voiceSwitchBusy: false, appLaunchTimer: null, lastAppRequest: '',
  quiz: null, quizSelected: null, quizAnswered: false, quizVoiceDebounce: '', quizHandledUtterance: '', quizLastActionAt: 0, publicSearchMode: false, interruptFrames: 0, playbackGeneration: 0, interruptUntil: 0, interruptActive: false, interruptSilence: 0, liveAttempt: 0, liveWatchdog: null, audioRecoveryBusy: false, lastAudioChunkAt: 0, voiceRecoveryTimer: null, voiceRecoveryCount: 0, voiceSwitchTarget: null
};
const normalize = text => String(text || '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const safeMemory = text => String(text || '').trim().replace(/\s+/g, ' ').slice(0, 600);

function toast(text, error = false) {
  const element = document.createElement('div');
  element.className = 'toast' + (error ? ' error' : '');
  element.textContent = text;
  $('#toastStack').append(element);
  setTimeout(() => element.remove(), 5000);
}
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let data;
  try { data = await res.json(); } catch { throw new Error('O servidor não retornou JSON válido.'); }
  if (!res.ok) { const e = new Error(data.error || 'Falha ao comunicar com a Griot.'); e.status = res.status; throw e; }
  return data;
}
function localArray(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function persistLocal() {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(state.memories.slice(-100)));
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.archive.slice(-60)));
  } catch (e) { console.warn('Armazenamento local indisponível:', e); }
}
function saveMemoryLocally(text, at = new Date().toISOString()) {
  const clean = safeMemory(text);
  if (clean.length < 3 || state.memories.some(m => normalize(m.text) === normalize(clean))) return false;
  state.memories.push({ text: clean, at }); state.memories = state.memories.slice(-100);
  persistLocal(); return true;
}
function updateMemoryIndicator() {
  $('.rail-bottom small').textContent = `${state.memories.length} memórias neste dispositivo`;
}
async function syncMemories() {
  try {
    const data = await request('/api/memory');
    for (const m of data.memories || []) {
      state.memoryIds.set(normalize(m.text), m.id);
      saveMemoryLocally(m.text, m.at);
    }
  } catch (e) { console.warn('Memórias remotas indisponíveis:', e); }
  for (const m of state.memories) {
    if (state.memoryIds.has(normalize(m.text))) continue;
    try {
      const data = await request('/api/memory', { method: 'POST', body: { text: m.text } });
      state.memoryIds.set(normalize(m.text), data.memory.id);
    } catch (e) { console.warn('Memória mantida no dispositivo:', e); break; }
  }
  updateMemoryIndicator(); renderMemories();
}
async function remember(text) {
  const clean = safeMemory(text);
  if (clean.length < 3) return;
  const added = saveMemoryLocally(clean);
  if (!added) return false;
  updateMemoryIndicator(); renderMemories();
  try {
    const data = await request('/api/memory', { method: 'POST', body: { text: clean } });
    state.memoryIds.set(normalize(clean), data.memory.id);
    toast('Memória salva.');
    return true;
  } catch { toast('Memória salva neste dispositivo; sincronização pendente.', true); return false; }
}
function memoryCommand(text) {
  const clean = String(text || '').trim().replace(/^(?:(?:ei|olá|oi)\s+)?griot[,!\s]*/i, '');
  const found = clean.match(/^(?:(?:por favor|eu quero|quero)\s+)?(?:que\s+(?:voc[eê]\s+)?)?(?:(?:lembre|lembra)(?:-se)?\s+(?:de\s+)?(?:que\s+)?|n[aã]o\s+esque[cç]a(?:\s+de)?\s+(?:que\s+)?|n[aã]o\s+esquece(?:\s+de)?\s+(?:que\s+)?|memorize(?:\s+que\s+)?|guarde(?:\s+(?:isso|isto|essa|esta informa[cç][aã]o))?(?:\s+na\s+(?:sua\s+)?mem[oó]ria)?(?:\s+que\s+)?|salve(?:\s+(?:essa|esta)\s+informa[cç][aã]o)?(?:\s+que\s+)?)(.+)$/i);
  return found ? safeMemory(found[1].replace(/^(?:de|que)\s+/i, '').replace(/[.!]+$/, '')) : null;
}
function archive(role, text) {
  const clean = safeMemory(text); if (!clean) return;
  const last = state.archive.at(-1);
  if (last?.role === role && normalize(last.text) === normalize(clean)) return;
  state.archive.push({ role, text: clean, at: new Date().toISOString() });
  state.archive = state.archive.slice(-60); persistLocal();
}
function renderMemories() {
  const list = $('#memoryList'); list.replaceChildren();
  if (!state.memories.length) { list.textContent = 'Nenhuma memória salva.'; return; }
  for (const m of state.memories.slice().reverse()) {
    const item = document.createElement('div'); item.className = 'memory-item';
    const text = document.createElement('span'); text.textContent = m.text;
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '×';
    del.title = 'Excluir memória'; del.setAttribute('aria-label', 'Excluir memória: ' + m.text);
    del.onclick = async () => {
      const id = state.memoryIds.get(normalize(m.text));
      if (id) {
        try { await request('/api/memory/' + id, { method: 'DELETE' }); }
        catch (e) { toast(e.message, true); return; }
        state.memoryIds.delete(normalize(m.text));
      }
      state.memories = state.memories.filter(x => normalize(x.text) !== normalize(m.text));
      persistLocal(); updateMemoryIndicator(); renderMemories();
    };
    item.append(text, del); list.append(item);
  }
}

/* ====== Histórico e conversa de texto, conectados às rotas Griot ====== */
const messagesEl = $('#messages'), input = $('#input');
function renderHistory() {
  const root = $('#history'); root.replaceChildren();
  for (const c of state.conversations) {
    const b = document.createElement('button');
    b.textContent = (c.mode === 'voice' ? '◉  ' : '▤  ') + c.title;
    b.className = c.id === state.chatId ? 'active' : '';
    b.onclick = () => openConversation(c.id);
    root.append(b);
  }
}
async function loadHistory() {
  const data = await request('/api/conversations');
  state.conversations = data.conversations || [];
  renderHistory();
}
function addMessage(role, content) {
  const element = document.createElement('div'); element.className = 'message ' + role;
  if (role === 'assistant') {
    const mark = document.createElement('span'); mark.className = 'assistant-mark'; mark.textContent = '✦'; element.append(mark);
  }
  const text = document.createElement('span'); text.className = 'message-text'; text.textContent = content;
  element.append(text); messagesEl.append(element);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return text;
}
function renderChat() {
  messagesEl.replaceChildren();
  $('#pageTitle').textContent = state.chat?.title || 'Novo chat';
  const items = state.chat?.messages || [];
  if (!items.length) {
    const welcome = document.createElement('div'); welcome.className = 'welcome';
    welcome.innerHTML = '<div class="welcome-icon">✦</div><h1>Oi, Igor.</h1><p>A conversa é sua. Pode começar quando quiser.</p>'; 
    messagesEl.append(welcome);
  }
  for (const m of items) addMessage(m.role, m.text);
  renderHistory();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
async function openConversation(id) {
  if (state.busy) return;
  try {
    const data = await request('/api/conversations/' + encodeURIComponent(id));
    state.chat = data.conversation;
    state.chatId = id;
    renderChat(); $('.rail').classList.remove('open');
    if (state.liveOn || state.connecting) await stopLive(false);
    showChat();
  } catch (e) { toast(e.message, true); }
}
function newChat() {
  if (state.busy) return;
  state.chat = null; state.chatId = null;
  renderChat(); input.focus(); $('.rail').classList.remove('open');
  if (state.liveOn || state.connecting) stopLive(false);
  showChat();
}
async function ensureChat() {
  if (state.chatId && state.chat) return state.chatId;
  const data = await request('/api/conversations', { method: 'POST', body: { mode: 'text' } });
  state.chat = data.conversation; state.chatId = state.chat.id;
  await loadHistory();
  return state.chatId;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function revealAnswer(target, answer) {
  const parts = String(answer).split(/(\s+)/);
  const fast = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let output = '';
  target.classList.add('reveal-caret');
  for (let i = 0; i < parts.length; i++) {
    output += parts[i]; target.textContent = output; messagesEl.scrollTop = messagesEl.scrollHeight;
    if (!fast && /\S/.test(parts[i])) await sleep(output.length > 1600 ? 4 : output.length > 600 ? 12 : 28);
  }
  target.classList.remove('reveal-caret');
}
function updateSend() {
  const hasText = !!input.value.trim();
  $('#send').classList.toggle('hidden', !hasText);
  $('#liveButton').classList.toggle('hidden', hasText);
}
function renderAttachments() {
  const root = $('#attachmentPreview'); root.replaceChildren();
  root.classList.toggle('hidden', state.attachments.length === 0);
  state.attachments.forEach((f, i) => {
    const item = document.createElement('span'); item.className = 'attachment-chip';
    const label = document.createElement('span'); label.textContent = f.name;
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = '×'; button.title = 'Remover ' + f.name;
    button.onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
    item.append(label, button); root.append(item);
  });
}
function bytesToBase64(bytes) {
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(encoded);
}
async function readAttachments() {
  const result = [];
  for (const file of state.attachments) {
    const mime = file.type || ({ '.txt': 'text/plain', '.csv': 'text/csv', '.pdf': 'application/pdf' }[file.name.slice(file.name.lastIndexOf('.')).toLowerCase()]);
    if (mime === 'text/plain' || mime === 'text/csv') {
      result.push({ name: file.name, mimeType: mime, text: (await file.text()).slice(0, 24000) });
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      result.push({ name: file.name, mimeType: mime, data: bytesToBase64(bytes) });
    }
  }
  return result;
}
async function ask(text) {
  if (state.busy) return;
  const files = state.attachments.slice();
  const prompt = text.trim() || (files.length ? 'Analise os arquivos anexados.' : '');
  if (!prompt) return;
  state.busy = true;
  const remembered = memoryCommand(prompt);
  if (remembered) await remember(remembered);
  if (!state.api?.keyConfigured && !state.publicSearchMode) { state.publicSearchMode = true; toast('Chat Gemini indisponível. Pesquisa pública ativada; Live permanece independente.'); }
  const previousValue = input.value;
  input.value = ''; updateSend();
  try {
    const conversationId = await ensureChat();
    messagesEl.querySelector('.welcome')?.remove();
    const userShown = prompt + (files.length ? '\n📎 ' + files.map(f => f.name).join(', ') : '');
    addMessage('user', userShown);
    maybeSuggestApp(prompt);
    const assistantText = addMessage('assistant', '');
    assistantText.classList.add('reveal-caret');
    const attachments = await readAttachments();
    let data;
    if (state.publicSearchMode) data = await request('/api/public-search', { method: 'POST', body: { conversationId, query: prompt } });
    else {
      try { data = await request('/api/chat', { method: 'POST', body: { conversationId, message: prompt, attachments } }); }
      catch (error) {
        if (error.status !== 429 && !/quota|limit|esgotad|RESOURCE_EXHAUSTED/i.test(error.message)) throw error;
        state.publicSearchMode = true;
        toast('Cota do chat Gemini atingida. Usando pesquisa pública; Live não foi alterado.');
        data = await request('/api/public-search', { method: 'POST', body: { conversationId, query: prompt } });
      }
    }
    if (Array.isArray(data.sources) && data.sources.length) {
      const list = document.createElement('div'); list.className = 'source-list';
      const heading = document.createElement('strong'); heading.textContent = 'Fontes consultadas'; list.append(heading);
      data.sources.forEach((source, index) => {
        if (!/^https:\/\//.test(source.url || '')) return;
        const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = `${index + 1}. ${source.title || source.provider} · ${source.provider || new URL(source.url).hostname}`;
        list.append(link);
      });
      assistantText.parentElement.append(list);
    }
    state.chat.title = data.title;
    state.chat.messages.push(
      { id: crypto.randomUUID(), role: 'user', text: userShown, at: new Date().toISOString() },
      { id: crypto.randomUUID(), role: 'assistant', text: data.reply, at: new Date().toISOString() }
    );
    archive('user', prompt); archive('assistant', data.reply);
    state.attachments = []; renderAttachments();
    await revealAnswer(assistantText, data.reply);
    $('#pageTitle').textContent = data.title;
    await loadHistory();
  } catch (e) {
    // Não apaga os anexos em caso de falha; o usuário pode reenviar.
    input.value = previousValue; updateSend();
    addMessage('error', e.message); toast(e.message, true);
  } finally { state.busy = false; }
}

/* ====== Ditado: usa apenas SpeechRecognition do navegador ====== */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function dictate() {
  if (!SpeechRecognition) { toast('O ditado não está disponível neste navegador. Use Chrome no Android.', true); return; }
  if (state.recognition) { state.recognition.stop(); state.recognition = null; return; }
  const recognition = new SpeechRecognition(); state.recognition = recognition;
  recognition.lang = 'pt-BR'; recognition.interimResults = true; recognition.continuous = false;
  recognition.onresult = event => {
    let phrase = '';
    for (let i = 0; i < event.results.length; i++) phrase += event.results[i][0].transcript;
    input.value = phrase; updateSend(); input.dispatchEvent(new Event('input'));
  };
  recognition.onerror = event => toast('Ditado: ' + event.error, true);
  recognition.onend = () => { state.recognition = null; };
  try { recognition.start(); } catch (e) { state.recognition = null; toast(e.message, true); }
}

/* ====== Gemini Live: mantém token efêmero, VAD, áudio PCM e interrupção ====== */
function showChat() { closeQuiz(); $('#chatPage').classList.remove('hidden'); $('#livePage').classList.add('hidden'); $('#pageTitle').textContent = state.chat?.title || 'Novo chat'; }
function showLive() { $('#chatPage').classList.add('hidden'); $('#livePage').classList.remove('hidden'); $('#pageTitle').textContent = 'Conversa por voz'; }
function setLiveStatus(message) { $('#liveStatus').textContent = message; }
function setOrb(mode, amplitude = 0) {
  const orb = $('#orb');
  orb.classList.toggle('speaking', mode === 'speaking');
  orb.classList.toggle('listening', mode === 'listening');
  orb.style.setProperty('--amp', String(Math.max(0, Math.min(1, Number(amplitude) || 0))));
}
function resetLiveTranscript() {
  clearTimeout(state.fadeTimer);
  $('#liveTranscript').textContent = '';
  $('#liveTranscript').classList.remove('fading');
  $('#liveTranscriptPrevious').textContent = '';
  $('#liveTranscriptPrevious').classList.remove('visible');
  $('#liveTranscriptSpeaker').textContent = '';
  state.transcriptRole = '';
  state.lastTranscript = '';
  state.inputBuffer = '';
  state.outputBuffer = '';
}
function showTranscript(text, role) {
  const current = $('#liveTranscript');
  const previous = $('#liveTranscriptPrevious');
  const clean = String(text || '').trim(); if (!clean) return;
  if (role !== state.transcriptRole && state.lastTranscript) {
    previous.textContent = state.lastTranscript.slice(-130);
    previous.classList.add('visible');
  }
  const words = clean.split(/\s+/);
  if (words.length > 19) {
    previous.textContent = words.slice(-34, -19).join(' ');
    previous.classList.add('visible');
  }
  current.textContent = words.slice(-19).join(' ');
  $('#liveTranscriptSpeaker').textContent = role === 'user' ? 'Você' : 'Griot';
  current.dataset.role = role;
  previous.dataset.role = state.transcriptRole;
  current.classList.remove('fading');
  state.transcriptRole = role; state.lastTranscript = current.textContent;
  clearTimeout(state.fadeTimer);
  state.fadeTimer = setTimeout(() => { previous.classList.remove('visible'); current.classList.add('fading'); }, 6500);
}
function downsample(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const pos = i * ratio, base = Math.floor(pos), f = pos - base;
    output[i] = input[base] * (1 - f) + (input[Math.min(input.length - 1, base + 1)] || 0) * f;
  }
  return output;
}
function encodePCM(samples) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
  }
  return bytesToBase64(bytes);
}
async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microfone indisponível. Use HTTPS ou localhost.');
  state.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const attempt = state.liveAttempt;
  state.micStream.getAudioTracks().forEach(track => { track.onended = () => { if (state.liveAttempt === attempt && state.micStream?.getTracks().includes(track) && !state.manuallyStopped) { setLiveStatus('Microfone desconectado. Toque para reconectar.'); stopLive(false); } }; });
  state.inputContext = new AudioContext({ latencyHint: 'interactive' });
  await state.inputContext.resume();
  state.micSource = state.inputContext.createMediaStreamSource(state.micStream);
  state.micSink = state.inputContext.createGain();
  state.micSink.gain.value = 0; state.micSink.connect(state.inputContext.destination);
  const onAudio = event => {
    if (!state.liveOn || state.micMuted || state.ws?.readyState !== WebSocket.OPEN) return;
    if (state.ws.bufferedAmount > 1_000_000) return;
    const samples = event.data instanceof Float32Array ? event.data : new Float32Array(event.data);
    let sum = 0; for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / (samples.length || 1));
    // Corte local imediato do áudio ao detectar fala sustentada. O Gemini recebe
    // continuamente o microfone e confirma a interrupção pelo VAD do servidor.
    if (state.playingSources.size && rms > .085 && Date.now() > state.interruptUntil) {
      if (++state.interruptFrames >= 2) {
        state.interruptFrames = 0; state.interruptUntil = Date.now() + 1300;
        state.interruptActive = true; state.interruptSilence = 0; stopAudioPlayback(); setLiveStatus('Ouvindo sua interrupção…');
      }
    } else if (rms < .05) state.interruptFrames = 0;
    if (state.interruptActive && rms < .025 && ++state.interruptSilence >= 10) { state.interruptActive = false; state.interruptSilence = 0; }
    else if (rms >= .025) state.interruptSilence = 0;
    if (rms > .035 && !state.outputInProgress) setOrb('listening', Math.min(1, rms * 7));
    state.ws.send(JSON.stringify({ realtimeInput: { audio: { data: encodePCM(downsample(samples, state.inputContext.sampleRate, 16000)), mimeType: 'audio/pcm;rate=16000' } } }));
  };
  if (state.inputContext.audioWorklet) {
    try {
      await state.inputContext.audioWorklet.addModule('/pcm-worklet.js');
      state.micProcessor = new AudioWorkletNode(state.inputContext, 'nova-mic-processor');
      state.micProcessor.port.onmessage = onAudio;
    } catch (error) { console.warn('AudioWorklet indisponível; usando processador alternativo:', error); }
  }
  if (!state.micProcessor) {
    state.micProcessor = state.inputContext.createScriptProcessor(4096, 1, 1);
    state.micProcessor.onaudioprocess = e => onAudio({ data: e.inputBuffer.getChannelData(0).slice() });
  }
  state.micSource.connect(state.micProcessor); state.micProcessor.connect(state.micSink);
}
function ensureOutputContext() {
  if (!state.audioContext) state.audioContext = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
  if (!state.analyser) {
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.audioData = new Float32Array(state.analyser.fftSize);
    state.analyser.connect(state.audioContext.destination);
  }
  return state.audioContext;
}
function animateOrb() {
  state.frame = requestAnimationFrame(animateOrb);
  if (!state.liveOn) return;
  if (state.playingSources.size) {
    state.analyser?.getFloatTimeDomainData(state.audioData);
    let sum = 0;
    for (const sample of state.audioData || []) sum += sample * sample;
    const rms = Math.sqrt(sum / (state.audioData?.length || 1));
    setOrb('speaking', Math.min(1, rms * 5.5));
  } else if (!state.outputInProgress) setOrb(state.micMuted ? 'idle' : 'listening', .06);
}
function stopAudioPlayback() {
  for (const source of state.playingSources) { try { source.stop(); } catch {} }
  state.playingSources.clear();
  state.nextPlayTime = state.audioContext?.currentTime || 0;
  state.playbackGeneration++; state.outputInProgress = false; setOrb('idle');
}
async function playAudio(base64) {
  if (!base64) return;
  try {
    const generation = state.playbackGeneration;
    const context = ensureOutputContext();
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') throw new Error('Saída de áudio suspensa pelo navegador.');
    if (generation !== state.playbackGeneration) return;
    const bin = atob(base64), len = Math.floor(bin.length / 2);
    if (!len) return;
    const buffer = context.createBuffer(1, len, 24000), channel = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      let sample = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (sample >= 32768) sample -= 65536;
      channel[i] = sample / 32768;
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(state.analyser);
    const start = Math.max(context.currentTime + .025, state.nextPlayTime);
    source.start(start); state.nextPlayTime = start + buffer.duration;
    state.playingSources.add(source); state.outputInProgress = true;
    setLiveStatus('Griot está falando');
    source.onended = () => {
      state.playingSources.delete(source);
      if (!state.playingSources.size && state.turnComplete) {
        state.outputInProgress = false;
        if (state.liveOn) { setLiveStatus('Ouvindo você…'); setOrb('idle'); }
      }
    };
  } catch (e) { console.warn('Falha na reprodução:', e); setLiveStatus('Áudio bloqueado. Toque na tela para reativar.'); toast('Toque na tela para reativar a voz da Griot.', true); }
}
function combineTranscript(before, next) {
  // O Gemini pode enviar tanto incrementos quanto versões completas da mesma frase.
  // Remova apenas sobreposições exatas; não apague repetições intencionais do usuário.
  const text = String(next || '').trim();
  if (!text) return before;
  if (!before) return text;
  if (text === before || before.endsWith(text)) return before;
  if (text.startsWith(before)) return text;
  if (before.startsWith(text)) return before;
  const left = before.toLocaleLowerCase('pt-BR');
  const right = text.toLocaleLowerCase('pt-BR');
  const max = Math.min(left.length, right.length);
  for (let n = max; n >= 4; n--) {
    if (left.slice(-n) === right.slice(0, n)) {
      return before + text.slice(n);
    }
  }
  return before + (/^[,.!?;:]/.test(text) ? '' : ' ') + text;
}
async function saveVoiceTurn(role, text) {
  if (!state.voiceConvId || !text.trim()) return;
  try { await request(`/api/conversations/${state.voiceConvId}/messages`, { method: 'POST', body: { role, text } }); }
  catch (e) { console.warn('Falha ao salvar transcrição:', e); }
}
function commitInput() {
  const text = state.inputBuffer.trim(); state.inputBuffer = '';
  if (!text) return;
  archive('user', text);
  const instruction = memoryCommand(text); if (instruction) remember(instruction);
  state.inputQueue = state.inputQueue.then(() => saveVoiceTurn('user', text));
  if (state.quizHandledUtterance && normalize(text).includes(state.quizHandledUtterance)) {
    state.quizHandledUtterance = '';
    const value = normalize(text);
    const requestedTopic = /\b(tge|teoria geral do estado|tr[eê]s poderes)\b/.test(value) ? 'TGE' : /\b(direito|jur[ií]dic)\b/.test(value) ? 'Direito' : null;
    const requestedCount = Number(value.match(/(\d{1,2})\s*(quest|pergunt)/)?.[1] || value.match(/quiz (?:de |com )?(\d{1,2})/)?.[1]);
    if (state.quiz && (requestedTopic && requestedTopic !== state.quiz.topic || requestedCount && requestedCount !== state.quiz.questions.length)) createQuiz(requestedTopic || state.quiz.topic, requestedCount || state.quiz.questions.length);
    return;
  }
  if (!handleQuizVoice(text)) maybeSuggestApp(text, { voice: true });
}
function commitOutput() {
  const text = state.outputBuffer.trim(); state.outputBuffer = '';
  if (!text) return;
  archive('assistant', text);
  state.outputQueue = state.outputQueue.then(() => saveVoiceTurn('assistant', text));
}
async function onSocketMessage(event, originSocket = state.ws) {
  let data; try { data = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); } catch { return; }
  if (originSocket !== state.ws || state.manuallyStopped) return;
  if (data.setupComplete) {
    clearTimeout(state.liveWatchdog); state.liveWatchdog = null;
    state.liveOn = true; state.connecting = false;
    setLiveStatus('Ouvindo você…'); updateLiveButtons(); setOrb('idle');
    // Uma escolha feita durante a conexão inicial é aplicada após o setup,
    // sem chamar stopLive e sem perder o microfone ou a conversa.
    const desiredVoice = state.user?.preferences?.voice || 'Kore';
    if (state.activeLiveVoice && desiredVoice !== state.activeLiveVoice) {
      switchLiveVoice(desiredVoice).catch(error => toast('Não foi possível aplicar a voz: ' + error.message, true));
    }
    return;
  }
  if (data.error) { toast(data.error.message || 'Falha do Gemini Live.', true); recoverLiveSocket(); return; }
  const content = data.serverContent;
  if (!content) return;
  if (content.interrupted) {
    stopAudioPlayback(); commitOutput(); state.turnComplete = true; state.interruptActive = true; state.interruptUntil = Date.now() + 500;
    setLiveStatus('Pode continuar, Igor.');
  }
  if (content.inputTranscription?.text) {
    state.inputBuffer = combineTranscript(state.inputBuffer, content.inputTranscription.text);
    if (!state.playingSources.size) showTranscript(state.inputBuffer, 'user');
    // Comandos de interface são executados assim que a transcrição chega,
    // independentemente da resposta verbal que o modelo venha a produzir.
    handleQuizInterim(state.inputBuffer);
  }
  if (content.outputTranscription?.text) {
    if (state.inputBuffer) commitInput();
    state.outputBuffer = combineTranscript(state.outputBuffer, content.outputTranscription.text);
    state.turnComplete = false; state.outputInProgress = true;
    if (!state.interruptActive) showTranscript(state.outputBuffer, 'assistant'); setLiveStatus('Griot está falando');
  }
  for (const part of content.modelTurn?.parts || []) {
    if (part.inlineData?.data) {
      if (state.inputBuffer) commitInput(); state.turnComplete = false;
      if (!state.interruptActive && Date.now() >= state.interruptUntil) { state.lastAudioChunkAt = Date.now(); playAudio(part.inlineData.data); }
    }
  }
  if (content.turnComplete) {
    commitInput(); commitOutput(); state.turnComplete = true;
    if (!state.playingSources.size) { state.outputInProgress = false; setLiveStatus('Ouvindo você…'); setOrb('idle'); }
  }
}
function liveInstructions(pendingTurns = []) {
  const memories = state.memories.slice(-60).map(m => '- ' + m.text).join('\n').slice(0, 9000);
  const recent = [...state.archive.slice(-35), ...pendingTurns].slice(-37).map(m => `${m.role === 'assistant' ? 'Griot' : 'Igor'}: ${m.text}`).join('\n').slice(-4500);
  return `Você é Griot, IA pessoal de voz criada e desenvolvida por Igor Vinícius Souza Santos, 23 anos, que prefere ser chamado de Igor. Converse em português brasileiro, com fluidez de uma conversa espontânea, voz acolhedora e ritmo natural, sem fingir ser humana.

REGRAS DE CONVERSAÇÃO NATURAL:
- NÃO comece toda resposta com "Como posso te ajudar hoje?", "Em que posso ajudar?", "Claro, Igor!", "Com certeza!", nem outra saudação automática. Não cumprimente de novo a cada turno. Cumprimente brevemente apenas quando Igor iniciar a conversa com um cumprimento; depois responda ao conteúdo diretamente.
- Varie as construções e evite repetir palavras, ideias ou a pergunta do usuário. Nunca repita frases inteiras por hábito. Se Igor já sabe de algo, avance na conversa em vez de explicar tudo de novo.
- Fale como numa conversa real: respostas curtas quando a pergunta for simples; aprofunde apenas quando necessário ou solicitado. Use pausas e entonação naturais da voz, mas não acrescente hesitações artificiais em excesso.
- Use o nome Igor de forma ocasional, não em toda frase. Faça perguntas de acompanhamento somente quando forem úteis, não no fim de cada resposta. Não faça apresentações sobre suas capacidades sem solicitação.
- Se ele interromper, pare de falar e ouça; responda ao que ele acabou de dizer, sem retomar mecanicamente a frase anterior. Pode discordar de forma educada quando apropriado.
- Se o conteúdo for incerto, diga isso diretamente. Não invente fatos, memórias ou ações realizadas. Se pedir para lembrar algo, reconheça o pedido sem alegar que foi salvo caso a gravação falhe.
- Não pronuncie emojis, Markdown, títulos ou marcadores em respostas faladas.
- IDIOMA DINÂMICO MULTILÍNGUE: detecte o idioma de CADA fala do usuário pelo áudio e conteúdo, sem idioma fixo na sessão. Responda no idioma que ele acabou de usar, incluindo inglês, português, espanhol, francês, japonês, coreano e outros idiomas suportados. Se ele alternar idiomas de repente, alterne imediatamente também, inclusive no meio da mesma conversa, sem pedir permissão, sem anunciar a troca e sem traduzir a menos que solicitado. Se houver mistura de idiomas, acompanhe o idioma predominante da última solicitação, respeitando instruções explícitas do usuário sobre idioma. Não assuma português só porque a conversa começou em português.
- VOZ CONFIGURÁVEL: a voz sintetizada é escolhida pelo usuário nas configurações da interface. Quando a voz mudar, o aplicativo aplica a escolha abrindo uma nova conexão Gemini Live de áudio, mantendo a tela Live, o microfone, o contexto recente e a conversa atual. Não diga que não é possível mudar de voz; não alegue que você própria modificou a API: a interface faz essa operação. A escolha de voz não deve limitar a detecção automática do idioma.
- QUIZ: a interface web tem um gerador de quiz REAL e INTEGRADO que funciona independentemente do modelo. Quando Igor pedir um quiz, diga brevemente 'Vou abrir o quiz na tela' e NÃO diga que você não pode gerar quiz ou controlar a interface. O próprio aplicativo detecta a fala e mostra o quiz automaticamente. Pode ser de Introdução ao Direito ou TGE; outros temas não estão disponíveis no gerador local. Ao mudar quantidade, tema, responder ou pedir para voltar ao orb, o aplicativo também processará o comando.
- Quando Igor pedir para abrir um aplicativo conhecido (YouTube, WhatsApp, Google Maps, Spotify ou Gmail), responda brevemente e naturalmente: 'Claro, abrindo o [nome do aplicativo].' O site tentará abrir o app se a permissão geral estiver ativa. Não prometa controle total do dispositivo.

Memórias pessoais relevantes:\n${memories}\nContexto recente de conversas anteriores (use somente quando relevante, sem repetir respostas antigas):\n${recent}`;
}
function updateLiveButtons() {
  const mute = $('#muteLive');
  mute.disabled = state.connecting;
  if (!state.liveOn && !state.connecting) { mute.title = 'Reconectar Live Voice'; mute.setAttribute('aria-label', mute.title); mute.classList.remove('active'); $('.live-bottom span').textContent = 'Reconectar voz sem reiniciar o aplicativo'; return; }
  mute.classList.toggle('active', state.liveOn && !state.micMuted);
  mute.title = state.micMuted ? 'Reativar microfone' : 'Silenciar microfone';
  mute.setAttribute('aria-label', mute.title);
  $('.live-bottom span').textContent = state.liveOn ? (state.micMuted ? 'Microfone silenciado' : 'Pode falar e interromper a Griot') : 'Conectando à Griot…';
}
async function startLive() {
  if (state.liveOn || state.connecting) return;
  showLive();
  resetLiveTranscript();
  if (!state.api?.keyConfigured) { setLiveStatus('Configure GEMINI_API_KEY no Render.'); toast('Chave Gemini não configurada.', true); return; }
  if (!window.isSecureContext) { setLiveStatus('O microfone exige HTTPS.'); return; }
  state.connecting = true; state.manuallyStopped = false; state.micMuted = false;
  const attempt = ++state.liveAttempt;
  clearTimeout(state.liveWatchdog);
  state.liveWatchdog = setTimeout(() => {
    if (state.liveAttempt === attempt && state.connecting && !state.manuallyStopped) {
      toast('A conexão de voz demorou demais. Toque em reconectar.', true);
      stopLive(false);
    }
  }, 22000);
  state.turnComplete = false; state.outputInProgress = false; state.inputBuffer = ''; state.outputBuffer = ''; state.interruptActive = false; state.quizHandledUtterance = ''; state.quizVoiceDebounce = ''; state.quizLastActionAt = 0;
  updateLiveButtons(); setLiveStatus('Conectando…');
  // Desbloqueie a saída imediatamente no clique, antes de qualquer fetch.
  if (state.audioContext?.state === 'closed') state.audioContext = null;
  const outputUnlock = ensureOutputContext().resume();
  try {
    // Recupera contexto de chats e sessões de voz anteriores, quando armazenados no servidor.
    try {
      const context = await request('/api/context');
      state.archive = [...(context.recent || []).map(m => ({ role: m.role, text: m.text }))].slice(-50);
      for (const memory of context.memories || []) saveMemoryLocally(memory.text, memory.at);
    } catch (error) { console.warn('Contexto anterior indisponível:', error); }
    // A criação e o desbloqueio da saída acontecem no gesto de abrir o Live.
    // Não reutilizar AudioContext fechado ou suspenso de uma sessão anterior.
    await Promise.all([outputUnlock, startMicrophone()]);
    if (state.liveAttempt !== attempt || state.manuallyStopped) return;
    if (state.audioContext.state !== 'running') throw new Error('Áudio bloqueado. Toque novamente para ativar.');
    // A identidade continua sendo o usuário da sessão atual.
    const conversation = await request('/api/conversations', { method: 'POST', body: { mode: 'voice', title: 'Conversa com Griot' } });
    state.voiceConvId = conversation.conversation.id;
    const { token, model } = await request('/api/live-token', { method: 'POST' });
    if (state.liveAttempt !== attempt || state.manuallyStopped) return;
    const ws = new WebSocket(LIVE_URL + '?access_token=' + encodeURIComponent(token)); state.ws = ws;
    ws.onopen = () => {
      if (state.manuallyStopped || state.ws !== ws || state.liveAttempt !== attempt) return;
      const voice = VOICES.includes(state.user.preferences?.voice) ? state.user.preferences.voice : 'Kore';
      state.activeLiveVoice = voice;
      ws.send(JSON.stringify({ setup: {
        model: 'models/' + model,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        systemInstruction: { parts: [{ text: liveInstructions() }] },
        inputAudioTranscription: {}, outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 60, silenceDurationMs: 600 } }
      } }));
    };
    ws.onmessage = event => { if (state.ws === ws && state.liveAttempt === attempt) onSocketMessage(event, ws); };
    ws.onerror = () => { if (state.ws === ws && state.liveAttempt === attempt && !state.manuallyStopped) setLiveStatus('Conexão falhou. Reconecte sem reiniciar o aplicativo.'); };
    ws.onclose = event => {
      if (state.ws === ws && state.liveAttempt === attempt && !state.manuallyStopped) { console.warn('Live socket closed:', event.code, event.reason); recoverLiveSocket(); }
    };
  } catch (e) {
    const message = e.name === 'NotAllowedError' ? 'Permita o uso do microfone.' : e.message;
    toast(message, true); setLiveStatus(message); await stopLive(false);
  }
}
// Gemini Live define a voz no setup: para trocá-la é necessário um novo WebSocket.
// O microfone, a saída de áudio, o histórico e a tela Live permanecem abertos.
async function switchLiveVoice(voice) {
  if (!state.liveOn || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.voiceSwitchBusy) return;
  state.voiceSwitchBusy = true;
  const previousSocket = state.ws;
  const attempt = state.liveAttempt;
  state.voiceSwitchTarget = voice;
  setLiveStatus('Aplicando a nova voz…');
  let nextSocket;
  try {
    const { token, model } = await request('/api/live-token', { method: 'POST' });
    if (state.liveAttempt !== attempt || state.ws !== previousSocket || !state.liveOn) throw new Error('A sessão Live foi encerrada antes da troca.');
    nextSocket = new WebSocket(LIVE_URL + '?access_token=' + encodeURIComponent(token));
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error('A nova voz não respondeu a tempo. A sessão atual continua ativa.')), 18000);
      const cleanup = () => { clearTimeout(timeout); nextSocket.onopen = null; nextSocket.onmessage = null; nextSocket.onerror = null; nextSocket.onclose = null; };
      const fail = error => { if (settled) return; settled = true; cleanup(); try { nextSocket.close(); } catch {} reject(error); };
      nextSocket.onopen = () => {
        if (state.liveAttempt !== attempt || state.ws !== previousSocket || !state.liveOn || state.manuallyStopped) { fail(new Error('A sessão Live foi encerrada antes da troca.')); return; }
        try {
          const pendingTurns = [
            ...(state.inputBuffer.trim() ? [{ role: 'user', text: state.inputBuffer.trim() }] : []),
            ...(state.outputBuffer.trim() ? [{ role: 'assistant', text: state.outputBuffer.trim() }] : [])
          ];
          nextSocket.send(JSON.stringify({ setup: {
            model: 'models/' + model,
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
            systemInstruction: { parts: [{ text: liveInstructions(pendingTurns) }] },
            inputAudioTranscription: {}, outputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 60, silenceDurationMs: 600 } }
          } }));
        } catch (error) { fail(error); }
      };
      nextSocket.onmessage = async event => {
        let data;
        try { data = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); } catch { return; }
        if (data.error) { fail(new Error(data.error.message || 'O Gemini rejeitou a nova voz. A sessão atual continua ativa.')); return; }
        if (!data.setupComplete) return;
        if (state.liveAttempt !== attempt || state.ws !== previousSocket || state.manuallyStopped || !state.liveOn) { fail(new Error('A sessão Live foi encerrada antes da troca.')); return; }
        clearTimeout(state.voiceRecoveryTimer); state.voiceRecoveryTimer = null;
        settled = true; cleanup();
        // Troca atômica: o socket antigo segue ativo até este instante. Mantém microfone,
        // AudioContext e áudio que já está tocando, sem limpar a tela ou reiniciar o Live.
        commitInput(); commitOutput();
        state.ws = nextSocket;
        state.activeLiveVoice = voice;
        state.voiceSwitchTarget = null; state.voiceRecoveryCount = 0;
        nextSocket.onmessage = e => { if (state.ws === nextSocket && state.liveAttempt === attempt) onSocketMessage(e, nextSocket); };
        nextSocket.onerror = () => { if (state.ws === nextSocket) setLiveStatus('Conexão instável. Toque para reconectar.'); };
        nextSocket.onclose = e => { if (state.ws === nextSocket && state.liveAttempt === attempt && !state.manuallyStopped) { console.warn('Voice socket closed:', e.code, e.reason); recoverLiveSocket(); } };
        try { previousSocket.close(1000, 'Voz alterada'); } catch {}
        setLiveStatus('Nova voz ativa. Pode continuar falando.');
        setOrb(state.outputInProgress ? 'speaking' : state.micMuted ? 'idle' : 'listening');
        resolve();
      };
      nextSocket.onerror = () => fail(new Error('Não foi possível conectar a nova voz. A sessão atual continua ativa.'));
      nextSocket.onclose = () => fail(new Error('A conexão da nova voz foi encerrada. A sessão atual continua ativa.'));
    });
  } catch (error) {
    if (state.ws === previousSocket && state.liveOn && !state.manuallyStopped) {
      state.voiceSwitchTarget = null;
      setLiveStatus('A sessão continua ativa com a voz anterior.');
    }
    throw error;
  } finally { state.voiceSwitchBusy = false; }
}

// Reconexão independente da interface: a queda do WebSocket nunca deve fechar
// a tela, encerrar a conversa, desligar o microfone ou limpar o histórico.
async function recoverLiveSocket() {
  if (state.manuallyStopped || (!state.liveOn && !state.connecting) || state.voiceRecoveryTimer) return;
  const attempt = state.liveAttempt;
  const old = state.ws;
  state.ws = null;
  state.connecting = true;
  setLiveStatus('Reconectando a voz sem encerrar a conversa…');
  updateLiveButtons();
  try { if (old?.readyState === WebSocket.OPEN) old.close(1000, 'Reconectando'); } catch {}
  const delay = Math.min(1000 * (2 ** Math.min(state.voiceRecoveryCount++, 4)), 12000);
  state.voiceRecoveryTimer = setTimeout(async () => {
    state.voiceRecoveryTimer = null;
    if (state.manuallyStopped || state.liveAttempt !== attempt) return;
    try {
      const { token, model } = await request('/api/live-token', { method: 'POST' });
      if (state.manuallyStopped || state.liveAttempt !== attempt) return;
      const ws = new WebSocket(LIVE_URL + '?access_token=' + encodeURIComponent(token));
      state.ws = ws;
      const voice = state.voiceSwitchTarget || state.user?.preferences?.voice || state.activeLiveVoice || 'Kore';
      const watchdog = setTimeout(() => { if (state.ws === ws && !state.manuallyStopped) { try { ws.close(); } catch {} recoverLiveSocket(); } }, 18000);
      ws.onopen = () => {
        if (state.ws !== ws || state.manuallyStopped) return;
        ws.send(JSON.stringify({ setup: {
          model: 'models/' + model,
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
          systemInstruction: { parts: [{ text: liveInstructions() }] },
          inputAudioTranscription: {}, outputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 60, silenceDurationMs: 600 } }
        } }));
      };
      ws.onmessage = async event => {
        if (state.ws !== ws || state.liveAttempt !== attempt) return;
        let data; try { data = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); } catch { return; }
        if (data.setupComplete) {
          clearTimeout(watchdog); state.voiceRecoveryCount = 0;
          state.activeLiveVoice = voice; state.voiceSwitchTarget = null;
          state.liveOn = true; state.connecting = false;
          setLiveStatus('Voz reconectada. Pode continuar falando.'); updateLiveButtons(); setOrb('idle');
          return;
        }
        onSocketMessage(event, ws);
      };
      ws.onerror = () => { if (state.ws === ws) setLiveStatus('Conexão instável; recuperando voz…'); };
      ws.onclose = event => { clearTimeout(watchdog); if (state.ws === ws && state.liveAttempt === attempt && !state.manuallyStopped) { console.warn('Recovery socket closed', event.code, event.reason); recoverLiveSocket(); } };
    } catch (error) {
      if (state.liveAttempt !== attempt || state.manuallyStopped) return;
      console.warn('Voice recovery failed:', error);
      state.voiceRecoveryTimer = null;
      recoverLiveSocket();
    }
  }, delay);
}

async function stopLive(backToChat = true) {
  closeQuiz();
  state.manuallyStopped = true; state.liveAttempt++; clearTimeout(state.voiceRecoveryTimer); state.voiceRecoveryTimer = null; state.voiceSwitchTarget = null; state.voiceRecoveryCount = 0; clearTimeout(state.liveWatchdog); state.liveWatchdog = null;
  state.liveOn = false; state.connecting = false; state.micMuted = false; state.activeLiveVoice = null;
  clearTimeout(state.appLaunchTimer); state.appLaunchTimer = null;
  const ws = state.ws; state.ws = null;
  if (ws) { try { ws.close(1000, 'Encerrada pelo usuário'); } catch {} }
  commitInput(); commitOutput();
  if (state.micProcessor) { try { state.micProcessor.disconnect(); if (state.micProcessor.port) state.micProcessor.port.onmessage = null; } catch {} }
  if (state.micSource) { try { state.micSource.disconnect(); } catch {} }
  if (state.micSink) { try { state.micSink.disconnect(); } catch {} }
  state.micStream?.getTracks().forEach(track => track.stop()); state.micStream = null;
  if (state.inputContext) { try { await state.inputContext.close(); } catch {} } state.inputContext = null;
  stopAudioPlayback();
  if (state.audioContext) { try { await state.audioContext.close(); } catch {} } state.audioContext = null;
  state.analyser = null; state.audioData = null; state.micProcessor = null; state.micSource = null; state.micSink = null; state.voiceConvId = null;
  setOrb('idle'); updateLiveButtons();
  resetLiveTranscript();
  if (backToChat) { showChat(); await loadHistory().catch(() => {}); }
  else { setLiveStatus('Toque em Reconectar para iniciar a voz novamente.'); updateLiveButtons(); }
}
function toggleMute() {
  if (!state.liveOn) { if (!state.connecting) startLive(); return; }
  state.micMuted = !state.micMuted;
  if (state.micMuted) {
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    setLiveStatus('Microfone silenciado'); setOrb('idle');
  } else setLiveStatus('Ouvindo você…');
  updateLiveButtons();
}

/* ====== Inicialização e controles do protótipo ====== */
async function init() {
  updateSend(); renderChat(); updateLiveButtons();
  state.memories = localArray(MEMORY_KEY); state.archive = localArray(ARCHIVE_KEY);
  $('#devicePermission').checked = localStorage.getItem(DEVICE_KEY) === 'yes'; updateDeviceBadge();
  for (const memory of CREATOR_MEMORIES) saveMemoryLocally(memory);
  updateMemoryIndicator(); renderMemories();
  state.frame = requestAnimationFrame(animateOrb);
  try {
    const me = await request('/api/me');
    state.user = me.user || (await request('/api/auth/guest', { method: 'POST' })).user;
    const prefs = state.user.preferences || {};
    const voice = VOICES.includes(prefs.voice) ? prefs.voice : 'Kore';
    setVoiceChoice(voice);
    if (prefs.persona !== 'Griot' || prefs.wakeWord !== 'Griot') {
      const resp = await request('/api/preferences', { method: 'PUT', body: { voice, persona: 'Griot', wakeWord: 'Griot' } });
      state.user.preferences = resp.preferences;
    }
    state.api = await request('/api/status');
    await Promise.all([syncMemories(), loadHistory()]);
  } catch (e) { toast('Inicialização: ' + e.message, true); }
}
$('#composer').addEventListener('submit', event => {
  event.preventDefault(); ask(input.value);
});
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'; updateSend();
});
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#newChat').onclick = newChat;
$('#headerNew').onclick = newChat;
$('#menu').onclick = () => $('.rail').classList.toggle('open');
$('#attach').onclick = () => $('#fileInput').click();
$('#fileInput').addEventListener('change', event => {
  const files = Array.from(event.target.files || []);
  for (const f of files) {
    const mime = f.type || ({ txt: 'text/plain', csv: 'text/csv', pdf: 'application/pdf' }[f.name.split('.').at(-1)?.toLowerCase()]);
    if (!['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv'].includes(mime)) { toast('Tipo de arquivo não compatível: ' + f.name, true); continue; }
    if (f.size > 2 * 1024 * 1024) { toast('Arquivo muito grande (máximo 2 MB): ' + f.name, true); continue; }
    if (state.attachments.length >= 2) { toast('Envie até dois anexos por mensagem.', true); break; }
    state.attachments.push(f);
  }
  event.target.value = ''; renderAttachments();
});
$('#mic').onclick = dictate;
$('#liveButton').onclick = startLive;
$('#closeLive').onclick = () => stopLive();
$('#exitLive').onclick = () => stopLive();
$('#muteLive').onclick = toggleMute;
/* Quiz visual integrado à sessão Live: o WebSocket e o microfone permanecem ativos. */
const QUIZ_BANK = {
  Direito: [
    ['Qual é a principal finalidade do Direito na sociedade?',['Garantir exclusivamente os interesses do Estado.','Regular as relações sociais, estabelecer direitos e deveres e promover a justiça e a segurança jurídica.','Substituir a moral e a religião na orientação da conduta humana.','Punir todos os comportamentos considerados imorais.'],1,'O Direito organiza a convivência social e estabelece normas, direitos, deveres e mecanismos de solução de conflitos.'],
    ['O que caracteriza uma norma jurídica?',['Ser apenas uma recomendação pessoal.','Ser uma regra obrigatória reconhecida pelo ordenamento jurídico.','Depender exclusivamente da religião.','Aplicar-se somente aos governantes.'],1,'A norma jurídica integra o ordenamento e pode ser aplicada pelas instituições competentes.'],
    ['Qual é a principal característica do direito privado?',['Regular apenas eleições.','Disciplinar predominantemente relações entre particulares.','Determinar a estrutura dos ministérios.','Estabelecer somente crimes e penas.'],1,'O direito privado disciplina, entre outras, relações civis e empresariais.'],
    ['O que significa segurança jurídica?',['Impossibilidade de mudar leis.','Previsibilidade e estabilidade na aplicação das normas.','Ausência de qualquer conflito.','Poder ilimitado do Estado.'],1,'A segurança jurídica protege a confiança e a previsibilidade das relações jurídicas.'],
    ['Qual ramo disciplina, em geral, contratos entre particulares?',['Direito Civil.','Direito Eleitoral.','Direito Penal.','Direito Constitucional exclusivamente.'],0,'O Direito Civil trata de contratos e de outras relações privadas.'],
    ['O que é uma fonte formal do Direito?',['Somente a opinião pessoal.','Uma forma reconhecida de manifestação de normas jurídicas.','Apenas uma tradição familiar.','Qualquer notícia de jornal.'],1,'Leis e outras fontes reconhecidas expressam normas no ordenamento.'],
    ['O que distingue Direito e moral?',['Toda conduta imoral é crime.','O Direito pode contar com mecanismos institucionais de aplicação.','A moral sempre é escrita.','Não há nenhuma relação entre ambos.'],1,'Direito e moral podem dialogar, mas possuem formas distintas de aplicação.'],
    ['Qual princípio assegura tratamento jurídico sem discriminações arbitrárias?',['Igualdade.','Publicidade comercial.','Livre concorrência apenas.','Anterioridade tributária apenas.'],0,'A igualdade é um princípio constitucional fundamental.'],
    ['O que é uma relação jurídica?',['Uma conversa informal sem efeitos.','Um vínculo entre sujeitos disciplinado pelo Direito.','Uma relação exclusivamente religiosa.','Uma norma revogada.'],1,'Relações jurídicas vinculam sujeitos e podem gerar direitos e deveres.'],
    ['Qual é a função geral da Constituição?',['Organizar o Estado e assegurar direitos fundamentais.','Substituir todos os contratos.','Regular apenas trânsito.','Determinar toda escolha individual.'],0,'A Constituição estrutura o Estado e estabelece direitos e garantias.']
  ],
  TGE: [
    ['Quais são os elementos tradicionalmente associados ao Estado?',['Povo, território e poder soberano.','Idioma, moeda e religião.','Partidos, empresas e sindicatos.','Tribunais, escolas e hospitais.'],0,'Povo, território e poder soberano são elementos clássicos estudados na TGE.'],
    ['O que é soberania?',['Subordinação a qualquer empresa.','Poder supremo do Estado na ordem interna e independência na ordem externa.','Direito individual de governar.','Ausência de leis.'],1,'Soberania é conceito central para compreender o poder estatal.'],
    ['Quais são os três poderes na organização constitucional brasileira?',['Municipal, estadual e federal.','Executivo, Legislativo e Judiciário.','Civil, militar e religioso.','Presidente, governador e prefeito.'],1,'A Constituição estabelece os Poderes Legislativo, Executivo e Judiciário.'],
    ['Qual é a função típica do Poder Legislativo?',['Julgar todos os processos.','Elaborar leis e fiscalizar o Executivo.','Comandar exclusivamente as polícias.','Administrar todos os municípios.'],1,'Legislar e fiscalizar são funções típicas do Legislativo.'],
    ['Qual é a função típica do Poder Judiciário?',['Executar políticas públicas.','Criar tributos por decreto.','Exercer a jurisdição e solucionar conflitos.','Organizar campanhas eleitorais.'],2,'O Judiciário exerce a jurisdição nos termos da Constituição.'],
    ['Qual é a função típica do Poder Executivo?',['Administrar e executar políticas públicas.','Julgar definitivamente todas as ações.','Aprovar sozinho emendas constitucionais.','Substituir o Parlamento.'],0,'O Executivo administra a máquina pública e executa políticas.'],
    ['O que caracteriza uma federação?',['Concentração absoluta em um único município.','Distribuição constitucional de competências entre entes autônomos.','Ausência de governo central.','Proibição de constituições.'],1,'Na federação, os entes têm autonomia conforme a Constituição.'],
    ['Qual é a forma de governo adotada no Brasil?',['Monarquia.','República.','Império.','Teocracia.'],1,'O Brasil adota a forma republicana de governo.'],
    ['O que é democracia representativa?',['Governo sem eleições.','Exercício do poder por representantes eleitos.','Governo hereditário.','Ausência de instituições.'],1,'Representantes eleitos exercem funções políticas em nome da população.'],
    ['Qual é a finalidade da separação dos poderes?',['Eliminar toda cooperação institucional.','Concentrar poder em uma autoridade.','Distribuir funções e criar mecanismos de controle recíproco.','Substituir a Constituição.'],2,'A separação de poderes envolve distribuição funcional e freios e contrapesos.']
  ]
};
function closeQuiz() {
  state.quiz = null;
  const panel = $('#liveQuiz'); if (panel) panel.classList.add('hidden');
  const orb = $('#orb'); if (orb) orb.classList.remove('hidden');
}
function createQuiz(topic = 'Direito', count = 10) {
  topic = /tge|estado|poder/i.test(topic) ? 'TGE' : 'Direito';
  count = Math.max(1, Math.min(30, Number(count) || 10));
  const bank = QUIZ_BANK[topic];
  const questions = Array.from({length: count}, (_, i) => bank[i % bank.length]);
  state.quiz = {topic, questions, index: 0, score: 0}; state.quizSelected = null; state.quizAnswered = false;
  $('#quizTopic').value = topic; $('#quizCount').value = count;
  $('#orb').classList.add('hidden'); $('#liveQuiz').classList.remove('hidden');
  renderQuiz(); setLiveStatus('Quiz de ' + topic + ' iniciado');
}
function renderQuiz() {
  const q = state.quiz; if (!q) return;
  const question = q.questions[q.index];
  $('#quizCounter').textContent = `Questão ${q.index + 1} de ${q.questions.length}`;
  $('#quizScore').textContent = `Acertos: ${q.score}`;
  $('#quizProgress').style.width = `${(q.index / q.questions.length) * 100}%`;
  $('#quizQuestion').textContent = question[0]; $('#quizFeedback').textContent = '';
  $('#quizConfirm').textContent = 'Confirmar resposta'; $('#quizConfirm').disabled = true;
  state.quizSelected = null; state.quizAnswered = false;
  $('#quizOptions').replaceChildren();
  question[1].forEach((answer, index) => {
    const label = document.createElement('label'); label.className = 'quiz-option';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'quizAnswer'; radio.value = String(index);
    radio.onchange = () => { state.quizSelected = index; $('#quizConfirm').disabled = false; };
    const text = document.createElement('span'); text.textContent = `${'ABCD'[index]}) ${answer}`;
    label.append(radio, text); $('#quizOptions').append(label);
  });
}
function advanceQuiz() {
  if (!state.quiz) return;
  if (state.quiz.index + 1 === state.quiz.questions.length) {
    $('#quizFeedback').textContent = `Concluído! Você acertou ${state.quiz.score} de ${state.quiz.questions.length} questões.`;
    $('#quizConfirm').textContent = 'Recomeçar'; $('#quizConfirm').disabled = false;
    $('#quizConfirm').onclick = () => { $('#openQuizLive').onclick = () => createQuiz($('#quizTopic').value || 'Direito', Number($('#quizCount').value) || 10);
$('#quizConfirm').onclick = confirmQuiz; createQuiz(state.quiz.topic, state.quiz.questions.length); };
    return;
  }
  state.quiz.index++; renderQuiz();
}
function confirmQuiz() {
  if (!state.quiz) return;
  if (state.quizAnswered) { advanceQuiz(); return; }
  if (state.quizSelected === null) return;
  const q = state.quiz.questions[state.quiz.index], correct = state.quizSelected === q[2];
  if (correct) state.quiz.score++;
  state.quizAnswered = true;
  $('#quizScore').textContent = `Acertos: ${state.quiz.score}`;
  $('#quizFeedback').textContent = (correct ? 'Correto! ' : `A resposta correta é ${'ABCD'[q[2]]}. `) + q[3];
  [...$('#quizOptions').children].forEach((label, i) => { label.querySelector('input').disabled = true; if (i === q[2]) label.classList.add('correct'); else if (i === state.quizSelected) label.classList.add('wrong'); });
  $('#quizConfirm').textContent = state.quiz.index + 1 === state.quiz.questions.length ? 'Ver resultado' : 'Próxima questão';
}
// O Gemini pode responder antes de finalizar a transcrição. Não espere o
// turnComplete para abrir o quiz: o comando de UI é responsabilidade do app.
function handleQuizInterim(text) {
  const value = normalize(text);
  const request = /\b(quiz|question[aá]rio|quest[oõ]es|perguntas|simulado)\b/.test(value)
    && /\b(cria|crie|criar|faz|faça|fazer|gera|gere|gerar|quero|inicia|iniciar|começa|começar|monte|montar|abre|abrir)\b/.test(value);
  const close = /\b(voltar ao orb|voltar pro orb|fechar o quiz|sair do quiz|remover o quiz)\b/.test(value);
  if (!request && !close) return;
  const now = Date.now();
  if (now - state.quizLastActionAt < 2500) return;
  if (request && !state.quiz) {
    state.quizLastActionAt = now;
    state.quizHandledUtterance = value;
    handleQuizVoice(value);
  } else if (close && state.quiz) {
    state.quizLastActionAt = now;
    state.quizHandledUtterance = value;
    handleQuizVoice(value);
  }
}
function handleQuizVoice(text) {
  const value = normalize(text);
  if (/\b(voltar (ao |pro )?(orb|modo live|voz)|fechar (o )?quiz|sair do quiz|remover (o )?quiz)\b/.test(value)) { if (state.quiz) closeQuiz(); return true; }
  const quizRequested = /\b(quiz|questionario|questionário|questoes|questões|perguntas|simulado)\b/.test(value);
  if (quizRequested && /(cria|crie|criar|faz|faça|fazer|gera|gere|gerar|quero|inicia|iniciar|começa|começar|monte|montar|abre|abrir|novo|muda|altera)/.test(value)) {
    const n = value.match(/(\d{1,2})\s*(quest|pergunt)/)?.[1] || value.match(/quiz (?:de |com )?(\d{1,2})/)?.[1];
    const topic = /tge|teoria geral do estado|tres poderes|três poderes/.test(value) ? 'TGE' : /direito|juridic|jurídic/.test(value) ? 'Direito' : state.quiz?.topic || 'Direito';
    createQuiz(topic, n || state.quiz?.questions.length || 10); return true;
  }
  if (!state.quiz) return false;
  const n = value.match(/(?:altera|muda|quero|coloca|faz|faça).*?(\d{1,2})\s*(?:quest|pergunt)/)?.[1];
  if (n) { createQuiz(state.quiz.topic, n); return true; }
  if (/\b(tge|teoria geral do estado)\b/.test(value) && /(muda|troca|assunto|tema)/.test(value)) { createQuiz('TGE', state.quiz.questions.length); return true; }
  if (/\bdireito\b/.test(value) && /(muda|troca|assunto|tema)/.test(value)) { createQuiz('Direito', state.quiz.questions.length); return true; }
  const letter = value.match(/(?:alternativa|opção|opcao|letra|resposta)\s+([abcd])\b/)?.[1] || (/^[abcd]$/.test(value) ? value : null);
  if (letter && !state.quizAnswered) {
    state.quizSelected = 'abcd'.indexOf(letter);
    const radio = $('#quizOptions').querySelectorAll('input')[state.quizSelected]; if (radio) { radio.checked = true; $('#quizConfirm').disabled = false; }
    return true;
  }
  if (/(confirm|corrig|próxima|proxima|avanç|avanc)/.test(value)) { if (state.quizAnswered) advanceQuiz(); else confirmQuiz(); return true; }
  return false;
}
$('#quizConfirm').onclick = confirmQuiz;
$('#quizClose').onclick = closeQuiz;
$('#quizRegenerate').onclick = () => createQuiz($('#quizTopic').value, $('#quizCount').value);
$('#quizTopic').onchange = () => createQuiz($('#quizTopic').value, $('#quizCount').value);
$('#quizCount').onchange = () => { if (state.quiz) createQuiz($('#quizTopic').value, $('#quizCount').value); };
$('#voiceSettingsBtn').onclick = () => { setVoiceChoice(state.user?.preferences?.voice || 'Kore'); $('#voiceChangeStatus').textContent = ''; $('#voiceDialog').showModal(); };
$('#closeVoiceDialog').onclick = () => $('#voiceDialog').close();
function setVoiceChoice(voice) {
  const radio = document.querySelector(`input[name="voice"][value="${VOICES.includes(voice) ? voice : 'Kore'}"]`);
  if (radio) radio.checked = true;
}
$('#voiceForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.user || state.voiceChangeBusy) return;
  const selected = document.querySelector('input[name="voice"]:checked')?.value;
  if (!VOICES.includes(selected)) return;
  const previous = state.user.preferences?.voice || 'Kore';
  const restart = (state.liveOn || state.connecting) && (state.activeLiveVoice || previous) !== selected;
  const submit = $('#voiceForm button[type="submit"]');
  state.voiceChangeBusy = true; submit.disabled = true;
  $('#voiceChangeStatus').textContent = 'Salvando voz…';
  try {
    const data = await request('/api/preferences', { method: 'PUT', body: { voice: selected, persona: 'Griot', wakeWord: 'Griot' } });
    state.user.preferences = data.preferences;
    if (data.preferences.voice !== selected) throw new Error('A voz escolhida não foi confirmada pelo servidor.');
    $('#voiceDialog').close();
    if (restart && state.liveOn) {
      try {
        await switchLiveVoice(selected);
        toast('Voz ' + selected + ' ativada sem sair do Live.');
      } catch (error) {
        state.voiceSwitchTarget = null;
        // Se o Gemini não aceitar a troca, mantenha a sessão antiga e restaure a preferência.
        try { const old = await request('/api/preferences', { method: 'PUT', body: { voice: previous, persona: 'Griot', wakeWord: 'Griot' } }); state.user.preferences = old.preferences; } catch {}
        throw error;
      }
    } else if (restart && state.connecting) {
      // A conexão inicial lê a preferência no onopen. Se o setup já foi enviado,
      // o setupComplete acima faz a troca sem encerrar a sessão.
      toast('Voz ' + selected + ' salva; será aplicada assim que a conexão estiver pronta.');
    } else toast('Voz ' + selected + ' salva' + (state.liveOn ? '.' : ' para a próxima sessão.') );
  } catch (error) { $('#voiceChangeStatus').textContent = error.message; toast(error.message, true); }
  finally { state.voiceChangeBusy = false; submit.disabled = false; }
});

function deviceAllowed() { try { return localStorage.getItem(DEVICE_KEY) === 'yes'; } catch { return false; } }
function updateDeviceBadge() {
  const allowed = deviceAllowed();
  $('#deviceBadge').textContent = allowed ? 'Ativado' : 'Desativado';
  $('#deviceStatus').textContent = allowed
    ? 'Autorizado: a Griot tentará abrir aplicativos conhecidos quando você pedir, sem pedir confirmação novamente.'
    : 'Desativado. Ative para permitir a abertura de aplicativos compatíveis.';
}
function requestedApp(text) {
  const normalized = normalize(text);
  // Only an explicit imperative from Igor triggers a launch, not a passing mention of an app.
  if (!/(?:\babr(?:a|e|ir)\b|\binici(?:e|ar)\b|\bexecut(?:e|ar)\b|\bentr(?:e|ar)\s+(?:no|na)\b)/.test(normalized)) return null;
  for (const key of Object.keys(APP_LINKS)) {
    const aliases = key === 'maps' ? ['google maps', 'mapas', 'maps'] : [key];
    if (aliases.some(alias => normalized.includes(alias))) return key;
  }
  return null;
}
function launchApp(app, key) {
  // Intents Android são tentativas: navegadores podem bloquear navegação
  // assíncrona e não concedem permissão nativa para iniciar outros apps.
  const native = {
    youtube: 'intent://www.youtube.com/#Intent;scheme=https;package=com.google.android.youtube;end',
    whatsapp: 'intent://send/#Intent;scheme=whatsapp;package=com.whatsapp;end',
    maps: 'intent://maps.google.com/#Intent;scheme=https;package=com.google.android.apps.maps;end',
    spotify: 'intent://open.spotify.com/#Intent;scheme=https;package=com.spotify.music;end',
    gmail: 'intent://mail.google.com/#Intent;scheme=https;package=com.google.android.gm;end'
  };
  if (/Android/i.test(navigator.userAgent) && native[key]) {
    window.location.href = native[key];
    // O navegador pode impedir intents fora de um gesto do usuário.
  } else window.open(app.url, '_blank', 'noopener,noreferrer');
}
function openAuthorizedApp(key, { voice = false } = {}) {
  const app = APP_LINKS[key]; if (!app) return false;
  if (!deviceAllowed()) { toast('Ative o acesso a aplicativos no menu lateral.', true); return false; }
  const announcement = `Claro, abrindo o ${app.name}.`;
  toast(announcement);
  // No extra app-specific confirmation after the user has opted in. In a browser,
  // direct navigation is more reliable than window.open from asynchronous voice events.
  // It can still be blocked by browser/OS policies and may end the current Live session.
  if (voice) {
    clearTimeout(state.appLaunchTimer);
    state.appLaunchTimer = setTimeout(() => {
      state.appLaunchTimer = null;
      launchApp(app, key);
    }, 3000);
  } else {
    launchApp(app, key);
  }
  return true;
}
function suggestApp(key) { return openAuthorizedApp(key); }
function maybeSuggestApp(text, options = {}) {
  if (!deviceAllowed()) return false;
  const key = requestedApp(text);
  return key ? openAuthorizedApp(key, options) : false;
}
$('#openDevice').onclick = () => { $('.rail').classList.remove('open'); $('#devicePermission').checked = deviceAllowed(); updateDeviceBadge(); $('#deviceDialog').showModal(); };
$('#closeDeviceDialog').onclick = () => $('#deviceDialog').close();
$('#devicePermission').addEventListener('change', e => {
  localStorage.setItem(DEVICE_KEY, e.target.checked ? 'yes' : 'no');
  updateDeviceBadge();
  toast(e.target.checked ? 'Abertura de aplicativos autorizada.' : 'Acesso a aplicativos desativado.');
});
document.querySelectorAll('[data-open-app]').forEach(button => button.addEventListener('click', () => suggestApp(button.dataset.openApp)));
$('#openMemory').onclick = () => { renderMemories(); $('.rail').classList.remove('open'); $('#memoryDialog').showModal(); };
$('#closeMemoryDialog').onclick = () => $('#memoryDialog').close();
$('#memoryForm').addEventListener('submit', async e => {
  e.preventDefault(); const text = $('#memoryInput').value.trim(); if (!text) return;
  await remember(text); $('#memoryInput').value = '';
});
window.addEventListener('pagehide', () => {
  state.manuallyStopped = true;
  try { state.ws?.close(); } catch {}
  state.micStream?.getTracks().forEach(track => track.stop());
});
init();

// Pesquisa pública independente da cota Gemini; opção manual para alternar.
const searchToggle = document.querySelector('#publicSearchToggle');
if (searchToggle) searchToggle.onclick = () => {
  state.publicSearchMode = !state.publicSearchMode;
  searchToggle.setAttribute('aria-pressed', String(state.publicSearchMode));
  searchToggle.textContent = state.publicSearchMode ? '🌐 Pesquisa pública: ligada' : '🌐 Pesquisa pública: desligada';
  toast(state.publicSearchMode ? 'Pesquisa na Wikipédia ativada. O modo Live continua no Gemini.' : 'Chat Gemini reativado; sujeito à cota da API.');
};
async function resumeLiveAudio() {
  if ((!state.liveOn && !state.connecting) || state.audioRecoveryBusy) return;
  state.audioRecoveryBusy = true;
  try {
    if (state.audioContext?.state === 'suspended') await state.audioContext.resume();
    if (state.inputContext?.state === 'suspended') await state.inputContext.resume();
    if (state.liveOn && state.audioContext?.state !== 'running') setLiveStatus('Áudio suspenso. Toque para reativar.');
  } catch (error) { console.warn('Falha ao retomar áudio:', error); }
  finally { state.audioRecoveryBusy = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeLiveAudio(); });
document.addEventListener('pointerdown', resumeLiveAudio, { passive: true });
window.addEventListener('pageshow', resumeLiveAudio);

$('#exportHistory').onclick = async () => { try { const data = await request('/api/export'); const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='griot-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000); } catch(e){ toast(e.message,true); } };
