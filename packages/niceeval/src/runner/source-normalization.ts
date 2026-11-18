import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import type { ParserOptions } from "oxc-parser";
import * as Schema from "effect/Schema";
import { decodeJsonRecord } from "../shared/json-value.ts";

const VERSION = "0.158.0";
export const SOURCE_PARSER_IDENTITY = `oxc-parser@${VERSION}`;
const parserRequireAtRuntime = createRequire(import.meta.url);
export type SyntaxNode = {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
};
const SyntaxNodeSchema = Schema.declare<SyntaxNode>(
  Schema.is(
    Schema.StructWithRest(
      Schema.Struct({
        type: Schema.String,
        start: Schema.Number,
        end: Schema.Number,
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
);
const decodeSyntaxTree = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ node: SyntaxNodeSchema })));
export type SourceComment = { readonly start: number; readonly end: number; readonly value: string };
type Comment = SourceComment;
/** UTF-16 ranges; values occupy a separate identity channel, never source text. */
export interface SourceReplacement {
  readonly start: number;
  readonly end: number;
  readonly value: unknown;
}
type Binding = {
  parseSync(
    filename: string,
    source: string,
    options: ParserOptions,
  ): {
    readonly program: string;
    readonly comments: readonly Comment[];
    readonly errors: readonly {
      readonly message: string;
      readonly labels: readonly { readonly start: number; readonly end: number }[];
    }[];
  };
};

