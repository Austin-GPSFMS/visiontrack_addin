# VisionTrack Events — MyGeotab Add-In (GPSFMS)

A custom MyGeotab add-in that shows VisionTrack safety events, **scoped to each
user's Geotab groups**. Unlike the stock VisionTrack add-in (which embeds the
VisionTrack portal and uses VisionTrack's own org structure), this one drives
everything from the logged-in MyGeotab user's session, so users only ever see
events for vehicles inside their group/data scope.

## Why grouping needs a proxy

VisionTrack has no concept of a Geotab group. To respect grouping we must:

1. Read the logged-in user's MyGeotab session.
2. Ask Geotab — *as that user* — which devices they can see. Geotab restricts
   `Get<Device>` to the caller's data scope, so this is the source of truth.
3. Translate those Geotab devices into VisionTrack vehicles.
4. Only ever return VisionTrack data for that allowed set.

If steps 2–4 ran in the browser, a user could bypass them with devtools and the
Autonomise bearer token (shipped in client JS) would be exposed to everyone. So
a small backend **proxy** does the scope resolution server-side and is the only
component that talks to `api.autonomise.ai`. The browser only ever sends its
MyGeotab session and receives already-filtered events.

```
MyGeotab iframe (React/Zenith add-in)
        │  POST /api/events  { session, groupIds, fromDate, toDate }
        ▼
VisionTrack proxy  ──(as the user)──►  MyGeotab API   (in-scope devices)
        │          ──(client_creds)──►  api.autonomise.ai  (vehicles + events)
        │
        └─ intersect on VIN-last-6, filter events, enrich, return
```

## The device → vehicle pairing (VIN last 6)

Geotab and VisionTrack rarely agree on the full VIN string but reliably agree on
the **last 6 characters**, so that is the join key (this matches the existing
`watchdog` script):

- **Geotab `PreferredVIN`** = `vehicleIdentificationNumber`, falling back to
  `engineVehicleIdentificationNumber` (ignoring values containing `@`).
- **VisionTrack** = `vehicle.vin`.
- Match = last 6 chars, uppercased/trimmed.

Vehicles with no usable VIN are **dropped** from the allow-set (fail closed) so
they can never leak across groups. The pairing lives in
`proxy/src/pairing.ts`.

Each Geotab **database** is paired to one VisionTrack **organisation** in
`proxy/pairings.json` (same idea as the watchdog `pairings.json`).

## Repo layout

```
visiontrack_addin/
├── src/                 # React/Zenith add-in (Vite, same pattern as advanced_report_builder)
│   ├── main.tsx         # MyGeotab add-in lifecycle (window.geotab.addin.visionTrackEvents)
│   ├── App.tsx          # toolbar: group picker + date range + classification; events table
│   ├── api/geotab.ts    # session + scoped-group helpers
│   ├── api/proxy.ts     # calls the backend proxy
│   ├── components/      # GroupFilterPicker (Zenith GroupsFilter), EventsTable (Zenith Table)
│   └── utils/vin.ts     # VIN-last-6 (display parity with the proxy)
├── config.json          # add-in manifest (ActivityLink menu item)
├── vite.config.ts
└── proxy/               # scope-enforcing backend (Node + Express + TypeScript)
    ├── src/server.ts    # POST /api/events, GET /api/health
    ├── src/geotab.ts    # calls MyGeotab AS THE USER -> in-scope devices
    ├── src/autonomise.ts# client_credentials auth + paged /vehicles, /events
    ├── src/pairing.ts    # VIN-last-6 allow-list resolution
    ├── src/scope.ts     # resolve + short-TTL per-user cache
    ├── pairings.json    # Geotab database -> Autonomise organisation
    └── .env.example
```

## Setup

### 1. Proxy

```bash
cd proxy
cp .env.example .env        # fill in CLIENT_ID / CLIENT_SECRET / TOKEN_URL
# edit pairings.json: add { name, geotab_database, organization_id } per customer
npm install
npm run dev                 # or: npm run build && npm start
```

Host the proxy somewhere with HTTPS and set `ALLOWED_ORIGINS` to your add-in's
origin (e.g. `https://austin-gpsfms.github.io`). Any always-on Node host or a
container works; the code is plain Express so it ports easily to a serverless
function if preferred.

#### Onboarding a customer (adding a pairing)

Each Geotab database is paired to one VisionTrack organisation in
`pairings.json`. GPSFMS controls this file; customers never see it, and the
proxy hot-reloads it, so a new entry takes effect on the next request with no
restart. Add one with the helper (it validates and appends, refusing to
clobber an existing database unless you pass `--force`):

```bash
npm run add-pairing -- --name "Acme Trucking" --db acme_db --org <visiontrack-org-uuid>
npm run list-pairings
```

Or just edit `pairings.json` by hand — same result.

### 2. Add-in

```bash
npm install
# point the add-in at your deployed proxy:
echo 'VITE_PROXY_BASE_URL=https://your-proxy-host' > .env.local
npm run build               # outputs dist/
```

Publish `dist/` (this repo uses GitHub Pages) and confirm the URL in
`config.json` matches. In MyGeotab: **Administration → System → Add-Ins → New
Add-In**, paste the contents of `config.json`.

## Security notes

- The proxy recomputes the allow-list from the user's session on every request
  (cached briefly per user). The browser cannot widen its own scope.
- The Autonomise client secret lives only in the proxy `.env`.
- A user with an expired session gets a 401 and is told to refresh MyGeotab.
- `/eventNotes` is rate-limited to 1 call / 5 min by VisionTrack — this v1 uses
  `/events` (500/min). If you later add note/review detail, cache `/eventNotes`
  aggressively in the proxy.

## v1 scope

Safety event list + review (filter by group, date range, classification).
Future phases (on-demand video/snapshot, live + playback streaming, journeys)
slot in as additional proxy endpoints reusing the same `resolveScope` allow-list.
