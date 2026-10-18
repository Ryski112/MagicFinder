# The Docker image, and how a new version reaches the NAS

Research for "What should the Docker image look like, and how does a new version reach the NAS?", part of the map "Wayfinder: hosting MagicFinder on the NAS for friends". It builds on "How hard would it be to self-host MagicFinder on a NAS with Docker?" (findings on branch `research/nas-docker`), apart from its Chromium parts: Chromium has been gone since PR 25.

These are facts and options. The owner makes the decisions. Code references are to `main` at `9d217b1` (v0.2.1). The proposed Dockerfile, compose file and workflow are in this document only; nothing was added to the repo. No image was published.

## Summary

- **Base image:** `node:24-bookworm-slim`. It matches the Node 24 that the desktop downloads ship and the bundle's `target: 'node24'`. It is glibc, so it is Node's tier-1 build, and it is published for amd64 and arm64. The image comes out at 254 MB uncompressed for arm64, about 81 MB gzipped. The app adds about 5 MB to the base.
- **Run the esbuild bundle, not `tsx`.** It is the same `main.mjs` + `worker.mjs` + `highs` layout that `scripts/package.ts` stages. That is 4.7 MB with no `node_modules` beyond `highs`, against 113 MB of `node_modules` for `tsx`.
- **No QEMU needed to build arm64.** Two things make this work. The build stage runs on the builder's own CPU (`--platform=$BUILDPLATFORM`), because the bundle is plain JavaScript plus WebAssembly. The runtime stage has no `RUN` steps. I built the arm64 image on an amd64 machine with no arm64 emulation registered.
- **Proven on arm64:** the image's own arm64 `node` and app files, run under `qemu-aarch64` user-mode emulation, booted and served `/api/status`. They planned a 100-card Want List from cache and did one live 3-card search (one card actually searched, on both Sources).
- **Memory, measured** (peak RSS of the whole process, which includes the worker threads):
  - 100 cards: 450–490 MiB on the first run with the NAS's default 3 solvers, settling around 680 MiB after repeated runs. With 1 solver: about 340–490 MiB.
  - 218 cards: about 700 MiB on the first run, settling around 930 MiB.
  - A CardKingdom price refresh adds about 375 MiB for a moment.
  - The number of solvers matters far more than Node's heap limit.
- **Code changes needed** (all can be gated on hosted mode, so the desktop is untouched):
  - a bind-address switch (`MAGICFINDER_HOST`)
  - a hosted-mode switch (`MAGICFINDER_HOSTED=1`)
  - probably a solver-count switch (`MAGICFINDER_SOLVERS`)

  Setting `MAGICFINDER_PORT` already skips the second-launch handover.
- **Publishing:** a new workflow (or a new job) on the existing `v*` tag pushes `ghcr.io/ryski112/magicfinder` for `linux/amd64,linux/arm64`, tagged `X.Y.Z`, `X.Y` and `latest`. A new GHCR package starts **private**; the owner flips it to public once by hand.
- **Updating on the NAS:** In Container Manager, stop the Project, then Build it, which pulls `:latest` again and recreates the container. The original Watchtower is archived. A maintained fork exists.
- **Update notice:** the current "new version available, download it" banner is wrong for friends in hosted mode. Options are below.

## What was tested, and how

- **Machine:** amd64 desktop with 32 threads and Docker 29.9.1 (BuildKit, `docker` driver). `qemu-aarch64` user-mode binary present. No arm64 handler was registered in `binfmt_misc`. I didn't register one, because that changes a kernel setting on the owner's machine.
- **Image:** built from a snapshot of `main` with the Dockerfile below.
  - amd64 and arm64 were both built with `docker buildx build --platform … --load`. The arm64 build needed no emulation.
  - The build includes one stand-in `sed` line that makes the bundled `main.mjs` read `MAGICFINDER_HOST`. That only stands in for the real code change, so this research build could serve outside the container.
