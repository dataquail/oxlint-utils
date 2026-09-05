// Copies the manifest's JSON Schema into the docs site's static files, so it
// is served at the stable URL a manifest's `$schema` header names. Run before
// every website build and dev server; the copy is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "packages/core/schema/architecture.schema.json");
const to = path.join(root, "website/public/schema/architecture.schema.json");
mkdirSync(path.dirname(to), { recursive: true });
copyFileSync(from, to);
