// Supervisor: um processo Node público e um FastAPI acessível apenas em loopback.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (!children.size) process.exit(code);
  const timeout = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 8000);
  const finish = () => { if (!children.size) { clearTimeout(timeout); process.exit(code); } };
  for (const child of children) child.once('exit', finish);
}
function launch(command, args, extra = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...extra });
  children.add(child);
  child.once('error', () => { children.delete(child); console.error('Não foi possível iniciar um serviço. Confira as dependências.'); stop(1); });
  child.once('exit', code => { children.delete(child); if (!stopping) stop(code || 1); });
  return child;
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
if (process.env.CRIOT_ENABLED === 'true') {
  const port = String(process.env.CRIOT_PORT || 8001);
  launch(process.env.PYTHON_BIN || 'python3', ['-m', 'uvicorn', 'app.main:app',
    '--host', '127.0.0.1', '--port', port, '--workers', '1'], {
      cwd: path.join(root, 'criot'),
      env: { ...process.env, CRIOT_DB_PATH: process.env.CRIOT_DB_PATH ||
        path.join(path.resolve(root, process.env.DATA_DIR || '.data'), 'criot.db') }
    });
  let ready = false;
  for (let i = 0; i < 100 && !stopping; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) { console.error('A API Criot não iniciou.'); stop(1); }
}
if (!stopping) launch(process.execPath, ['server.js']);
