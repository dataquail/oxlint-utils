// Writes the manifest's JSON Schema, generated from the Effect codec that
// decodes it, to packages/core/schema/. Run after a build of the core; a test
// in the core (`manifest/json-schema.test.ts`) fails when the committed file
// falls behind the codec, which is how the two are kept in step.
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { manifestJsonSchema } from "../packages/core/build/esm/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = path.join(root, "packages/core/schema/architecture.schema.json");
mkdirSync(path.dirname(at), { recursive: true });
writeFileSync(at, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${path.relative(root, at)}\n`);
