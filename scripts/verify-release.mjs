import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must point to a disposable local PostgreSQL database');
  process.exit(2);
}
let host;
try { host = new URL(databaseUrl).hostname; }
catch { console.error('DATABASE_URL is invalid'); process.exit(2); }
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error('Release verification refuses non-local database hosts; use an isolated localhost PostgreSQL service');
  process.exit(2);
}
if (process.env.AITRADING_ALLOW_DATABASE_RESET !== '1') {
  console.error('Set AITRADING_ALLOW_DATABASE_RESET=1 only for a disposable local test database; migration replay resets test schemas');
  process.exit(2);
}

const commands = [
  ['npm', ['run', 'test']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'build']],
  ['npm', ['audit', '--omit=dev']],
  ['deno', ['check', '--config', 'supabase/functions/market-collector/deno.json', 'supabase/functions/market-collector/index.ts']],
  ['npm', ['run', 'test:integration']],
  ['npm', ['run', 'test:e2e']],
  ['npx', ['--yes', 'wrangler@4.158.0', 'deploy', '--dry-run', '--config', 'cloudflare/wrangler.jsonc']],
];
for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nRelease verification passed. Wrangler was dry-run only; no deployment was performed.');
