import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const browser = process.env.CHROMIUM_BIN || (spawnSync('sh', ['-lc', 'command -v chromium || command -v chromium-browser || command -v google-chrome'], { encoding: 'utf8' }).stdout || '').trim();
if (!browser) {
  console.error('Chromium is required for E2E smoke tests');
  process.exit(2);
}
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
try {
  let ready = false;
  server.stdout.on('data', chunk => { if (String(chunk).includes('4173')) ready = true; });
  for (let i = 0; i < 50 && !ready; i++) {
    await delay(100);
    const probe = spawnSync('curl', ['-fsS', 'http://127.0.0.1:4173/'], { stdio: 'ignore' });
    ready = probe.status === 0;
  }
  if (!ready) throw new Error('Vite server did not become ready');
  const result = spawnSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--virtual-time-budget=5000', '--timeout=20000', '--dump-dom', 'http://127.0.0.1:4173/'], { encoding: 'utf8', timeout: 25_000, maxBuffer: 2_000_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Chromium failed');
  const dom = result.stdout;
  for (const marker of ['AITrading', 'INDODAX SIGNAL ENGINE', 'Data resmi']) {
    if (!dom.includes(marker)) throw new Error(`missing rendered marker: ${marker}`);
  }
  if (/Uncaught (?:Error|TypeError)|Failed to load resource: the server responded with a status of 5/.test(dom)) throw new Error('fatal browser error rendered');
  console.log('browser smoke assertions passed');
} finally {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
}
