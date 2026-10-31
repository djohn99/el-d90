// AWS CLI owns authentication and cached credentials. Only profile/cluster metadata crosses IPC.
const fs = require('node:fs/promises'), nativeFs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process'), YAML = require('yaml'), kube = require('./kube.cjs');
const text = (value, label, max = 256) => { if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value) || value.startsWith('-')) throw Error('Invalid ' + label); return value; };
const region = value => { if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(value || '')) throw Error('Choose an AWS region such as eu-west-1'); return value; };
function configMetadata(source) {
  const sections = new Map(); let current;
  for (const line of source.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]\r\n]+)\]\s*(?:[#;].*)?$/.exec(line);
    if (heading) { current = {}; sections.set(heading[1], current); continue; }
    const entry = /^\s*(region|sso_session|sso_start_url|sso_region|sso_account_id|sso_role_name)\s*=\s*(.*?)\s*$/.exec(line);
    if (entry && current) current[entry[1]] = entry[2];
  }
  return sections;
}
function safeError(error) {
  const value = String(error?.message || error);
  if (/abort|cancel/i.test(value)) return 'Cancelled.';
  if (/bad CPU type|exec format/i.test(value)) return 'AWS CLI has the wrong CPU architecture. Install the Apple Silicon AWS CLI.';
  if (/ENOENT|not found/i.test(value)) return 'AWS CLI v2 was not found. Install it, then reload profiles.';
  if (/expired|UnauthorizedSSOToken|SSO session|TokenRetrieval|InvalidGrant/i.test(value)) return 'Your AWS SSO session has expired. Choose Sign in with AWS SSO again.';
  if (/AccessDenied|Forbidden|not authorized/i.test(value)) return 'AWS denied this request. Check the selected account/role and its EKS permissions.';
  if (/timeout|timed out/i.test(value)) return 'AWS request timed out. Check your network or complete browser sign-in and try again.';
  return 'AWS could not complete this request. Check your profile, region, network and AWS CLI configuration.';
}
function binary() {
  for (const file of [process.env.EL_D90_AWS, ...kube.environment().PATH.split(path.delimiter).map(dir => path.join(dir, 'aws'))].filter(Boolean)) {
    try { nativeFs.accessSync(file, nativeFs.constants.X_OK); return file; } catch {}
  }
  throw Error('AWS CLI not found');
}
function run(args, options = {}) {
  const env = { ...kube.environment(), AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true' };
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN']) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary || binary(), [...args, '--no-cli-pager'], { shell: false, env, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = Error('AWS request timed out'); child.kill('SIGKILL'); }, options.timeout || 45000);
    const append = (chunk, error) => { if (error) stderr += chunk.toString(); else stdout += chunk.toString(); if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 2 * 1024 * 1024) { failure = Error('AWS response too large'); child.kill('SIGKILL'); } };
    child.stdout.on('data', chunk => append(chunk, false)); child.stderr.on('data', chunk => append(chunk, true));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code) reject(Error(stderr || 'AWS request failed')); else resolve(stdout); });
  });
}
class AWSConnections {
  constructor(directory, options = {}) { this.directory = directory; this.options = options; this.jobs = new Map(); this.writes = Promise.resolve(); }
  configPath() { return this.options.configFile || process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws/config'); }
  run(args, options) { return (this.options.run || run)(args, options); }
  async configText() { try { const stat = await fs.stat(this.configPath()); if (stat.size > 1024 * 1024) throw Error('AWS config too large'); return await fs.readFile(this.configPath(), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }
  async profiles() {
    try {
      const [version, names, source] = await Promise.all([this.run(['--version']), this.run(['configure', 'list-profiles']), this.configText()]);
      const match = /aws-cli\/(\d+)\.([\d.]+)/.exec(version); if (!match || Number(match[1]) !== 2) return { available: false, profiles: [], message: 'AWS CLI v2 is required for browser SSO.' };
      const sections = configMetadata(source);
      const profiles = [...new Set(names.split(/\r?\n/).map(name => name.trim()).filter(Boolean))].slice(0, 256).map(name => {
        const profile = sections.get(name === 'default' ? 'default' : 'profile ' + name) || {}, session = sections.get('sso-session ' + profile.sso_session) || {};
        return { name, region: profile.region || '', sso: !!(profile.sso_session || profile.sso_start_url), account: /^\d{12}$/.test(profile.sso_account_id || '') ? profile.sso_account_id : '', role: profile.sso_role_name || '', session: profile.sso_session || '', ssoRegion: session.sso_region || profile.sso_region || '' };
      });
      return { available: true, version: match[0], profiles, jobs: [...this.jobs.values()].filter(job => job.state === 'running').map(job => this.status({ id: job.id })), message: 'AWS manages browser sign-in and cached credentials. No token copying is required.' };
    } catch (error) { return { available: false, profiles: [], message: safeError(error) }; }
  }
  async profile(value) { const name = text(value, 'AWS profile'), overview = await this.profiles(); if (!overview.available) throw Error(overview.message); const profile = overview.profiles.find(profile => profile.name === name); if (!profile) throw Error('Choose a configured AWS profile'); return profile; }
  startLogin(input) {
    return this.profile(input.profile).then(profile => {
      if (!profile.sso) throw Error('This profile is not configured for AWS SSO. Create an SSO profile below.');
      const existing = [...this.jobs.values()].find(job => job.profile === profile.name && job.state === 'running'); if (existing) return this.status({ id: existing.id });
      for (const [id, job] of this.jobs) if (job.state !== 'running' && Date.now() - job.created > 600000) this.jobs.delete(id);
      if (this.jobs.size >= 20) throw Error('Too many recent sign-in attempts. Try again shortly.');
      const id = crypto.randomUUID(), controller = new AbortController(), job = { id, profile: profile.name, state: 'running', message: 'Complete AWS SSO sign-in in your browser.', created: Date.now(), controller }; this.jobs.set(id, job);
      (async () => { try {
        await this.run(['sso', 'login', '--profile', profile.name], { signal: controller.signal, timeout: 300000 });
        const identity = JSON.parse(await this.run(['sts', 'get-caller-identity', '--profile', profile.name, '--output', 'json'], { signal: controller.signal }));
        if (job.state !== 'running') return; job.state = 'complete'; job.message = 'Signed in. Choose the EKS region and load clusters.'; job.account = /^\d{12}$/.test(identity.Account || '') ? identity.Account : ''; job.arn = typeof identity.Arn === 'string' ? identity.Arn.slice(0, 2048) : '';
      } catch (error) { if (job.state !== 'running') return; job.state = 'failed'; job.message = safeError(error); } })();
      return this.status({ id });
    });
  }
  status(input) { const job = this.jobs.get(input.id); if (!job) throw Error('Sign-in attempt not found'); return { id: job.id, profile: job.profile, state: job.state, message: job.message, account: job.account || '', arn: job.arn || '' }; }
  cancel(input) { const job = this.jobs.get(input.id); if (job?.state === 'running') { job.state = 'cancelled'; job.message = 'Sign-in cancelled. You may close the AWS browser tab.'; job.controller.abort(); } return job ? this.status(input) : { state: 'cancelled' }; }
  close() { for (const job of this.jobs.values()) this.cancel({ id: job.id }); }
  async clusters(input) {
    const profile = await this.profile(input.profile), selectedRegion = region(input.region);
    try { const result = JSON.parse(await this.run(['eks', 'list-clusters', '--profile', profile.name, '--region', selectedRegion, '--output', 'json'])); return { profile: profile.name, region: selectedRegion, clusters: (result.clusters || []).filter(name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name)).slice(0, 1000) }; }
    catch (error) { throw Error(safeError(error)); }
  }
  async connect(input) {
    const profile = await this.profile(input.profile), selectedRegion = region(input.region), name = text(input.cluster, 'EKS cluster', 100);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name)) throw Error('Invalid EKS cluster');
    let cluster;
    try { cluster = JSON.parse(await this.run(['eks', 'describe-cluster', '--name', name, '--profile', profile.name, '--region', selectedRegion, '--output', 'json'])).cluster; } catch (error) { throw Error(safeError(error)); }
    if (cluster?.name !== name || typeof cluster.arn !== 'string' || !new RegExp('^arn:aws(?:-[a-z-]+)?:eks:' + selectedRegion + ':\\d{12}:cluster/' + name + '$').test(cluster.arn)) throw Error('AWS returned an unexpected cluster identity');
    let endpoint; try { endpoint = new URL(cluster.endpoint); } catch { throw Error('Cluster endpoint is unavailable'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('AWS returned an invalid cluster endpoint');
    const certificate = cluster.certificateAuthority?.data; if (typeof certificate !== 'string' || !certificate || !/^[A-Za-z0-9+/=\r\n]+$/.test(certificate)) throw Error('Cluster certificate is unavailable');
    const context = 'el-d90:' + profile.name + ':' + selectedRegion + ':' + name, executable = this.options.binary || binary();
    const config = { apiVersion: 'v1', kind: 'Config', 'current-context': context, clusters: [{ name: context, cluster: { server: endpoint.origin, 'certificate-authority-data': certificate } }], contexts: [{ name: context, context: { cluster: context, user: context } }], users: [{ name: context, user: { exec: { apiVersion: 'client.authentication.k8s.io/v1beta1', command: executable, args: ['--region', selectedRegion, 'eks', 'get-token', '--cluster-name', name, '--output', 'json', '--profile', profile.name], env: [{ name: 'AWS_PROFILE', value: profile.name }] } } }] };
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, crypto.createHash('sha256').update(JSON.stringify([profile.name, selectedRegion, name])).digest('hex').slice(0, 24) + '.yaml'), temporary = file + '.' + crypto.randomUUID();
    try { await fs.writeFile(temporary, YAML.stringify(config), { mode: 0o600 }); await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
    return { context, file, profile: profile.name, region: selectedRegion, cluster: name, message: 'EKS connection added to el-d90. Your global kubeconfig/current-context is unchanged.' };
  }
  createProfile(input) {
    const work = this.writes.catch(() => {}).then(async () => {
      const name = text(input.name, 'profile name', 80); if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/.test(name) || name === 'default') throw Error('Choose a new named profile; default is not overwritten');
      const ssoRegion = region(input.ssoRegion), selectedRegion = region(input.region), account = String(input.account || ''), role = text(input.role, 'SSO role', 128);
      if (!/^\d{12}$/.test(account) || !/^[A-Za-z0-9_+=,.@ -]+$/.test(role)) throw Error('Enter the 12-digit AWS account ID and SSO role/permission-set name');
      const url = new URL(text(input.startUrl, 'SSO start URL', 1024));
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !(url.hostname.endsWith('.awsapps.com') && /^\/start\/?$/.test(url.pathname) || url.hostname === 'identitycenter.amazonaws.com')) throw Error('Use your HTTPS AWS access portal /start URL or Identity Center issuer URL');
      const overview = await this.profiles(); if (!overview.available) throw Error(overview.message); if (overview.profiles.some(profile => profile.name === name)) throw Error('That AWS profile already exists. Choose another name.');
      const file = this.configPath(), original = await this.configText(), sections = configMetadata(original), session = 'el-d90-' + name;
      if (sections.has('profile ' + name) || sections.has('sso-session ' + session)) throw Error('Profile/session already exists. Choose another name.');
      const next = original + (original.endsWith('\n') || !original ? '' : '\n') + `\n[profile ${name}]\nsso_session = ${session}\nsso_account_id = ${account}\nsso_role_name = ${role}\nregion = ${selectedRegion}\noutput = json\n\n[sso-session ${session}]\nsso_start_url = ${url.href}\nsso_region = ${ssoRegion}\nsso_registration_scopes = sso:account:access\n`;
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      if (original) await fs.writeFile(file + '.el-d90-backup-' + crypto.randomUUID(), original, { mode: 0o600, flag: 'wx' });
      const temporary = file + '.' + crypto.randomUUID(); try { await fs.writeFile(temporary, next, { mode: 0o600 }); if (await this.configText() !== original) throw Error('AWS config changed. Reload profiles and try again.'); await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
      return { profile: name, message: 'Named SSO profile created. Choose Sign in with AWS SSO to continue.' };
    }); this.writes = work; return work;
  }
}
module.exports = { AWSConnections, configMetadata, safeError, region, run };
