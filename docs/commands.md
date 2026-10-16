# Commands

Generated from `package.json` and `cli/` by the `docs:gen` step of `npm run app:verify`. Don't edit this file:
change a command's description in `cli/commands/<noun>.ts`, or its dependencies in `package.json` → `wireit`.

## Goals

Run with `npm run <goal>`. Wireit runs what each one needs first, in order, and skips anything already up to date.

| Goal | Runs first | What it does |
|---|---|---|
| `app:setup` |  | Set up this machine: install the VS Code extensions in .vscode/extensions.json and a browser for the checks (safe to re-run) |
| `app:dev` | `db:migrate` | Dev server with hot reload; the Worker runs in workerd (http://localhost:5173) |
| `app:verify` | `app:check`, `test:run`, `app:lint`, `docs:gen` | Runs app:check, test:run, app:lint, docs:gen |
| `app:artifact -- [--no-check]` | `app:check` | Build the app and its Worker into one HTML file that runs with no server (dist/artifact/index.html, for a Claude artifact), then check it in a browser with the network blocked |
| `app:smoke -- [--url <url>] [--offline]` |  | Smoke-test a running copy of the app over HTTP (production: read-only; Previews and local: full guest round trip) |
| `app:preview` | `app:build`, `db:migrate` | Run the production build (dist/) in workerd (http://localhost:4173) |
| `app:build` | `app:check` | Build the app and Worker to dist/ |
| `worker:ci` |  | Workers Builds' deploy command (after its app:build): migrate D1, then deploy with secrets from the environment |
| `worker:preview` |  | Workers Builds' preview command (after its app:build), one Preview per branch: migrate the staging D1, then deploy a Preview |
| `worker:deploy` | `app:verify`, `app:build` | Deploy the build in dist/ from your machine (credentials and secrets from your fnox production profile) |
| `worker:setup -- [--rotate-secrets]` |  | Create or update everything on Cloudflare: Worker, staging DB, Workers Builds, Previews, secrets (safe to re-run) |
| `worker:build -- [--branch <branch>]` |  | Start a Workers Build, wait for it and print the URL (production by default) |
| `worker:status` |  | Show the production and Preview URLs and the latest builds |
| `worker:logs -- [build-uuid]` |  | Print a build's log (the latest build by default) |
| `db:gen -- <name>` |  | Write a SQL migration for changes to worker/db/schema.ts |
| `test:watch` | `worker:types` | Re-run tests on change |
| `ui:add -- <components...>` |  | Add shadcn components, e.g. ui add dialog sheet |
| `theme:show` |  | Show the project's current shadcn preset |
| `theme:set -- <code>` |  | Switch the base preset (build codes at ui.shadcn.com/create), then regenerate the accent themes from it |
| `theme:gen -- [--json-only]` |  | Regenerate src/styles/themes.css and themes.json from shadcn presets (~20s per theme) |
| `env:list` |  | List the secrets declared in fnox.toml |
| `env:check` |  | Check every secret has a value in your store |

## Steps

Only in the `wireit` section of `package.json`: they run as part of a goal.

- `worker:types`: Regenerate worker-configuration.d.ts from wrangler.jsonc
- `app:check` (after `worker:types`): Type-check everything: app, worker, shared and cli
- `app:lint`: Lint with oxlint
- `test:run` (after `worker:types`): Run all tests once
- `db:migrate`: Apply pending migrations (local by default)
- `docs:gen` (after `worker:types`): Write docs/commands.md from package.json and the CLI, and fail on any mention of a command that doesn't exist

Any goal or step also runs on its own, without what it depends on, with `npm run cli -- <noun> <verb>`.
