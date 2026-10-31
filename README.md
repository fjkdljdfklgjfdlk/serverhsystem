# ServerH Control

A red, animated staff panel for ServerH. The supplied rainbow H is used in the branding. The interface runs on GitHub Pages. A separate private Node.js backend verifies Roblox bios, authorizes staff, performs Roblox operations, and stores the audit trail.

## What is included

- Username lookup → unique bio phrase → server reads the bio → current role check.
- Access for the exact ServerH Lead Operator, Co-Owner, and E role IDs.
- Multiple-role support: assign and remove individual group roles using Open Cloud.
- Group kick, group ban, group unban using a server-held bot cookie.
- Experience bans, unbans, custom temporary durations, permanent bans, and optional suspected alternate accounts using Roblox User Restrictions.
- Required reasons, mandatory internal notes for experience bans, server-issued action reviews, audit log and CSV export.
- Animated page transitions, dialogs, buttons, a floating rainbow logo, responsive layouts, and reduced-motion support.
- An always-running Docker deployment with HTTPS, persistent SQLite storage, health checks, and automatic restart after process crashes or host restarts (when Docker starts on boot).

This package has not been deployed. Live Roblox mutations were not run. Tests use mocked Roblox responses. The backend requires a private Open Cloud key, a protected bot ID, and hosting configuration before real staff can connect. The supplied chat cookie is not saved in these files.

## 1. Run locally

Install Node.js 24 or newer. No npm dependencies are required.

```sh
npm start
```

Open `http://localhost:8787` to sign in. The dashboard opens only after the backend verifies your Roblox bio and confirms an authorized group role. There is no preview or demo mode, including on localhost. Without backend credentials, sign-in returns a setup message.

Opening `web/index.html` directly shows the login screen only. Sign-in requires HTTP/HTTPS and the configured backend. Sessions stay in browser memory and end on reload; verify again to reconnect. Active sessions expire after 30 minutes.

## 2. Configure the private backend

Copy `.env.example` to `.env` on the backend machine. Fill in these values using your host's private environment settings or the private local file:

| Setting | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | Your exact Pages origin, such as `https://YOURNAME.github.io`. No repository path and no trailing slash. |
| `ROBLOX_API_KEY` | Private Roblox Open Cloud API key, scoped to group `988023438` and universe `7933292768`. |
| `BOT_USER_ID` | The numeric Roblox ID of the account whose cookie you use; panel actions against it are blocked. |
| `ROBLOX_COOKIE` | Only the `.ROBLOSECURITY` cookie value, entered privately on the backend. Required for group kick/ban/unban. No cookie is needed for bio verification, role updates, or experience bans. |
| `DATABASE_PATH` | SQLite file on persistent storage. Docker sets this automatically. |
| `API_DOMAIN` | Your API hostname, such as `control-api.example.com`, for the included Docker/Caddy deployment. |

