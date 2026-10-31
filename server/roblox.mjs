import { AppError, ensure } from './policy.mjs';
export class Roblox {
  constructor({ apiKey, cookie, groupId, universeId, fetchImpl = fetch }) { Object.assign(this, { apiKey, cookie, groupId, universeId, fetchImpl }); }
  async request(url, options = {}) {
    let response;
    try { response = await this.fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000), redirect: 'error' }); }
    catch { const e = new AppError(502, 'Roblox did not confirm the result. Check the audit log before trying again.'); e.uncertain = true; throw e; }
    if (!response.ok) {
      const e = new AppError(502, `Roblox rejected the request (HTTP ${response.status}). Check service permissions or try later.`);
      e.uncertain = response.status >= 500; throw e;
    }
    let text; try { text = await response.text(); } catch { const e = new AppError(502, 'Roblox did not finish its response. Check the audit log.'); e.uncertain = true; throw e; }
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { const e = new AppError(502, 'Roblox returned an unreadable response.'); e.uncertain = true; throw e; }
  }
  async cloud(path, method = 'GET', body) {
    ensure(this.apiKey, 503, 'The owner needs to configure the Roblox Open Cloud key.');
    return this.request(`https://apis.roblox.com/cloud/v2/${path}`, { method, headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async profile(id) { return this.request(`https://users.roblox.com/v1/users/${id}`); }
  async resolve(username, { excludeBannedUsers = true } = {}) {
    const data = await this.request('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: [username], excludeBannedUsers }) });
    ensure(data.data?.length === 1, 404, 'That Roblox username was not found.'); return data.data[0];
  }
  async directory() {
    const members = new Map(), pages = new Set(); let pageToken = '';
    do {
      ensure(!pages.has(pageToken) && pages.size < 50, 502, 'The member directory could not be loaded completely. Use account lookup and try again later.');
      pages.add(pageToken);
      const query = new URLSearchParams({ maxPageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const page = await this.cloud(`groups/${this.groupId}/memberships?${query}`);
      const rows = page.groupMemberships ?? [];
      ensure(Array.isArray(rows) && rows.length <= 100, 502, 'Roblox returned an invalid member list.');
      for (const membership of rows) {
        const id = typeof membership?.user === 'string' && membership.user.match(/^users\/([1-9][0-9]{0,15})$/)?.[1];
        ensure(id && Number.isSafeInteger(Number(id)) && (!membership.path || membership.path.startsWith(`groups/${this.groupId}/memberships/`)), 502, 'Roblox returned an unexpected group member.');
        members.set(id, { id, membership });
      }
      ensure(members.size <= 5000 && (!page.nextPageToken || (typeof page.nextPageToken === 'string' && page.nextPageToken.length <= 2048 && rows.length > 0)), 502, 'Roblox returned incomplete member pagination.');
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    const rows = [...members.values()];
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100), ids = new Set(batch.map(row => row.id));
      const profiles = await this.request('https://users.roblox.com/v1/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: batch.map(row => Number(row.id)), excludeBannedUsers: false }) });
      ensure(Array.isArray(profiles.data) && profiles.data.length <= batch.length, 502, 'Roblox returned an invalid profile list.');
      const found = new Map();
      for (const profile of profiles.data) {
        const id = String(profile.id);
        ensure(ids.has(id) && !found.has(id) && typeof profile.name === 'string' && profile.name.length > 0 && profile.name.length <= 100 && typeof profile.displayName === 'string' && profile.displayName.length <= 100, 502, 'Roblox returned an unexpected member profile.');
        found.set(id, profile);
      }
      for (const row of batch) {
        const profile = found.get(row.id);
        row.name = profile?.name || `User${row.id}`;
        row.displayName = profile?.displayName || 'Account unavailable';
      }
    }
    return rows;
  }
  async membership(id) {
    let token = '', found = []; const pages = new Set();
    do {
      ensure(!pages.has(token) && pages.size < 10, 502, 'Unexpected membership pagination.'); pages.add(token);
      const q = new URLSearchParams({ maxPageSize: '100', filter: `user == 'users/${id}'`, ...(token ? { pageToken: token } : {}) });
      const data = await this.cloud(`groups/${this.groupId}/memberships?${q}`);
      ensure(Array.isArray(data.groupMemberships) || !data.nextPageToken, 502, 'Roblox membership response was incomplete.');
      found.push(...(data.groupMemberships || [])); token = data.nextPageToken || '';
      ensure(found.length <= 100, 502, 'Unexpected membership response.');
    } while (token);
    ensure(found.every(m => m.user === `users/${id}`) && found.length <= 1, 502, 'Roblox returned an unexpected membership.');
    return found[0] || null;
  }
  async cookieAction(path, method) {
    ensure(this.cookie && !/[\r\n;]/.test(this.cookie), 503, 'The owner needs to configure a valid bot cookie on the backend.');
    const headers = { Cookie: `.ROBLOSECURITY=${this.cookie}`, 'Content-Type': 'application/json' };
    // Challenge on the exact target endpoint; retry only an explicit CSRF rejection.
    let response;
    try { response = await this.fetchImpl(`https://groups.roblox.com/v1/groups/${this.groupId}/${path}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { const e = new AppError(502, 'Roblox did not confirm the result. Check the audit log.'); e.uncertain = true; throw e; }
    if (response.status === 403 && response.headers.get('x-csrf-token')) {
      headers['x-csrf-token'] = response.headers.get('x-csrf-token');
      return this.request(`https://groups.roblox.com/v1/groups/${this.groupId}/${path}`, { method, headers });
    }
    if (!response.ok) { const e = new AppError(502, `Roblox rejected the group action (HTTP ${response.status}).`); e.uncertain = response.status >= 500; throw e; }
    return {};
  }
  async checkBot(id) {
    ensure(this.cookie, 503, 'Bot cookie is missing on the backend.');
    const me = await this.request('https://users.roblox.com/v1/users/authenticated', { headers: { Cookie: `.ROBLOSECURITY=${this.cookie}` } });
    ensure(String(me.id) === id, 503, 'The configured bot ID does not match the cookie account.');
  }
}
