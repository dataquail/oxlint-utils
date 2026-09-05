import { readFileSync } from "node:fs";
import * as path from "node:path";

import type { SourceFacts } from "../../domain/facts.js";
import type { FactExtractor } from "../../ports/fact-extractor.js";

export type { SourceFacts } from "../../domain/facts.js";

// Everything the policy needs to know about one file on disk, read once,
// through the extractor of whichever language the policy routes the file to.
export const sourceFactsOf = (
  repoRoot: string,
  file: string,
  extractor: FactExtractor,
): SourceFacts => extractor.factsOf(file, readFileSync(path.join(repoRoot, file), "utf8"));
