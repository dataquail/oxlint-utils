import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// Through the barrel on purpose: this is the package's public surface, and a
// re-export that stops resolving is a break no internal test would notice.
import { ConfigInvalid } from "../../index.js";
import { loadPolicy } from "./config-loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
// Inside the package rather than the OS temp dir: Vitest resolves the loader's
// dynamic import through its own module graph, which does not reach outside the
// project root.
const scratch = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.tmp-config-tests",
);
mkdirSync(scratch, { recursive: true });

afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

let counter = 0;
const writeConfig = (source: string): string => {
  counter += 1;
  const name = `config-${String(counter)}.mjs`;
  writeFileSync(path.join(scratch, name), source);
  return path.join(scratch, name);
};

const RESOLVE = `resolve: { scopes: [{ files: "", tsconfig: "tsconfig.resolve.json" }] }`;

// A one-node manifest: a domain folder that may reach only itself.
const TREE = `tree: {
  "packages/server/src/modules/{module}/domain/": {
    message: "domain/ may only reach the contracts tier.",
    imports: {
      message: "domain/ may only reach the contracts tier.",
      allow: ["packages/server/src/modules/{module}/domain/**"],
    },
    children: { "*.root.ts": {} },
  },
}`;

describe("loadPolicy", () => {
  it("compiles a valid policy and builds a resolver for it", async () => {
    const policy = await loadPolicy(
      repoRoot,
      writeConfig(`export default { ${RESOLVE}, ${TREE} };`),
    );

    expect(policy.importRules.map((rule) => rule.name)).toEqual([
      "packages-server-src-modules-module-domain/imports",
    ]);
    expect(policy.resolver.resolve("packages/server/src/server.ts", "node:path")).toBeDefined();
  });

  it("rejects a config whose shape does not decode", async () => {
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { tree: {} };`)),
    ).rejects.toBeInstanceOf(ConfigInvalid);
  });

  it("rejects a config file that cannot be imported at all", async () => {
    await expect(
      loadPolicy(repoRoot, path.join(scratch, "does-not-exist.mjs")),
    ).rejects.toBeInstanceOf(ConfigInvalid);
  });

  // The glob layer escapes most regex metacharacters, so the way to reach an
  // uncompilable pattern is a character class the engine rejects.
  it("rejects an uncompilable pattern rather than loading a rule that matches nothing", async () => {
    const broken = TREE.replace('allow: ["packages/server', 'allow: ["packages/[z-a]server');
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${broken} };`)),
    ).rejects.toThrow(/uncompilable/);
  });

  // The guard the whole package exists for: a rule that no longer reports the
  // violation it was written for must stop the lint run, not pass it.
  it("refuses to load when a rule does not report its own probe", async () => {
    // Widening the allowlist to admit everything leaves a rule that can no
    // longer report the violation it was written for.
    const drifted = TREE.replace(
      'allow: ["packages/server/src/modules/{module}/domain/**"]',
      'allow: ["packages/**"]',
    );
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${drifted} };`)),
    ).rejects.toThrow(/do not report their own probe/);
  });

  // The point of an authored probe. Both members rules below are written the
  // same way; only the snippet differs. The synthetic probe passes both. The
  // real parser reads a member out of the interface and nothing out of the
  // class body — so the second rule is refused at load, today, rather than
  // silently enforcing nothing until someone widens the extractor.
  const membersRuleWith = (probe: string) => `tree: {
    "packages/server/src/modules/{module}/domain/": {
      children: {
        "*.repository.ts": {
          members: [
            {
              message: 'Port method "{name}" is not in the vocabulary.',
              subject: "type-members",
              in: "*RepositoryShape",
              allow: ["findOne"],
              probe: ${probe},
            },
          ],
        },
      },
    },
  }`;

  it("loads a member rule whose source probe the parser reads and the rule reports", async () => {
    const probe = `{ source: "export interface TodosRepositoryShape { findOneById(): void }", name: "findOneById" }`;
    const policy = await loadPolicy(
      repoRoot,
      writeConfig(`export default { ${RESOLVE}, ${membersRuleWith(probe)} };`),
    );
    expect(policy.memberRules).toHaveLength(1);
  });

  it("refuses a member rule whose source probe is a shape the parser does not read", async () => {
    const probe = `{ source: "export class TodosRepositoryShape { findOneById(): void {} }", name: "findOneById" }`;
    await expect(
      loadPolicy(
        repoRoot,
        writeConfig(`export default { ${RESOLVE}, ${membersRuleWith(probe)} };`),
      ),
    ).rejects.toThrow(/architecture facts/);
  });

  it("checks an export restriction's source probe through the parser too", async () => {
    // A default import, against a rule that (by default) covers named bindings only.
    const restriction = `exports: [{
      name: "no-factories",
      message: "A factory is built at a composition root.",
      module: "lib/**",
      symbols: ["makeBus"],
      probe: { source: 'import makeBus from "lib/bus";', symbol: "default" },
    }]`;
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${restriction}, tree: {} };`)),
    ).rejects.toThrow(/no-factories/);
  });

  it("refuses a restriction whose symbols can never meet its kinds", async () => {
    // A default binding is only ever named `default`, so a rule listing both a
    // symbol and the default kind could never fire on either form.
    const restriction = `exports: [{
      name: "contradiction",
      message: "…",
      module: "lib/**",
      symbols: ["makeBus"],
      kinds: ["default"],
    }]`;
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${restriction}, tree: {} };`)),
    ).rejects.toThrow(/contradiction/);
  });

  it("loads a surface rule, and refuses one whose source probe the parser reads nothing from", async () => {
    const tree = (probe: string) => `tree: {
      "packages/web/src/": {
        layout: "open",
        children: {},
        surface: [{ message: "No default exports.", kinds: ["default"], probe: ${probe} }],
      },
    }`;
    const loaded = await loadPolicy(
      repoRoot,
      writeConfig(`export default { ${RESOLVE}, ${tree('{ source: "export default 1;" }')} };`),
    );
    expect(loaded.surfaceRules).toHaveLength(1);

    await expect(
      loadPolicy(
        repoRoot,
        writeConfig(`export default { ${RESOLVE}, ${tree('{ source: "export const x = 1;" }')} };`),
      ),
    ).rejects.toThrow(/surface-0/);
  });

  it("compiles the repo's own policy, so this suite fails if that config breaks", async () => {
    const policy = await loadPolicy(repoRoot);
    expect(policy.importRules.length).toBeGreaterThan(0);
  });
});

describe("uncompilable patterns in the other three families", () => {
  const BROKEN = "[z-a]";

  it("refuses an export restriction whose module pattern cannot compile", async () => {
    const exports = `exports: [{ name: "x", message: "x", module: "**/${BROKEN}/**", symbols: ["y"] }]`;
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${exports}, ${TREE} };`)),
    ).rejects.toThrow(/uncompilable/);
  });

  it("refuses a member rule whose pattern cannot compile", async () => {
    const tree = TREE.replace(
      'children: { "*.root.ts": {} },',
      `children: { "*.root.ts": { members: [{ message: "x", subject: "calls", match: "${BROKEN}" }] } },`,
    );
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${tree} };`)),
    ).rejects.toThrow(/uncompilable/);
  });

  it("refuses a structure rule whose folder pattern cannot compile", async () => {
    const tree = TREE.replace('domain/": {', `domain/${BROKEN}/": {`);
    await expect(
      loadPolicy(repoRoot, writeConfig(`export default { ${RESOLVE}, ${tree} };`)),
    ).rejects.toThrow(/uncompilable/);
  });

  // A config module that exports the manifest directly rather than as a
  // default is the CommonJS-ish shape a `.cjs` policy would produce.
  it("accepts a manifest that is the module itself rather than its default export", async () => {
    const at =
      writeConfig(`export const resolve = { scopes: [{ files: "", tsconfig: "tsconfig.resolve.json" }] };
export const tree = { "packages/server/src/modules/{module}/domain/": { message: "m", imports: { message: "m", allow: ["packages/server/src/modules/{module}/domain/**"] }, children: { "*.root.ts": {} } } };`);
    const policy = await loadPolicy(repoRoot, at);
    expect(policy.importRules.length).toBeGreaterThan(0);
  });
});
