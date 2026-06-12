# VisionTrack Add-In for MyGeotab — Project State & Context

## Goal

Build GPSFMS's own VisionTrack add-in inside MyGeotab that **respects Geotab grouping** —
users with access only see events/video for vehicles within their Geotab group/data scope.
The stock VisionTrack add-in cannot do this because it embeds the VisionTrack portal, which uses
VisionTrack's own org structure and has no knowledge of Geotab groups. Longer term this may grow
toward a fuller replacement for the VisionTrack portal (events, on-demand media, live video,
provisioning, settings), but the high-value, uniquely-better pieces are **group-aware event/video
viewing** and **painless vehicle pairing**.

Built with the same stack as GPSFMS's other add-ins ("zenith structure"): Vite + React 19 +
TypeScript + `@geotab/zenith`, hosted on GitHub Pages, mirroring the existing
`advanced_report_builder` add-in.

## Why the architecture is "add-in + proxy" (not add-in alone)

A Geotab add-in is static JS running in the user's browser. The **Geotab half** can run in the
browser normally (the `api` object is already scoped to the user; Geotab enforces grouping). The
**VisionTrack half cannot**, for three independent reasons:

1. **Secret exposure** — VisionTrack needs OAuth `client_credentials`. In browser JS that secret
   is readable by every user and grants access to the entire VisionTrack account; it also lets a
   user bypass any client-side group filter.
2. **CORS** — VisionTrack hosts only allow their own origins (confirmed: `app-api.autonomise.ai`
   returns `Access-Control-Allow-Origin: https://app.autonomise.ai`). Browser calls from the
   add-in's origin are blocked. Server-to-server calls aren't.
3. **Enforcement integrity** — group filtering must happen somewhere the user can't tamper with.

So a small **server-side proxy** holds the VisionTrack credentials and enforces scope. It is
essentially "the existing watchdog script, made callable on demand." The watchdog is a Python
script that already joins Geotab + Autonomise data server-side; the proxy is the same idea exposed
as an HTTP endpoint.

## How grouping is enforced (the core mechanism)

On every request the proxy:
1. Reads the forwarded MyGeotab session (`database`, `userName`, `sessionId`, `server`) — bound to
   that specific user; cannot be forged.
2. Calls Geotab `Get<Device>` **as that user**. Geotab itself restricts results to the user's data
   scope — a Branch-A user physically cannot get Branch-B devices back.
3. Computes each in-scope device's **VIN-last-6** and matches against the VisionTrack org's vehicles
   to produce an allow-list of VT vehicle IDs / camera hardware IDs.
4. Filters/gates **every** VisionTrack call against that allow-list. For video, it checks the camera
   is in the user's allow-list **before** asking VisionTrack for the clip/stream (returns 403
   otherwise), so an out-of-scope video URL is never even minted.

Scope is **re-derived per request** (short cache, `SCOPE_CACHE_TTL_SECONDS`, default 120s), so
changing a user's groups in Geotab automatically widens/narrows what they see on the next
load — no redeploy, no manual sync. It fails closed (vehicles with no VIN match are dropped).

Two independent gates: **clearance** = can you open the add-in / use a feature; **group scope** =
which vehicles' data you see inside it.

## The Geotab ↔ VisionTrack pairing (VIN-last-6)

Matching is on the **last 6 characters of the VIN** (the two platforms disagree on full VINs but
agree on the tail). This mirrors the existing `watchdog` script:
- **Geotab `PreferredVIN`** = `vehicleIdentificationNumber`, falling back to
  `engineVehicleIdentificationNumber` (ignoring values containing `@`).
- **VisionTrack** = `vehicle.vin`.
- Match = last 6 chars, uppercased/trimmed. No-VIN vehicles are excluded (fail-closed).

Each **Geotab database** is paired to one **VisionTrack organisationId** in `proxy/pairings.json`.

## Clearance + users

- Tie the add-in to a Geotab clearance via `config.json`: `enableViewSecurityId: true` creates a
  "View VisionTrack Events" security identifier that you enable per clearance; custom identifiers
  can gate individual actions (view-video, manage-pairing). Proxy should re-check server-side.
