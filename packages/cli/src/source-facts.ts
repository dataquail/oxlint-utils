import { readFileSync } from "node:fs";
import * as path from "node:path";

import type { FactExtractor, SourceFacts } from "@goodbones/core";

export type { SourceFacts } from "@goodbones/core";

// Everything the policy needs to know about one file on disk, read once,
// through the extractor of whichever language the policy routes the file to.
export const sourceFactsOf = (
  repoRoot: string,
  file: string,
  extractor: FactExtractor,
): SourceFacts => extractor.factsOf(file, readFileSync(path.join(repoRoot, file), "utf8"));