Create a key in [Creator Hub credentials](https://create.roblox.com/dashboard/credentials). The key creator must have the corresponding community and experience permissions. Restrict the key to these resources and, when possible, your server's fixed outbound IP. Enable these permissions:

- Group membership/role read and write (`group:read`, `group:write`). The key creator must be able to read the group's memberships and manage the intended roles.
- Universe user-restriction read and write (`universe.user-restriction:read`, `universe.user-restriction:write`) for universe `7933292768`.

Enable experience bans in Studio (`Players.BanningEnabled`) and confirm moderation permissions in Creator Hub. A bot never joins a game to perform an experience ban: the backend uses Roblox's own moderation API. Universe-wide bans appear in the linked Creator Hub experience. Temporary bans expire through Roblox.

Give the bot the group permissions required to remove and ban members and place it above the roles it manages. The backend confirms that the cookie account matches `BOT_USER_ID` before cookie actions. Roblox may require additional challenges for a cookie, revoke it, or limit access from hosting IPs. This app reports those errors; it does not bypass challenges. Renew a cookie privately in the host settings and restart the backend if needed.

Never paste credentials into `web/config.js`, HTML, browser storage, GitHub Actions public output, or a repository. `.env` and databases are ignored by Git and Docker build contexts. The Pages workflow uploads only `web/`.

## 3. Keep the service running

Use an always-on Linux machine with Docker Compose, an API domain pointing to its public IP, and ports 80 and 443 open. Configure Docker to start on boot. Set the private `.env` values above, then run:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 api
```

Caddy obtains HTTPS certificates automatically. The API has no public direct port; the proxy forwards to it. `TRUST_PROXY=1` is safe here because the included proxy overwrites `X-Forwarded-For`. Do not expose the API directly with that setting. For a different host, leave it disabled unless the host's trusted proxy is configured to overwrite that header.

The API health endpoint is `https://YOUR_API_DOMAIN/api/health`. It reports whether the process is running and whether key/ID settings exist; it does not claim that credentials remain valid. Authorized staff can check Connection and view action errors. Use a host uptime monitor if you need outage notifications. Docker's health check marks an unresponsive container unhealthy; restart policy restarts exited containers, not merely unhealthy ones.

Run **one API instance** against the SQLite volume. The in-process workflow and startup recovery assume a single writer process. On restart, unfinished actions are marked `unknown` and are not replayed. Check Roblox before trying them again. Keep the volume backed up using SQLite's backup facilities or by stopping the API before copying the database. Do not delete the volume when updating.

No service can guarantee uninterrupted availability or permanent cookie validity. Hosting must stay powered on and connected; automatic restart cannot repair revoked credentials or a Roblox outage. Roblox does not require the bot to remain logged into a game client for these API operations.

For updates:

```sh
docker compose up -d --build
```

For local live setup, keep `PUBLIC_ORIGIN=http://localhost:8787` and run `npm start`. On a non-Docker host terminate HTTPS at a trusted proxy, set `HOST` to suit the host, and configure a process supervisor with restart on crash and startup at boot.

## 4. Publish the interface to GitHub Pages

1. In `web/config.js`, set `apiBase` to the backend HTTPS origin, such as `https://control-api.example.com`. This is a public URL, never a secret.
2. Upload this project to a GitHub repository, preserving `.github/workflows/pages.yml`. Do not upload a filled `.env` file or databases.
3. Set repository **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push to `main` or run **Deploy panel interface** in Actions. The workflow publishes only `web/`.
5. Open the resulting Pages URL. Enter your real username, add the generated phrase to your Roblox About / bio, save, and verify.

Your API's `PUBLIC_ORIGIN` must match the Pages browser origin exactly. For a custom domain, use that custom origin. A GitHub project site under `/repo-name/` still has origin `https://YOURNAME.github.io`. Relative asset paths work in project sites. Use a dedicated origin if other untrusted projects share your GitHub Pages domain.

## Access policy

`server/role-policy.json` contains the reviewed application policy, captured from the group's public roles on October 31, 2026:

| Exact role ID | Display name | Panel access |
| --- | --- | --- |
| `907620068` | Lead Operator | Yes |
| `715241042` | Co-Owner | Yes |
| `715241040` | E | Yes |

Higher roles still cannot grant any of these protected staff roles through this panel. This intentional safeguard prevents panel-based privilege escalation. Staff can manage only lower-priority targets and explicitly assignable roles. Self-actions, bot actions, and actions against peers or higher staff are rejected on the backend. Roblox also applies its own credential permissions.

`priority` values are this application's explicit policy; they are initialized from the public role snapshot. Roblox's unified communities can have multiple roles and role order can differ from the legacy numeric rank field. The application does **not** automatically promote access based on live rank numbers or role names. Review the policy if roles/order change. New unknown role IDs fail closed for both actors and targets, including accounts that also hold a known role. The decorative separator role is not manageable.

Authorization reads fresh Open Cloud memberships on every authenticated request and again immediately before a mutation. Roblox's own data propagation delay still applies. Access decisions are not based on hidden HTML, JavaScript flags, client-provided ranks, or local storage. Removing staff access from Roblox blocks subsequent API requests when Roblox reflects the change.

Bio verification is a custom ownership proof, not Roblox OAuth or a Roblox-operated login. Challenges have a random 128-bit suffix, expire after 10 minutes, are checked at most 12 times, and can only be consumed once. Never ask another user to put your verification phrase in their bio. OAuth is preferable if you later need stronger standardized identity or longer sessions.

## Action behavior

- **Assign role:** adds one role. It does not remove existing roles. To change a member's role, assign the new role, then separately remove the old role if appropriate. Both actions receive their own review and audit entry.
- **Kick:** removes group membership; it does not kick from a live game server.
- **Group ban / unban:** controls access to the group. A group unban does not automatically rejoin the person.
- **Experience ban:** applies to the whole universe, with a player-facing reason, private staff note, and 1 minute–365 day duration or permanent. Suspected alts are excluded unless selected. Permanent Open Cloud bans omit `duration`; they do not send the Engine API's `-1` value.
- **Experience unban:** clears a universe-level restriction. Separately scoped place restrictions and device blocks may need further handling in Roblox.
- Every action needs a 10–400 character reason. Experience bans also require a 10–800 character private note. Validation happens on both client and server.
- A server-issued review is bound to the session and current target roles, expires after 2 minutes, and can be submitted only once. Concurrent actions for the same target are blocked. Network errors are not automatically retried.
- Audit records contain the operator, target ID, reason, internal details, timestamp, and success/failure/unknown status. Authorized staff can view these records. The UI shows the most recent 100; the database retains all records. This audit log covers this panel's operations, not actions performed elsewhere in Roblox.

## Validation

```sh
npm run check
npm test
```

Tests cover unverified access, forged tokens, rank revocation, missing reasons, invalid durations, protected targets/roles, multiple roles, unknown roles, one-time reviews, concurrent confirmation, uncertain outcomes, expiry, rate limits, pagination, and CSRF-token handling. They never send live Roblox mutations.

Before enabling real use, verify with an authorized low-privilege test account that each intended action works under your actual key and bot permissions. Live Roblox behavior and hosting availability cannot be confirmed without those credentials and deployment.

## Roblox API references

- [Group APIs and role assignment](https://create.roblox.com/docs/cloud/reference/features/groups)
- [Membership filter syntax](https://create.roblox.com/docs/cloud/reference/patterns)
- [User Restrictions / moderation](https://create.roblox.com/docs/cloud/reference/features/bans-and-blocks)
- [Roblox ban system](https://create.roblox.com/docs/reference/engine/classes/Players#BanAsync)
- [Unified community role changes](https://devforum.roblox.com/t/official-list-of-deprecated-web-endpoints/62889/123)

The provided place `91495780481344` was verified through Roblox's universe lookup as belonging to universe `7933292768`. No real users were ranked, removed, or banned while creating this package.
