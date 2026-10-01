#!/usr/bin/env bash
# deploy.sh -- ham.tcos.app: gate, lab, promote. Two explicit steps, never
# one (HEE_POLICY 17). Modeled on tcos-app's deploy.sh; drive it with
# `hee release -lab | -cut | -promote`, not by hand.
#
#   ./deploy.sh lab       gate, then wait until the lab serves main's index.html.
#                         Pushes nothing: CI publishes each main build and
#                         lab-pull installs it.
#   ./deploy.sh promote   gate the COMMITTED pages (no rebuild), deploy the
#                         ham-tcos-app Worker with the session signature on the
#                         version, verify, record a GPG-signed prod/ham-tcos-app/<v>
#
# Requires: hee on PATH, and for promote the sealed token
# via `hee cred -pass cloudflare-tcos-www -dir <dir> -exec` (see the card).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-}"
[ "$cmd" = lab ] || [ "$cmd" = promote ] || { echo "usage: $0 lab|promote" >&2; exit 1; }
PAGES=(index.html study.html callsign.html)
ASSET_DIRS=(css js data)
ASSET_FILES=(robots.txt sitemap.xml og.jpg)
HOST=ham.tcos.app
LAB_HOST=ham-app.lab.tcos.us

cd "$HERE"
if [ "$cmd" = promote ]; then
  # Prod deploys a commit that is on main; checked first so a refusal leaves
  # the tree exactly as it was.
  if [ -n "$(git status --porcelain -- "${PAGES[@]}" "${ASSET_DIRS[@]}" "${ASSET_FILES[@]}")" ]; then
    echo "❌ CRITICAL promote: uncommitted changes in what would ship -- commit, merge; prod deploys a commit" >&2; exit 2
  fi
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "❌ CRITICAL promote: HEAD $(git rev-parse --short HEAD) is not origin/main $(git rev-parse --short origin/main) -- git switch main && git pull" >&2; exit 2
  fi
  echo "=== promote: committed pages at $(git rev-parse --short HEAD) (origin/main), no rebuild ==="
fi
echo "=== gates ==="
python3 "$HERE/build.py" --check || { echo "❌ CRITICAL deploy: data/ is not what ham/pools produces -- run python3 build.py, commit, merge -- stopping" >&2; exit 2; }
hee check all "$HERE" >/dev/null 2>&1 || { echo "❌ CRITICAL deploy: hee check all fails -- stopping" >&2; exit 2; }
if grep -l -E '^(<<<<<<< |=======$|>>>>>>> )' "${PAGES[@]}" 2>/dev/null | grep -q .; then
  echo "❌ CRITICAL deploy: git conflict markers in pages -- stopping" >&2; exit 2
fi
echo "  hee check all: OK; no conflict markers"

if [ "$cmd" = lab ]; then
  # Nothing is pushed from here. CI publishes a payload for every main build
  # and lab-pull on pve installs it, so the lab can only show what is merged.
  git fetch -q origin main
  if ! git diff --quiet origin/main -- "${PAGES[@]}" "${ASSET_DIRS[@]}" "${ASSET_FILES[@]}"; then
    echo "❌ CRITICAL lab: the shipped files differ from origin/main -- the lab serves main via lab-pull; merge first, then run this to confirm" >&2; exit 2
  fi
  want="$(sha256sum index.html | cut -d' ' -f1)"
  tries="${LAB_WAIT_TRIES:-14}"
  got=""
  echo "=== lab: waiting for lab-pull to serve index.html $want (up to $((tries * 30))s) ==="
  for i in $(seq 1 "$tries"); do
    got="$(curl -s "https://$LAB_HOST/" | sha256sum | cut -d' ' -f1)"
    [ "$got" = "$want" ] && break
    [ "$i" -lt "$tries" ] && sleep 30
  done
  if [ "$got" != "$want" ]; then
    echo "❌ CRITICAL lab: https://$LAB_HOST/ is not serving this commit's index.html -- check the publish job on main, then that lab-pull has run on pve" >&2; exit 2
  fi
  printf '  %s/  %s  (matches origin/main)\n' "$LAB_HOST" "$(curl -s -o /dev/null -w '%{http_code}' "https://$LAB_HOST/")"
  echo "=== lab is current -- review https://$LAB_HOST, then hee release -cut ==="
  exit 0
