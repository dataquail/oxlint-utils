import * as path from "node:path";
import { type ViteUserConfig } from "vitest/config";

// A package's own tests can import it by its published name (`oxlint-architecture-rules`),
// the same specifier a consumer writes. `TEST_DIST=1` points that specifier at the built
// output instead of `src`, so the suite can be re-run against what `tsc -b tsconfig.build.json`
// actually emitted. Note that `nx run-many -t test` does not key its cache on `TEST_DIST`,
// so going through Nx will replay the `src` run — invoke vitest directly in the package to
// actually exercise `build/esm`.
const alias = (name: string) => {
  const target = process.env.TEST_DIST !== undefined ? "build/esm" : "src";
  return {
    [name]: path.join(__dirname, "packages", name, target),
  };
};

const config: ViteUserConfig = {
  esbuild: {
    target: "es2020",
  },
  test: {
    onConsoleLog: (log) => {
      console.log(log);
    },
    setupFiles: [path.join(__dirname, "setupTests.ts")],
    fakeTimers: {
      toFake: undefined,
    },
    sequence: {
      concurrent: true,
    },
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    alias: {
      ...alias("oxlint-architecture-rules"),
    },
  },
};

export default config;
