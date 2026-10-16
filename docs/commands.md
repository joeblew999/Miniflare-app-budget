# Commands

Generated from `package.json` and `cli/` by the `docs:gen` step of `npm run app:verify`. Don't edit this file:
change a command's description in `cli/commands/<noun>.ts`, or its dependencies in `package.json` → `wireit`.

## Goals

Run with `npm run <goal>`. Wireit runs what each one needs first, in order, and skips anything already up to date.

| Goal | Runs first | What it does |
|---|---|---|
| `app:dev` | `db:migrate` | Dev server with hot reload; the Worker runs in workerd (http://localhost:5173) |
| `app:build` | `app:check` | Build the app and Worker to dist/ |
| `app:preview` | `app:build`, `db:migrate` | Run the production build (dist/) in workerd (http://localhost:4173) |
| `app:setup` |  | Set up this machine: install the VS Code extensions in .vscode/extensions.json and a browser for the checks (safe to re-run) |
| `app:artifact -- [--no-check]` | `app:check` | Build the app and its Worker into one HTML file that runs with no server (dist/artifact/index.html, for a Claude artifact), then check it in a browser with the network blocked |
| `app:smoke -- [--url <url>] [--offline]` |  | Smoke-test a running copy of the app over HTTP (read-only, plus a full guest round trip where guest sign-in is on) |
| `app:verify` | `app:check`, `test:run`, `app:lint`, `docs:gen` | Runs app:check, test:run, app:lint, docs:gen |
| `worker:deploy` | `app:verify`, `app:build` | Deploy the build in dist/ to production from your machine (credentials from your fnox production profile; the Worker keeps its secrets) |
| `worker:ci` |  | Workers Builds' deploy command (after its app:build): migrate D1, then deploy with secrets from the environment |
| `worker:preview` | `app:build` | Deploy this branch's Preview (Workers Builds' preview command, and how agents deploy): migrate the staging D1, then deploy a Preview |
| `worker:setup -- [--rotate-secrets]` | `env:setup` | Create or update everything on Cloudflare: Worker, staging DB, Workers Builds, Previews, secrets (safe to re-run) |
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
| `env:setup -- [--account <id>] [--provider <name>] [--recheck] [--keep-other-tokens]` |  | Give this machine its Cloudflare access and agents theirs: your everyday token and account id in fnox, the parent token that makes agents' short-lived tokens, and what the mint workflow needs on GitHub. Never waits: if it needs you, it opens the pre-filled Cloudflare form, says what to do and stops; then run it again (safe to re-run) |
| `env:push -- [--dry-run] [--only <name>]` |  | Copy the secrets listed in env.targets.jsonc from fnox to their targets: Worker secrets, Workers Builds variables, GitHub |
| `env:status` |  | Show which secrets are where (names only), and warn about Cloudflare tokens that expire within 14 days |
| `env:lease -- [--ttl <duration>]` |  | Cloud sessions: get a short-lived Cloudflare token from the GitHub mint workflow, with nothing pasted, and keep it in this session's fnox.local.toml |
| `env:issue -- [--public-key <key>] [--ttl <duration>] [--out <file>]` |  | Run by the GitHub mint workflow: make a short-lived Cloudflare token (or take the fallback token) and encrypt it to a session's public key |

## Steps

Only in the `wireit` section of `package.json`: they run as part of a goal.

- `app:check` (after `worker:types`): Type-check everything: app, worker, shared and cli
- `app:lint`: Lint the code with oxlint, and check package.json lines up with the CLI (every command a goal or step, named after it, in the CLI's order)
- `worker:types`: Regenerate worker-configuration.d.ts from wrangler.jsonc
- `db:migrate`: Apply pending migrations (local by default)
- `test:run` (after `worker:types`): Run all tests once
- `docs:gen` (after `worker:types`): Write docs/commands.md from package.json and the CLI, and fail on any mention of a command that doesn't exist

Any goal or step also runs on its own, without what it depends on, with `npm run cli -- <noun> <verb>`.
