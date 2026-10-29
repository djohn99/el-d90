const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const kube = require('./kube.cjs');
const previews = new Map();
function binary() {
  const candidates = [process.env.EL_D90_HELM, ...kube.environment().PATH.split(':').map(p => path.join(p, 'helm'))].filter(Boolean);
  for (const p of candidates) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  throw new Error('Helm was not found. Install Helm or set EL_D90_HELM to its absolute executable path.');
}
function token(value, label, max = 1024) { return kube.string(value, label, max); }
function releaseName(value) { token(value, 'release name', 53); if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) throw new Error('Use a lowercase release name with letters, numbers and hyphens'); return value; }
function namespace(value) { token(value, 'namespace', 63); if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) throw new Error('Choose exactly one valid namespace'); return value; }
function chartRef(value) {
  token(value, 'chart', 2048);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && !/^oci:\/\/[a-zA-Z0-9][a-zA-Z0-9.:-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$/.test(value)) throw new Error('Use a configured repository/chart or an oci://registry/path/chart reference');
  return value;
}
function version(value) { if (!value) return ''; token(value, 'chart version', 128); if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(value)) throw new Error('Invalid chart version'); return value; }
function target(input) { return ['--kube-context', token(input.context, 'context'), '--namespace', namespace(input.namespace)]; }
function validateOperation(input) {
  if (!['install', 'upgrade'].includes(input.operation)) throw new Error('Choose install or upgrade');
  target(input); releaseName(input.name); chartRef(input.chart); version(input.version);
  if (typeof input.values !== 'string' || Buffer.byteLength(input.values) > 2 * 1024 * 1024) throw new Error('Values must be YAML text no larger than 2 MB');
  if (input.createNamespace !== undefined && typeof input.createNamespace !== 'boolean') throw new Error('Invalid create namespace choice');
  if (input.wait !== undefined && typeof input.wait !== 'boolean') throw new Error('Invalid wait choice');
  return { operation: input.operation, context: input.context, namespace: input.namespace, name: input.name, chart: input.chart, version: input.version || '', values: input.values, createNamespace: !!input.createNamespace, wait: !!input.wait };
}
function operationArgs(input, { dryRun = false, hideSecret = false, valuesPath } = {}) {
  const v = validateOperation(input);
  const args = [v.operation, v.name, v.chart, ...target(v), '--timeout', '10m'];
  if (v.version) args.push('--version', v.version);
  if (valuesPath) args.push('--values', valuesPath);
  if (v.createNamespace && v.operation === 'install') args.push('--create-namespace');
  if (v.wait && !dryRun) args.push('--wait');
  if (dryRun) args.push(dryRun === 'client-legacy' ? '--dry-run' : '--dry-run=' + dryRun);
  if (dryRun && hideSecret) args.push('--hide-secret');
  return args;
}
async function run(args, options = {}) { return kube.run(args, { binary: binary(), timeout: 600000, ...options }); }
async function withValues(text, fn) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'el-d90-helm-'));
  try { await fsp.chmod(directory, 0o700); const file = path.join(directory, 'values.yaml'); await fsp.writeFile(file, text, { mode: 0o600 }); return await fn(file); }
  finally { await fsp.rm(directory, { recursive: true, force: true }); }
}
function signature(input) { return createHash('sha256').update(JSON.stringify(validateOperation(input))).digest('hex'); }
async function repos() { try { return JSON.parse(await run(['repo', 'list', '-o', 'json'])); } catch (e) { if (/no repositories|no repository/i.test(e.message)) return []; throw e; } }
async function search(input = {}) {
  let query = input.query || '';
  if (input.repo) { token(input.repo, 'repository name', 63); if (!/^[a-z0-9][a-z0-9._-]*$/.test(input.repo)) throw new Error('Invalid repository name'); query = input.repo + '/' + query; }
  if (typeof query !== 'string' || query.length > 200 || (query && (query.startsWith('-') || /[\x00-\x1f]/.test(query)))) throw new Error('Invalid chart search');
  return JSON.parse(await run(['search', 'repo', ...(query ? [query] : []), '-o', 'json']));
}
async function versions(input) { return JSON.parse(await run(['search', 'repo', chartRef(input.chart), '--versions', '-o', 'json'])); }
async function values(input) { const args=['show', 'values', chartRef(input.chart)]; if(version(input.version))args.push('--version',input.version); return run(args); }
async function releaseValues(input) { return run(['get', 'values', releaseName(input.name), ...target(input), '-o', 'yaml']); }
async function history(input) { return JSON.parse(await run(['history', releaseName(input.name), ...target(input), '--max', '256', '-o', 'json'])); }
async function preview(input) {
  const validated = validateOperation(input);
  if (!validated.version) {
    const metadata = await run(['show', 'chart', validated.chart]);
    const match = metadata.match(/^version:\s*['\"]?([^'\"\s]+)['\"]?\s*$/m);
    if (!match) throw new Error('Could not resolve the chart version. Enter an exact version before previewing.');
    validated.version = version(match[1]);
  }
  const help = await run([validated.operation, '--help'], { timeout: 30000 });
  const dryRun = /--dry-run\s+string/.test(help) || /--dry-run[^\n]*server/.test(help) ? 'server' : 'client-legacy';
  const output = await withValues(validated.values, file => run(operationArgs(validated, { dryRun, hideSecret: help.includes('--hide-secret'), valuesPath: file })));
  for (const [id, entry] of previews) if (entry.expires < Date.now()) previews.delete(id);
  if (previews.size > 200) previews.delete(previews.keys().next().value);
  const previewToken = randomUUID(); previews.set(previewToken, { signature: signature(validated), expires: Date.now()+10*60*1000 });
  return { output, previewToken, resolvedVersion: validated.version, mode: dryRun === 'server' ? 'server dry run' : 'client dry run', target: { context: validated.context, namespace: validated.namespace, name: validated.name } };
}
async function perform(input) {
  const validated = validateOperation(input), entry = previews.get(input.previewToken);
  if (!entry || entry.expires < Date.now() || entry.signature !== signature(validated)) throw new Error('Preview this exact chart, values and target before applying; previews expire after 10 minutes');
  previews.delete(input.previewToken);
  return { output: await withValues(validated.values, file => run(operationArgs(validated, { valuesPath: file }))) };
}
function validateRevision(input) { target(input); releaseName(input.name); if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1e8) throw new Error('Choose a valid release revision'); return input; }
async function rollback(input) { validateRevision(input); return { output: await run(['rollback', input.name, String(input.revision), ...target(input), '--timeout', '10m', '--wait']) }; }
async function uninstall(input) { target(input); releaseName(input.name); return { output: await run(['uninstall', input.name, ...target(input), '--timeout', '10m', '--wait']) }; }
function validateRepo(input) {
  token(input.name,'repository name',63); if(!/^[a-z0-9][a-z0-9._-]*$/.test(input.name))throw new Error('Invalid repository name');
  let url;try{url=new URL(input.url);}catch{throw new Error('Use an HTTPS chart repository URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Use an HTTPS chart repository URL without embedded credentials or query parameters');
  return input;
}
async function repoAdd(input) { validateRepo(input); return {output:await run(['repo','add',input.name,input.url])}; }
async function repoUpdate() { return {output:await run(['repo','update'])}; }
module.exports = { repos, search, versions, values, releaseValues, history, preview, perform, rollback, uninstall, repoAdd, repoUpdate, validateOperation, operationArgs, validateRevision, validateRepo, releaseName, namespace, chartRef };
