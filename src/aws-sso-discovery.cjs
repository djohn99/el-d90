// Tokens remain in the main process and AWS CLI's private SSO cache; never return them over IPC.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { SSOOIDCClient, RegisterClientCommand, StartDeviceAuthorizationCommand, CreateTokenCommand } = require('@aws-sdk/client-sso-oidc');
const { SSOClient, paginateListAccounts, paginateListAccountRoles } = require('@aws-sdk/client-sso');
const { region, configMetadata, safeError } = require('./aws-connections.cjs');
function portal(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname.endsWith('.awsapps.com') || !/^\/start\/?$/.test(url.pathname)) throw Error('Enter your HTTPS AWS access portal /start URL'); return url.href; }
class SSODiscovery {
  constructor(aws, options = {}) { this.aws = aws; this.options = options; this.jobs = new Map(); }
  async portals() { const sections = configMetadata(await this.aws.configText()), portals = []; for (const item of sections.values()) { if (!item.sso_start_url || !item.sso_region) continue; try { const startUrl = portal(item.sso_start_url), ssoRegion = region(item.sso_region); if (!portals.some(p => p.startUrl === startUrl && p.ssoRegion === ssoRegion)) portals.push({ startUrl, ssoRegion }); } catch {} } const active=[...this.jobs.values()].find(job=>job.state==='running'||job.state==='complete'&&Date.now()<job.expiresAt); return { portals, ...(active?{active:{...this.view(active),startUrl:active.startUrl,ssoRegion:active.ssoRegion}}:{}) }; }
  view(job) { return { id: job.id, state: job.state, message: job.message, accounts: job.accounts || [] }; }
  status({ id }) { const job = this.jobs.get(id); if (!job) throw Error('SSO sign-in not found'); return this.view(job); }
  cancel({ id }) { const job = this.jobs.get(id); if (job) { job.controller.abort(); clearTimeout(job.timer); job.token = null; job.registration = null; job.authorizationUrl=null; job.state = 'cancelled'; job.message = 'SSO discovery cancelled.'; } return job ? this.view(job) : { state: 'cancelled' }; }
  close() { for (const id of this.jobs.keys()) this.cancel({ id }); }
  async start(input) {
    const startUrl = portal(input.startUrl), ssoRegion = region(input.ssoRegion);
    for (const id of this.jobs.keys()) this.cancel({ id }); this.jobs.clear();
    const job = { id: crypto.randomUUID(), startUrl, ssoRegion, state: 'running', message: 'Complete browser sign-in, then choose Allow access for el-d90 Kubernetes desktop.', controller: new AbortController() }; this.jobs.set(job.id, job);
    this.authenticate(job).catch(error => { if (job.controller.signal.aborted) return; job.state = 'failed'; job.message = safeError(error); job.token = null; job.registration = null; });
    return this.view(job);
  }
  async reopen({id}) { const job=this.jobs.get(id);if(!job||job.state!=='running'||!job.authorizationUrl)throw Error('Start a new SSO sign-in to open its approval page.');await this.options.openExternal(job.authorizationUrl);return this.view(job); }
  async authenticate(job) {
    const client = this.options.oidc?.(job.ssoRegion) || new SSOOIDCClient({ region: job.ssoRegion, ignoreConfiguredEndpointUrls: true, maxAttempts: 2, requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 } }), signal = job.controller.signal;
    const send = command => client.send(command, { abortSignal: signal });
    try {
      const registration = await send(new RegisterClientCommand({ clientName: 'el-d90 Kubernetes desktop', clientType: 'public', scopes: ['sso:account:access'] })); job.registration = registration;
      const device = await send(new StartDeviceAuthorizationCommand({ clientId: registration.clientId, clientSecret: registration.clientSecret, startUrl: job.startUrl }));
      const url = new URL(device.verificationUriComplete || device.verificationUri);
      if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.amazonaws.com') || url.hostname.endsWith('.awsapps.com'))) throw Error('Invalid AWS authorization destination');
      if (signal.aborted) return; job.authorizationUrl=url.href; await this.options.openExternal(url.href);
      const deadline = Date.now() + Math.min(device.expiresIn || 600, 900) * 1000; let interval = Math.max(device.interval || 5, 1) * 1000;
      while (!signal.aborted && Date.now() < deadline) {
        await (this.options.wait || ((ms, signal) => require('node:timers/promises').setTimeout(ms, undefined, { signal })))(interval, signal);
        try { job.token = await send(new CreateTokenCommand({ clientId: registration.clientId, clientSecret: registration.clientSecret, deviceCode: device.deviceCode, grantType: 'urn:ietf:params:oauth:grant-type:device_code' })); break; }
        catch (error) { if (error.name === 'AuthorizationPendingException') continue; if (error.name === 'SlowDownException') { interval += 5000; continue; } throw error; }
      }
      if (signal.aborted) return; if (!job.token?.accessToken) throw Error('SSO session expired');
      job.expiresAt = Date.now() + job.token.expiresIn * 1000;
      job.accounts = await this.accounts(job); if (signal.aborted) return;
      job.state = 'complete'; job.message = job.accounts.length ? 'Signed in. Choose an assigned AWS account, then a role.' : 'No AWS accounts are assigned to this sign-in.';
      job.timer = setTimeout(() => this.cancel({ id: job.id }), Math.min(job.token.expiresIn * 1000, 2147483647)); job.timer.unref?.();
    } finally { if(signal.aborted){job.token=null;job.registration=null;} client.destroy?.(); }
  }
  session(id) { const job = this.jobs.get(id); if (!job || job.state !== 'complete' || !job.token || Date.now() >= job.expiresAt) throw Error('SSO session expired. Sign in again.'); return job; }
  client(job) { return this.options.sso?.(job.ssoRegion) || new SSOClient({ region: job.ssoRegion, ignoreConfiguredEndpointUrls: true, maxAttempts: 3, requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 } }); }
  async accounts(job) { const client = this.client(job), result = []; try { for await (const page of paginateListAccounts({ client }, { accessToken: job.token.accessToken }, { abortSignal: job.controller.signal })) { for (const account of page.accountList || []) if (/^\d{12}$/.test(account.accountId)) result.push({ id: account.accountId, name: String(account.accountName || account.accountId).slice(0, 256) }); if (result.length > 10000) throw Error('Too many AWS accounts'); } return result; } finally { client.destroy?.(); } }
  async roles({ id, account }) {
    const job = this.session(id); if (!job.accounts.some(item => item.id === account)) throw Error('Choose an assigned AWS account'); const client = this.client(job), roles = [];
    try { for await (const page of paginateListAccountRoles({ client }, { accessToken: job.token.accessToken, accountId: account }, { abortSignal: job.controller.signal })) { for (const role of page.roleList || []) if (role.accountId === account && /^[A-Za-z0-9_+=,.@ -]{1,128}$/.test(role.roleName)) roles.push(role.roleName); if (roles.length > 10000) throw Error('Too many AWS roles'); } return { account, roles }; }
    catch (error) { throw Error(safeError(error)); } finally { client.destroy?.(); }
  }
  async select(input) {
    const job = this.session(input.id), available = await this.roles(input); if (!available.roles.includes(input.role)) throw Error('Choose an assigned SSO role');
    const name = 'el-d90-sso-' + input.account + '-' + crypto.createHash('sha256').update(JSON.stringify([job.startUrl, job.ssoRegion, input.role])).digest('hex').slice(0, 12);
    const session = 'el-d90-' + name, overview = await this.aws.profiles(), existing = overview.profiles.find(profile => profile.name === name);
    if (existing) { const config = configMetadata(await this.aws.configText()), metadata = config.get('sso-session ' + session); if (existing.session !== session || existing.account !== input.account || existing.role !== input.role || metadata?.sso_start_url !== job.startUrl || metadata?.sso_region !== job.ssoRegion) throw Error('Existing SSO profile differs. Choose another connection.'); }
    else await this.aws.createProfile({ name, account: input.account, role: input.role, startUrl: job.startUrl, ssoRegion: job.ssoRegion, region: region(input.region) });
    // AWS CLI's refreshable sso-session cache format, keyed by the session name.
    const directory = this.options.cacheDir || path.join(os.homedir(), '.aws/sso/cache'); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, crypto.createHash('sha1').update(session).digest('hex') + '.json'), temporary = file + '.' + crypto.randomUUID();
    this.session(input.id);
    const cache = { startUrl: job.startUrl, region: job.ssoRegion, accessToken: job.token.accessToken, expiresAt: new Date(job.expiresAt).toISOString(), clientId: job.registration.clientId, clientSecret: job.registration.clientSecret, registrationExpiresAt: new Date(job.registration.clientSecretExpiresAt * 1000).toISOString(), ...(job.token.refreshToken ? { refreshToken: job.token.refreshToken } : {}) };
    try { await fs.writeFile(temporary, JSON.stringify(cache), { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
    return { profile: name, account: input.account, role: input.role, message: 'SSO role selected. Load EKS clusters to continue.' };
  }
}
module.exports = { SSODiscovery, portal };
