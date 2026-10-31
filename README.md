# ServerH Control

Animated red staff panel with the supplied rainbow H branding, Roblox bio verification, and server-side staff authorization. No preview mode or sample accounts are included.

- **Panel on GitHub Pages:** https://fjkdljdfklgjfdlk.github.io/serverhsystem/
- **Private API on the Hostinger VPS:** https://serverh.uhbacon.cloud
- **Group:** `988023438` · **Universe:** `7933292768` · **Place:** `91495780481344`

GitHub Pages publishes only `web/`. The VPS runs the Node backend, calls Roblox, and retains the private credentials and SQLite database. Every protected API request requires a verified session and a current authorized Roblox role. Editing the public HTML or JavaScript cannot authorize a Roblox operation.

## GitHub Pages

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. The `Deploy panel interface` workflow publishes `web/` when those files or the workflow change on `main`, and supports manual dispatch. It does not upload `.env`, backend files, or databases.

`web/config.js` points to `https://serverh.uhbacon.cloud`. Asset paths are relative so the panel works at the repository Pages path. The backend's exact origin allowlist contains:

```dotenv
PUBLIC_ORIGINS=https://fjkdljdfklgjfdlk.github.io,https://serverh.uhbacon.cloud
```

Only the matching requesting origin is echoed in CORS headers. Similar domains, other GitHub Pages accounts, and null origins are rejected. Origin checks supplement session and rank authorization; they do not replace authentication. Keep other content hosted under the same GitHub Pages account trusted, because GitHub project paths share one browser origin.

## Current VPS deployment

The installation is at `/opt/serverh-control`, behind the existing host Nginx service. Use **`compose.vps.yaml`** on this VPS. It publishes the container port only on `127.0.0.1:8787`; Nginx handles ports 80/443. The alternative `compose.yaml`/`Caddyfile` are for a separate server without an existing web proxy and are not used by this installation.

The VPS has:

- A Node 24 container, restart policy `unless-stopped`, process health checks, and a persistent SQLite volume.
- An HTTPS certificate for `serverh.uhbacon.cloud` with Certbot renewal and an Nginx reload hook.
- The bot cookie and Open Cloud key in the private `.env`, mode `600`, outside Git.
- Bot account `ServerH_SystemBOT`, ID `11919015367`, protected from panel actions.

The bot was verified to hold **Operator** and the site owner's account to hold **Lead Operator**. The cookie can therefore manage only users below Operator, subject to the bot's Roblox group permissions. Role assignment and experience moderation use the Open Cloud key and its permissions. Roblox can revoke or expire either credential; automatic restart cannot repair revoked access or a Roblox outage.

### Start or update the backend

Keep the private `.env` and Docker volume in place. After fetching the intended release, use:

```sh
git fetch origin main
git switch --detach origin/main
docker compose -p serverh-control -f compose.vps.yaml up -d --build
docker compose -p serverh-control -f compose.vps.yaml ps
```

Review the incoming source before running it. Do not delete the Docker volume during an update. Run one API instance against the SQLite database. Use SQLite's backup facilities or stop the API before copying its database file. Docker must start on boot for automatic startup.

`https://serverh.uhbacon.cloud/api/health` reports process availability and whether key/ID settings exist. `configured: true` does not guarantee that credentials remain valid. A Docker health check marks an unresponsive container unhealthy; the restart policy restarts exited containers, not merely unhealthy ones.

### Private environment

Use `.env.example` only as a template. Never replace a populated VPS `.env` with the blank template. The runtime needs:

| Setting | Purpose |
| --- | --- |
| `ROBLOX_API_KEY` | Open Cloud key with group read/write and ServerH user-restriction read/write. |
| `ROBLOX_COOKIE` | Bot `.ROBLOSECURITY` value, used for group kick/ban/unban. |
| `BOT_USER_ID` | Protected account ID, verified against the cookie before cookie actions. |
| `PUBLIC_ORIGINS` | Comma-separated exact browser origins allowed to call the API. |
| `DATABASE_PATH` | Persistent SQLite file; Compose sets `/app/data/serverh.sqlite`. |
| `TRUST_PROXY` | Enabled by Compose only behind the trusted proxy that overwrites `X-Forwarded-For`. |

The existing single-origin `PUBLIC_ORIGIN` remains supported when `PUBLIC_ORIGINS` is absent or empty. Production origins must use HTTPS; localhost HTTP is permitted for development. No cookie or API key belongs in `web/config.js`, GitHub Pages, repository files, or browser storage.

