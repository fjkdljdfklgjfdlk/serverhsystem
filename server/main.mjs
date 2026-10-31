import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, ensure, userId, roleState, availableActions, validateAction, banPayload } from './policy.mjs';
import { Roblox } from './roblox.mjs';
import { createPhrase } from './challenges.mjs';
import { community } from './community.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const GROUP = '988023438', UNIVERSE = '7933292768';
const hash = s => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const policy = JSON.parse(readFileSync(new URL('./role-policy.json', import.meta.url)));
export function makeServer({ env = process.env, roblox: injected, databasePath } = {}) {
  const origins = (env.PUBLIC_ORIGINS || env.PUBLIC_ORIGIN || 'http://localhost:8787').split(',').map(value => value.trim());
  for (const origin of origins) {
    const parsedOrigin = new URL(origin);
    ensure(parsedOrigin.origin === origin, 500, 'Each public origin must be exact, without a path or trailing slash.');
    ensure(parsedOrigin.protocol === 'https:' || (parsedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)), 500, 'Use HTTPS for public origins.');
  }
  const allowedOrigins = new Set(origins);
  const dbPath = databasePath || env.DATABASE_PATH || resolve(ROOT, 'data/serverh.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS challenges (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, phrase TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS intents (hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, action TEXT NOT NULL, snapshot TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ready', audit_id INTEGER);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT NOT NULL, actor TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS target_locks (target_id TEXT PRIMARY KEY, intent_hash TEXT NOT NULL);
  `);
  // Surviving pending records indicate an interrupted process. Never replay them.
  db.exec("UPDATE audit SET status='unknown' WHERE status='pending'; UPDATE intents SET status='unknown' WHERE status='pending'; DELETE FROM target_locks;");
  const rb = injected || new Roblox({ apiKey: env.ROBLOX_API_KEY, cookie: env.ROBLOX_COOKIE, groupId: GROUP, universeId: UNIVERSE });
  const botId = env.BOT_USER_ID || '';
  const sql = (q, ...args) => db.prepare(q).run(...args);
  const one = (q, ...args) => db.prepare(q).get(...args);
  function rate(key, max, seconds) {
    const now = Date.now();
    sql('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires < ? THEN 1 ELSE hits+1 END, expires=CASE WHEN expires < ? THEN excluded.expires ELSE expires END', key, now + seconds * 1000, now, now);
    ensure(one('SELECT hits FROM limits WHERE key=?', key).hits <= max, 429, 'Too many requests. Wait before trying again.');
  }
  const state = async id => roleState(await rb.membership(id), policy, GROUP);
  async function auth(req) {
    const raw = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    ensure(raw, 401, 'Connect your Roblox account to continue.');
    const key = hash(raw), session = one('SELECT * FROM sessions WHERE hash=? AND expires>?', key, Date.now());
    ensure(session, 401, 'Your session ended. Connect your account again.');
    const rank = await state(session.user_id);
    if (!rank.access) { sql('DELETE FROM sessions WHERE hash=?', key); throw new AppError(403, 'Lead Operator or higher is required. Your access has been removed.'); }
    const actor = { ...rank, id: session.user_id, name: session.name, expires: session.expires, key };
    people.remember(actor); return actor;
  }
  const people = community({ db, rb, state, rate, groupId: GROUP });
  const publicActor = async a => { const d = (await people.decorate([a]))[0]; return { id:a.id, name:a.name, role:a.label, expires:a.expires, avatarUrl:d.avatarUrl, frame:d.frame, rankFrame:d.rankFrame, badges:d.badges }; };
  let directoryCache = null, directoryPending = null;
  async function directory(refresh) {
    const age = directoryCache ? Date.now() - directoryCache.fetchedAt : Infinity;
    if (directoryCache && age < (refresh ? 5000 : 30000)) return directoryCache;
    if (!directoryPending) directoryPending = (async () => {
      const records = (await rb.directory()).map(row => {
        let role, roles = [];
        try { const rank = roleState(row.membership, policy, GROUP); role = rank.label; roles = rank.roles; }
        catch (error) { if (error.status !== 403) throw error; role = 'Role needs owner review'; }
        return { id: row.id, name: row.name, displayName: row.displayName, role, roles };
      }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      directoryCache = { records, fetchedAt: Date.now() }; return directoryCache;
    })().finally(() => { directoryPending = null; });
    return directoryPending;
  }
  async function body(req) {
    ensure((req.headers['content-type'] || '').split(';')[0] === 'application/json', 415, 'Use application/json.');
    let data = '', size = 0;
    for await (const chunk of req) { size += chunk.length; ensure(size <= 8192, 413, 'Request too large.'); data += chunk; }
    let result; try { result = JSON.parse(data); } catch { throw new AppError(400, 'Invalid JSON.'); }
    ensure(result && typeof result === 'object' && !Array.isArray(result), 400, 'Invalid request.'); return result;
  }
  async function target(id, { lookupOnly = false } = {}) {
    const [profile, membership] = await Promise.all([rb.profile(id), rb.membership(id)]);
    ensure(String(profile.id) === id, 502, 'Roblox returned the wrong profile.');
    let rank;
    try { rank = { ...roleState(membership, policy, GROUP), policyConfirmed: true }; }
    catch (error) {
      if (!lookupOnly || error.status !== 403) throw error;
      // Profiles remain searchable; an unrecognized role never authorizes an action.
      rank = { isMember: Boolean(membership), priority: null, access: false, roles: [], label: 'Role needs owner review', policyConfirmed: false };
    }
    return { id, name: profile.name, displayName: profile.displayName, ...rank };
  }
  async function capabilities(action, actor, victim) {
    ensure(botId, 503, 'The owner needs to configure the protected bot user ID.'); userId(botId);
    if (['kick', 'group-ban', 'group-unban'].includes(action)) {
      await rb.checkBot(botId);
      const bot = await state(botId);
      ensure(bot.priority > victim.priority, 403, 'The bot cannot manage a user at or above its own level.');
    }
  }
  function snapshot(victim) { return JSON.stringify({ isMember: victim.isMember, roles: victim.roles.map(r => r.id).sort() }); }
  const server = createServer(async (req, res) => {
    const reqOrigin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    if (allowedOrigins.has(reqOrigin)) { res.setHeader('Access-Control-Allow-Origin', reqOrigin); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/session.mjs': ['session.mjs', 'text/javascript'], '/config.js': ['config.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/serverh-logo.png': ['serverh-logo.png', 'image/png'] };
        const file = Object.hasOwn(files, path) ? files[path] : null; ensure(file && req.method === 'GET', 404, 'Not found.');
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.rbxcdn.com; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
        res.writeHead(200, { 'Content-Type': file[1].startsWith('image/') ? file[1] : `${file[1]}; charset=utf-8` }); res.end(readFileSync(resolve(ROOT, 'web', file[0]))); return;
      }
      ensure(!reqOrigin || allowedOrigins.has(reqOrigin), 403, 'This website origin is not allowed.');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const address = env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').at(-1).trim() : req.socket.remoteAddress;
      rate(`ip:${hash(address || 'unknown')}`, 150, 60);
      if (path === '/api/branding' && req.method === 'GET') return json(200, { group: await people.branding() });
      if (path === '/api/health' && req.method === 'GET') return json(200, { status: 'running', configured: Boolean(env.ROBLOX_API_KEY && botId), groupId: GROUP, universeId: UNIVERSE });
      if (path === '/api/auth/challenge' && req.method === 'POST') {
        rate(`login:${hash(address || 'unknown')}`, 12, 900);
        const input = await body(req);
        ensure(typeof input.username === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(input.username), 400, 'Enter a Roblox username, without @.');
        ensure(env.ROBLOX_API_KEY || injected, 503, 'The owner needs to connect the private backend to Roblox.');
        const profile = await rb.resolve(input.username), secret = token(); userId(profile.id);
        const phrase = createPhrase();
        const expires = Date.now() + 600000;
        sql('INSERT INTO challenges(hash,user_id,name,phrase,expires) VALUES(?,?,?,?,?)', hash(secret), String(profile.id), profile.name, phrase, expires);
        return json(200, { challengeToken: secret, phrase, expires, user: { id: String(profile.id), name: profile.name, displayName: profile.displayName, avatarUrl: (await people.decorate([{ id: String(profile.id), roles: [] }]))[0].avatarUrl } });
      }
      if (path === '/api/auth/verify' && req.method === 'POST') {
        const input = await body(req);
        ensure(typeof input.challengeToken === 'string' && input.challengeToken.length === 43, 400, 'Start a new verification.');
        const key = hash(input.challengeToken), c = one('SELECT * FROM challenges WHERE hash=? AND used=0 AND expires>?', key, Date.now());
        ensure(c, 401, 'That verification has expired or was already used.');
        sql('UPDATE challenges SET attempts=attempts+1 WHERE hash=?', key); ensure(c.attempts < 12, 429, 'Start a new verification.');
        const profile = await rb.profile(c.user_id);
        ensure(String(profile.id) === c.user_id && typeof profile.description === 'string' && profile.description.includes(c.phrase), 403, 'The phrase is not in your Roblox bio yet. Save your bio and try again.');
        const rank = await state(c.user_id); ensure(rank.access, 403, 'Your account is verified, but Lead Operator or higher is required.');
        const consumed = sql('UPDATE challenges SET used=1 WHERE hash=? AND used=0 AND expires>?', key, Date.now());
        ensure(consumed.changes === 1, 401, 'That verification has expired or was already used.');
        const secret = token(), expires = Date.now() + 3600000;
        sql('INSERT INTO sessions VALUES(?,?,?,?)', hash(secret), c.user_id, profile.name, expires);
        const connected = { ...rank, id: c.user_id, name: profile.name, expires }; people.remember(connected);
        return json(200, { token: secret, user: await publicActor(connected) });
      }
      const actor = await auth(req);
      const communityResult = await people.route(path, req, actor, body);
      if (communityResult) return json(200, communityResult);
      if (path === '/api/auth/logout' && req.method === 'POST') { sql('DELETE FROM sessions WHERE hash=?', actor.key); return json(200, { ok: true }); }
      if (path === '/api/me' && req.method === 'GET') return json(200, { user: await publicActor(actor), group: await people.branding(), roles: Object.entries(policy).filter(([,r]) => r.assignable && !r.access && r.priority < actor.priority).map(([id,r]) => ({ id, name: r.name })).sort((a,b) => policy[a.id].priority - policy[b.id].priority), capabilities: { groupActions: Boolean(env.ROBLOX_COOKIE), experienceBans: Boolean(env.ROBLOX_API_KEY) } });
      if (path === '/api/members' && req.method === 'GET') {
        rate(`directory:${actor.id}`, 30, 60);
        const query = new URL(req.url, 'http://localhost').searchParams;
        const rawSearch = query.get('search') || '', search = rawSearch.trim(), pageValue = query.get('page') || '1';
        ensure(rawSearch.length <= 50 && !/[\x00-\x1f\x7f]/.test(rawSearch) && /^[1-9][0-9]{0,3}$/.test(pageValue), 400, 'Choose a valid member page or search.');
        const result = await directory(query.get('refresh') === '1'), needle = search.normalize('NFKC').toLowerCase();
        const matches = result.records.filter(row => !needle || [row.name, row.displayName, row.id, row.role].some(value => value.normalize('NFKC').toLowerCase().includes(needle)));
        const pageSize = 20, totalPages = Math.max(1, Math.ceil(matches.length / pageSize)), page = Math.min(Number(pageValue), totalPages);
        return json(200, { members: await people.decorate(matches.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: matches.length, totalMembers: result.records.length, totalPages, fetchedAt: result.fetchedAt });
      }
      if (['/api/users/lookup', '/api/member'].includes(path) && req.method === 'POST') {
        rate(`lookup:${actor.id}`, 30, 60);
        const input = await body(req), query = String(input.query ?? input.userId ?? '').trim();
        let id;
        if (/^[0-9]+$/.test(query)) id = userId(query);
        else {
          ensure(/^[A-Za-z0-9_]{3,20}$/.test(query), 400, 'Enter a Roblox username or numeric user ID, not a display name.');
          id = userId((await rb.resolve(query, { excludeBannedUsers: false })).id);
        }
        const v = await target(id, { lookupOnly: true }), actions = availableActions(actor, v, botId), decorated = (await people.decorate([v]))[0];
        return json(200, { user: { avatarUrl: decorated.avatarUrl, frame: decorated.frame, rankFrame: decorated.rankFrame, badges: decorated.badges, id: v.id, name: v.name, displayName: v.displayName, role: v.label, roles: v.roles.map(r => ({ id:r.id, name:r.name })), isMember: v.isMember, policyConfirmed: v.policyConfirmed, manageable: actions.length > 0, allowedActions: actions } });
      }
      if (path === '/api/audit' && req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();
        return json(200, { entries: rows.map(r => ({ ...r, details: JSON.parse(r.details) })) });
      }
      if (path === '/api/actions/prepare' && req.method === 'POST') {
        rate(`prepare:${actor.id}`, 20, 60);
        const input = await body(req), v = await target(userId(input.targetId));
        const action = validateAction(input, actor, v, policy, botId); await capabilities(action.action, actor, v);
        const secret = token(), expires = Date.now() + 120000;
        sql('INSERT INTO intents(hash,session_hash,action,snapshot,expires) VALUES(?,?,?,?,?)', hash(secret), actor.key, JSON.stringify(action), snapshot(v), expires);
        return json(200, { intentToken: secret, expires, action, target: { id:v.id, name:v.name, role:v.label } });
      }
      if (path === '/api/actions/confirm' && req.method === 'POST') {
        rate(`action:${actor.id}`, 10, 60);
        const input = await body(req); ensure(typeof input.intentToken === 'string' && input.intentToken.length === 43, 400, 'Review the action first.');
        const key = hash(input.intentToken), intent = one('SELECT * FROM intents WHERE hash=? AND session_hash=?', key, actor.key);
        ensure(intent, 404, 'That action was not found.');
        if (intent.status !== 'ready') return json(409, { error: 'This action was already submitted. Check its audit entry.', auditId: intent.audit_id, status: intent.status });
        ensure(intent.expires > Date.now(), 409, 'The action review expired. Review it again.');
        const action = JSON.parse(intent.action), v = await target(action.targetId);
        ensure(snapshot(v) === intent.snapshot, 409, 'The user’s roles changed. Look them up and review again.');
        // Refresh actor after target lookup as well. The browser never supplies role authority.
        const freshActor = { ...actor, ...await state(actor.id) };
        validateAction(action, freshActor, v, policy, botId); await capabilities(action.action, freshActor, v);
        ensure(one('SELECT hash FROM sessions WHERE hash=? AND expires>?', actor.key, Date.now()), 401, 'Your session ended. Connect again.');
        ensure(intent.expires > Date.now(), 409, 'The action review expired. Review it again.');
        db.exec('BEGIN IMMEDIATE');
        let auditId;
        try {
          ensure(sql("UPDATE intents SET status='pending' WHERE hash=? AND status='ready'", key).changes === 1, 409, 'This action was already submitted.');
          ensure(!one('SELECT * FROM target_locks WHERE target_id=?', v.id), 409, 'Another action for this user is still running.');
          sql('INSERT INTO target_locks VALUES(?,?)', v.id, key);
          auditId = Number(sql('INSERT INTO audit(at,actor_id,actor,target_id,action,reason,details,status) VALUES(?,?,?,?,?,?,?,?)', new Date().toISOString(), actor.id, actor.name, v.id, action.action, action.reason, JSON.stringify(action), 'pending').lastInsertRowid);
          sql('UPDATE intents SET audit_id=? WHERE hash=?', auditId, key); db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        let status = 'succeeded';
        try {
          if (['assign-role','remove-role'].includes(action.action)) {
            await rb.cloud(`groups/${GROUP}/memberships/${v.id}:${action.action === 'assign-role' ? 'assignRole' : 'unassignRole'}`, 'POST', { role: `groups/${GROUP}/roles/${action.roleId}` });
          } else if (action.action.startsWith('experience-')) {
            const query = new URLSearchParams({ updateMask: 'game_join_restriction', 'idempotencyKey.key': String(auditId) + '-' + key.slice(0,20), 'idempotencyKey.firstSent': new Date().toISOString() });
            await rb.cloud(`universes/${UNIVERSE}/user-restrictions/${v.id}?${query}`, 'PATCH', banPayload(action, actor.id));
          } else await rb.cookieAction(action.action === 'kick' ? `users/${v.id}` : `bans/${v.id}`, action.action === 'group-ban' ? 'POST' : 'DELETE');
        } catch (e) { status = e.uncertain ? 'unknown' : 'failed'; throw e; }
        finally {
          sql('UPDATE audit SET status=? WHERE id=?', status, auditId); sql('UPDATE intents SET status=? WHERE hash=?', status, key); sql('DELETE FROM target_locks WHERE target_id=? AND intent_hash=?', v.id, key);
        }
        return json(200, { ok: true, auditId, status });
      }
      throw new AppError(404, 'Not found.');
    } catch (e) { if (!res.headersSent) json(e.status || 500, { error: e.status ? e.message : 'The server could not complete the request.' }); else res.end(); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  const cleanup = setInterval(() => {
    const now = Date.now(); for (const table of ['challenges','sessions','limits']) sql(`DELETE FROM ${table} WHERE expires<?`, now);
    sql("DELETE FROM intents WHERE expires<? AND status='ready'", now);
  }, 60000).unref();
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return { server, db };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server } = makeServer();
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log(`ServerH Control: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787}`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
