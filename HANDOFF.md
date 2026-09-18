# GPSFMS VisionTrack Add‑In — Engineering Handoff & GoFocus Blueprint

_Last updated: 2026‑09‑18_

This document describes the VisionTrack MyGeotab add‑in as it stands today, the
conventions and decisions behind it, an operational runbook, and — in the final
section — a concrete blueprint for building the **GoFocus / Geotab Camera‑Services**
equivalent in the same style. Read sections 1–11 to understand the platform;
read section 12 when you start GoFocus.

---

## 1. What this is

A custom **MyGeotab Page add‑in** that brings VisionTrack (Autonomise) camera
data into MyGeotab, scoped to each user's Geotab group access, plus a
**scope‑enforcing proxy** that is the only thing that talks to the camera API.
Built for GPSFMS (a Geotab reseller); intended to be polished enough that
VisionTrack would want it.

Pages today: **Dashboard** (safety‑event video grid), **Device Association**
(pairing health + a Pairing tool), **Camera Rules** (email alerts), **Reports**
(Watchdog offline report + Safety Scorecard), **Collision Center** (collision
triage, reconstruction, footage, downloadable bundle).

---

## 2. Architecture at a glance

```
  Browser (MyGeotab page)                 Lightsail box                     Camera cloud
  ┌────────────────────┐   HTTPS POST    ┌──────────────────────┐  OAuth   ┌──────────────┐
  │  Add‑in (React)     │ ───────────────▶│  Proxy (Express/Node) │ ───────▶│ api.autonomise│
  │  injected into      │  forwards the   │  systemd: vtproxy      │  bearer │   .ai          │
  │  my.geotab.com      │  MyGeotab       │                        │         └──────────────┘
  │  via GitHub Pages   │  session        │  • re‑derives the      │  JSON‑RPC ┌────────────┐
  └────────────────────┘                 │    caller's allow‑set  │ ────────▶│  MyGeotab   │
                                          │  • holds camera secret │  as user │  (Geotab)   │
                                          │  • SQLite (op state)   │         └────────────┘
                                          └──────────────────────┘
```

Key idea: **the browser never holds the camera API secret and cannot widen its
own scope.** Every request forwards the user's MyGeotab session; the proxy calls
Geotab *as that user* (so Geotab enforces the data scope), derives which
vehicles/cameras the user may see, and only then returns camera data.

MyGeotab does **not** iframe the add‑in — it injects `index.html` into the
`my.geotab.com` page. That single fact drives several conventions (see §4).

---

## 3. The two repos and how they deploy

| Repo | Visibility | Hosts | Deploy mechanism |
|---|---|---|---|
| `visiontrack_addin` | **Public** (GitHub Pages) | the React front‑end | Build locally, **commit `dist/`**, push. Pages serves `dist/` from `main`. |
| `visiontrack_proxy` | **Private** | the Express proxy | `git pull` on the Lightsail box, `npm run build`, restart the `vtproxy` systemd service. |

Notes:
- The proxy lives in its **own repo**, nested under `visiontrack_addin/proxy/`
  but git‑ignored by the add‑in repo. Commits/pushes for the proxy must be run
  **from inside `proxy/`**.
- The add‑in has **no `deploy` script**; "deploy" = `npm run build` then commit
  the rebuilt `dist/` and push (`.gitignore` intentionally does **not** ignore
  `dist/` — Pages serves it).
- `vite.config.ts` `base` is the **absolute** Pages URL
  (`https://austin-gpsfms.github.io/visiontrack_addin/dist/`). It must be
  absolute because the add‑in is injected into `my.geotab.com`; relative asset
  paths would resolve against Geotab's origin and 404.
- The **menu/config** (`config.json`) is registered *inside MyGeotab* (System →
  Settings → Add‑Ins). Changing `config.json` in the repo does nothing until you
  paste the new JSON into MyGeotab. This is why menu labels can lag the repo.

### Server layout (Lightsail)
- Service: `vtproxy.service` (systemd), runs `node dist/server.js` on `:8080` as
  user `vtproxy`, working dir `/home/vtproxy/proxy`.