- **No VisionTrack user provisioning is needed or possible.** The proxy brokers all VT access with
  one service credential; end users never have VT logins. The VT Third-Party API has no portal-user
  endpoint anyway. People are managed entirely in Geotab (clearances + groups).

## Current build status

All code is in `C:\Users\User\Projects\visiontrack_addin\`. Verified: the proxy typechecks clean
(`tsc --noEmit`, exit 0); all frontend files pass syntax checks (a full frontend typecheck was
blocked only because the private `@geotab/zenith` install kept timing out in the sandbox — run
`npm install && npm run typecheck` locally before deploying).

**Add-in (`/`, `/src`)** — Vite + React 19 + `@geotab/zenith`:
- `config.json` (manifest; menu item URL `https://austin-gpsfms.github.io/visiontrack_addin/dist/index.html`)
- `vite.config.ts` (`base: ""` for clean relative asset paths), `index.html`, tsconfig
- `src/main.tsx` (add-in lifecycle, registered at `window.geotab.addin.visionTrackEvents`)
- `src/App.tsx` (toolbar: group picker + date range + classification; events table)
- `src/api/geotab.ts` (session + scoped-group helpers), `src/api/proxy.ts` (calls the proxy)
- `src/components/GroupFilterPicker.tsx` (Zenith `GroupsFilter`), `src/components/EventsTable.tsx` (Zenith `Table`)
- `src/utils/vin.ts`, `src/types.ts`, `src/styles.css`

**Proxy (`/proxy`)** — Node + Express + TypeScript:
- `src/server.ts` (`POST /api/events`, `GET /api/health`; hot-reloads `pairings.json`)
- `src/geotab.ts` (calls MyGeotab as the user → in-scope devices), `src/autonomise.ts`
  (client_credentials auth + paged `/vehicles`, `/events`), `src/pairing.ts` (VIN-last-6 allow-list),
  `src/scope.ts` (resolve + per-user TTL cache), `src/enums.ts`, `src/types.ts`
- `pairings.json` (Geotab database → VisionTrack org), `.env.example`, `Dockerfile`, `.dockerignore`
- `scripts/add-pairing.mjs` (`npm run add-pairing -- --name … --db … --org …`; validated, appends, `--force` to overwrite, `--list`)

**Other:** `README.md`; root `.gitignore` (excludes `proxy/` and all `.env*`, keeps `dist/`);
`proxy/.gitignore`; `vt-dev-info-supplement.md` (skill addendum, see below).

## Hosting & deployment plan

- **Add-in:** GitHub Pages, public repo `visiontrack_addin` under the `austin-gpsfms` account
  (same pattern as `advanced_report_builder`). `dist/` is committed/published.
- **Proxy:** must run server-side over HTTPS (holds the secret; CORS). **Do NOT use AWS App Runner —
  it closed to new customers April 30, 2026.** Options: AWS Lightsail instance ($7/1 GB is the sweet
  spot) or co-host on an existing box. GPSFMS already has a Lightsail box
  `gpsfms-tamper-detect-server-2gb` (Ubuntu, 2 GB, **static IP 3.139.166.82**, us-east-2) running
  something else — fine to **co-host the proxy there for the pilot** as its own `systemd` service /
  user behind a reverse-proxy vhost; give it a dedicated instance for production.
- **HTTPS:** Caddy (automatic Let's Encrypt) reverse-proxying `localhost:8080`; Node under `systemd`.
  Open ports 80/443, keep 8080 internal.
- **DNS:** `gpsfms.com` runs through **Wix**. Add an A record: Host `visiontrack-proxy`,
  Value = the box's static IP → gives `visiontrack-proxy.gpsfms.com`. (Don't touch the existing
  root/`www` records.) DNS must resolve before Caddy can issue the cert.
- **Secrets:** Autonomise `CLIENT_ID`/`CLIENT_SECRET`/`TOKEN_URL` (from the watchdog `.env`) go in
  the proxy `.env` / SSM — never in git. Set `ALLOWED_ORIGINS=https://austin-gpsfms.github.io`.
