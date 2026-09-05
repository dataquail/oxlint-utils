import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { MANIFEST_SCHEMA_ID, manifestJsonSchema } from "./json-schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const committed = path.join(root, "packages/core/schema/architecture.schema.json");

const validator = () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(manifestJsonSchema());
};

describe("the manifest JSON Schema", () => {
  // The committed file is what the docs site publishes and what an editor
  // fetches. It is generated, and this is what says when it is stale.
  it("is what packages/core/schema/architecture.schema.json holds", () => {
    const expected = `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`;
    expect(readFileSync(committed, "utf8")).toBe(expected);
  });

  it("names itself at the URL the docs site publishes", () => {
    expect(manifestJsonSchema().$id).toBe(MANIFEST_SCHEMA_ID);
    expect(MANIFEST_SCHEMA_ID).toMatch(/^https:\/\/dataquail\.github\.io\/goodbones\/schema\//);
  });

  it("validates this repository's own manifest, defs and use included", () => {
    const validate = validator();
    const manifest: unknown = parse(readFileSync(path.join(root, "architecture.yaml"), "utf8"));
    expect(validate(manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("rejects a misspelled key", () => {
    const validate = validator();
    expect(
      validate({
        resolve: { scopes: [] },
        tree: {
          "src/": { children: {}, members: [{ message: "m", subject: "calls", matchNott: "x" }] },
        },
      }),
    ).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain("matchNott");
  });

  it("rejects a value outside its enum", () => {
    const validate = validator();
    expect(validate({ resolve: { scopes: [] }, tree: { "src/": { layout: "closed" } } })).toBe(
      false,
    );
  });

  it("admits a use with overrides wherever an object may stand, and a $schema key", () => {
    const validate = validator();
    expect(
      validate({
        $schema: MANIFEST_SCHEMA_ID,
        defs: { floor: { allow: ["node:**"] }, rule: { message: "m", subject: "calls" } },
        resolve: { scopes: [] },
        graph: { cycles: [{ use: "rule" }] },
        tree: {
          "src/": { use: "node" },
          "lib/": {
            imports: { use: "floor", message: "m" },
            members: [{ use: "rule", except: ["x"] }],
          },
        },
      }),
      JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it("names the recursive node", () => {
    const schema = manifestJsonSchema() as { $defs: Record<string, unknown> };
    expect(Object.keys(schema.$defs).sort()).toEqual(["ManifestNode", "Use"]);
  });
});