- **Memory runs:** the amd64 image under Node 24.22.0, started with `--network none` so it could not reach any Store.
  - **Data:** a copy of the owner's real search cache (252 cards per Source, cached 2026-10-16/17), with timestamps moved forward so every search counted as fresh, plus a copy of the real catalogue.
  - **Want Lists:** the first 100 cards (alphabetical) that both Sources have Listings for, and all 218 such cards.
  - **Solver count:** pinned with `--cpuset-cpus`. `SolverPool` uses `availableParallelism() - 1`, capped at 4. `availableParallelism()` follows the CPU affinity (`--cpuset-cpus 0-1` gives 2) but not `--cpus` (still 32). So cpusets of 2/3/4/5 CPUs gave 1/2/3/4 solvers. The DS423 has 4 cores, so its default is **3**.
  - **Sampling:** `/proc/<pid>/status` VmRSS was read every 100 ms, plus VmHWM (the kernel's own peak) at the end. The cgroup figures also count the driver script I ran inside the container (`docker exec node …`), so the process RSS is the honest number for the app.
  - **Not measured on Node 22:** Node 22 measured within noise of Node 24 for one run (475 vs 455–489 MiB).
- **First-boot catalogue build:** one real Scryfall bulk download into an empty data directory (`--network bridge`).
- **CardKingdom refresh:** one real `api.cardkingdom.com` pricelist download, with the CardKingdom comparison switched on.
- **arm64 run:** the arm64 image's filesystem was exported and its `/usr/local/bin/node` run with `qemu-aarch64 -L <rootfs>`.
  - Everything ran as arm64: the app, the `node:sqlite` catalogue and the HiGHS worker threads.
  - One live 3-card Want List (Brainstorm, Ponder, Dark Ritual) was run. Two of the cards were in the cache, so only "Ponder" was searched live: one search per Source, at the app's normal pacing. Both Sources answered `ok`.
  - The first live attempt failed with `fetch failed` because the exported rootfs has an empty `/etc/resolv.conf`, which Docker normally fills in at run time. Copying the host's file into the scratch rootfs fixed it. That was a problem with my test setup, not with the image.
- **Container checks** (amd64, port published):
  - Docker's `HEALTHCHECK` reported `healthy` after about 8 s.
  - `/plan` returned 200.
  - Idle memory per `docker stats` was 37 MiB with the catalogue loaded but not yet touched.
  - `docker stop` took 0.18 s and the container exited with code 0. `main.ts`'s SIGTERM handler works as PID 1, so `init: true` is optional now that there are no Chromium child processes.

## Base image

| Option | Facts | Trade-offs |
|---|---|---|
| **`node:24-bookworm-slim`** | Tested (amd64 and arm64). 235 MB amd64 / 254 MB arm64 uncompressed; arm64 about 81 MB gzipped. Node 24.22.0. | Same Node major as the desktop downloads (`package.ts` ships the newest 24.x) and the bundle target. Node 24 is LTS until 2028-04-30; maintenance starts 2026-10-20 ([Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)). |
| `node:22-bookworm-slim` | Tested (amd64): 232 MB, Node 22.23.3, planned the 100-card list at 475 MiB peak. | Meets `engines` (`>=22.13`). LTS ends 2027-04-30, a year earlier. The bundle is built for `node24`, so this would be the only place the bundle runs on 22. |
| `node:26-*` | Node 26 becomes LTS on 2026-10-28 (same schedule). | Not tested. Would differ from the desktop runtime. |
| `node:24-alpine` | Tested (amd64 only): 177 MB. Planned the 100-card list correctly, and peak RSS was about 10–20 % lower (559 vs 678 MiB after 6 runs; 815 vs 930 MiB for 218 cards). | musl. Node lists musl on x64 as Tier 2, not Tier 1 ([Node BUILDING.md, platform list](https://github.com/nodejs/node/blob/main/BUILDING.md#platform-list)), and the Alpine images are built by the Docker Node image maintainers, not by Node's release builds. Not tested on arm64 or with live Source traffic. The savings are mostly glibc's allocator overhead. `MALLOC_ARENA_MAX=2` on bookworm saved only about 3–6 %, which is within run-to-run noise. |
| Distroless (`gcr.io/distroless/nodejs24-debian12`) | Not tested. | No shell, so a healthcheck has to call node directly (it already does below). Entrypoint differs from the official images. |

## Running it: bundle, not `tsx`

- **Bundle:** `scripts/package.ts` `stageCommon()` already produces what a container needs.
  - It runs `vite build`, then esbuild bundles `src/server/main.ts` → `src/server/main.mjs` and `src/optimiser/worker.ts` → `src/server/worker.mjs`.
  - It copies `dist/web`, `data/stores.yaml` and `node_modules/highs`, and writes a minimal `package.json`.
  - `paths.ts` reads the version from `../../package.json`, and `pool.ts` picks `worker.mjs` when it exists, so the layout works as is. Total: 4.7 MB.
- **`tsx`** (what the earlier assessment sketched): it needs the full dev install (113 MB of `node_modules`) and compiles TypeScript at every start. It would also run differently from what the release smoke test checks.
- **Getting the bundle into the image without touching packaging.** `stageCommon()` isn't exported, and `package.ts` runs `main()` as soon as it is imported. Three ways:
  1. **The Dockerfile repeats the esbuild options** (what I tested). This leaves `package.ts` untouched, but the two copies can drift apart. A comment in each file pointing at the other limits that risk.
  2. **A new `scripts/bundle.ts`** that both `package.ts` and the Dockerfile call. This is the cleanest, but it changes `package.ts`, a file the owner wants left alone. Behaviour would stay the same and the smoke test would prove it, but it is still a change to that file.
  3. **The image job downloads the Linux tarball** the `build` job already made (the `downloads` artifact) and copies everything except `runtime/`. The image then holds exactly the bytes that `smoke-linux` tested. But a local `docker build .` won't work without the tarball, and the job depends on `build`.

## Environment and the code changes they need

| Variable | Exists today? | Value in the image | Notes |
|---|---|---|---|
| `MAGICFINDER_DATA_DIR` | Yes (`paths.ts`) | `/data` | Holds `catalogue.sqlite` (54 MB), `search-cache.sqlite` (up to about 7 MB seen), `settings.json`, and when the CardKingdom comparison is on, `cardkingdom-prices.json` (22 MB) and `exchange-rate.json`. |
| `MAGICFINDER_PORT` | Yes (`main.ts`) | `5180` | Setting it **already skips `choosePort()` and the second-launch handover** (`if (!dev && !process.env.MAGICFINDER_PORT)`). No change needed. |
| `MAGICFINDER_NO_OPEN` | Yes (`main.ts`) | `1` | Skips `xdg-open`. Even unset, the spawn error is swallowed. |
| `MAGICFINDER_HOST` | **No** | `0.0.0.0` | `main.ts` hard-codes `hostname: '127.0.0.1'`. Inside a container that is the container's own loopback, so neither a published port nor a cloudflared container on the same compose network can reach the app. Needs a one-line change that defaults to `127.0.0.1`. The startup message still says `localhost`, which is cosmetic. |
| `MAGICFINDER_HOSTED` | **No** | `1` | The switch for everything hosted-only: the multi-user behaviour from the sibling tickets, the update notice below, and the solver count. The desktop never sets it. |
| `MAGICFINDER_SOLVERS` | **No** (proposed) | e.g. `2` | `new SolverPool()` takes a size but `main.ts` passes none. Today the only way to change it without code is a compose `cpuset` (for example `"0-2"` gives 2 solvers), which also limits the CPUs everything else in the app may use. |
| `NODE_OPTIONS` | Node's own | `--max-old-space-size=384` (optional) | See Memory: it barely changes the peak. |

The hosted switch and the host switch could be one variable, with hosted mode implying `0.0.0.0`. Keeping them separate lets someone run hosted mode on bare metal behind a local proxy while staying on loopback.

## Memory

All peaks are VmRSS of the MagicFinder process. That includes its solver worker threads, because they share the process. The Sources were served from cache, with 3 solvers (the DS423's default) unless noted. "×6" means six runs in a row of the same list in one process.

| Scenario | Solvers | Peak RSS |
|---|---|---|
| Idle, catalogue loaded (after first use) | – | 87–102 MiB |
| Idle, CardKingdom prices also loaded (read at startup whenever the file exists) | – | 155 MiB |
| First boot: download and build the catalogue (100,212 printings, about 7 s here) | – | 248 MiB |
| 100 cards, first run | 1 / 2 / 3 / 4 | 351 / 394 / 455–489 / 471 MiB |
| 100 cards ×6 | 1 (with `MALLOC_ARENA_MAX=2`) / 2 / 3 | 488 / 592 / 678 MiB |
| 100 cards, first run, CardKingdom comparison on | 3 | 664 MiB |
| 100 cards, then the daily CardKingdom refresh (one real download) | 3 | 877 MiB (the refresh adds about 375 MiB, then falls back to about 480) |
| 218 cards, first run | 1 / 3 | 423 / 676–725 MiB |
| 218 cards ×4 or ×6 | 1 (×4) / 1 (×6, arena 2) / 2 (×6, arena 2) / 3 (×6) | 472 / 620 / 739 / 909–930 MiB |

What this shows:

- **Solvers are the main lever.** Each extra solver adds roughly 50–100 MiB on a 100-card list, and more on bigger lists.
  - `milp.ts` keeps one HiGHS WebAssembly instance per worker for the worker's whole life (`highsPromise ??= highsLoader()`).
  - A WebAssembly memory grows to fit the biggest problem it has solved and never shrinks. That fits the climb over repeated runs and then the plateau.
- **The Node heap limit is not the lever.** On the 218-card list with 3 solvers, a 160 MB, 256 MB or default old-space limit gave 613, 706 and 685 MiB, all within noise, and none of them failed. Most of the memory sits outside the main thread's JS heap: WebAssembly memory, worker heaps, and SQLite and malloc. I didn't check whether `--max-old-space-size` also caps each worker's heap. A cap of 384 is a guard rail against a runaway main-thread heap, nothing more.
- **Hard limits:** `--memory 512m` OOM-killed the 218-card run with 3 solvers. `--memory 384m` OOM-killed the 100-card run with 3 solvers. With 1 solver, the 100-card run fit in 384m (peak 338 MiB). When the kernel kills the container, `restart: unless-stopped` brings it back, but the search in progress is lost.
- **Things that can stack up:**
  - the daily catalogue rebuild (up to about +160 MiB over idle)
  - the daily CardKingdom refresh (about +375 MiB)
  - a plan in progress

  The catalogue rebuild is checked hourly and starts once the catalogue is a day old. The CardKingdom refresh starts on the first plan after its day is up.
- **Not measured:**
  - two or three friends planning at once. Today `RunManager` cancels the previous run; the ticket "How do friends' searches run side by side in hosted mode?" decides this.
  - the real speed of the Cortex-A55. See "Not verified".

Options for a 2 GB NAS shared with Immich and DSM (for the owner to pick):

| Option | Solvers | `mem_limit` | Expect | Cost |
|---|---|---|---|---|
| A | 1 | 768m | Peak about 340–620 MiB, plus about 375 MiB for a moment during a CardKingdom refresh. Without CardKingdom, about 620 worst seen. | Rungs solve one after another, so the Ladder fills in slowest. On a slow CPU, more rungs may hit the 10 s "no plan in time". |
| B | 2 | 1g | Peak about 400–740 MiB; with a CardKingdom refresh on top, about 1.1 GB is possible. | Middle ground. |
| C | 3 (today's default on 4 cores) | 1.25g | Peak about 450–930 MiB; with a CardKingdom refresh, about 1.3 GB. | Fastest Ladder, but the most memory taken from Immich. |

A code option that cuts the plateau, worth considering in the build ticket: in hosted mode, **end idle solver workers** after a few minutes. That frees their WebAssembly memory, and the next plan spawns them again, paying about a second to compile HiGHS.

## Proposed Dockerfile

Tested as written, except that the line marked STAND-IN is replaced by the real `MAGICFINDER_HOST` code change. A matching `.dockerignore`:

```
node_modules
dist
release
.git
.claude
.magicfinder-data
```

```dockerfile
# syntax=docker/dockerfile:1
# MagicFinder hosted image. The build stage runs on the builder's own CPU (no QEMU): the bundle is plain JavaScript
# plus highs' WebAssembly, so it is the same for amd64 and arm64. The runtime stage has no RUN steps, so building the
# arm64 variant needs no emulation either.

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same esbuild options as scripts/package.ts stageCommon(): main.mjs and worker.mjs side by side in src/server.
RUN npx vite build --logLevel warn \
 && B="import { createRequire as __mfRequire } from 'node:module'; const require = __mfRequire(import.meta.url);" \
 && for e in src/server/main.ts:main.mjs src/optimiser/worker.ts:worker.mjs; do \
      npx esbuild "${e%%:*}" --bundle --platform=node --format=esm --target=node24 --external:highs \
        "--banner:js=$B" --log-level=warning --outfile="/out/src/server/${e##*:}"; \
    done \
 && mkdir -p /out/dist /out/data /out/node_modules /empty \
 && cp -r dist/web /out/dist/ && cp data/stores.yaml /out/data/ && cp -r node_modules/highs /out/node_modules/ \
 && node -e "const p=require('./package.json');console.log(JSON.stringify({name:p.name,version:p.version,private:true,type:'module'}))" > /out/package.json
# STAND-IN for the real code change (MAGICFINDER_HOST in main.ts); only here so the research build could serve.
RUN sed -i 's/hostname: "127.0.0.1"/hostname: process.env.MAGICFINDER_HOST ?? "127.0.0.1"/' /out/src/server/main.mjs

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/Ryski112/MagicFinder
ENV NODE_ENV=production \
    MAGICFINDER_HOSTED=1 \
    MAGICFINDER_HOST=0.0.0.0 \
    MAGICFINDER_PORT=5180 \
    MAGICFINDER_DATA_DIR=/data \
    MAGICFINDER_NO_OPEN=1 \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=build /out/ /app/
# An empty /data owned by the image's "node" user (uid 1000), without a RUN step.
COPY --from=build --chown=1000:1000 /empty /data
USER 1000:1000
VOLUME /data
EXPOSE 5180
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MAGICFINDER_PORT||5180)+'/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.mjs"]
```

Notes:

- **The `LABEL` was added after testing.** It links the GHCR package to the repo when the image is pushed from somewhere other than the repo's own workflow ([GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
- **The healthcheck starts a short-lived `node` once a minute.** That costs about 40 MB and a fraction of a CPU-second for a moment on the NAS. The interval can be longer, or the healthcheck can move to compose.
- **Uid 1000 is only a default.** On Synology the compose `user:` overrides it (below).

## Proposed compose.yaml (Synology Container Manager Project)

```yaml
# /volume1/docker/magicfinder/compose.yaml. Container Manager → Project → Create, path /volume1/docker/magicfinder.
services:
  magicfinder:
    image: ghcr.io/ryski112/magicfinder:latest   # or pin, e.g. :0.3 (minor) or :0.3.0
    container_name: magicfinder
    restart: unless-stopped
    user: "1026:100"          # the DSM user that owns /volume1/docker/magicfinder; find it with `id <user>` over SSH
    environment:
      MAGICFINDER_SOLVERS: "2"   # proposed variable; until it exists, `cpuset: "0-2"` gives 2 solvers
    volumes:
      - /volume1/docker/magicfinder/data:/data
    mem_limit: 1g
    # ports:                    # only for LAN access; the cloudflared container reaches magicfinder:5180 without it
    #   - "5180:5180"
  # cloudflared goes here; see "Can Cloudflare Tunnel + Access carry MagicFinder's live streams, and what does Access give the app?"
```

## Publishing to GHCR

- **Build without QEMU.** With the Dockerfile above, `docker/setup-qemu-action` isn't needed. buildx only has to pull the arm64 `node:24-bookworm-slim` and copy files into it. I checked this locally. `ubuntu-latest` plus `docker/setup-buildx-action` is enough.
- **Additive, two ways:**
  1. **A new file `.github/workflows/docker.yml`** on `push: tags: ['v*']`. `release.yml` is untouched. The image is published even if a desktop smoke test fails. You could add a manual run with `push: false` as a build check.
  2. **A new `image` job in `release.yml`** with `needs: [smoke-linux, smoke-windows]` and its own `permissions:`. Existing jobs stay byte-identical, but the file changes, and the image only ships once the desktop downloads pass.
     - **The workflow's top-level `permissions: contents: write` would replace the defaults.** A job-level `permissions:` block (`contents: read`, `packages: write`) sets that job's token.
     - **The `pull_request` trigger also runs every job.** Guard the push with `if:`/`push: ${{ startsWith(github.ref, 'refs/tags/') }}`, and expect the image build to add a few minutes to PRs that touch those paths.
- **Permissions:** `packages: write` for `GITHUB_TOKEN`, as in GitHub's example ([Publishing and installing a package with GitHub Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions)).
- **Tags:** `docker/metadata-action` with `type=semver,pattern={{version}}` and `type=semver,pattern={{major}}.{{minor}}`. With its default `flavor: latest=auto`, pushing `v1.2.3` gives `1.2.3`, `1.2` and `latest`. It also lowercases the image name ([metadata-action README](https://github.com/docker/metadata-action/blob/master/README.md)), so `Ryski112/MagicFinder` becomes `ghcr.io/ryski112/magicfinder`.
- **Action versions** (latest releases, checked 2026-10-19 via the GitHub API): `docker/setup-buildx-action` v4.4.1, `docker/login-action` v4.6.0, `docker/metadata-action` v6.2.0, `docker/build-push-action` v7.4.0 (and `docker/setup-qemu-action` v4.4.0 if ever needed). GitHub recommends pinning third-party actions to a commit SHA. `release.yml` currently uses tags (`@v4`).

Sketch of option 1 (not run):

```yaml
name: Docker image
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: read
  packages: write
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Tag matches package.json
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          want="v$(node -p 'require("./package.json").version')"
          [ "$GITHUB_REF_NAME" = "$want" ] || { echo "Tag $GITHUB_REF_NAME doesn't match package.json ($want)"; exit 1; }
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        if: startsWith(github.ref, 'refs/tags/')
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
      - uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: ${{ startsWith(github.ref, 'refs/tags/') }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Package visibility

- **The repo is public** (`gh repo view`: `PUBLIC`).
- **GitHub's docs disagree about a new package's visibility.**
  - The access-control page says: "When you first publish a package, the default visibility is private". It also says a linked package inherits the repo's access permissions "but not the visibility" ([Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)).
  - The Actions page says a package created by a workflow's `GITHUB_TOKEN` "inherits the visibility and permissions model of the repository".
  - Plan for private and check after the first push. If needed, make it public once: package settings → Danger Zone → Change visibility. GitHub warns that a public package can't be made private again.
- **A public image can be pulled without signing in** ("You can also access public container images anonymously", Container registry docs). The NAS then needs no GHCR token.
- **The private alternative:** a personal access token with `read:packages`, entered in Container Manager's registry settings. The code is public anyway, so a public image gives nothing away.

## How a new version reaches the NAS

| Way | How | Trade-offs |
|---|---|---|
| **Container Manager, Project: Stop → Build** | Right-click the Project → Stop, then Build. Build pulls the image again and recreates the container; the data folder stays. (Steps from [mariushosting](https://mariushosting.com/synology-how-to-update-containers-in-container-manager/); Synology's own help page didn't load for me.) | Manual, two clicks, a few seconds of downtime. The image tag in compose decides what you get: `:latest` gives every release, `:0.3` only fixes within 0.3. |
| Container Manager "Update available" on the Image/Overview page | One-click update for images tagged `:latest`. The same guide says the notice can take about 12 hours to appear. | Not documented for containers created by a Project. A forum thread notes that resetting a container could remove it from its Project, which a later Container Manager fixed. |
| SSH: `docker compose pull && docker compose up -d` in `/volume1/docker/magicfinder` | Standard compose. | Needs SSH and `sudo`; the owner is comfortable with that, but it isn't a click. |
| Watchtower | The original `containrrr/watchtower` is **archived** (archived on GitHub; last release v1.7.1, 2023-11). A maintained fork, `nicholas-fedor/watchtower`, released v1.23.1 on 2026-10-13. Runs as a container with the Docker socket, checks on a schedule, pulls and recreates. Can be limited to labelled containers. | Fully automatic: a bad release reaches friends without the owner looking. It needs the Docker socket, which means root-equivalent access to the NAS. It is a third-party project. Untested with DSM's Docker. |

## The update notice in hosted mode

- **How it works today:**
  - `updates.ts` asks GitHub for the latest release once a day and stores the result in the install-wide `settings.json`.
  - `/api/status` returns `update` with the release page URL. The banner tells the buyer to download the new version.
  - Dismissing it is also install-wide.
- **In hosted mode this is wrong in two ways.** Friends can't update the NAS. And one friend dismissing the banner would hide it from everyone.
- **Options:**
  1. **Turn it off in hosted mode** (`update: () => null`). The owner learns about releases from GitHub, or from Container Manager's "Update available".
  2. **Keep the check, but log it.** Print "MagicFinder X.Y.Z is available: update the image" to the container log, which shows in Container Manager. Nothing appears in the UI.
  3. **Show it only to the owner.** That needs to know who the owner is, which waits for "Does the owner need controls friends shouldn't have?" and "Can Cloudflare Tunnel + Access carry MagicFinder's live streams, and what does Access give the app?".
  4. **Change the wording** to "A new version is available; the NAS owner can update it". Every friend sees it, and dismissing it stays per browser once settings move to the browser ("Which settings belong to each friend and which to the server?").
- **Desktop unchanged:** every option is gated on `MAGICFINDER_HOSTED`.

## Synology specifics

- **Paths:**
  - Compose Projects live in a folder you choose, conventionally under the `docker` shared folder: `/volume1/docker/magicfinder/compose.yaml` and `/volume1/docker/magicfinder/data`.
  - Keep `data` on the NAS's own volume, not a mounted SMB/NFS share. SQLite relies on file locks ([SQLite: how to corrupt](https://www.sqlite.org/howtocorrupt.html#_filesystems_with_broken_or_missing_lock_implementations)), as the earlier assessment noted.
- **User and permissions:**
  - The app doesn't need root. Create the `data` folder in File Station as the owner's DSM user and set `user: "<uid>:<gid>"` in compose. DSM's first user is usually uid 1026 and group `users` is 100; check with `id` over SSH.
  - `PUID`/`PGID` is a linuxserver.io convention. It needs an entrypoint script that runs as root, changes ownership and drops privileges, which this image doesn't have. `user:` does the same job without it.
  - With a named volume instead of a bind mount, the image's `/data` (owned by 1000:1000) works as is.
- **Healthcheck:** built into the image (`/api/status`). Container Manager shows the health state. `/api/status` answers as soon as the server listens, even while the first catalogue download is still running (`catalogue.ready: false`), so "healthy" means the server is up, not that the catalogue is ready.
- **Ports:** not needed when only cloudflared reaches the app over the compose network. Publish `5180` only for LAN use. The API has no login, so don't port-forward it.
- **Memory limit:** `mem_limit` in compose is the hard cap (see Memory for sizes). I didn't verify whether DSM's kernel honours swap limits; `docker run` warns on kernels that don't.
- **First start:** downloads the Scryfall bulk file (about 80 MB) and builds the catalogue. That took about 7 s here and will take noticeably longer on the A55. Searches answer "The card list is still downloading" until then.

## Not verified

- **Real DS423 hardware:**
  - Speed: under qemu emulation (much slower than real hardware), rungs k1–k3 of the 100-card list hit the 10 s limit. On native amd64, the whole Ladder took about 2 s. Where the A55 falls between those is unknown. Rungs that run out of time still show the best plan found so far.
  - Memory: measured on amd64. arm64 should be close, since it is the same Node, the same WebAssembly and the same data, but it wasn't measured. qemu-user's memory figures aren't representative.
  - Container Manager's behaviour: the Project Build re-pull, the "Update available" notice, `user:` and `mem_limit` in Container Manager's compose.
- **Running the arm64 image as a container:** I ran its files under user-mode qemu, not as a container, because that needs an arm64 handler registered with the kernel.
- **The GitHub Actions workflow and the GHCR push:** not run, and nothing was published. Which of the two GitHub doc statements on visibility applies is unresolved.
- **Alpine:** not tested on arm64 or with live Source traffic.
- **Distroless and Node 26:** not tested.
- **Several friends planning at once:** not measured (depends on "How do friends' searches run side by side in hosted mode?").
- **Watchtower fork:** not tested on DSM.
- **`--max-old-space-size` and worker heaps:** I didn't check whether it limits worker threads' heaps.

## Sources

- Code: `src/server/main.ts`, `paths.ts`, `instance.ts`, `updates.ts`, `app.ts`, `runs.ts`, `searchCache.ts`, `cardKingdom.ts`, `src/optimiser/pool.ts`, `milp.ts`, `worker.ts`, `src/catalogue/updater.ts`, `scripts/package.ts`, `scripts/smoke-package.mjs`, `.github/workflows/release.yml`, `package.json` (all at `9d217b1`).
- [Node.js release schedule (schedule.json)](https://github.com/nodejs/Release/blob/main/schedule.json); [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json) for current versions; [Node BUILDING.md platform list](https://github.com/nodejs/node/blob/main/BUILDING.md#platform-list).
- [GitHub: Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility); [GitHub: Publishing and installing a package with GitHub Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions); [GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
- [docker/metadata-action README](https://github.com/docker/metadata-action/blob/master/README.md); action release versions and Watchtower repository status from the GitHub API (`gh api repos/<owner>/<repo>/releases/latest`, `.archived`).
- [mariushosting: How to update containers in Container Manager](https://mariushosting.com/synology-how-to-update-containers-in-container-manager/) (third-party; Synology's Knowledge Center page for Projects didn't render without JavaScript).
- [SQLite: How to corrupt an SQLite database file](https://www.sqlite.org/howtocorrupt.html#_filesystems_with_broken_or_missing_lock_implementations).
- Measurements: my own runs on 2026-10-19, described under "What was tested, and how".
