# Miniflare-app-budget

Example Google drive like app that will be able to run on Cloudflare using mitigate primitives

---

## Baht & Dollar Budget

Income and expenses in THB or AUD, any frequency, with shared tags. Every total shows both currencies.
Sign in and your budget is saved to your account, so it's the same on every device.

**Stack:** contract-first API with oRPC v2 (beta) and Zod 4 · Cloudflare Worker + D1 (Drizzle) ·
Better Auth · React 19 + Vite + Tailwind v4 + shadcn/ui · TanStack Query · Vitest in workerd.
TypeScript strict throughout. See [CLAUDE.md](CLAUDE.md) for the conventions.

## Setup

    mise install          # tools from mise.toml (node 24, fnox)
    npm install
    npm run app:dev       # http://localhost:5173 (applies local DB migrations first)

`mise.toml` holds tools only. Every command is an npm script named `noun:verb`, backed by the
TypeScript CLI in `cli/`. Secrets and env vars are declared in `fnox.toml`; the dev defaults there are
enough to run locally. For Cloudflare, set your own values in `fnox.local.toml` (gitignored) under
`[profiles.production]`: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`.

## Commands

    npm run app:dev             # app + Worker with hot reload, http://localhost:5173
    npm run app:check           # type-check app, worker, shared and cli
    npm run app:build           # type-check and build to dist/
    npm run app:preview         # build, then run it in workerd, http://localhost:4173
    npm run app:lint            # oxlint
    npm run app:smoke -- --url <url>  # check a running copy (production: read-only; Preview/local: guest round trip)
    npm run worker:types        # regenerate worker-configuration.d.ts
    npm run worker:setup        # one-time Cloudflare setup (safe to re-run)
    npm run worker:build        # start a build and wait (-- --branch xyz for a Preview)
    npm run worker:status       # URLs and recent builds
    npm run worker:logs         # a build's log
    npm run worker:deploy       # build and deploy from your machine (fnox production profile)
    npm run worker:ci           # deploy step used by Cloudflare Workers Builds
    npm run worker:preview      # Preview step used by Workers Builds (staging DB, guest sign-in)
    npm run db:gen -- NAME      # write a migration after changing worker/db/schema.ts
    npm run db:migrate          # apply migrations locally (add -- --remote for Cloudflare)
    npm run test:run            # run tests in workerd
    npm run test:watch          # re-run tests on change
    npm run ui:add -- dialog    # add shadcn components
    npm run theme:show          # current shadcn preset
    npm run theme:set -- CODE   # switch base preset (build codes at ui.shadcn.com/create)
    npm run theme:gen           # regenerate the runtime accent themes from shadcn presets
    npm run env:list            # secrets fnox knows about
    npm run env:check           # are they all set?

## API

The API is defined once, in `shared/contract.ts`, and served by the Worker in two forms:

- `/api/rpc/*`: oRPC's RPC protocol, used by the React app through a client typed from the contract
- `/api/*`: the same procedures as REST: `GET /api/me`, `GET /api/budget`, `PUT /api/budget`
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

- `src/styles/themes.css` / `themes.json` are generated by `npm run theme:gen`, which runs
  `shadcn init --preset` once per theme and extracts the CSS variables. Don't hand-edit them.
- Change the base with `npm run theme:set -- CODE`, then `npm run theme:gen`.

## Moving from the browser-only version

Budgets saved by the earlier browser-only version are imported into your account the first time you
sign in on that browser.
