#!/usr/bin/env bash
# Build the kind image with the compile steps in throwaway containers and the
# repo/caches bind-mounted from the HOST: node_modules, the npm cache, the
# Angular build cache and the Go build/module caches all live under the repo
# (surviving between runs — they double as incremental caches), and the docker
# VM disk only ever holds the final ~120MB image. Replaces
# `docker build -f Dockerfile.kind`, whose in-VM buildkit cache (~6GB per
# build) kept filling the VM disk.
#
#   ./build-kind.sh ng22-33            → k8s-dashboard-plugins:ng22-33
set -euo pipefail

TAG=${1:?usage: build-kind.sh <image-tag>}
REPO="$(cd "$(dirname "$0")" && pwd)"
CACHE="$REPO/.build-cache"
OUT="$REPO/dist-kind"
mkdir -p "$CACHE/npm" "$CACHE/go-build" "$CACHE/go-mod" "$OUT"

# version.ts is normally generated via git-describe by the npm postinstall;
# write the same static one Dockerfile.kind used.
printf "%s\n" \
  "import {VersionInfo} from '@api/root.ui';" \
  "export const version: VersionInfo = {dirty:false,raw:'v2.7.0-plugins',hash:'pre-split',distance:0,tag:'v2.7.0',semver:{raw:'2.7.0',major:2,minor:7,patch:0,prerelease:[],build:[],version:'2.7.0',loose:false,options:{includePrerelease:false,loose:false}},suffix:'',semverString:'2.7.0',packageVersion:'2.7.0'};" \
  > "$REPO/src/app/frontend/environments/version.ts"
printf '{"version":"v2.7.0","defaultLocale":"en","supportedLocales":["en"],"translations":["en"]}' \
  > "$OUT/locale_conf.json"

# ---- frontend (node 22): npm ci only when the lockfile changed ----
STAMP="$CACHE/package-lock.stamp"
if [ ! -d "$REPO/node_modules" ] || ! cmp -s "$REPO/package-lock.json" "$STAMP"; then
  docker run --rm -v "$REPO":/src -v "$CACHE/npm":/root/.npm -w /src node:22-bookworm \
    npm ci --no-audit --no-fund --ignore-scripts --legacy-peer-deps
  cp "$REPO/package-lock.json" "$STAMP"
fi
docker run --rm -v "$REPO":/src -w /src node:22-bookworm \
  npx ng build --configuration production --localize=false --output-path=dist-kind/en

# ---- backend (Go): persistent build/module caches, no -a ----
docker run --rm -v "$REPO":/src -w /src \
  -v "$CACHE/go-build":/root/.cache/go-build -v "$CACHE/go-mod":/go/pkg/mod \
  -e CGO_ENABLED=0 -e GOOS=linux golang:1.26-bookworm \
  go build -ldflags "-X github.com/kubernetes/dashboard/src/app/backend/client.Version=v2.7.0-plugins" \
    -o dist-kind/dashboard ./src/app/backend

# ---- assemble ----
docker build -f "$REPO/Dockerfile.kind.prebuilt" -t "k8s-dashboard-plugins:$TAG" "$OUT"
echo "k8s-dashboard-plugins:$TAG"
