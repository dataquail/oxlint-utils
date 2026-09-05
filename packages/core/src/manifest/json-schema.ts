import * as Schema from "effect/Schema";

import { Manifest } from "./manifest.js";

// The manifest's shape as a JSON Schema, generated from the same codec that
// decodes it, so the two cannot disagree. A YAML file names it in a header
// comment and a JSON file in a `$schema` key; either way the editor completes
// keys and flags a misspelled one before the loader ever runs.
//
// Two things the codec does not know are added here: the `defs` map, and the
// `{ use }` reference form that may stand in for any object — both belong to
// the expansion pass that runs before decoding.

export const MANIFEST_SCHEMA_ID =
  "https://dataquail.github.io/goodbones/schema/architecture.schema.json";

type JsonValue = string | number | boolean | null | JsonObject | ReadonlyArray<JsonValue>;
type JsonObject = { readonly [key: string]: JsonValue };

const entriesOf = (value: JsonObject): ReadonlyArray<readonly [string, JsonValue]> =>
  Object.entries(value);

const isObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The generator names the recursive node after its own internal wrapper. A
// stable name is what a `$ref` in an error message or a docs page can point at.
const DEFINITION_NAMES: Readonly<Record<string, string>> = { Suspend_: "ManifestNode" };

const USE_REFERENCE = "#/$defs/Use";

const Use: JsonObject = {
  type: "object",
  description:
    "A reference to a fragment under the top-level `defs`. Replaced by a copy of the fragment before the manifest is decoded; any other key written beside `use` overrides the fragment's key of the same name.",
  properties: { use: { type: "string" } },
  required: ["use"],
};

// Every object schema below the root becomes "this object, or a `use` of a
// fragment shaped like it". The expansion pass replaces a reference wherever
// it stands, so the schema admits one wherever an object may stand.
const admitReferences = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(admitReferences);
  if (!isObject(value)) return value;

  const rebuilt: Record<string, JsonValue> = {};
  for (const [key, entry] of entriesOf(value)) {
    if (key === "$ref" && typeof entry === "string") {
      const name = entry.replace(/^#\/\$defs\//, "");
      rebuilt[key] = `#/$defs/${DEFINITION_NAMES[name] ?? name}`;
    } else {
      rebuilt[key] = admitReferences(entry);
    }
  }
  const isObjectSchema = rebuilt.type === "object" && "properties" in rebuilt;
  return isObjectSchema ? { anyOf: [{ $ref: USE_REFERENCE }, rebuilt] } : rebuilt;
};

export const manifestJsonSchema = (): JsonObject => {
  const generated = Schema.toJsonSchemaDocument(Manifest) as unknown as {
    readonly schema: JsonObject;
    readonly definitions: JsonObject;
  };
  const { properties, ...root } = generated.schema;
  if (properties === undefined || !isObject(properties)) {
    throw new Error("the manifest schema generated with no properties");
  }

  const definitions: Record<string, JsonValue> = {};
  for (const [name, definition] of entriesOf(generated.definitions)) {
    definitions[DEFINITION_NAMES[name] ?? name] = admitReferences(definition);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: MANIFEST_SCHEMA_ID,
    title: "Architecture manifest",
    description:
      "One manifest of a repository's architecture, read by @goodbones/cli and @goodbones/oxlint. See https://dataquail.github.io/goodbones/architecture-rules/manifest/.",
    ...root,
    properties: {
      $schema: {
        type: "string",
        description: "For editors. Ignored by the loader.",
      },
      defs: {
        type: "object",
        description:
          'Named fragments, referenced elsewhere in the manifest as `{ use: "<name>" }`. A fragment may itself contain `use`.',
        additionalProperties: true,
      },
      ...Object.fromEntries(
        entriesOf(properties).map(([key, value]) => [key, admitReferences(value)]),
      ),
    },
    $defs: { ...definitions, Use },
  };
};