- **Repo split for safety:** add-in in a **public** repo (Pages), proxy in a **private** repo
  (holds pairings). The root `.gitignore` already excludes `proxy/` from the public repo.

### Repo separation note
The `.gitignore` is set up so the public add-in repo excludes `proxy/` and every `.env*` (keeping
`dist/` and `.env.example`). For the proxy, push the `proxy/` folder to a separate **private** repo.

## Cost & scale

- Add-in: free. Proxy: **~$7–10/month, flat regardless of customer count** (Lightsail $7/1 GB or
  co-hosted). Cost is driven by concurrent requests, not vehicle/customer count; the data per
  request is small and the proxy is I/O-bound. Video/media bytes stream **directly** browser↔
  VisionTrack, never through the proxy, so bandwidth isn't a factor.
- Target scale (20 customers, ~1–2k vehicles, low concurrency, multiple branches/groups per
  customer) is comfortably within a single small node. Grouping per customer adds zero infra cost.
- Self-hosting on owned hardware is $0 hosting but you own uptime; same HTTPS/DNS plumbing applies.

## Onboarding / pairings model

Infrequent and GPSFMS-controlled. Adding a customer = one entry in `proxy/pairings.json`
(`{ name, geotab_database, organization_id }`), via the `add-pairing` helper or by hand. The proxy
hot-reloads the file, so it's live on the next request with no restart. A caller can only ever
resolve their own database's org (the session is bound to its database), so other customers' pairings
are never exposed. On a writable host (your own server) editing the file is enough; on an immutable
container you redeploy.

## New findings from VisionTrack docs (Webhooks, Supplement API, Snapshots) — and plan impact

Three VisionTrack PDFs were reviewed and their content captured in `vt-dev-info-supplement.md`
(meant to be pasted onto the end of the `vt-dev-info` skill's `SKILL.md`, which lives in a
read-only application folder at
`…\skills-plugin\…\skills\vt-dev-info\SKILL.md`). Key takeaways and how they change the plan:

1. **Webhooks (push) replace polling for events.** VisionTrack can POST events, journeys,
   media-ready, live GPS, alarms, and raw telemetry to an endpoint as they happen (six hook types:
   Media, Journey, Event, LiveTrack, Alarm, TelemetryRaw). **Plan change:** the proxy should become a
   webhook receiver writing to a small local DB; the add-in reads from that DB — instant, no
   `/events` (500/min) or `/eventNotes` (1/5min) rate-limit pressure, near real-time. This needs a
   public receiver endpoint + a datastore, reinforcing the always-on-server choice. Grouping is still
   enforced per-user at query time.
2. **Per-organisation credentials are achievable.** `POST /organisation` (Reseller licence) with the
   `ThirdPartyAPI` licence **returns a `clientId` + `clientSecret` for that child org**. **Plan
   change:** store per-customer credentials (encrypted) in the pairings store → credential-level
   tenant isolation (a bug can't cross tenants), instead of relying on one shared partner token.
3. **Onboarding can be automated.** `POST /organisation` can set licences *and* wire up webhooks
   (`apiSettings.serviceHookSettings`) in one call — create org → receive creds → webhooks
   configured → store creds.
4. **Snapshots/media well-documented:** command type 7, `duration > 2s` (snapshot at midpoint),
   `mediaType 5` = thumbnail; HD via `videoQuality 1` + FFmpeg frame extract.
5. **Device-level settings** are reachable via `POST /command/raw-config-patch` (type 10) on the
   **public API** with the bearer token — but **only the VT3500 model currently**, and only
   device-level (DSM AI-alarm toggles, collision thresholds, etc.).

What did NOT change:
- **Vehicle naming is still unsolved by the public API** (no writable display-name field surfaced).
  VisionTrack's built-in Geotab master-data sync auto-creates vehicles/drivers but **renames every
  vehicle to its license plate** instead of the Geotab description — the key pain point. This needs a
  VisionTrack-side fix/setting, not an API patch.
- **Org/fleet settings** (journey/idle, video-upload rules, fleet thresholds) are **not** on the
  public API — they live on the portal backend `app-api.autonomise.ai`.

## Two VisionTrack API surfaces (important)

- `api.autonomise.ai` — **public Third-Party API**. OAuth `client_credentials` bearer (per-org
  clientId/secret possible). Use this for all automation/the proxy. Public docs:
  `https://api.autonomise.ai/docs/index.html`. Swagger: `https://api.autonomise.ai/swagger/v2/swagger.json`.
- `app-api.autonomise.ai` — **portal's internal backend** (org/fleet settings, thresholds,
  video-upload rules). Captured live: uses a portal **UI bearer token** + `Organisation-Selection: <orgId>`
  header, CORS-locked to `app.autonomise.ai`, undocumented. Example writable endpoint observed:
  `PUT /api/fleet/{fleetId}/settings/`; `GET /api/organisation/settings` returns the full org settings
  object (idleSettings, journeyInterval, video lengths, `enableCreateVehiclesWhenGeotabSync`,
  `enableGeoTabApi`, etc.). Building on this requires confirming whether the `client_credentials`
  token is accepted here (it may need a portal login token) and is undocumented/subject to change —
  confirm with VisionTrack first.

