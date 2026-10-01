# ham-tcos-app

Org governance is canonical in `human-execution-engine`'s
`prompts/PROMPTING_RULES.md`. It is delivered to every session by the
`SessionStart` hook installed from the `dotfiles` repo:

    make claude-hooks

It is deliberately **not** `@import`-ed here: an `@import` whose path resolves
outside this repo fails silently. If the org rules are not in `/context`, the
hook is not installed.

`ham-tcos-app` is a static site, the ham study guide served at `ham.tcos.app`.
`build.py` turns `ham/pools` into `data/`; the committed pages and data are
what ships, and `deploy.sh promote` deploys them with no rebuild. After any
change under `ham/`, run `python3 build.py` and commit `data/`; CI and
`deploy.sh` refuse stale data. New shipped paths must be added to `deploy.sh`,
the CI payload and its required-member check. Never commit or push to
`main`; branch, then PR. Release only through
`hee release -lab | -cut | -promote`.

The repo is public. Nothing internal goes in it: no lab hostnames beyond what
`deploy.sh` needs, no IP addresses, no operator details, no tokens.

## Open Graph tags

Every page carries the full og set (title, description, url, image with width, height and alt, locale) plus `twitter:card` `summary_large_image`, and the og image is a 1200x630 title card from the org tile generator (`tools/meme-factory/tile/tile.py`, recipe in `og.jpg.job.json`), the same card the media pages use, with provenance and branding EXIF. `tests/test_pages.py` fails when a page lacks any of it. A new page needs the tags in the same PR.

## The call sign page

`callsign.html` (operator, 2026-10-01: the call sign page is this repo's) is a
static page whose search runs on `https://man.tcos.us/cgi-bin/callsign.cgi` --
the same CGI and protocol as the lab's, over an index the org's CI rebuilds
weekly from the FCC's ULS files. CORS there answers `https://ham.tcos.app` and
`https://ham-app.lab.tcos.us` only; requests are rate-limited (429 beyond a
burst). Holder name, city and state are the FCC's public record; they are
served by that endpoint and never stored in this repo. `js/callsign.js` and
`js/callsign-format.js` are ports of the lab page's scripts; the FCC format
rules in the latter are a copy -- change them at their source and copy again.
