# Packaging MagicFinder as a double-click download (Windows + Linux)

Research for [#20](https://github.com/Ryski112/MagicFinder/issues/20), 2026-10-17. Feeds the decision in [#23](https://github.com/Ryski112/MagicFinder/issues/23).

Constraints: no Electron or Tauri. The UI stays in the user's own browser. Windows and Linux. Unsigned builds are fine. Friends are non-technical: download, extract, double-click.

## Recommendation

**Ship a portable Node runtime next to a bundled build of the app, in a zip (Windows) and a tarball (Linux), with a `MagicFinder.cmd` / `MagicFinder.sh` launcher. Build both from one `ubuntu-latest` GitHub Action.** I built and ran this locally (see [What I tried](#what-i-tried)). Node, `node:sqlite`, worker threads, highs WASM and playwright-core all ran unchanged, on Linux and under Wine on the Windows `node.exe`. It needs no app refactor beyond one Windows path bug fix. The download is about 41 MB (Windows) or 33 MB (Linux).

Node SEA is the runner-up. It does work, but it costs a real refactor: CommonJS main on Node 24, workers from strings, WASM through `instantiateWasm`, and playwright-core kept outside the binary. It also leaves an **invalid** Authenticode signature, so SmartScreen warns harder. Bun, Deno and pkg add risk without a benefit we need.

**Must-fix found while testing (affects today's `start.bat` too):** `src/server/main.ts` builds `webDir` with `new URL(...).pathname`. On Windows that gives `/C:/…/dist/web/`, so `serveStatic` finds nothing and the UI returns **404**. The API still works. Reproduced under Wine with `node.exe` v24.22.0. Fixed and verified by `fileURLToPath(new URL('../../dist/web/', import.meta.url))` with `root: webDir` and `path: join(webDir, 'index.html')`, dropping the `.replace(process.cwd(), '.')` calls.

## Comparison

| | **Portable Node + zip/tarball** (recommended) | **Node SEA** | **Bun `--compile`** | **Deno `compile`** | **yao-pkg** |
|---|---|---|---|---|---|
| Download (x64) | **Measured:** Win zip 41 MB (108 MB unpacked); Linux tar.xz 33 MB, tar.gz 50 MB (139 MB unpacked) | **Measured:** exe 98 MB, ELF 131 MB raw; about 24 MB / 30 MB with xz, about 40 MB zipped. Plus playwright-core alongside | Not measured (Bun calls its binary "still way too big" [B1]) | Not measured | Similar to SEA (stock Node in SEA mode) |
| `node:sqlite` | Yes (tested) | Yes (tested) | Docs: "Fully implemented" [B2] | Docs: added in Deno 2.2 [D2] | Stock Node in SEA mode, so as SEA |
| Worker threads (`new Worker(new URL('./worker.ts'))`) | Yes, after bundling to `worker.mjs` (tested) | Only from a code string (`eval: true`) or a file on disk. A worker can't load a file embedded in the exe. Tested with eval | List the worker as an extra entrypoint [B1] | Static imports auto-included, otherwise `--include` [D1] | Docs list worker threads as supported [P1] |
| highs WASM | Yes, unchanged (tested) | Embed as an asset, pass via `instantiateWasm`. This highs build ignores `wasmBinary` (tested) | `with { type: "file" }` [B1] | Not documented for compile | Asset handling via pkg config |
| playwright-core + user's Chrome | Yes (tested). The Chromium fallback works because `process.execPath` is a real `node` | playwright-core must stay on disk. The fallback breaks, because `process.execPath` is the app itself and `spawn(execPath, [cli, 'install'])` would re-run MagicFinder | Unverified. A Bun issue reports `chromium.launch` timing out [B3] | Unverified | As SEA |
| Code changes needed | Bundle step, plus the Windows path fix | CJS main on Node 24 (`mainFormat: "module"` only in Node 25.5+/26 [N1]), no `import.meta.url`, worker/WASM/Playwright rework | Port to Bun runtime semantics | Port to Deno semantics | As SEA |
| SmartScreen (unsigned) | `node.exe` is the official OpenJS-signed binary (SHA-256 checked against `SHASUMS256.txt`). Only the `.cmd` is ours | New hash. Signature is broken by injection [N1], so no reputation | New unsigned exe | New unsigned exe | New unsigned exe |
| Build both OSes from Linux | Yes: download both Node archives, no compiling | Yes, with `useCodeCache`/`useSnapshot` false [N1] (tested: built .exe ran under Wine) | Yes, `--target=bun-windows-x64` [B1] | Yes, "regardless of the host platform" [D1] | SEA mode yes; standard mode "broken on Node 22" [P1] |
| Later Docker image | No conflict: the same bundle runs on `node:24-slim` | Docker would use the bundle, not the SEA | Separate runtime | Separate runtime | n/a |
| Maturity | Plain Node | Stability 1.1 "Active development"; VFS 1.0 "Early development" (26.9+) [N1] | Production runtime, different from Node | Node compat layer, partial for `worker_threads` [D2] | Single maintainer project, recommends SEA mode [P1] |

## Option notes

### Portable Node + bundled app (recommended)

- **Build step:** `vite build`, then esbuild `src/server/main.ts` and `src/optimiser/worker.ts` to `src/server/main.mjs` / `worker.mjs` (ESM, `platform=node`). Keep `highs` and `playwright-core` external and copy those two packages (18 MB) into `node_modules/`. Rewrite `'./worker.ts'` to `'./worker.mjs'`. For a real build, read the worker path from a build-time define or try `.mjs` first. You also need a `createRequire` banner: without it, bundled `yaml` fails with *Dynamic require of "process" is not supported*.
- **Layout:** `package.json`, `data/stores.yaml`, `dist/web/`, `src/server/{main,worker}.mjs`, `node_modules/{highs,playwright-core}`, `runtime/node.exe` (Windows) or `runtime/bin/node` (Linux), and the launcher. Only the `node` binary from the official archive is needed; drop npm.
- **Launcher:** a `.cmd` that does `cd /d "%~dp0"` and runs `runtime\node.exe src\server\main.mjs`. The console window doubles as the "close this to stop" UI that the app already prints. Avoid a `.vbs` "hidden window" launcher: Microsoft is phasing out VBScript, and a hidden server gives friends no way to stop it.
- **Node version:** bundle Node 24 LTS (v24.22.0 on 2026-10-17). Node 26 is "Current" [N2]. `engines` already allows ≥22.13.

### Node single executable applications (SEA)

- Node 24 docs: SEA "currently only supports running a single embedded script using the CommonJS module system". `--build-sea` and `mainFormat: "module"` arrive in v25.5.0 / 26 [N1]. The injected script can `require` only built-ins unless you call `createRequire` [N1]. Assets go through `sea.getAsset()` / `getRawAsset()` [N1]. The docs say nothing about workers or WASM. In my probe, both worked only through the workarounds above.
- `useVfs` (Node 26.9+, stability 1.0) would let `require`/`node_modules` resolve inside the binary [N1]. It may make SEA viable later, but it is too new to rely on now.
- Windows: the docs say an unsigned SEA "is still runnable" and suggest `signtool remove /s` before injecting [N1]. postject leaves Node's original certificate table in place (I checked: same offset and size), so the signature is now invalid.

### Bun / Deno compile

Both cross-compile to Windows and Linux from one host [B1][D1], and both document `node:sqlite` [B2][D2]. Neither is Node: Deno lists `node:worker_threads` as partially supported [D2]. Playwright on Bun has an open launch-timeout report [B3]. Not tried here (neither runtime is installed). Adopting either means testing the whole app on a second runtime for no gain over the zip.

### pkg-style (yao-pkg)

Standard mode runs a patched Node from `pkg-fetch`, and cross-compile is "broken on Node 22". The project itself recommends its SEA mode, which uses stock Node, for new projects [P1]. So it is SEA with a wrapper.

## Windows: SmartScreen and antivirus (unsigned)

- SmartScreen does reputation checks on downloaded programs "and the digital signature used to sign a file"; items with "no reputation" get a warning [W1].
- **Zip + `.cmd`:** the file the friend opens is a script, not a new exe. Windows typically shows its "Open File – Security Warning" (Run / Cancel) for script files from the internet. It then starts the official, signed `node.exe`. This is lower friction than an unknown exe, though not warning-free. Telling friends to use **"Extract All"** (not running from inside the zip) avoids the app running from a temp folder.
- **SEA / Bun / Deno / pkg exe:** a brand-new unsigned exe gets the "Windows protected your PC" screen, where the friend clicks More info → Run anyway. Single-file packed Node/Bun binaries are often flagged heuristically by antivirus. That is widely reported, but I have no primary source and did not test it.
- The only real fix for any option is code signing (e.g. Azure Trusted Signing; not researched here). That is out of scope because unsigned is acceptable.

## Linux: tarball vs AppImage

- **Tarball (`.tar.gz`/`.tar.xz`)** keeps the executable bits, needs nothing installed, and is what the prototype used. Caveat: many file managers open a `.sh` in a text editor on double-click instead of running it. Plan on a short "right-click → Run as a Program, or `./MagicFinder.sh` in a terminal" instruction. A `.desktop` file has the same "Allow launching" trust step.
- **AppImage** is a single file, but it needs FUSE 2. Ubuntu ≥22.04 ships fuse3 by default, so friends must `sudo apt install libfuse2` (`libfuse2t64` on 24.04) [A1]. It also needs `chmod +x` after download. That is more friction than a tarball for this audience, and it adds a build tool.

## Hosting the downloads (repo is private)

- **Private repo releases:** no. "Anyone with read access to a repository can view and compare releases" [G1]. Friends without access get a 404, and the API needs a token, which must never be shipped in the app.
- **Options:**
  1. Make the repo public. This is the simplest, and Actions on standard runners become free [G3].
  2. Keep code private and add a **public releases-only repo** (e.g. `Ryski112/MagicFinder-releases`). CI in the private repo runs `gh release create -R Ryski112/MagicFinder-releases …` with a fine-grained token scoped to that repo (Contents: write). Friends get a stable link: `https://github.com/Ryski112/MagicFinder-releases/releases/latest/download/MagicFinder-windows-x64.zip` [G4].
  3. Other hosts, such as a cloud bucket or a Drive/Dropbox share link. These work for downloads but give no stable "latest" API for update checks. GitHub Pages needs a public repo on GitHub Free [G5].
- **CI cost:** both builds run on `ubuntu-latest`, with no Windows runner. A private repo on GitHub Free gets 2,000 free minutes a month [G3], far more than one short job per release needs.

## In-app "update available" notice

- On startup (and daily, alongside the catalogue refresh), call `GET https://api.github.com/repos/<owner>/<public-repo>/releases/latest`. It returns the newest non-draft, non-prerelease release [G2]. Compare `tag_name` (e.g. `v0.2.0`) with `package.json` `version`, which the server already reads, and expose it on the existing `/api` version payload. The UI then shows a banner linking to `…/releases/latest`.
- This works unauthenticated only for a public repo. The limit is 60 requests/hour per IP [G6], which is ample for once a day. Fail silently when offline. Send the existing `USER_AGENT`.
- Alternative with no API: publish a small `latest.json` as a release asset and fetch `…/releases/latest/download/latest.json`.
- Don't self-update. Just link to the download. Settings live in the user data folder (`dataDir()`), so extracting a new version over or beside the old one keeps settings, cache and catalogue.

## Docker (later, #21)

None of this blocks a Docker image. The zip approach produces a plain `main.mjs` + `worker.mjs` + `dist/web` tree, which is exactly what a `node:24-slim` image would copy. The server currently binds `127.0.0.1` and tries to open a browser. Docker will need a host override (e.g. `MAGICFINDER_HOST=0.0.0.0`) plus the existing `MAGICFINDER_NO_OPEN=1`, and a Chromium in the image for MtgSingles.

## What I tried

All in a scratch directory, nothing committed. Official archives `node-v24.22.0-linux-x64.tar.xz` and `node-v24.22.0-win-x64.zip`, checked against `SHASUMS256.txt`.

1. **Zip/tarball:** esbuild-bundled server and worker plus the shipped `highs`/`playwright-core`.
   - Linux: the launcher started the server. `/`, deep links and `/api/settings` returned 200. The catalogue downloaded into `catalogue.sqlite` / `search-cache.sqlite` (`node:sqlite`). A worker solved a two-Store problem with highs (`optimal`). playwright-core launched the installed Chromium 154 headless.
   - Windows `node.exe` under Wine: the worker and highs solve succeeded and the server started. The UI was **404** until the `webDir` fix, then 200.
2. **SEA (Node 24.22.0, `--experimental-sea-config` + `postject@1.0.0-alpha.6`), built on Linux for both OSes:** a probe used `node:sqlite`, solved with highs on the main thread (WASM from `sea.getAsset` via `instantiateWasm`), and solved in a worker started from an embedded code string (`eval: true`). Both the ELF and the cross-built `.exe` (under Wine) passed. Passing `wasmBinary` instead failed with ENOENT for `highs.wasm` next to the exe.

Not tried: Bun, Deno, yao-pkg, AppImage, real Windows SmartScreen and antivirus behaviour.

## Sources

- [N1] Node.js docs, Single executable applications: [v26](https://nodejs.org/api/single-executable-applications.html), [v24](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
- [N2] [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [B1] [Bun: single-file executables](https://bun.com/docs/bundler/executables)
- [B2] [Bun: Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)
- [B3] [oven-sh/bun#10120](https://github.com/oven-sh/bun/issues/10120) (Playwright launch timeout under Bun)
- [D1] [Deno: `deno compile`](https://docs.deno.com/runtime/reference/cli/compile/)
- [D2] [Deno: Node APIs](https://docs.deno.com/runtime/reference/node_apis/)
- [P1] [yao-pkg: SEA vs Standard](https://yao-pkg.github.io/pkg/guide/sea-vs-standard) (v6.23.0, 2026-09-29)
- [W1] [Microsoft Defender SmartScreen overview](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)
- [A1] [AppImage docs: FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
- [G1] [GitHub: About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [G2] [GitHub REST: Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- [G3] [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [G4] [GitHub: Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)
- [G5] [What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [G6] [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
