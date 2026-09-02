import { readFileSync } from "node:fs";
import * as path from "node:path";

import type { SourceFacts } from "../../domain/facts.js";
import { factsOfText } from "../../infrastructure/fact-extractor-live.js";

export type { SourceFacts } from "../../domain/facts.js";

// Everything the policy needs to know about one file on disk, read once.
export const sourceFactsOf = (repoRoot: string, file: string): SourceFacts =>
  factsOfText(file, readFileSync(path.join(repoRoot, file), "utf8"));
