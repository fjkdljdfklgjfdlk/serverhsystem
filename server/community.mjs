import { ensure, userId } from './policy.mjs';
export const FRAMES = ['rank', 'crimson', 'steel', 'rainbow', 'none'];
export function safeThumbnail(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.hostname.endsWith('.rbxcdn.com') && !u.port ? u.href : null; } catch { return null; }
}
export function identityStyle(rank, owner = false) {
  const roles = rank.roles || [];
  const special = roles.filter(r => r.priority >= 3).slice(0, 4);
  const tone = owner || roles.some(r => r.priority === 255) ? 'gold' : roles.some(r => /creator|founder/i.test(r.name)) ? 'violet' : roles.some(r => r.access || r.priority >= 250) ? 'crimson' : special.length ? 'steel' : 'none';
  return { badges: [...(owner ? [{ label: 'Group owner', tone: 'gold' }] : []), ...special.map(r => ({ label: r.name, tone: r.priority === 255 ? 'gold' : /creator|founder/i.test(r.name) ? 'violet' : r.access || r.priority >= 250 ? 'crimson' : 'steel' }))], rankFrame: tone };
}
export function community({ db, rb, state, rate, groupId }) {
  db.exec(`CREATE TABLE IF NOT EXISTS panel_people (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen INTEGER NOT NULL, frame TEXT NOT NULL DEFAULT 'rank');
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL, nonce TEXT NOT NULL, UNIQUE(sender,nonce));
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(sender,recipient,id);`);
  const one = (q, ...a) => db.prepare(q).get(...a), run = (q, ...a) => db.prepare(q).run(...a);
  let brandCache, brandPending;
  const imageCache = new Map(); let imageQueue = Promise.resolve();
  async function branding() {
    if (brandCache && brandCache.expires > Date.now()) return brandCache.value;
    if (!brandPending) brandPending = (async () => {
      const [group, icons] = await Promise.allSettled([Promise.resolve().then(() => rb.request(`https://groups.roblox.com/v1/groups/${groupId}`)), Promise.resolve().then(() => rb.request(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=150x150&format=Png&isCircular=false`))]);
      const g = group.status === 'fulfilled' ? group.value : {}, icon = icons.status === 'fulfilled' ? icons.value.data?.find(i => String(i.targetId) === groupId && i.state === 'Completed') : null;
      const value = { id: groupId, name: typeof g.name === 'string' ? g.name : 'ServerH', ownerId: g.owner?.userId ? String(g.owner.userId) : null, iconUrl: safeThumbnail(icon?.imageUrl) };
      brandCache = { value, expires: Date.now() + (value.iconUrl ? 300000 : 30000) }; return value;
    })().finally(() => { brandPending = null; });
    return brandPending;
  }
  async function images(ids) {
    const unique = [...new Set(ids.map(String))];
    const load = async () => {
      const missing = unique.filter(id => !imageCache.has(id) || imageCache.get(id).expires <= Date.now());
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100); let rows = [];
        try { rows = (await rb.request(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${batch.join(',')}&size=150x150&format=Png&isCircular=false`)).data || []; } catch { /* Images never decide access. */ }
        for (const id of batch) { const row = Array.isArray(rows) && rows.find(r => String(r.targetId) === id && r.state === 'Completed'), url = safeThumbnail(row?.imageUrl); imageCache.set(id, { url, expires: Date.now() + (url ? 300000 : 30000) }); }
      }
      // Bound decorative cache growth even for repeated outside-group lookups.
      if (imageCache.size > 6000) for (const id of imageCache.keys()) { if (!unique.includes(id)) imageCache.delete(id); if (imageCache.size <= 5000) break; }
    };
    imageQueue = imageQueue.catch(() => {}).then(load); await imageQueue;
    return new Map(unique.map(id => [id, imageCache.get(id)?.url || null]));
  }
  function remember(actor) { run("INSERT INTO panel_people(user_id,name,last_seen) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen", actor.id, actor.name, Date.now()); }
  async function decorate(rows) {
    const [group, avatars] = await Promise.all([branding(), images(rows.map(r => r.id))]);
    return rows.map(row => { const style = identityStyle(row, row.id === group.ownerId), frame = one('SELECT frame FROM panel_people WHERE user_id=?', row.id)?.frame || 'rank'; return { ...row, ...(row.roles ? { roles: row.roles.map(r => ({ id:r.id, name:r.name })) } : {}), ...style, frame, avatarUrl: avatars.get(row.id) }; });
  }
  async function peer(actor, id) {
    id = userId(id); ensure(id !== actor.id, 400, 'Choose another signed-in staff member.');
    const saved = one('SELECT * FROM panel_people WHERE user_id=?', id); ensure(saved, 404, 'This person has not connected to the panel yet.');
    const rank = await state(id); ensure(rank.access, 403, 'This person no longer has staff chat access.');
    return { id, name: saved.name, ...rank };
  }
  async function route(path, req, actor, body) {
    if (path === '/api/profile/frame' && req.method === 'POST') {
      rate(`frame:${actor.id}`, 12, 60); const input = await body(req);
      ensure(FRAMES.includes(input.frame), 400, 'Choose an available profile frame.');
      run('UPDATE panel_people SET frame=? WHERE user_id=?', input.frame, actor.id);
      const d = (await decorate([actor]))[0]; return { user: { id: actor.id, name: actor.name, role: actor.label, expires: actor.expires, avatarUrl: d.avatarUrl, frame: d.frame, rankFrame: d.rankFrame, badges: d.badges } };
    }
    if (path === '/api/chat/contacts' && req.method === 'GET') {
      rate(`contacts:${actor.id}`, 20, 60);
      const rows = db.prepare('SELECT * FROM panel_people WHERE user_id<>? ORDER BY name COLLATE NOCASE LIMIT 200').all(actor.id), contacts = [];
      for (const row of rows) {
        try { const rank = await state(row.user_id); if (rank.access) contacts.push({ id: row.user_id, name: row.name, role: rank.label, roles: rank.roles, lastSeen: row.last_seen }); }
        catch (e) { if (e.status !== 403) throw e; }
      }
      return { contacts: await decorate(contacts) };
    }
    if (path === '/api/chat/messages' && req.method === 'GET') {
      rate(`chat-read:${actor.id}`, 30, 60);
      const q = new URL(req.url, 'http://localhost').searchParams, other = await peer(actor, q.get('peer'));
      const before = q.get('before') || '0'; ensure(/^(0|[1-9][0-9]{0,14})$/.test(before), 400, 'Invalid message page.');
      const rows = db.prepare('SELECT id,sender,recipient,content,at FROM messages WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND (?=0 OR id<?) ORDER BY id DESC LIMIT 51').all(actor.id, other.id, other.id, actor.id, Number(before), Number(before));
      return { peer: (await decorate([{ ...other, role: other.label }]))[0], messages: rows.slice(0, 50).reverse(), hasMore: rows.length > 50 };
    }
    if (path === '/api/chat/messages' && req.method === 'POST') {
      rate(`chat-send:${actor.id}`, 15, 60); rate('chat-global', 300, 60);
      const input = await body(req), other = await peer(actor, input.peerId), content = typeof input.content === 'string' ? input.content.trim() : '';
      ensure(content.length >= 1 && content.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content), 400, 'Write a message between 1 and 2,000 characters.');
      ensure(typeof input.nonce === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(input.nonce), 400, 'Reload chat before sending.');
      // Recheck both memberships after asynchronous lookups; a saved profile grants nothing.
      ensure((await state(actor.id)).access, 403, 'Your staff access has been removed.');
      ensure((await state(other.id)).access, 403, 'This person no longer has staff chat access.');
      ensure(one('SELECT hash FROM sessions WHERE hash=? AND expires>?', actor.key, Date.now()), 401, 'Your session ended. Connect again.');
      const existing = one('SELECT * FROM messages WHERE sender=? AND nonce=?', actor.id, input.nonce);
      if (existing) ensure(existing.recipient === other.id && existing.content === content, 409, 'This message identifier was already used.');
      else run('INSERT INTO messages(sender,recipient,content,at,nonce) VALUES(?,?,?,?,?)', actor.id, other.id, content, Date.now(), input.nonce);
      const message = one('SELECT id,sender,recipient,content,at FROM messages WHERE sender=? AND nonce=?', actor.id, input.nonce);
      return { message };
    }
    return null;
  }
  return { branding, decorate, remember, route };
}
