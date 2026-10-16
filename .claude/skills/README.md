# Agent skills

Vendored from the oRPC repo (https://github.com/middleapi/orpc/tree/main/skills), MIT licensed.
Source commit: aef5cca296f488989c17feb005d009889958a517 2026-10-15

- `orpc`: core oRPC v2 (procedures, middleware, RPCHandler, clients, TanStack Query)
- `orpc-contract`: contract-first (`oc`, `implement`, contract clients). This repo's API is built this way.
- `orpc-openapi`: REST exposure, OpenAPIHandler, spec and Scalar docs

Pretrained oRPC knowledge is v1 and wrong for v2. Load these before touching `shared/contract.ts` or `worker/`.
Update them by copying `skills/<name>/SKILL.md` again from that repo.
