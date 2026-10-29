const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const kube = require('./kube.cjs');

class Forwards {
  constructor() { this.entries = new Map(); }
  start(input) {
    const args = kube.forwardArgs(input);
    if ([...this.entries.values()].some(f => ['starting', 'ready'].includes(f.state) && f.localPort === input.localPort)) throw new Error('That local port already has an active forward');
    const id = randomUUID();
    const entry = { id, context: input.context, namespace: input.namespace, resource: input.resource, name: input.name, localPort: input.localPort, remotePort: input.remotePort, state: 'starting', output: '' };
    const child = spawn(kube.executable(), args, { env: kube.environment(), detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.entries.set(id, { ...entry, child });
    const item = this.entries.get(id);
    const output = text => { item.output = (item.output + text).slice(-20000); if (/Forwarding from 127\.0\.0\.1:/.test(text) && item.state === 'starting') item.state = 'ready'; };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.on('error', e => { item.state = 'error'; item.output += e.message; });
    child.on('close', code => { clearTimeout(item.timer); if (!['stopped', 'error'].includes(item.state)) { item.state = code ? 'error' : 'ended'; if (code) item.output += `\nPort forward exited with ${code}`; } });
    item.timer = setTimeout(() => { if (item.state === 'starting') { this.stop(id); item.state = 'error'; item.output += '\nPort forward did not become ready within 30 seconds.'; } }, 30000);
    item.timer.unref();
    for (const [oldId, old] of this.entries) if (this.entries.size > 200 && !['starting', 'ready'].includes(old.state)) this.entries.delete(oldId);
    return { id, localPort: input.localPort };
  }
  list() { return [...this.entries.values()].map(({ child, timer, ...record }) => record); }
  stop(id) {
    const item = this.entries.get(id);
    if (!item || !['starting', 'ready'].includes(item.state)) return;
    clearTimeout(item.timer); item.state = 'stopped';
    try { process.kill(-item.child.pid, 'SIGTERM'); } catch { item.child.kill(); }
  }
  close() { for (const id of this.entries.keys()) this.stop(id); }
}
module.exports = { Forwards };