fi

SIG="$(hee ver session --tag 2>/dev/null || hee ver session 2>/dev/null | awk '/sig_tag|rc_tag/{print $2; exit}')"
[ -n "$SIG" ] || { echo "❌ CRITICAL promote: no session signature from hee ver session" >&2; exit 2; }
SRC_SHA="$(git rev-parse --short HEAD)"
STAMP="${RELEASE_VERSION:-$(date -u +%Y%m%dT%H%MZ)}"
STAGE="$(mktemp -d)"; trap 'rm -rf "${STAGE:?}"' EXIT
cp "${PAGES[@]}" "${ASSET_FILES[@]}" "$STAGE/" && cp -r "${ASSET_DIRS[@]}" "$STAGE/"
# wrangler needs Node >= 20; with older Node it prints one line and exits 1,
# which the grep below would swallow.
node_major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
[ "${node_major:-0}" -ge 20 ] || { echo "❌ CRITICAL promote: Node >= 20 required, found $(node -v 2>/dev/null || echo none)" >&2; exit 2; }
# hee cred -exec injects the secret as HEE_CRED_PASS; wrangler wants CLOUDFLARE_API_TOKEN.
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${HEE_CRED_PASS:-}}"; export CLOUDFLARE_API_TOKEN
: "${CLOUDFLARE_API_TOKEN:?run via hee release -promote (hee cred -exec)}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"][0]["id"])')}"
export CLOUDFLARE_ACCOUNT_ID
echo "=== promote: ham-tcos-app worker, src=$SRC_SHA session=$SIG ==="
( cd "$STAGE" && npx --yes wrangler@4.86.0 deploy --name ham-tcos-app --assets . --compatibility-date=2026-08-15 \
    --message "hee:$SIG ham-tcos-app src=$SRC_SHA" --tag "${SIG%%_*}" 2>&1 | grep -E 'Success|rror|requires'; exit "${PIPESTATUS[0]}" ) \
  || { echo "❌ CRITICAL promote: wrangler deploy failed -- nothing verified, nothing tagged" >&2; exit 2; }
echo "=== verify prod ==="
# A fresh deploy or a new custom domain takes a few seconds to reach the edge:
# poll, do not judge the first response.
code=""; body=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/")"
  [ "$code" = 200 ] && break
  [ "$i" -lt 12 ] && sleep 10
done
body="$(curl -s "https://$HOST/")"
markers="$(printf '%s\n' "$body" | grep -c -E '^(<<<<<<< |=======$|>>>>>>> )' || true)"
printf '  /  %s markers=%s\n' "$code" "$markers"
if [ "$code" != 200 ] || [ "$markers" != 0 ]; then
  echo "❌ CRITICAL promote: prod verification failed -- fix forward or redeploy the previous commit" >&2; exit 2
fi
TAG="prod/ham-tcos-app/$STAMP"
KEYARG=(); [ -n "${HEE_SIGN_KEY:-}" ] && KEYARG=(--key "$HEE_SIGN_KEY")
hee git tag "$TAG" -m "prod promotion: $HOST
worker: ham-tcos-app
source: $SRC_SHA
session: $SIG
verified: / 200, no conflict markers" "$SRC_SHA" --yes --push "${KEYARG[@]}" \
  || { echo "⚠️ WARNING promote: deployed and verified, but the prod tag could not be created/pushed -- hee git tag $TAG -m ... $SRC_SHA --yes --push --key <ID>" >&2; }