- Restart: `sudo systemctl restart vtproxy`; logs: `sudo journalctl -u vtproxy`.
- Public URL: `https://visiontrack-proxy.gpsfms.com` (the add‑in's
  `VITE_PROXY_BASE_URL`).

---

## 4. Add‑in front‑end conventions

- **Stack:** React 19 + Vite multi‑page build + `@geotab/zenith` components.
- **One HTML entry per page.** `vite.config.ts` `rollupOptions.input` lists
  `index / association / notifications / watchdog / collision`. Each has a
  `<name>.html` + `src/<name>.tsx` entry that registers one MyGeotab add‑in
  factory (`window.geotab.addin.visionTrack<Page>`), with `initialize/focus/blur`.
- **Page naming in MyGeotab:** the page hash is
  `#addin-visiontrack_dashboard-<entry>` (e.g. `-association`, `-collision`,
  `-index`). `visiontrack_dashboard` is the slug of the add‑in `name` in
  `config.json`; the suffix is the HTML entry base.
- **Re‑fetch on focus.** MyGeotab keeps the page mounted and fires `focus()` when
  you return to it; the data‑load effect only runs on first mount. Pages that can
  go stale pass a `focusNonce` prop (bumped in `focus()`) that the App watches to
  re‑load. Camera Rules also has a manual Refresh button. **Apply this pattern to
  any new page that shows shared/editable data** or two users will see different
  snapshots.
- **Styling:** a single `src/styles.css` with `vt-*` classes. Reusable bits:
  `vt-header`/`vt-headerbtns`, `vt-toolbar`, `vt-summary`/`vt-stat`,
  `vt-table`, `vt-pill`, `vt-modal`/`vt-modal-backdrop`, `vt-linkbtn`,
  `vt-vehsel` (searchable single‑select). Brand navy is `#25477b`.
- **Scope UI:** `GroupFilterPicker` (Zenith GroupsFilter) + a searchable
  `VehicleSelect`. Group selection narrows *within* the user's scope; it can
  never widen it (the proxy enforces).
- **API client:** `src/api/proxy.ts` (all proxy calls) and `src/api/geotab.ts`
  (`getSession`, `fetchScopedGroups`, `friendlyError`).

---

## 5. The proxy

`proxy/src/server.ts` is an Express app. Cross‑cutting pieces:

- **`geotab.ts`** — server‑side MyGeotab JSON‑RPC client. `call(session, method,
  params)` runs *as the user* (forwarded `sessionId`), so Geotab enforces data
  scope. Helpers: `getScopedDevices`, `getGroupsById`, `getUserPermissions`
  (reads `securityFilters` → `{isAdmin, grantedIds}`), `getLogRecords`,
  `getIgnitionStatus`, `getExceptionEvents`, `getCollisionEvents`, `getTrips`,
  `getDriversById`, `getRules`, `getUserTimeZone`, `getUsersForPicker`.
- **`autonomise.ts`** — the only module that talks to `api.autonomise.ai`.
  OAuth `client_credentials` (cached token), `fetchEvents` (72h‑chunked),
  `fetchVehicles`, `fetchDevices`, `fetchEventMedia`, `submitMediaCommand`,
  `createVehicle/updateVehicle/assignDeviceToVehicle/unassignDeviceFromVehicle`,
  `mapWithConcurrency`.
- **`pairing.ts`** — the scope core. `resolveAllowedVehicles(scoped, vehicles,
  cameras)` joins VisionTrack vehicles to in‑scope Geotab devices on **VIN
  last‑6** and returns `byVehicleId` / `byHardwareId` allow‑sets (each carries the
  Geotab device id + group ids). Everything camera‑facing filters through this.
- **`requireSession(req,res)`** validates the forwarded session; endpoints 400 if
  missing, 404 if the database isn't paired.