export class SourceParserEnvironmentError extends Error {
  readonly _tag = "SourceParserEnvironmentError";
  constructor(message: string) {
    super(`SourceParserEnvironmentError: ${message}`);
    this.name = this._tag;
  }
}
export class SourceParseError extends Error {
  readonly _tag = "SourceParseError";
  constructor(
    readonly file: string,
    readonly line: number,
    readonly column: number,
    message: string,
  ) {
    super(
      `SourceParseError: ${file}:${line}:${column}: ${message}. Historical Runs remain readable with a fixed Run selector.`,
    );
    this.name = this._tag;
  }
}
let binding: Binding | undefined;
function nativeBinding(): Binding {
  const overrides = Object.keys(process.env)
    .filter((name) => name.startsWith("NAPI_RS_"))
    .sort();
  if (overrides.length > 0)
    throw new SourceParserEnvironmentError(`Unsupported environment variables: ${overrides.join(", ")}`);
  if (binding !== undefined) return binding;
  // Never execute oxc's bindings.js: it permits environment overrides and WASI / install fallbacks.
  let target = `${process.platform}-${process.arch}`;
  if (process.platform === "linux") {
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
    function linuxAbi(): string {
      if (process.arch === "arm") return report.header?.glibcVersionRuntime ? "-gnueabihf" : "-musleabihf";
      return report.header?.glibcVersionRuntime ? "-gnu" : "-musl";
    }
    target += linuxAbi();
  } else if (process.platform === "win32") target += "-msvc";
  else if (process.platform === "android" && process.arch === "arm") target += "-eabi";
  const name = `@oxc-parser/binding-${target}`;
  try {
    const parserPath = parserRequireAtRuntime.resolve("oxc-parser/package.json");
    const parserRequire = createRequire(parserPath);
    if (parserRequire("./package.json").version !== VERSION) throw new Error(`oxc-parser must be ${VERSION}`);
    const version = parserRequire(`${name}/package.json`).version;
    if (version !== VERSION) throw new Error(`binding version ${version}; expected ${VERSION}`);
    binding = parserRequire(name) as Binding;
    return binding;
  } catch (cause) {
    throw new SourceParserEnvironmentError(
      `${process.platform}/${process.arch} requires ${name}@${VERSION}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
export function syntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "start" in value &&
    "end" in value
  );
}
export function childNodes(node: SyntaxNode): SyntaxNode[] {
  return Object.values(node).flatMap(function childSyntaxNodes(value) {
    if (Array.isArray(value)) return value.filter(syntaxNode);
    return syntaxNode(value) ? [value] : [];
  });
}
export function walkSyntax(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of childNodes(node)) walkSyntax(child, visit);
}
export function sourcePosition(source: string, index: number): { line: number; column: number } {
  const lines = source.slice(0, index).split(/\r\n|[\n\r\u2028\u2029]/u);
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}
export const isCodeSource = (file: string): boolean => /\.[cm]?[jt]sx?$/u.test(file);
function moduleType(file: string): "module" | "commonjs" {
  if (/\.(?:mjs|mts)$/u.test(file)) return "module";
  if (/\.(?:cjs|cts)$/u.test(file)) return "commonjs";
  let dir = dirname(file);
  for (;;) {
    try {
      const pkg = decodeJsonRecord(readFileSync(join(dir, "package.json"), "utf8"));
      return pkg.type === "module" ? "module" : "commonjs";
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
    const parent = dirname(dir);
    if (parent === dir) return "commonjs";
    dir = parent;
  }
}
export function parseSource(
  file: string,
  source: string,
  transformed = false,
): { program: SyntaxNode; comments: readonly Comment[]; language: string; mode: string } {
  const extension = extname(file);
  function sourceLanguage() {
    if (transformed) return "js" as const;
    if (extension === ".tsx") return "tsx" as const;
    if (extension === ".jsx") return "jsx" as const;
    return /\.[cm]?ts$/u.test(extension) ? ("ts" as const) : ("js" as const);
  }
  const lang = sourceLanguage();
  const sourceType = transformed ? "commonjs" : moduleType(file);
  const parsed = nativeBinding().parseSync(file, source, { lang, sourceType, astType: "ts", preserveParens: true });
  const first = parsed.errors[0];
  if (first !== undefined) {
    const pos = sourcePosition(source, first.labels[0]?.start ?? 0);
    throw new SourceParseError(file, pos.line, pos.column, `${lang}/${sourceType}: ${first.message}`);
  }
  // The binding's serialized tree uses UTF-16 ranges. RegExp / BigInt value repair is unnecessary:
  // identity uses raw lexemes and dependency specifiers are string literals only.
  const program = decodeSyntaxTree(parsed.program).node;
  return { program, comments: parsed.comments, language: lang, mode: sourceType };
}
const lineTerminator = /[\n\r\u2028\u2029]/u;
const whitespace = /[\u0009\u000b\u000c\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff\n\r\u2028\u2029]+/gu;
export function normalizeSource(source: string, program: SyntaxNode, comments: readonly Comment[]): string {
  return normalizedSourceParts(source, program, comments).join("");
}
// @concord-code
// @concord-implements docs/feature/experiments/architecture/source-identity.md#规范化规则
export function normalizedSourceParts(
  source: string,
  program: SyntaxNode,
  comments: readonly Comment[],
  replacements: readonly SourceReplacement[] = [],
  omitted: readonly { readonly start: number; readonly end: number }[] = [],
): readonly (string | { readonly replacement: unknown })[] {
  const edits = [...replacements, ...omitted].toSorted((a, b) => a.start - b.start || b.end - a.end);
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]!;
    if (
      edit.start < 0 ||
      edit.end > source.length ||
      edit.end <= edit.start ||
      (index > 0 && edit.start < edits[index - 1]!.end)
    ) {
      throw new Error("Source identity replacements must be disjoint UTF-16 ranges.");
    }
  }
  const spans: {
    start: number;
    end: number;
    text: string;
    edit?: SourceReplacement | { readonly start: number; readonly end: number };
  }[] = edits.map((edit) => ({ ...edit, text: "", edit }));
  const protect = (span: { start: number; end: number; text: string }): void => {
    if (!edits.some((edit) => edit.start < span.end && span.start < edit.end)) spans.push(span);
  };
  walkSyntax(program, (node) => {
    if (
      node.type === "Literal" ||
      node.type === "TemplateElement" ||
      node.type === "JSXText" ||
      node.type === "Hashbang"
    ) {
      protect({ start: node.start, end: node.end, text: source.slice(node.start, node.end) });
    }
  });
  if (source.startsWith("#!")) {
    const end = source.search(/[\n\r\u2028\u2029]/u);
    protect({
      start: 0,
      end: end === -1 ? source.length : end,
      text: source.slice(0, end === -1 ? source.length : end),
    });
  }
  for (const comment of comments) {
    const raw = source.slice(comment.start, comment.end);
    // jiti 2.7.0's Babel JSX / TypeScript transforms recognize @jsx, @jsxFrag,
    // @jsxRuntime and @jsxImportSource. Preserve unknown JSX pragmas conservatively.
    const directive = /@jsx\w*\b/u.test(comment.value);
    function normalizedComment(): string {
      if (directive) return raw;
      return lineTerminator.test(raw) ? "\n" : " ";
    }
    protect({
      start: comment.start,
      end: comment.end,
      text: normalizedComment(),
    });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  let output = "",
    cursor = 0,
    pending = "";
  const parts: (string | { readonly replacement: unknown })[] = [];
  const hasOutput = (): boolean => output !== "" || parts.length > 0;
  const trivia = (text: string): void => {
    let last = 0;
    for (const match of text.matchAll(whitespace)) {
      if (match.index! > last) {
        output += (hasOutput() ? pending : "") + text.slice(last, match.index);
        pending = "";
      }
      pending = lineTerminator.test(pending + match[0]) ? "\n" : " ";
      last = match.index! + match[0].length;
    }
    if (last < text.length) {
      output += (hasOutput() ? pending : "") + text.slice(last);
      pending = "";
    }
  };
  for (const span of spans) {
    if (span.start < cursor) continue;
    trivia(source.slice(cursor, span.start));
    if (span.edit !== undefined) {
      if ("value" in span.edit) {
        output += hasOutput() ? pending : "";
        if (output !== "") parts.push(output);
        parts.push({ replacement: span.edit.value });
        output = "";
        pending = "";
      }
    } else if (span.text === " " || span.text === "\n") trivia(span.text);
    else {
      output += (hasOutput() ? pending : "") + span.text;
      pending = "";
    }
    cursor = span.end;
  }
  trivia(source.slice(cursor));
  if (output !== "") parts.push(output);
  return parts;
}
export function sourceIdentity(file: string, bytes: Uint8Array): string {
  if (!isCodeSource(file)) return createHash("sha256").update(bytes).digest("hex");
  const source = Buffer.from(bytes).toString("utf8");
  const parsed = parseSource(file, source);
  return normalizedIdentity(normalizeSource(source, parsed.program, parsed.comments));
}
export const normalizedIdentity = (source: string): string => createHash("sha256").update(source).digest("hex");