## Open questions / decisions pending

1. **Scope decision** (not yet made): targeted v1 (grouping + pairing) vs full portal replacement
   vs pause. Recommendation: **targeted v1** — ship the group-scoped event viewer (built) + a pairing
   solution, pilot with one customer, then decide on the rest. Full replacement is a real ongoing
   commitment (feature parity, write-action safety, you own uptime).
2. **Naming fix** — ask VisionTrack: can the Geotab sync name vehicles by Geotab **description**
   instead of license plate? (Highest-leverage; possibly just a setting on their side.)
3. **Settings control** — test whether the `client_credentials` token works against
   `app-api.autonomise.ai` (mint token from `TOKEN_URL`, call `GET /api/organisation/settings` with
   `Authorization: Bearer …` + `Organisation-Selection: <orgId>`, check 200 vs 401). If yes, the
   proxy can wrap settings; if no, a portal login is required.
4. **Writable vehicle name field** — capture a portal vehicle-edit request to see if one exists and
   on which API.
5. **Ask VisionTrack** about per-org credential provisioning and whether to use their Geotab sync vs
   build custom provisioning.

## Recommended phased plan

1. **Events viewer (built)** — deploy proxy + add-in, add one test pairing, pilot with a customer
   whose VINs are populated. (Consider switching events to the webhook-push + local-DB model.)
2. **Pairing/provisioning** — ideally fix VisionTrack's sync naming (their side); otherwise a
   one-click "provision & pair" using Geotab data + VIN decode (NHTSA vPIC) for make/model/fuel.
3. **On-demand media + snapshots** (scope-gated).
4. **Live + playback streaming** (HLS; bytes go browser↔VT directly; proxy gates by scope).
5. **Scope-gated writes with a role layer + audit log** (reboot, enable/disable, settings).
6. **Settings** — device-level via `raw-config-patch` (VT3500); org/fleet via portal backend if auth
   allows.

## Environment specifics

- User: Austin Selander, austin@gpsfms.com. Company: GPS Fleet Management Solutions (GPSFMS), a
  Geotab reseller/partner. Email/web domain `gpsfms.com` (DNS via Wix).
- GitHub account/org for hosting: `austin-gpsfms` (GitHub Pages).
- Existing reference add-in: `advanced_report_builder` (same zenith stack/conventions).
- Existing watchdog Python script does the Geotab↔Autonomise VIN-last-6 join and holds the
  Autonomise `client_credentials` in a `.env` — the proxy reuses the same credentials and logic.
- Existing Lightsail box available for co-hosting: `gpsfms-tamper-detect-server-2gb`
  (Ubuntu 2 GB, static IP 3.139.166.82, us-east-2).
- Relevant skills installed: `vt-dev-info` (VisionTrack/Autonomise API — now extended via the
  supplement file), `geotab-partner-dev` (Geotab SDK/Add-Ins/partner ops), `geotab-support-docs`,
  `geotab-camera-services` (Geotab's own camera backend, not VisionTrack), `gpsfms-brand`.