### Scope enforcement model (important)
1. Browser forwards `{server, database, userName, sessionId}`.
2. Proxy calls Geotab as that user → only the user's in‑scope devices come back.
3. Proxy intersects those devices' VIN tails with VisionTrack vehicles.
4. Only matching vehicles' events/media are returned. The allow‑set is recomputed
   **per request** — scope cannot be bypassed client‑side.

### Endpoint inventory
`/api/events`, `/api/vehicles`, `/api/event-media`, `/api/event-track`,
`/api/associations`, `/api/pair/options|run|unpair`, `/api/rules` (+ `/save`
`/delete` `/users`), `/api/dist-lists/save|delete`, `/api/device-channels`,
`/api/request-video`, `/api/video-requests`, `/api/request-download`, `/api/watchdog`,
`/api/scorecard/*`, `/api/collisions` (+ `/triage` `/config` `/config/save`),
`/api/collision-media`, `/api/collision-detail`, `/api/collision-download`.

### Background workers (started in `server.ts`)
- **`ingest.ts`** — polls VisionTrack events, evaluates Camera Rules, sends
  alert emails (cooldown per rule+vehicle). Runs as the per‑database **service
  account**.
- **`reconcile.ts`** — keeps VT vehicle names = Geotab description. **OFF unless
  `RECONCILE_ENABLED=true`** (it writes to VT; left off while VT's master sync
  owns names).

---

## 6. Storage model

Two tiers, deliberately separated:

- **Config → Geotab AddInData** (`addInData.ts`, `AddInId
  a1e6QAmb9WqTWqJdDhptNDQ`). Camera rules, distribution lists, and
  collision‑source selections are each one AddInData record (Geotab caps each at
  10,000 chars; many small records beat one big array). Written via the user's
  session in the UI, read via the service account in the worker. Inherently
  per‑database, durable, survives proxy redeploys, consistent across users.
- **Operational state → SQLite** (`data/ingest.db`, better‑sqlite3). Ingest
  cursor/dedupe, per‑rule cooldown timestamps, collision triage, video‑request
  tracking. Machine state, not config — never goes in AddInData.

> History note: rules/lists started in SQLite and were migrated to AddInData
> because two admins on the same database could see divergent data and config
> didn't survive redeploys. The migration was a "start fresh" (no data carried
> over). The AddInData record **Id is the entity's id** (rule id = record id).

---

## 7. Security / clearances

- Custom MyGeotab security identifiers (declared in `config.json`):
  `gpsfmsCameraView` (View Camera Dashboard), `gpsfmsCameraRules` (Manage Camera
  Rules), `gpsfmsCameraRecipients` (Manage Camera Recipients).
- `getUserPermissions` reads the user's `securityFilters`; **"Everything" =
  full Administrator** (`isAdmin`).
- `canManageRules = isAdmin || has(gpsfmsCameraRules)`;
  `canManageRecipients = canManageRules || has(gpsfmsCameraRecipients)`.
- **Per‑recipient visibility:** non‑admins only see/manage recipients within
  their own group access; external emails and out‑of‑scope recipients are hidden
  and preserved (never clobbered) on save. Only a full Administrator sees the
  complete recipient list. Pairing/unpairing and collision triage are gated to
  `canManageRules`.

---

## 8. Feature inventory (what's built)

- **Dashboard** — group + vehicle + date‑range + event‑type filters; video grid
  with a dual‑camera clip modal (synced playback), an animated Leaflet trip map,
  per‑event "request more footage", and a standalone custom video request +
  **Requests view** (2026‑09): vehicle filter, grouped by footage date, compact
  first‑frame cards; click opens a fit‑to‑viewport synced multi‑camera modal
  (1/2/3‑column grid by camera count) with trip map and a **Download all views**
  button → `/api/request-download` returns one stitched MP4 (`composite.ts`:
  ffmpeg `xstack` grid, channel labels, navy title bar; cached under
  `data/composites/`, 14‑day sweep). Deep‑linkable to a clip via `#…,eventId:<id>`.
