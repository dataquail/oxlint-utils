import * as Schema from "effect/Schema";

// These errors surface through oxlint's plugin loader, which prints a stack and
// nothing else. The `message` override is what turns "ConfigInvalid" into an
// instruction the reader can act on.

export class ConfigInvalid extends Schema.TaggedErrorClass<ConfigInvalid>("ConfigInvalid")(
  "ConfigInvalid",
  { configPath: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.configPath}: ${this.detail}`;
  }
}

export class PatternInvalid extends Schema.TaggedErrorClass<PatternInvalid>("PatternInvalid")(
  "PatternInvalid",
  {
    ruleName: Schema.String,
    field: Schema.String,
    pattern: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `rule "${this.ruleName}" has an uncompilable ${this.field} pattern ${JSON.stringify(
      this.pattern,
    )}: ${this.detail}`;
  }
}

// A `resolve.scopes` entry a language pack cannot build a resolver from: options
// it does not understand, or a language no pack answers to. Raised by the pack,
// without the config path, which the loader adds when it reports it.
export class ScopeInvalid extends Schema.TaggedErrorClass<ScopeInvalid>("ScopeInvalid")(
  "ScopeInvalid",
  {
    files: Schema.String,
    language: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `resolve scope ${JSON.stringify(this.files)} (${this.language}): ${this.detail}`;
  }
}

export class ImportUnresolved extends Schema.TaggedErrorClass<ImportUnresolved>("ImportUnresolved")(
  "ImportUnresolved",
  {
    fromFile: Schema.String,
    specifier: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `${this.fromFile} imports "${this.specifier}", which does not resolve: ${this.detail}`;
  }
}
