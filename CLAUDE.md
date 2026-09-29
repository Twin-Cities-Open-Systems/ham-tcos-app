# ham-tcos-app

Org governance is canonical in `human-execution-engine`'s
`prompts/PROMPTING_RULES.md`. It is delivered to every session by the
`SessionStart` hook installed from the `dotfiles` repo:

    make claude-hooks

It is deliberately **not** `@import`-ed here: an `@import` whose path resolves
outside this repo fails silently. If the org rules are not in `/context`, the
hook is not installed.

`ham-tcos-app` is a static site, the ham study guide served at `ham.tcos.app`.
There is no generator yet: the committed pages are what ships, and
`deploy.sh promote` deploys them with no rebuild. Never commit or push to
`main`; branch, then PR. Release only through
`hee release -lab | -cut | -promote`.

The repo is public. Nothing internal goes in it: no lab hostnames beyond what
`deploy.sh` needs, no IP addresses, no operator details, no tokens.
