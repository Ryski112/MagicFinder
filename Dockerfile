# syntax=docker/dockerfile:1
# MagicFinder's hosted image, for the owner's NAS (see docs/hosting.md). Decided in "Which image setup, and how does
# the owner run and update it on the DS423?".
#
# It runs the same esbuild bundle as the desktop downloads. The build stage runs on the builder's own CPU (no QEMU):
# the bundle is plain JavaScript plus highs' WebAssembly, so it is the same for amd64 and arm64. The runtime stage has
# no RUN steps, so building the arm64 variant needs no emulation either.
#
#   docker build -t magicfinder .
#   docker run --rm -p 5180:5180 -v "$PWD/.magicfinder-data:/data" magicfinder

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Keep in step with stageCommon() in scripts/package.ts, which bundles the desktop downloads: the same esbuild
# options, with main.mjs and worker.mjs side by side in src/server, two folders below package.json, data/ and dist/.
# The image workflow boots the result and checks /api/status, so a drift that breaks start-up fails the build.
RUN npx vite build --logLevel warn \
 && B="import { createRequire as __mfRequire } from 'node:module'; const require = __mfRequire(import.meta.url);" \
 && for e in src/server/main.ts:main.mjs src/optimiser/worker.ts:worker.mjs; do \
      npx esbuild "${e%%:*}" --bundle --platform=node --format=esm --target=node24 --external:highs \
        "--banner:js=$B" --log-level=warning --outfile="/out/src/server/${e##*:}"; \
    done \
 && mkdir -p /out/dist /out/data /out/node_modules /empty \
 && cp -r dist/web /out/dist/ && cp data/stores.yaml /out/data/ && cp -r node_modules/highs /out/node_modules/ \
 && node -e "const p=require('./package.json');console.log(JSON.stringify({name:p.name,version:p.version,private:true,type:'module'},null,2))" > /out/package.json

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/Ryski112/MagicFinder \
      org.opencontainers.image.description="MagicFinder hosted mode: the cheapest way for NZ buyers to get Magic singles."
# MAGICFINDER_SOLVERS is left unset (the pool's default); set it in compose only if the NAS's CPU turns out tight.
ENV NODE_ENV=production \
    MAGICFINDER_HOSTED=1 \
    MAGICFINDER_HOST=0.0.0.0 \
    MAGICFINDER_PORT=5180 \
    MAGICFINDER_DATA_DIR=/data \
    MAGICFINDER_NO_OPEN=1
WORKDIR /app
COPY --from=build /out/ /app/
# An empty /data owned by the image's "node" user (uid 1000), without a RUN step. Compose's `user:` overrides the uid.
COPY --from=build --chown=1000:1000 /empty /data
USER 1000:1000
VOLUME /data
EXPOSE 5180
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MAGICFINDER_PORT||5180)+'/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.mjs"]