- **Device Association** — read‑only pairing‑health table (paired / no camera /
  no VT match / no VIN) + Excel export, **plus a Pairing tool**: search a Geotab
  unit (name/VIN/serial) + a camera serial → Pair sets the VT vehicle's
  `vrn = Geotab description` (not the UK plate) and `vin`, fuel‑type dropdown,
  other required fields auto‑filled; **Unpair** detaches a camera back to the
  unassigned pool.
- **Camera Rules** — per‑event‑type email alerts, admin‑gated on/off, scoped
  recipients (searchable Geotab user picker), distribution lists, cooldown,
  group scoping. Self‑owned SMTP delivery (Geotab custom diagnostics couldn't be
  API‑created — see §10).
- **Reports** hub — clickable report cards + per‑user favorites; **Watchdog**
  (offline cameras/GO devices, threshold picker) and **Safety Scorecard**
  (weighted, distance‑normalized score from Geotab exceptions + VT camera events,
  admin‑configurable factors/weights/bands). Excel exports open on the data sheet.
- **Collision Center** — triage queue from Geotab **Possible/Major Collision**
  `ExceptionEvent`s, filtered to camera‑equipped vehicles in scope (so GoRugged /
  non‑camera assets drop out); admin‑selectable rule sources (default Major
  only); Confirm/Dismiss triage. Detail view: footage near the collision, an
  on‑demand **Request footage** button, a filled speed chart, a Leaflet trip map
  with point‑of‑impact, raw log (speed/ignition/lat‑long over a window). **Download
  all accident data** = ZIP of footage + GPSFMS‑branded reconstruction PDF (OSM
  tile map + vector speed/path) + raw‑log Excel.

---

## 9. Environment & server config (all server‑only)

`proxy/.env` (gitignored; `.env.example` committed for shape):
```
AUTONOMISE_BASE_URL=https://api.autonomise.ai
TOKEN_URL=https://login.autonomise.ai/connect/token
CLIENT_ID=...            # VisionTrack OAuth client_credentials
CLIENT_SECRET=...
ALLOWED_ORIGINS=...      # (CORS also auto‑allows *.geotab.com)
SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
ADDIN_BASE_URL=https://my.geotab.com
INGEST_INTERVAL_SECONDS=60
RECONCILE_ENABLED=false  # name‑sync worker; keep OFF while VT master sync runs
INGEST_DB_PATH=./data/ingest.db
FFMPEG_PATH=               # optional; default: /usr/bin/ffmpeg if present, else bundled ffmpeg-static
COMPOSITE_FONT=            # optional: .ttf for composite labels; auto-detects DejaVu/Liberation
```
- **Composite labels need the distro ffmpeg + a TTF font.** The bundled
  `ffmpeg-static` binary has **no `drawtext`** (built without libfreetype), so
  `composite.ts` prefers `/usr/bin/ffmpeg` when present and probes `-filters`;
  without drawtext the video still builds, just unlabelled. On the box:
  `sudo apt install -y ffmpeg fonts-dejavu-core`.
