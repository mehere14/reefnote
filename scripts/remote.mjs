import { existsSync, readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
// config/tailscale.json is machine-specific and gitignored; fall back to the committed example.
const localConfig = new URL('../config/tailscale.json', import.meta.url);
const config = JSON.parse(readFileSync(existsSync(localConfig) ? localConfig : new URL('../config/tailscale.example.json', import.meta.url), 'utf8'));
if (config.host !== '127.0.0.1' || ![config.port, config.httpsPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error('Tailscale config requires localhost and valid port numbers.');
}
const candidates = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];
const cli = candidates.find(existsSync) || 'tailscale';
function fail(message) { console.error(message); process.exit(1); }
const status = spawnSync(cli, ['status', '--json'], { encoding: 'utf8', timeout: 10000 });
if (status.error || status.status !== 0) fail('Open Tailscale and sign in on this Mac first, then run npm run remote again.');
let info;
try { info = JSON.parse(status.stdout); } catch { fail('Could not read Tailscale status. Open Tailscale and check its connection.'); }
const dns = info.Self?.DNSName?.replace(/\.$/, '');
if (info.BackendState !== 'Running' || !dns) fail('Connect this Mac to Tailscale first, then run npm run remote again.');
if (config.hostname && config.hostname !== dns) fail(`Tailscale hostname changed to ${dns}. Update config/tailscale.json before starting.`);
const origin = `https://${dns}${config.httpsPort === 443 ? '' : ':' + config.httpsPort}`;
const { host, port } = config;
await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => fail(`Port ${port} is already in use. Stop the existing Reefnote server before running npm run remote.`));
  probe.listen(port, host, () => probe.close(resolve));
});
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) fail('Reefnote could not build. Remote access was not started.');
const serve = spawnSync(cli, ['serve', '--bg', `--https=${config.httpsPort}`, `http://${host}:${port}`], { stdio: 'inherit' });
if (serve.status !== 0) fail('Complete any Tailscale HTTPS setup shown above, then run npm run remote again.');
console.log(`\nOpen ${origin} on your phone with Tailscale connected.\nKeep this terminal open and the Mac powered on. Press Ctrl+C to stop Reefnote.\n`);
const server = spawn(process.execPath, ['scripts/start.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, HOST: host, PORT: String(port), ORIGIN: origin }
});
// Prevent idle sleep while serving; closing a laptop lid can still suspend it.
const awake = process.platform === 'darwin' ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(server.pid)], { stdio: 'ignore' }) : null;
awake?.on('error', () => console.warn('Keep the Mac awake manually; caffeinate could not start.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => { awake?.kill(); process.exitCode = code ?? 0; });
server.on('error', (error) => { awake?.kill(); fail(error.message); });
