export { type Coverage, coverageOf, coverageShortfalls } from "./core/coverage.js";
export { evaluateGraph, type Graph } from "./core/graph.js";
export {
  type CompiledImportRule,
  compileImportRule,
  compileImportRules,
  evaluateImportEdge,
  type ImportEdge,
} from "./core/imports.js";
export {
  type DeclarationKind,
  type GraphConfig,
  type ImportRule,
  type ResolveConfig,
  type ResolveScope,
  type SurfaceRule,
} from "./domain/architecture-config.js";
export {
  ConfigInvalid,
  ImportUnresolved,
  PatternInvalid,
  ScopeInvalid,
} from "./domain/architecture-error.js";
export {
  type Binding,
  type ExportSite,
  type MemberSite,
  type SourceFacts,
} from "./domain/facts.js";
export {
  fingerprintOf,
  formatMessage,
  type Violation,
  type ViolationKind,
} from "./domain/violation.js";
export { makeFactExtractorFake } from "./infrastructure/fact-extractor-fake.js";
export { factsOfText, makeFactExtractorLive } from "./infrastructure/fact-extractor-live.js";
export { typescriptLanguage } from "./infrastructure/languages/typescript/index.js";
export {
  decodeTypescriptScopeOptions,
  type TypescriptScopeOptions,
} from "./infrastructure/languages/typescript/options.js";
export { makeModuleResolverFake } from "./infrastructure/module-resolver-fake.js";
export { makeModuleResolverLive } from "./infrastructure/module-resolver-live.js";
export { type LoweredRules, lowerManifest } from "./manifest/compile.js";
export {
  type DecodedManifest,
  decodeManifest,
  type Manifest,
  type ManifestNode,
  Manifest as ManifestSchema,
} from "./manifest/manifest.js";
export { type FactExtractor } from "./ports/fact-extractor.js";
export { type Language } from "./ports/language.js";
export { type ModuleResolver, type ResolvedTarget } from "./ports/module-resolver.js";