The Open Cloud key should be restricted to the VPS outbound IP `187.124.131.23`, with `group:read`, `group:write`, and `universe.user-restriction:read`/`write` for ServerH universe `7933292768`. The key creator must hold the corresponding Roblox permissions. Enable experience bans (`Players.BanningEnabled`) in Studio. The bot never joins a game client to issue an experience ban.

### Nginx and certificates

`deploy/serverh-control.nginx.conf` matches the domain's HTTPS reverse-proxy configuration. It requires an existing certificate before `nginx -t` can pass. For a fresh installation, first add an HTTP-only ACME webroot server, then issue the certificate:

```sh
certbot certonly --webroot -w /var/www/serverh-acme -d serverh.uhbacon.cloud --non-interactive
```

After the certificate exists, install the HTTPS config as `/etc/nginx/sites-available/serverh-control.conf`, enable its symlink, run `nginx -t`, and reload Nginx. Do not overwrite other sites. Install `deploy/renew-serverh-nginx.sh` as `/etc/letsencrypt/renewal-hooks/deploy/serverh-nginx-reload` with mode `700`. The existing `certbot.timer` handles renewals.

## Staff access and operations

Users enter a Roblox username, add the unique random phrase to their bio, save it, and verify. The backend reads that exact profile and the current membership. Sessions remain in browser memory, expire after 30 minutes, and end on reload. Challenges expire after 10 minutes, allow at most 12 checks, and can only be consumed once.

The exact authorized role IDs are:

| Role | Role ID |
| --- | --- |
| Lead Operator | `907620068` |
| Co-Owner | `715241042` |
| E | `715241040` |

`server/role-policy.json` is the explicit application policy. Its priorities are initialized from the reviewed group snapshot, not automatically inferred from changing Roblox rank numbers or role names. Unified communities support multiple roles; all roles are checked. Unknown roles fail closed. Review the policy if roles or their intended order change.

- Assign/remove individual group roles. Assigning one does not remove other roles. Protected staff roles cannot be granted or removed through the role editor.
- Kick users from the group; this does not disconnect them from a live game.
- Ban/unban users from the group, independently of experience restrictions.
- Apply temporary experience bans (1 minute–365 days), permanent bans, and universe-level unbans. Suspected alternate accounts are excluded unless selected. Permanent Open Cloud bans omit `duration`.
- Require a 10–400 character reason for every operation, plus a 10–800 character private note for experience bans. Reasons are validated on the backend.
- Block self-actions, bot actions, peers/higher staff, and unavailable roles. Roblox also enforces the service credential's permissions.

Each mutation requires a server-issued review tied to the session and current target roles, valid for 2 minutes and usable once. Actor access is refreshed immediately before mutation. Concurrent actions against the same target are blocked. Unconfirmed requests and interrupted operations are marked `unknown` and are never automatically replayed; inspect Roblox before retrying.

The audit log records operator, target, reason, internal details, time, and result. The UI shows the latest 100 panel operations and can export CSV. It does not include actions performed outside this panel. An experience unban does not clear separately scoped place restrictions or device blocks; review those in Roblox.

## Validation and development

Node 24 or newer is required. No npm dependencies are used.

```sh
npm run check
npm test
```

The tests cover unauthorized access, forged tokens, role revocation, missing reasons, invalid durations, protected targets and roles, multiple roles, unknown roles, challenge/session expiry, throttling, one-time reviews, concurrency, uncertain outcomes, pagination, CSRF handling, and exact CORS allowlisting for Pages and the VPS.

For local development, use `PUBLIC_ORIGIN=http://localhost:8787` with `PUBLIC_ORIGINS` unset, and set `web/config.js` `apiBase` to an empty string to target the local backend. `npm start` opens the HTTP service; opening the HTML file directly cannot authenticate. There is no demo bypass.

Infrastructure, Roblox credential validity, and read permissions were checked on the VPS. No real user was ranked, kicked, or banned during setup. Perform intended mutations only after reviewing an authorized target in the panel.

## Roblox references

- [Group APIs](https://create.roblox.com/docs/cloud/reference/features/groups)
- [Membership filters](https://create.roblox.com/docs/cloud/reference/patterns)
- [User restrictions](https://create.roblox.com/docs/cloud/reference/features/bans-and-blocks)
- [Experience bans](https://create.roblox.com/docs/reference/engine/classes/Players#BanAsync)