- **`service-accounts.json`** (gitignored) — per‑database Geotab service account
  `{geotab_database, server, userName, password, eventTypes?}`. Used by the
  ingest/reconcile workers (CIAM‑exempt service accounts so sessions don't die).
- **`pairings.json`** (now **gitignored / server‑only**, like `.env`) — maps
  `geotab_database → VisionTrack organization_id`. **Do not track this in git.**
  A committed copy once overwrote the live mapping on `git pull` and 401/403'd the
  whole integration. `pairings.example.json` documents the shape.

---

## 10. Hard‑won lessons / gotchas

- **Vite `base` must be absolute** (injected, not iframed). Relative paths 404.
- **VisionTrack pagination is 1‑based** (page=0 → HTTP 500) and **`/events`
  rejects ranges > 72h** — chunk longer windows.
- **You cannot create Geotab custom diagnostics via the API** — the original
  StatusData‑based notification plan was abandoned for self‑owned SMTP rules.
- **Server‑side time = UTC.** `toLocaleString()`/`toUTCString()` on the Lightsail
  box render UTC. Format with `timeFormat.ts` (`formatInTimeZone`) using the
  Geotab user's `timeZoneId` (`getUserTimeZone`). The browser is already local —
  only server‑rendered output (emails, PDF, Excel) needs this.
- **Notification emails must BCC.** `to: SMTP_FROM`, `bcc: recipients` — never put
  all recipients in `to:` (they'd see each other).
- **Email deep link can land on the Map** if MyGeotab's login redirect drops the
  URL fragment (clicked while logged out). The page token
  `#addin-visiontrack_dashboard-index` is correct; the open item is routing
  through a login‑return URL so the hash survives.
- **`pairings.json` is server‑only.** See §9. Untracking it removed org ids from
  git entirely (more private), and made deploys unable to clobber it.
- **AddInData:** 10k chars/record; `Details` deserializes as an object (no
  `JSON.parse`); `Set` merges (can't delete keys — always write the full shape);
  clearance gates methods (Admin/Supervisor/Default = write, ViewOnly = read).
- **OSM tiles / Nominatim** (collision PDF map + reverse geocode) are free
  community services — fine for pilot volume; move to a paid provider if it scales.
- **Dev sandbox caveat (this environment only):** the Linux shell mount can serve
  a **stale snapshot** of the repo, so `tsc` there may report phantom errors. The
  real typecheck is the server/laptop `npm run build`. Don't trust sandbox `tsc`.

---

## 11. Operational runbook

**Deploy the add‑in (front‑end):**
```
cd visiontrack_addin
npm run build
git add -A && git commit -m "..." && git push     # commits dist/
# then in MyGeotab: re‑paste config.json only if menu/securityIds changed
```

**Deploy the proxy:**
```
cd visiontrack_addin/proxy
git add -A && git commit -m "..." && git push
# on the server:
sudo -u vtproxy bash -c 'cd /home/vtproxy/proxy && git pull && npm install && npm run build' \
  && sudo systemctl restart vtproxy
sudo journalctl -u vtproxy -n 25 --no-pager        # expect "listening on :8080"
```

**Probes** (`proxy/scripts/`, run as `sudo -u vtproxy … node scripts/<probe>.mjs`):
`probe-auth.mjs` (Autonomise token + per‑pairing org access), `probe-addindata.mjs`
(AddInData round‑trip), `probe-collision.mjs` (collision rules/events),
`probe-vehicle*.mjs` (VT vehicle/pairing schemas). Probe‑first, then build — this
rhythm has been reliable.

**If Autonomise 401/403s:** run `probe-auth.mjs`. Token issued but data rejected
= bad `organisation_id` in `pairings.json` or revoked access (call VisionTrack).

---

## 12. Building the GoFocus version (the reuse blueprint)

GoFocus / Surfsight / Sensata cameras live behind **Geotab Camera‑Services**
(`media-services.geotab.com`), not VisionTrack. The good news: they're
**Geotab‑native**, which makes much of the architecture *simpler*. Use the
`geotab-camera-services` skill for endpoint/field detail.

### What carries over unchanged
- The **whole front‑end shell**: multi‑page Vite build, Zenith UI, entry/factory
  pattern, `focusNonce` re‑fetch, `vt-*` styles, scope UI, the modal/clip/trip‑map
  components, the report‑card hub, the Collision Center page structure.
- The **proxy shape**: Express + `requireSession` + per‑request scope, SQLite for
  operational state, AddInData for config, the same deploy/runbook.
- **AddInData storage** (`addInData.ts`) — reuse as‑is (generate a *new*
  `AddInId` for the GoFocus add‑in so its config is isolated).
- **Camera Rules, Reports, Collision Center, Watchdog/Scorecard** concepts all
  apply.

### What changes (the deltas)
1. **Auth (biggest difference).** Camera‑Services needs **two** layers on every
   call: an **OIDC Bearer** from Geotab's Keycloak realm *and* **five
   `X-MyGeotab-*` headers** (`Database`, `Path`, `SessionId`, `Userid`,
   `Username`). The proxy already receives `{server, database, userName,
   sessionId}` from the add‑in — that supplies four of the five headers directly;
   `X-MyGeotab-Userid` needs one `Get<User>` lookup (cache it). The OIDC token
   comes from a **refresh‑token grant** that rotates every call with reuse
   detection — seed it once from DevTools for a **dedicated service account**
   that nobody logs into interactively, and persist the rotated token to a cache
   file. (`client_credentials` is *not* available here, unlike VisionTrack.)
2. **Scope is even simpler.** Because every call carries the user's MyGeotab
   session headers, Geotab enforces the tenant/scope natively. You likely **don't
   need the VIN‑last‑6 join or `pairings.json` at all** — there's no separate
   org. Endpoint **roles** (`ListAssets`, `ViewRecordedVideo`,
   `AdministerCameraSettings`, `AddPairing`, etc.) gate access; set them on the
   service account / users.
3. **Pairing is native.** Replace `autonomise.ts` vehicle create/assign with
   `DeviceMappings` (`GET/POST/DELETE /DeviceMappings`, `/DeviceMappings/Search`,
   `/serialNumber/{serial}`). The Pairing tool maps cleanly onto these. Note
   `Camera.partnerDeviceId` = camera serial (URL `{serialNumber}`),
   `deviceSerialNumber`/`goDeviceSerialNumber` = the paired GO — **reversed from
   intuition.**
4. **Collision footage is cleaner.** Geotab exceptions link directly to media:
   `POST /Video/Queue/{exceptionId}`, `GET /Media/Exception/{myGeotabExceptionId}`,
   `/Video/Requests/Exception/{id}`. The Collision Center can request/attach
   footage by `ExceptionEvent.id` natively — no VIN matching to find the camera.
5. **Camera Rules** can optionally push **native** `SmarterAi EventsSettings`
   (per‑device/tenant) instead of (or alongside) self‑owned SMTP alerts.
6. **Footage requests / live:** `POST /Media`, `/Video/Queue`, `/Media/{requestId}/
   Resources`; live via `ViewCameraLiveVideo`.
7. **Gotchas:** SmarterAi `endpointDetails` timestamps are **unix‑ms** (others
   ISO); Surfsight uses **IMEI** not serial; **don't pass `scope`** on refresh
   (it only narrows); 401 from media‑services is almost always a missing
   `X-MyGeotab-*` header, 403 is a missing role; the access token's `aud` is
   `api.my.geotab.com` (media‑services trusts the session headers as the tenant
   check).

### Suggested GoFocus build order
1. Stand up a **dedicated camera‑services service account** + capture the OIDC
   refresh token (see the `geotab-camera-services` skill bootstrap).
2. New proxy module `cameraServices.ts` (the `autonomise.ts` analog): token
   refresh+cache, the 5‑header builder, typed wrappers for `DeviceMappings`,
   `DeviceInformation`, `Media`, `Video`, `SmarterAi`.
3. Fork the add‑in shell to a new repo/`AddInId`; swap the API client; drop the
   VIN‑join scope code (use session headers + roles).
4. Port pages in this order: Device Association/Pairing (native DeviceMappings) →
   Collision Center (exception‑linked footage) → Camera Rules → Reports.

---

## 13. Open items / backlog

- **Deep‑link login redirect** — make the email "View clip" link survive
  MyGeotab's login redirect (route through login‑return URL).
- **"Mark as collision"** — promote a manual custom‑footage pull into the
  Collision Center (for equipment/excavator incidents that shouldn't auto‑detect).
- **Accelerometer graph** in the collision detail (VT per‑event accelerometer
  when a camera event coincides).
- **Focus‑refetch** could be extended to Dashboard/Association/Collision (only
  Camera Rules has it today; the others have Refresh/Apply).
- **Server‑side report favorites** (currently per‑user localStorage).
- **VIN‑decode auto‑update** button on the Pairing tool.
- **SMS / Slack‑Teams** notification channels for Camera Rules.
- Email `to:` is the alerts mailbox (gets a copy of every alert); switch to
  per‑recipient sends if that copy is unwanted.
```
