# Self-hosting MagicFinder on a NAS with Docker

Research for [#21](https://github.com/Ryski112/MagicFinder/issues/21). This is an assessment only. No app code was changed. Code references are to `main` at `882f703`.

## Verdict

- **Docker for one household (LAN, one buyer):** about **half a day**. One small code change is needed: the server binds `127.0.0.1` with no override. The rest is a Dockerfile, a compose file and a README section. MtgSingles' headless Chromium should work unchanged from a home NAS. That is likely, not proven inside a container (see the smoke test below).
- **Several friends using one install:** about **2-4 days** more. Several things now assume one buyer. Starting a search cancels everyone else's search. Settings and pickup choices are global. The API has no notion of who is calling. Doing this properly is the bigger job, and it reopens a scope decision: `docs/spec.md` §1 lists "Docker/NAS and shared multi-user installs" as out of scope.

## What already works in a container

| Concern | Finding |
|---|---|
| Node version | `package.json` needs `>=22.13`. That is the first 22.x where `node:sqlite` works without `--experimental-sqlite`; it is still experimental, which is why the start script passes `--disable-warning=ExperimentalWarning` ([Node sqlite docs, history table](https://nodejs.org/api/sqlite.html)). `node:22-bookworm-slim` and the Playwright image (Node 24, [its Dockerfile](https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble)) both satisfy this. |
| Data dir | `src/server/paths.ts` honours `MAGICFINDER_DATA_DIR` before any platform default and creates the folder. Map it to a volume such as `/data`. It holds `catalogue.sqlite` (~54 MB), `search-cache.sqlite` (a few MB) and `settings.json`, measured on a dev machine. |
| Port | `MAGICFINDER_PORT` is honoured (`main.ts`) and skips the free-port probe. It isn't documented in the README. |
| Browser auto-open | `MAGICFINDER_NO_OPEN=1` skips it. If the variable is left unset, the `xdg-open` spawn error is swallowed (`.on('error', () => {})`), so nothing breaks either way. |
| Shutdown | `main.ts` handles `SIGTERM` and closes Chromium and the solver workers. Run with `--init` / `init: true` so PID 1 reaps Chromium's child processes ([docker run --init](https://docs.docker.com/reference/cli/docker/container/run/)). |
| Scryfall catalogue | `src/catalogue/updater.ts` checks hourly and rebuilds once the catalogue is a day old. Today's `default_cards` file is 79.7 MB compressed (`compressed_size` from `GET https://api.scryfall.com/bulk-data/default_cards`). It needs no special handling. A shared NAS downloads it once a day instead of once per friend's machine. It persists as long as `/data` is a volume; otherwise every container recreate downloads it again. |
| Chromium sandbox / shm | playwright-core 1.64.1 passes `--no-sandbox` unless `chromiumSandbox: true`, and always passes `--disable-dev-shm-usage` (`node_modules/playwright-core/lib/coreBundle.js`, the chromium launch args). The app therefore runs as root in a container, and Docker's 64 MB `/dev/shm` is fine. Playwright's Docker guide still recommends `--ipc=host` for Chromium, and a non-root user plus its seccomp profile when visiting untrusted sites ([Playwright Docker](https://playwright.dev/docs/docker)). |

### MtgSingles and Cloudflare

MtgSingles "only answers real browsers". The question is whether a containerised headless Chromium counts.

- Today's desktop path is already headless: `browser.ts` launches with `headless: true`, so what a container adds is a Linux build and a different filesystem.
- **Tested 2026-10-17:** Debian Chromium 154 on Linux, headless via playwright-core, from a home NZ connection. It loaded `https://mtgsingles.co.nz/` (200, real title, no challenge). The in-page `fetch` to `api.mtgsingles.co.nz/MtgSingle?query=Sol Ring…` returned 200 with JSON Listings. This happened even though the UA says `HeadlessChrome/154` and `navigator.webdriver` is `true`. The check that matters is evidently "is this a real browser engine (TLS, JS)", not "is it headless".
- The NAS sits on the same residential IP as the desktops, so IP reputation doesn't change. Don't route the container through a VPN or a Tailscale exit node: spec §5 says "Don't route Source traffic through a VPN", and datacenter IPs are what Cloudflare challenges.
- **Untested:** the same thing inside a container, and Playwright's *headless shell* build. Playwright's default headless mode uses a separate `chromium-headless-shell`; full Chromium is only used via `channel: 'chromium'` ([Playwright browsers](https://playwright.dev/docs/browsers)). The test above used full Chromium. To stay on the tested path, install Debian's `chromium` package. `findInstalledBrowser()` already looks for `/usr/bin/chromium`, so no code change or `MAGICFINDER_BROWSER` is needed.
- If MtgSingles is challenged anyway, the existing rules apply unchanged: Blocked, 30-minute cooldown, Fetch-only run. Spec §5.3 forbids evasion, so there is nothing to "fix" in that case.

### Image choice

| Option | Pros | Cons |
|---|---|---|
| **`node:22-bookworm-slim` + `apt install chromium`** (recommended) | Same Node major as `engines`. Full Chromium (the tested path). Found automatically at `/usr/bin/chromium`. No version lock to playwright-core. amd64 and arm64. | Debian's Chromium lags upstream a little. playwright-core warns only if the CDP protocol drifts far. |
| `mcr.microsoft.com/playwright:v1.64.0-noble` | Browsers and dependencies pre-baked, amd64 and arm64 tags. | Over 1 GB (includes Firefox and WebKit). Browsers are found only when the image version matches playwright-core ([Playwright Docker](https://playwright.dev/docs/docker)). The lockfile has **1.64.1**, and MCR has no `v1.64.1` tag (checked `mcr.microsoft.com/v2/playwright/tags/list`), so playwright-core would have to be pinned to 1.64.0. Otherwise `browser.ts` falls back to downloading Chromium *at runtime* inside the container. It uses headless shell by default. |
| Alpine | Small | Not supported by Playwright (glibc builds only) ([Playwright Docker](https://playwright.dev/docs/docker)). Avoid. |

## Required changes: needed for Docker at all

1. **Make the bind address configurable.** `main.ts` calls `serve({ …, hostname: '127.0.0.1' })`. Inside a container that is the container's own loopback, so a published port (`-p 5180:5180`, which Docker binds on `0.0.0.0` by default, [docker run](https://docs.docker.com/reference/cli/docker/container/run/)) never reaches it. Add e.g. `MAGICFINDER_HOST` (default `127.0.0.1`, `0.0.0.0` in the image). Keep the default local, because the API has no auth (see below). The startup log still prints `http://localhost:port`, which is cosmetic.
2. **Build at image time, not at start.** `npm start` runs `vite build` on every start. The image should run `npm run build` once and start with `tsx src/server/main.ts`. `tsx` is a devDependency and is needed at runtime, so the image needs `npm ci` with devDependencies, or `tsx` moved to dependencies. Node's native type stripping can't replace it, because imports omit the `.ts` extension.
3. **Run from the repo root.** `serveStatic` is given `webDir.replace(process.cwd(), '.')`, so the process must start with `WORKDIR` set to the app directory. It works as-is with `WORKDIR /app`; just don't change the working dir in compose.
4. **Packaging files:** `Dockerfile`, `.dockerignore` (`node_modules`, `dist`, `.git`), `compose.yaml`, and a README section that documents `MAGICFINDER_DATA_DIR`, `MAGICFINDER_PORT`, `MAGICFINDER_HOST` and `MAGICFINDER_NO_OPEN`.
5. **One-off smoke test** on the NAS: start the container and search one card on MtgSingles. That closes the "untested in a container" gap above.

Sketch (not built):

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV MAGICFINDER_DATA_DIR=/data MAGICFINDER_PORT=5180 MAGICFINDER_HOST=0.0.0.0 MAGICFINDER_NO_OPEN=1
VOLUME /data
EXPOSE 5180
CMD ["npx", "tsx", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]
```

```yaml
services:
  magicfinder:
    build: .
    init: true
    restart: unless-stopped
    ipc: host            # Playwright's recommendation for Chromium; optional given --disable-dev-shm-usage
    ports: ["5180:5180"] # or "192.168.1.10:5180:5180" to pin to the LAN interface
    volumes: ["./magicfinder-data:/data"]
```

## Required changes: needed for multiple users

| # | What assumes one buyer | Where | Change |
|---|---|---|---|
| 1 | **A new search cancels every other search.** `RunManager.start` calls `cancel()` on all runs and `runs.clear()` ("One active run at a time keeps Source traffic low"). Friend A's results then 404 with "That search has finished or been replaced". | `src/server/runs.ts` | Key runs by client or session and keep one run per user. Queue searches and cap how many run at once, so Source traffic stays low. Expire idle runs. |
| 2 | **Settings are one global file.** `pickupStores`, `pickupCity`, `ruralAddress`, `postageType`, `postageOverrides`, `minCondition`, `allowFoils`, `sources`, `theme` and so on are personal. A `PUT /api/settings` also calls `runs.replanAll()`, which re-plans *other people's* runs with the new settings. | `src/server/settings.ts`, `app.ts`, `runs.ts` (`ctx()` reads `settings.get()`) | Split the settings. **Install-wide:** `sourceHealth`, `staples`, `rungTimeLimitS`, `defaultPostage`. **Per-buyer:** everything else, stored per user server-side or kept in the browser (`localStorage`, as the Want List draft already is) and sent with each run or plan. Pass the buyer's settings into the run instead of reading the global store. |
| 3 | **No identity at all.** Every endpoint is anonymous, so items 1 and 2 have nothing to key on. | `app.ts` | The simplest key is a random client id cookie (enough on a trusted LAN). For a real identity, trust a reverse-proxy or Tailscale header (below). |
| 4 | **Cart pre-check throttle is per call.** `checkShopifyCart(…, throttle = new Throttle(1000))` makes a new throttle each time, so two friends checking out at the same Store double the rate. | `src/server/cart.ts`, `app.ts` | Share one throttle per Store, or per Shopify host, across requests. |
| 5 | **Solver capacity.** `SolverPool` is `min(4, cores-1)` workers, and each rung gets `rungTimeLimitS` (10 s). Concurrent plans on a low-power NAS CPU will hit "no plan in time" more often. | `src/optimiser/pool.ts` | Queue plans per run, possibly lower the parallel count, and expect to raise `rungTimeLimitS` on weak NAS CPUs. |

These already suit a shared install and need no change:

- **Search cache is a benefit.** It is keyed by (Source, card name), not by user (`searchCache.ts`). Friends with overlapping lists reuse each other's results for an hour, and stale entries up to a day stand in during blocks. Shared caching reduces Source traffic compared with each friend running their own copy.
- **Politeness is global per Source.** Each Source instance has one `Throttle(1000)`, and the instances are shared by all runs (`main.ts` builds `sources` once). Concurrent runs therefore interleave at about 1 req/s per Source in total, instead of 1 req/s each. The cost is latency: two people searching at once each go about half speed. MtgSingles also shares one browser page.
- **Block handling is per IP, so a shared state is correct.** All traffic leaves from the NAS's one IP. A block hits everyone, and the shared `sourceHealth` cooldown keeps it so. Two policy points remain:
  - Anyone can press **Try again now** and lift the cooldown for all (`POST /api/sources/:id/try-again`). Consider restricting it to the owner.
  - Total volume grows with the number of friends. Spec §5 accepted "low volume, for personal and friends' use", and Fetch's Terms forbid automated access without permission (spec, risks). A per-day request cap or a visible daily count would make "low volume" checkable.

### Access from outside the LAN

The API is unauthenticated. Anyone who can reach it can trigger Source traffic from your IP, change settings and lift block cooldowns. **Don't port-forward it to the internet.**

- **Tailscale (recommended for friends):** share the NAS machine with each friend ("Sharing is available for all plans"; a shared machine accepts incoming connections but can't start them, [Tailscale sharing](https://tailscale.com/kb/1084/sharing)). `tailscale serve 5180` then proxies the local port over HTTPS and adds `Tailscale-User-Login` identity headers. That gives multi-user item 3 a real user key for free ([Tailscale Serve](https://tailscale.com/kb/1312/serve)). With Serve proxying `127.0.0.1`, MagicFinder can stay bound to loopback on the host network. Use Tailscale for inbound access only, never as an exit node for the container (VPN rule above).
- **Reverse proxy (Caddy, nginx, Traefik) with auth** such as basic auth, Authelia or Authentik, if a public hostname is wanted. Disable response buffering for `/api/runs/:id/events` (SSE) and `/api/runs/:id/cart` (streamed NDJSON), or progress will arrive in bursts.

## Keep Docker easy: what the packaging should avoid

- **Don't put mutable state outside `MAGICFINDER_DATA_DIR`.** Per-user settings and any future files belong under it, so one volume is the whole backup.
- **Don't keep `/data` on an SMB/NFS share.** SQLite relies on file locks that network filesystems often get wrong ([SQLite: how to corrupt](https://www.sqlite.org/howtocorrupt.html#_filesystems_with_broken_or_missing_lock_implementations)). A volume on the NAS's local disk is fine.
- **Don't rely on a runtime Chromium download.** Bake the browser into the image, or the first MtgSingles search downloads one into an ephemeral layer every time the container is recreated.
- **Don't couple to the Playwright image tag** unless playwright-core is pinned to the same exact version.
- **Don't use Alpine or musl images.**
- **Don't default to `0.0.0.0` outside the image.** Desktop installs must stay loopback-only while there is no auth.
- **Don't build in auth.** Leave identity to a proxy or Tailscale header, plus a client-id fallback, so the app stays a simple local server.
- **Don't add a database server or separate containers.** `node:sqlite` plus JSON in one volume keeps it a single `compose up`.
