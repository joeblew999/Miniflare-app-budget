# Miniflare-app-budget

Example Google drive like app that will be able to run on Cloudflare using mitigate primitives

---

## Baht & Dollar Budget

Income and expenses in THB or AUD, any frequency, with shared tags. Every total shows both currencies.
Sign in and your budget is saved to your account, so it's the same on every device.
The AUD/THB exchange rate is live (the European Central Bank's daily rate). It works offline too: edits are kept on the
device and sync when you're back online (the latest edit wins).

- Production: https://baht-dollar-budget.gedw99.workers.dev, built from `main`. Every other branch gets its own Preview
  on a staging database; sign in there with **Continue as guest**.
- The API is defined once, in `shared/contract.ts`, and served as RPC (`/api/rpc`) and REST (`/api/*`), with interactive
  docs at `/api/docs`.

## Start

    mise install          # tools from mise.toml
    npm install
    npm run app:setup     # editor extensions and a browser for the checks
    npm run app:dev       # http://localhost:5173

For Cloudflare, `npm run worker:setup` gives your machine its access (it opens the Cloudflare forms it needs) and sets up
everything on Cloudflare. After that, deploying is a git push.

Every command is in [docs/commands.md](docs/commands.md). How to work in this repo is in [CLAUDE.md](CLAUDE.md).
