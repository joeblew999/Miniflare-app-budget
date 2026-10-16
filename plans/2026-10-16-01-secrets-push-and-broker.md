# 2026-10-16-01-secrets-push-and-broker.md

**Status:** planned. To be built on the Mac (it needs the real secrets in fnox).

## How we work on this (Mac and phone agent)

- **Branch:** `secrets-push`, created from the latest `main`:
  ```
  git checkout main && git pull
  git checkout -b secrets-push
  ```
- Never commit to `main` directly. Merging to `main` deploys production.
- Push the branch whenever you like. Every push gets its own Preview URL. When it's done, open a PR into `main` and merge it.
- **Sync goes through GitHub.** Whoever wants the other's work pulls the branch: `git fetch && git checkout secrets-push && git pull`.
- **One writer per branch at a time.** While the Mac is working on `secrets-push`, the phone agent stays off it, or works on its own branch (for example `secrets-push-agent`) and opens a PR **into `secrets-push`**, not into `main`.
- To hand over, push first and then say which branch to pick up.
- **The phone agent** is the cloud agent: Claude in a cloud session, which you run from your phone. It works on this same repo, and it's the reason for Part 2. The timeline in "Who runs what, and in what order" marks every point where you bring it in (**You → Phone agent**), with the message to paste to it.

## Problem

Every secret lives in fnox on the Mac, which is the only source of truth. Three other places need some of them and can't reach the Mac:

| Consumer | Needs | Lifetime |
|---|---|---|
| Cloudflare | Worker runtime secrets, Workers Builds build variables | permanent |
| GitHub | Actions secrets, for any workflow that needs them | permanent |
| Cloud agent sessions (Claude) | a Cloudflare API token to deploy directly (about 30s instead of about 2 min through Workers Builds), now and then | one session, and every session starts empty |

Today these are copied by hand or not at all, so things drift, deploys are slower than they need to be, and agents get stuck.

## Principles

1. **The Mac (fnox) stays the single source of truth** for every secret that comes from outside (API tokens, third-party keys). Nothing is edited anywhere else. Secrets that are only random values nobody needs to read, such as `BETTER_AUTH_SECRET`, stay with `worker:setup`, which generates them straight into Cloudflare (see Part 1).
2. **Permanent consumers get pushed copies.** One command makes Cloudflare and GitHub match fnox.
3. **Agents never hold long-lived secrets.** They get short-lived, narrowly scoped child credentials minted from a parent token (fnox calls these *leases*).
4. **Nothing an agent can reach is more powerful than what the agent is meant to have.** The parent token is stored in fnox on the Mac and in one GitHub Actions secret (or, in the fallback in Part 2, only on the Mac). On this repo, an Actions secret counts as reachable by agents (see "What was found today"), so the parent must be narrow too. It never goes into a chat, a sandbox or a repo file.

## Who runs what, and in what order

Three kinds of things run CLI commands. Only the first needs a person.

### You, on the Mac

| Command | When | What it does |
|---|---|---|
| `npm run env:setup` | once, after PR 1 is merged (timeline step 4); again when warned that a token is about to expire | Wireit runs its two dependencies first: `worker:setup`, which now also puts `BETTER_AUTH_SECRET` into the Previews base config (Part 0), and `env:push`. Then it opens the pre-filled Cloudflare form: you press Create and paste the token. Then, by itself: it checks the token's permissions, checks other account tokens, runs the limit test, and pushes the parent to GitHub (or makes and pushes the 30-day fallback token). |
| `npm run env:push` | whenever you add or change a secret in fnox that's listed in `env.targets.jsonc` | Copies those secrets to GitHub and Cloudflare. `--dry-run` shows what it would do, `--only <NAME>` pushes one. |
| `npm run env:status` | any time | Shows which secrets exist where, and warns about tokens that expire within 14 days. |
| `npm run worker:deploy` | optional, as today | Deploys production from the Mac (Wireit runs `app:verify` and `app:build` first). After Part 0 it no longer needs `BETTER_AUTH_SECRET`. |

### Agents, in a cloud session

| Command | When | What it does |
|---|---|---|
| `npm run env:lease` | at the start of a session, and again if the token runs out | Gets a Cloudflare token for up to 4 hours and saves it in the session. Prints how long it lasts, plus any expiry warning to pass on to you. |
| `npm run worker:preview` | after each change it wants to see live | Wireit builds the app first (`app:build`), then it deploys the agent's branch to its Preview, in about 30s. |
| `npm run worker:status`, `npm run worker:logs`, `npm run app:smoke -- --url <preview>` | to check a deploy | Same as today. |

