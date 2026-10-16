# Miniflare-app-budget

Example Google drive like app that will be able to run on Cloudflare using mitigate primitives

---

## Baht & Dollar Budget

Income and expenses in THB or AUD, any frequency, with shared tags. Every total shows both currencies.
Sign in and your budget is saved to your account, so it's the same on every device.
The AUD/THB exchange rate is live (the European Central Bank's daily rate). It works offline too: edits are kept on the device and sync when you're back online (the latest edit wins).

**Stack:** contract-first API with oRPC v2 (beta) and Zod 4 · Cloudflare Worker + D1 (Drizzle) ·
Better Auth · React 19 + Vite + Tailwind v4 + shadcn/ui · TanStack Query · Vitest in workerd.
TypeScript strict throughout. See [CLAUDE.md](CLAUDE.md) for the conventions.

## Setup

    mise install          # tools from mise.toml (node 24, fnox)
    npm install
    npm run app:setup     # VS Code extensions (Wireit) and a browser for the checks
    npm run app:dev       # http://localhost:5173

`mise.toml` holds tools only. The npm scripts are goals: run the one you want, and
[Wireit](https://github.com/google/wireit) runs whatever it needs first, skipping anything already up to date.
There's no order to remember. The commands themselves are a TypeScript CLI in `cli/`.

Secrets and env vars are declared in `fnox.toml`; the dev defaults there are enough to run locally. For Cloudflare, set your own values in `fnox.local.toml` (gitignored) under
`[profiles.production]`: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`.

## Commands

<!-- generated:commands (npm run app:verify writes this; edit package.json or cli/ instead) -->
```
npm run app:setup                    # Set up this machine: install the VS Code extensions in .vscode/extensions.json and a browser for the checks (safe to re-run)
npm run app:dev                      # Dev server with hot reload; the Worker runs in workerd (http://localhost:5173)
npm run app:verify                   # Runs app:check, test:run, app:lint, docs:gen
npm run app:artifact -- [--no-check] # Build the app and its Worker into one HTML file that runs with no server (dist/artifact/index.html, for a Claude artifact), then check it in a browser with the network blocked
npm run app:smoke -- [--url <url>] [--offline] # Smoke-test a running copy of the app over HTTP (production: read-only; Previews and local: full guest round trip)
npm run app:preview                  # Run the production build (dist/) in workerd (http://localhost:4173)
npm run app:build                    # Build the app and Worker to dist/
npm run worker:ci                    # Workers Builds' deploy command (after its app:build): migrate D1, then deploy with secrets from the environment
npm run worker:preview               # Workers Builds' preview command (after its app:build), one Preview per branch: migrate the staging D1, then deploy a Preview
npm run worker:deploy                # Deploy the build in dist/ from your machine (credentials and secrets from your fnox production profile)
npm run worker:setup -- [--rotate-secrets] # Create or update everything on Cloudflare: Worker, staging DB, Workers Builds, Previews, secrets (safe to re-run)
npm run worker:build -- [--branch <branch>] # Start a Workers Build, wait for it and print the URL (production by default)
npm run worker:status                # Show the production and Preview URLs and the latest builds
npm run worker:logs -- [build-uuid]  # Print a build's log (the latest build by default)
npm run db:gen -- <name>             # Write a SQL migration for changes to worker/db/schema.ts
npm run ui:add -- <components...>    # Add shadcn components, e.g. ui add dialog sheet
npm run theme:set -- <code>          # Switch the base preset (build codes at ui.shadcn.com/create), then regenerate the accent themes from it
```

Single steps or other commands, without what they depend on: `npm run cli -- <noun> <verb>`,
e.g. `npm run cli -- test watch`, `npm run cli -- theme show`, `npm run cli -- theme gen`. `npm run cli -- --help` lists them all.
<!-- /generated:commands -->

## API

The API is defined once, in `shared/contract.ts`, and served by the Worker in two forms:

- `/api/rpc/*`: oRPC's RPC protocol, used by the React app through a client typed from the contract
- `/api/*`: the same procedures as REST: `GET /api/rate`, `GET /api/me`, `GET /api/budget`, `PUT /api/budget`
- `/api/docs`: interactive API docs (Scalar); `/api/spec.json` is the OpenAPI 3.2 document
- `/api/auth/*`: Better Auth (sign up, sign in, sign out, session)

## Live

- Production: https://baht-dollar-budget.gedw99.workers.dev (built from `main`)
- Previews: every other branch gets its own Preview URL, using a staging database. Sign in with
  **Continue as guest**, which is only offered in Previews and local dev.

## Deploy (Cloudflare Workers Builds)

Deploying is a git push. Pushing to `main` deploys production, and pushing any other branch deploys that branch's Preview.

One-time setup, from this repo:

1. In `fnox.local.toml`, under `[profiles.production]`, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
   The token needs Workers Scripts Edit, D1 Edit, Workers Builds Configuration Edit and Account Settings Read.
2. `npm run worker:setup`. It creates the Worker, the staging database, the Workers Builds connection to this repo,
   Previews and the secrets. Commit any ids it writes into `wrangler.jsonc`.

After that:

    npm run worker:status                 # URLs and recent builds
    npm run worker:build                  # build production now and wait
    npm run worker:build -- --branch xyz  # build a branch's Preview now and wait
    npm run worker:logs                   # latest build log

## Layout

    cli/       project CLI (TypeScript)
    shared/    contract, Zod schemas, budget maths (used by app and Worker)
    worker/    Worker: routing, oRPC router, auth, D1 access, tests
    migrations/ SQL migrations for D1
    src/       React app: components/, components/ui/ (shadcn), hooks/, lib/, styles/

## Theme

The base theme is official shadcn preset **`b2oDXH5AO`** (base neutral, theme green, charts green):
https://ui.shadcn.com/create?preset=b2oDXH5AO

In the app, the header switcher changes **light / dark / system** and the **accent colour**, from the 18
official shadcn themes. Choices are saved per browser.

- `src/styles/themes.css` / `themes.json` are generated by `npm run theme:set` (or `npm run cli -- theme gen`), which runs
  `shadcn init --preset` once per theme and extracts the CSS variables. Don't hand-edit them.
- Change the base with `npm run theme:set -- CODE`; the accent themes regenerate from it.

## Moving from the browser-only version

Budgets saved by the earlier browser-only version are imported into your account the first time you
sign in on that browser.
