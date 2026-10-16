// Project CLI: `node cli/main.ts <noun> <verb>`. Wireit runs it from the package.json goals.
// Runs as TypeScript directly on Node 24 (type stripping), no build step.
import { createProgram } from "./program.ts"

await createProgram().parseAsync()