Agents never run `env:setup`, `env:push`, `worker:setup` or `worker:deploy`. Those need your fnox on the Mac, and production is a merge to `main`. If a Cloudflare command finds no token in a cloud session, its error says to run `npm run env:lease`.

### Automatic: nobody types these

| Who | When | Runs |
|---|---|---|
| Workers Builds | push to `main` | `npm run app:build`, then `npm run worker:ci` (production). Same as today. |
| Workers Builds | push to any other branch | `npm run app:build`, then `npm run worker:preview` (that branch's Preview). Wireit sees the build is already done and doesn't repeat it. |
| GitHub workflow `mint-cloudflare-token.yml` | started by `env:lease` | Installs the tools and runs `npm ci`. Then `fnox lease create cf` (or takes the fallback token), then `npm run cli -- env encrypt`, then uploads the result. Only the workflow uses `env encrypt`, so it isn't a goal. |

### The timeline, start to finish

Who: **You** (on the Mac), **Mac agent** (Claude on the Mac, building the code), **Phone agent** (Claude in a cloud session on your phone), **Automatic**.

1. **You → Phone agent**, before anything is built. Paste:
   > The Mac is building the secrets work on branch `secrets-push`. Don't touch that branch. Until it's merged, avoid changing `cli/`, `CLAUDE.md`, `README.md`, `docs/commands.md`, `fnox.toml`, `package.json` and `.github/` on your branches, so nothing conflicts. Please check two things through your session's proxy and report back, without changing the repo: (1) can you download an artifact from a public repo's workflow run with `gh run download <run-id> --repo <owner/repo>`? (2) can you read a check run's annotations with `gh api repos/<owner/repo>/check-runs/<id>/annotations`?

   Its answer decides how `env:lease` gets the encrypted token back: through an artifact if (1) works, otherwise through annotations (Part 2, design step 3). Only one of the two gets built.
2. **Mac agent** builds PR 1 on `secrets-push`: everything in Parts 0, 1 and 2. It runs `npm run app:verify` and pushes the branch (Workers Builds makes its Preview).
3. **You** merge PR 1 into `main`. **Automatic:** Workers Builds deploys production.
4. **You** run `npm run env:setup`. Wireit runs `worker:setup` and `env:push` first. Then press Create in the pre-filled form and paste the token.
5. **You → Phone agent.** Paste:
   > PR 1 (secrets) is merged. Start a fresh session on `main`, so you read the new `CLAUDE.md`. Create a branch `lease-test` and run these, timing each step: `npm run env:lease`, then `npm run worker:preview`, then `npm run app:smoke -- --url https://lease-test-baht-dollar-budget.gedw99.workers.dev`. Report the times and any errors. Don't fix anything yet.
6. **Phone agent** runs the test and reports back.
   - **All good:** done. From now on the phone agent uses `env:lease` by itself, because `CLAUDE.md` tells it to.
   - **Something failed:** PR 2. Whoever can test the fix writes it, with one writer per branch:
     - **A fix in `env:lease`** (it runs in the phone agent's session): the **phone agent** fixes and tests it on a branch `lease-fix` and opens PR 2, and **you** merge it.
     - **A fix in the workflow or `env encrypt`** (they run from `main`): the **Mac agent** fixes it, **you** merge it, and you go back to step 5.

Every phone agent session after that:
1. `npm run env:lease`. It makes a one-off key pair and starts the workflow on `main`. The workflow creates a token and encrypts it to that key. `env:lease` then downloads it, decrypts it and saves it in the session's `fnox.local.toml`.
2. `npm run worker:preview`. It builds first by itself.
3. `npm run app:smoke -- --url https://<branch>-baht-dollar-budget.gedw99.workers.dev`.
4. Repeat steps 2 and 3. If the token runs out, run step 1 again.

Later, you:
- To add or change an outside secret: `fnox set NAME`, add it to `env.targets.jsonc` if it's new, then `npm run env:push`.
- When warned about expiry, by `env:status` or by the phone agent passing on `env:lease`'s warning: `npm run env:setup`.

## Part 0: deploy without holding `BETTER_AUTH_SECRET`

Part of PR 1. Without it, an agent with a Cloudflare token still can't deploy, and `npm run worker:deploy` doesn't work on the Mac either.

What's wrong today:
- `worker:ci` and `worker:preview` call `secretsFromEnv()` (`cli/commands/worker.ts`), which stops if `BETTER_AUTH_SECRET` isn't set or is the dev default.
- On the Mac, the fnox production profile inherits the dev default from the top-level `[secrets]` (`fnox list --profile production` shows `BETTER_AUTH_SECRET` as "default value"), so `worker:deploy` always refuses.
- In a cloud session, the agent would need the production `BETTER_AUTH_SECRET`, which is long-lived and breaks Principle 3.

Change:
- When `BETTER_AUTH_SECRET` isn't in the environment, deploy **without** `--secrets-file`. Wrangler keeps the Worker's existing secrets ("existing secrets not included in the file are preserved"), and `secrets.required` in `wrangler.jsonc` still fails the deploy if the Worker has none.
- Keep refusing the dev default when it is set.
- Run the production profile with `fnox exec --profile production --no-defaults` (in `cli/run.ts`), so the dev default stops leaking into it.
- Previews: `worker:setup` sets `BETTER_AUTH_SECRET` in the Previews base config if it isn't there yet (`wrangler preview base-config secret put`, or the API behind it). `env:setup` runs `worker:setup` every time, so this must leave an existing value alone. New Previews copy it, so `worker:preview` can also run without the secret. The current Previews value exists only on Cloudflare and can't be read back, so `worker:setup` generates a new one for the base config. Only Previews created after that get it; existing ones keep theirs.
- Workers Builds keeps passing the build variable as it does now, so nothing changes there.
- Give `worker:preview` a Wireit dependency on `app:build`, and give `app:build` `files` and `output` (`dist/**`), so Wireit skips the build when nothing changed. Agents then run one goal. Workers Builds runs `app:build` first anyway, and doesn't build twice.

Acceptance:
- With only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set, `npm run worker:deploy` deploys production and `npm run worker:preview` builds and deploys a branch's Preview.
- Users stay signed in afterwards (the secret didn't change).

## Part 1: `env:push`, from Mac to Cloudflare and GitHub

New goals: npm scripts run by Wireit (see `CLAUDE.md`), with their descriptions in `cli/commands/env.ts`, so `docs/commands.md` picks them up.

- `npm run env:push`: reads each secret named in `env.targets.jsonc` from fnox and writes it to its targets.
  - `--dry-run`: lists what would be set where, by name only and never values.
  - `--only <NAME>`: push one secret.
- `npm run env:status`: lists, by name only, which secrets exist at each target and which are missing or extra. It shows presence only: Cloudflare and GitHub never return values, so it can't tell a stale value from a current one.

**Who owns `BETTER_AUTH_SECRET`: decided, `worker:setup` keeps it.** Nobody needs to read it, moving it to fnox signs everyone out once and gains nothing, and two owners (`worker:setup`'s random values and `env:push`) would overwrite each other. So it doesn't appear in `env.targets.jsonc`. `env:push` is for secrets that come from outside.

**Where each secret goes** is declared in a new file `env.targets.jsonc`. It has to be separate from `fnox.toml`: fnox 1.39 rejects unknown keys (tested: "unknown field `targets`"). Example:

```jsonc
{
  "CLOUDFLARE_ACCOUNT_ID": ["github:variables"],
  // a future third-party key the Worker needs at runtime (the exchange rate needs none: it's the free ECB rate):
  // "SOME_SERVICE_API_KEY": ["cloudflare:worker", "cloudflare:builds:production", "cloudflare:builds:previews"]
}
```

The parent token is **not** listed here. `env:setup` (Part 2) decides whether it goes to GitHub at all, and pushes it (or the fallback token) with the same code. If it were listed here, `env:push` would push the parent even in the fallback, where it must stay on the Mac.

Targets to implement:

| Target | How | API |
|---|---|---|
| `cloudflare:worker` | Worker runtime secret | `PUT /accounts/{id}/workers/scripts/{name}/secrets` |
| `cloudflare:builds:production` | Workers Builds production build variable (`is_secret: true`) | `PATCH /accounts/{id}/builds/workers/{tag}`, `production_settings.environment_variables` |
| `cloudflare:builds:previews` | Workers Builds Previews build variable | same call, `previews_base_config.environment_variables` |
| `github:actions` | repo Actions secret | `gh secret set NAME --repo owner/repo` (value on stdin) |
| `github:variables` | repo Actions variable, for values that aren't secret (like the account ID) | `gh variable set NAME --repo owner/repo` |

Implementation notes:
- Reuse `cli/cloudflare.ts`, which already has the REST client and credentials, and `cli/project.ts`, which already knows the Worker name and the GitHub repo. `worker:setup` already PATCHes build variables (`cli/cloud.ts`); share that code.
- Read only the names listed in `env.targets.jsonc`, one at a time with `fnox get`. Don't use `fnox exec`, which exports everything, including unrelated secrets from the global `~/.config/fnox/config.toml`.
- Values go over stdin or in request bodies only, never in argv, logs or files.
- `cloudflare:worker` deploys immediately (setting a secret creates a new deployment), and the next Workers Build uploads the build variable again. A runtime secret therefore always needs both targets, pushed together.
- Put `CLOUDFLARE_PARENT_TOKEN` in its own fnox profile (for example `[profiles.mint.secrets]`), not in `production`, so wrangler and the other production commands never see it. `env:push` reads it from there. Other new secrets go under `[profiles.production.secrets]`, as names only.

Acceptance:
- `env:push --dry-run` lists every target and touches nothing.
- `env:push` followed by `env:status` shows nothing missing.
- Rotating one value in fnox and running `env:push --only X` updates only X.

## Part 2: short-lived Cloudflare tokens for agent sessions

### What was found today

- The cloud sandbox **can** reach `api.cloudflare.com`. Direct `wrangler deploy` works from there with a token.
- The Cloudflare connector **cannot** create API tokens (error 9109), so it can't mint them.
- The session's GitHub token is a **proxy placeholder** (`prox…`): the session's proxy swaps in the real credential only on requests to GitHub. So the agent can't prove its GitHub identity to a third-party service such as a custom broker Worker. It **can** use the `gh` CLI and the GitHub API normally, including triggering workflows.
- **On this repo, Actions secrets are readable from any branch.** The repo is private on GitHub Free: the branch protection and rulesets APIs return 403 ("Upgrade to GitHub Pro"), and GitHub's docs say environments with branch rules need Pro on private repos. Any workflow on any pushed branch can read any Actions secret, and the agent can push branches. So whatever is stored there, the agent can effectively have.
- **A user token with *API Tokens: Edit* is a master key.** Cloudflare's docs say it "can create tokens with access to any of a user's resources". Its children are not limited to its own permissions. Stored as an Actions secret, it would give every agent session full access to the Cloudflare user.
- **fnox already mints Cloudflare tokens.** fnox 1.39 has a `cloudflare` lease backend (`[leases.cf] type = "cloudflare"`): user or account tokens, explicit policies, a duration of up to 24h, and `fnox lease revoke` deletes the token. No hand-written token-creation code is needed.

### Design: GitHub Actions mints the token

Repo write access (being able to trigger a workflow) is the identity check, and Actions holds the parent token.

1. **Parent token** (Cloudflare): an **account-owned** token (`/accounts/{id}/tokens`), scoped to this one account, with *Account API Tokens: Edit* plus the four permissions the children get: Workers Scripts Edit, D1 Edit, Workers Builds Configuration Edit, Account Settings Read. It expires after a year. It's stored in fnox on the Mac (the `mint` profile) and pushed to the GitHub Actions secret `CLOUDFLARE_PARENT_TOKEN`.

   **`npm run env:setup`** (Mac, one-time, safe to re-run) does all of this. Its Wireit dependencies, `worker:setup` and `env:push`, run first. The command itself doesn't call them, because chaining is Wireit's job. The only manual part is creating the token in the dashboard, which can't be avoided (see "Order of work", PR 1):
   - **Pre-filled form:** if fnox has no parent token, it opens a dashboard link with the form already filled in. That's an account token template URL, `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=…&name=…`, with the keys `account_api_tokens` edit, `workers_scripts` edit, `d1` edit, `account_settings` read, plus the Workers Builds Configuration key (still to confirm). You pick the account, set the expiry, press Create, and paste the token when `fnox set CLOUDFLARE_PARENT_TOKEN --profile mint` asks for it.
   - **Permission check:** it reads the parent's own permissions (`/accounts/{id}/tokens/verify`, then the token's policies) and refuses a parent that is broader than the list above.
   - **Other tokens check:** *Account API Tokens: Edit* may also let the parent edit or roll account tokens it didn't create, and rolling one returns its new value. If the parent can list other account tokens and any of them is broader than the parent, `env:setup` stops and names them. You then narrow, delete or keep those tokens before going on, because a leaked parent could reach them.
   - **Limit test, with the real parent:** it asks for a 1-minute child with a harmless permission the parent doesn't have, for example Account Analytics Read. If Cloudflare refuses, or creates the child without that permission, children are limited, and `env:setup` pushes the parent to GitHub. If the child gets the extra permission, `env:setup` deletes it at once and switches to the fallback by itself.
   - **Fallback (children not limited):** no token that can create tokens goes to GitHub. The parent stays on the Mac only. `env:setup` creates a narrow account token (the four permissions, expiring after 30 days) through `POST /accounts/{id}/tokens`, because fnox leases last at most 24h, and pushes it as the Actions secret `CLOUDFLARE_AGENT_TOKEN`. Principle 3 then becomes "agents hold a narrow token that expires within 30 days".
   - **Worst case if the parent leaks:** when the limit holds, Workers and D1 on this account, which is what an agent has anyway. A leaked parent could still create tokens that never expire; the yearly expiry bounds that.
   - **Reminders:** `env:status` warns when the parent or the 30-day token expires within 14 days. `env:lease` prints the same warning in agent sessions, so the agent tells you. Replacing either token means running `npm run env:setup` again.
2. **Workflow** `.github/workflows/mint-cloudflare-token.yml`, run by `workflow_dispatch` with inputs:
   - `public_key`: the requesting session's one-off public key (X25519);
   - `ttl`: capped at 4h;
   - `request_id`: a random id, used in `run-name: mint ${{ inputs.request_id }}` so each session finds its own run, even when two run at once.

   The workflow:
   - installs node and fnox from `mise.toml` (`jdx/mise-action`);
   - mints the child with `fnox lease create cf --format json` (cloudflare backend, `token_type = "account"`, the four permissions as explicit `policies`, duration from `ttl`), with the parent in the environment as `CLOUDFLARE_API_TOKEN`. `[leases.cf]` lives in `fnox.toml`, since it holds policies, not secrets. The account id comes from the `CLOUDFLARE_ACCOUNT_ID` repo variable, so the repo holds no account id. In the fallback there's no parent: the workflow skips minting and hands out `CLOUDFLARE_AGENT_TOKEN` instead;
   - masks the child token with `::add-mask::` before anything else;
   - runs `npm ci` (cached), then encrypts the token to `public_key` with `npm run cli -- env encrypt`, a new `cli/` command (not a goal, since only the workflow uses it) using `node:crypto` (X25519 plus AES-GCM). There's nothing extra to install on either side, and it stays inside the CLI's rules. The `npm ci` counts toward the 45s target;
   - uploads the ciphertext as a short-retention workflow artifact (1 day), next to two values that aren't secret: the account id and when the parent (or the fallback token) expires.
3. **Agent side**: `npm run env:lease` (the `env` noun, not a new one).
   - It generates a keypair in memory.
   - It runs the workflow with `gh workflow run … --ref main -f public_key=… -f request_id=…`, finds the run by `request_id`, waits with `gh run watch`, downloads the artifact with `gh run download`, decrypts it, and writes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` into the sandbox's own gitignored `fnox.local.toml`, under the production profile.
   - The artifact download redirects to GitHub's blob storage, not `api.github.com`, and the proxy may block that. The other route: the workflow writes the ciphertext as a `::notice::` annotation, and `env:lease` reads it from the check-run annotations API, which is on `api.github.com`. The phone agent's check in timeline step 1 decides which one gets built.
   - From then on, `worker:preview`, `worker:status` and the rest work directly in about 30s. Part 0 means no `BETTER_AUTH_SECRET` is needed.
4. **What agents deploy:** their branch's Preview (`npm run worker:preview`, which builds first). Production stays a merge to `main`. A token can't enforce this, because Workers Scripts permissions cover the whole account, so it's a rule in `CLAUDE.md`.
5. **fnox integration:** on the Mac, `[leases.cf]` with the cloudflare backend mints the same child directly, with no workflow. In a sandbox, a `command`-backend lease can wrap `env:lease`, so `fnox lease create` works the same everywhere. This is optional.
6. **Cleanup:** Cloudflare's `expires_on` kills children automatically, and `fnox lease revoke` deletes one early. Optionally, a scheduled workflow deletes expired `agent-*` tokens to keep the account's token list tidy.
7. **Guard `worker:setup`:** when it creates the Workers Builds build token, it stores the current `CLOUDFLARE_API_TOKEN` (`ensureBuildToken` in `cli/cloud.ts`). Run with a lease, builds would break when the lease expires. It should refuse a token that expires within 30 days (`/tokens/verify` returns `expires_on`). A lease always does, while your own long-lived token passes even if it has a far-off expiry.

Why not a custom broker Worker: it would need to verify the agent's GitHub identity, and the session's token is a placeholder that only works through the session's proxy. Also, a broker on this account could be redeployed by any child token (Workers Scripts Edit) to leak the parent. With Actions, GitHub does the identity check, and no extra service has to be secured.

### Before building, verify

- [x] Can a user token with *API Tokens: Edit* create a child with permissions beyond its own? **Yes**: any of the user's resources (Cloudflare docs). So the parent must be account-owned.
- [x] Can `env.targets.jsonc` be folded into `fnox.toml`? **No**: fnox rejects unknown keys.
- [ ] **Decides the design:** is a child of an account-owned token limited to the parent's own permissions? `env:setup` tests this with the real parent and picks the design or the fallback by itself (design step 1).
- [ ] Can a token with *Account API Tokens: Edit* list, edit or roll account tokens it didn't create? If it can, the "other tokens check" in design step 1 is essential. If it can't, that check finds nothing and is harmless.
- [ ] What's the template-link key for Workers Builds Configuration? The docs list `account_api_tokens`, `workers_scripts`, `d1` and `account_settings`, but not that one.
- [ ] Do `wrangler deploy`, `wrangler preview` and `wrangler d1 migrations apply` work with an account-owned token?
- [ ] Can `[leases.cf]` in `fnox.toml` take `account_id` from the environment? If not, the workflow writes a small fnox config at run time, so the repo still holds no account id.
- [ ] Does `wrangler preview` without `--secrets-file` give a new Preview `BETTER_AUTH_SECRET` from the base config, and does the `secrets.required` check accept it? (Part 0)
- [ ] From a cloud session, does `gh run download` (or the annotations API) work through the proxy? The phone agent checks this before anything is built (timeline step 1). `gh workflow run` itself gets tested in timeline step 5.
- [ ] Is the time from triggering the workflow to having the token under about 45s (measured in timeline step 5)?
- [ ] In Workers Builds, does `worker:preview` skip `app:build` as already done, because the build command just ran it (Part 0)? If it rebuilds, drop the dependency and give agents their own goal for a Preview deploy. If it's much slower, Workers Builds (about 2 min) may be good enough.

Acceptance:
- On the Mac, `npm run env:setup` from scratch needs only the pre-filled dashboard form and one paste.
- From a fresh cloud session: `npm run env:lease` gets a working token in under about a minute, with no human input, and a Preview deploy then takes about 30s without `BETTER_AUTH_SECRET` in the sandbox.
- The token stops working after its TTL.
- A workflow on any branch that reads the Actions secret gets nothing more than Workers and D1 on this account.
- No secret value appears in any log, artifact or annotation (except the ciphertext), chat or repo file.

## Order of work

Two PRs at most. The timeline in "Who runs what, and in what order" says who does what around them.

1. **PR 1: everything.** Parts 0, 1 and 2: the deploy fix, `env:push`, `env:status`, `env.targets.jsonc`, `env:setup`, the workflow, `env encrypt` and `env:lease`. It's built on the Mac with real fnox secrets.
   - **Wiring:** each new goal or step goes into `package.json` (`scripts` and `wireit`), with its description in `cli/commands/env.ts`. `docs:gen` (part of `app:verify`) regenerates `docs/commands.md`. Never list commands by hand.
   - **`CLAUDE.md`:** the new verbs (`push`, `lease`, `encrypt`) go into its verb list. It also gets a short section, in prose with a link to `docs/commands.md`, on how agents get Cloudflare access: `env:lease` once per session, never ask for tokens, deploy Previews and never production.
   - **After merge,** you run `npm run env:setup`.
   - Creating the parent in the Cloudflare dashboard is the one manual step, and the one exception to the `CLAUDE.md` rule against setting Cloudflare up by hand: only a token that can already create tokens can create one, and the CLI's everyday token deliberately can't. `env:setup` opens the form already filled in, so you pick the account, set the expiry, press Create and paste. Everything after that is automatic: the permission check, the other tokens check, the limit test, pushing the parent (or the 30-day fallback token) to GitHub, and `env:push`.
2. **PR 2: only if the phone agent's test fails** (timeline step 6). This is the only reason for a second PR: GitHub only starts a `workflow_dispatch` workflow that exists on `main`, and `--ref main` runs `main`'s code, so `env:lease` can't be tested end to end until PR 1 is merged.

## Later: reuse across repos

Parts 0, 1 and 2 are generic. Once they work here, move the `env:*` commands and the mint workflow into a shared package or template repo, so every Cloudflare project gets the same setup.
