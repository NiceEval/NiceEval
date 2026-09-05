import { createHash } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { stringify as stringifyYaml } from "yaml";

import {
  editorInputFinding,
  editorStateComment,
  emptyPrBodyEditorState,
  renderEditorState,
  updateEditorState,
} from "./editor.js";
import {
  PrBodyCheckFailed,
  PrDraftInvalid,
  PrInputInvalid,
  PrInternalFailure,
  PrMutationRejected,
  PrRemoteHeadMismatch,
  PrTestRelationInvalid,
  type PrBodyError,
} from "./errors.js";
import {
  DEFAULT_PR_BODY_BUDGET,
  GITHUB_BODY_LIMIT,
  type ByteReport,
  type DraftMetadata,
  type EditPrBodyInput,
  type FinalMetadata,
  type PrBodyEditorState,
  type PrBodyInput,
  type PrBodyOutcome,
  type RenderedBody,
  type TestDirective,
} from "./model.js";
import {
  decodeDraftMetadata,
  decodePrBodyEditorState,
  decodePrBodyInput,
  decodeTestDirective,
  decodeTestRelations,
} from "./schema.js";
import { PrFileSystem, PrGit, PrGitHub, type PrBodyRequirements } from "./services.js";
import { testingOwnerContracts } from "../docs/trace/compiler.js";

export const PR_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

interface Template {
  readonly text: string;
  readonly hash: string;
}

interface ManagedBody {
  readonly authored: string;
  readonly suffix?: string;
}

function draftFailure(source: string, message: string): PrDraftInvalid {
  return new PrDraftInvalid({ source, message });
}

function pure<A>(operation: string, thunk: () => A): Effect.Effect<A, PrBodyError> {
  return Effect.try({
    try: thunk,
    catch: (cause) => cause instanceof PrDraftInvalid || cause instanceof PrInputInvalid
      ? cause
      : new PrInternalFailure({ operation, cause }),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadataComment(metadata: DraftMetadata | FinalMetadata): string {
  return `<!-- niceeval:pr-body\n${stringifyYaml(metadata).trimEnd()}\n-->`;
}

function stripAuthoringComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function uniqueLineIndex(lines: readonly string[], anchor: string, label: string, path: string): number {
  const exact = lines.flatMap((line, index) => line === anchor ? [index] : []);
  const matches = exact.length === 0 && anchor === anchor.trim()
    ? lines.flatMap((line, index) => line.trim() === anchor ? [index] : [])
    : exact;
  if (matches.length !== 1) {
    throw draftFailure(path, `${label} anchor must identify one complete line; found ${matches.length}: ${JSON.stringify(anchor)}`);
  }
  return matches[0]!;
}

function omissionMarker(path: string, before: string, after: string, reason: string): string {
  if (!before.trim() || !after.trim()) throw draftFailure(path, "omission anchors cannot be blank lines");
  if (reason.includes("\n") || reason.includes(";")) {
    throw draftFailure(path, "omission reason must be one line without semicolons");
  }
  return `// … omitted: file=${path}; before=${before}; after=${after}; reason=${reason}`;
}

function nearestUniqueLine(
  lines: readonly string[],
  indices: readonly number[],
  label: string,
  path: string,
): string {
  for (const index of indices) {
    const candidate = lines[index];
    if (candidate !== undefined && candidate.trim() && lines.filter((line) => line === candidate).length === 1) {
      return candidate;
    }
  }
  throw draftFailure(path, `cannot find a unique non-blank ${label} omission anchor; retain more source around the boundary`);
}

function changedFinalLines(diff: string): Set<number> {
  const changed = new Set<number>();
  for (const line of diff.split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let index = start; index < start + count; index++) changed.add(index);
  }
  return changed;
}

function renderSelectedFragments(
  path: string,
  source: string,
  spec: Exclude<TestDirective["source"], "full" | "link" | undefined>,
  changed: ReadonlySet<number>,
): string {
  if (!spec.reason.trim()) throw draftFailure(path, "fragment source requires a non-empty reason");
  const lines = source.split("\n");
  const ranges = spec.fragments.map((fragment, index) => {
    const start = fragment.from === "<BOF>"
      ? 0
      : uniqueLineIndex(lines, fragment.from, `fragment ${index + 1} from`, path);
    const end = fragment.through === "<EOF>"
      ? lines.length - 1
      : uniqueLineIndex(lines, fragment.through, `fragment ${index + 1} through`, path);
    if (end < start) throw draftFailure(path, `fragment ${index + 1} ends before it starts`);
    return { start, end };
  }).sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]!.start <= ranges[index - 1]!.end) throw draftFailure(path, "source fragments overlap");
  }
  const included = new Set<number>();
  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index++) included.add(index + 1);
  }
  const missed = [...changed].filter((line) => !included.has(line));
  if (missed.length) {
    throw draftFailure(path, `fragments omit base→working-tree changed final lines: ${missed.join(", ")}`);
  }
  const rendered: string[] = [];
  let previousEnd = -1;
  for (const range of ranges) {
    if (range.start > previousEnd + 1) {
      const before = previousEnd >= 0
        ? lines[previousEnd]!
        : nearestUniqueLine(
            lines,
            Array.from({ length: range.start }, (_unused, index) => range.start - index - 1),
            "before",
            path,
          );
      rendered.push(omissionMarker(path, before, lines[range.start]!, spec.reason));
    }
    rendered.push(lines.slice(range.start, range.end + 1).join("\n"));
    previousEnd = range.end;
  }
  if (previousEnd < lines.length - 1) {
    const after = nearestUniqueLine(
      lines,
      Array.from(
        { length: lines.length - previousEnd - 1 },
        (_unused, index) => previousEnd + index + 1,
      ),
      "after",
      path,
    );
    rendered.push(omissionMarker(path, lines[previousEnd]!, after, spec.reason));
  }
  return rendered.join("\n");
}

interface RenderContext {
  readonly head?: string | undefined;
  readonly linkTarget?: Pick<import("./model.js").GitHubPullRequest, "headRepository" | "baseRefOid" | "baseRefName" | "baseRepository"> | undefined;
  readonly inputFiles: Set<string>;
  sourceLinkPreviewShown?: boolean;
}

function sourceLink(target: NonNullable<RenderContext["linkTarget"]>, base: string, head: string, path: string): string {
  const repository = target.headRepository;
  return [
    `[Complete final source](https://github.com/${repository}/blob/${head}/${path})`,
    `[${target.baseRefName} merge-base → head diff](https://github.com/${repository}/compare/${base}...${head})`,
  ].join(" · ");
}

function githubRepositoryFromRemote(remote: string): string | undefined {
  const match = /(?:github\.com[/:])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote);
  return match?.[1];
}

function pendingCreateTarget(
  base: string,
): Effect.Effect<NonNullable<RenderContext["linkTarget"]>, PrBodyError, PrGit | PrGitHub> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const github = yield* PrGitHub;
    const upstream = yield* git.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFailure: true });
    if (!upstream || !upstream.includes("/")) {
      return yield* Effect.fail(new PrMutationRejected({ action: "create", message: "create source=link requires a GitHub upstream for the current branch" }));
    }
    const remote = upstream.slice(0, upstream.indexOf("/"));
    const remoteUrl = yield* git.run(["remote", "get-url", remote]);
    const headRepository = githubRepositoryFromRemote(remoteUrl);
    if (headRepository === undefined) {
      return yield* Effect.fail(new PrMutationRejected({ action: "create", message: `create source=link requires a parseable GitHub upstream URL; got ${remoteUrl}` }));
    }
    const baseRefOid = yield* git.run(["rev-parse", `origin/${base}`], { allowFailure: true });
    if (!baseRefOid) {
      return yield* Effect.fail(new PrMutationRejected({ action: "create", message: `create source=link requires local origin/${base} for its pending target base` }));
    }
    return { headRepository, baseRefOid, baseRefName: base, baseRepository: yield* github.repository() };
  });
}

function codeLanguage(path: string): string {
  return ({ js: "js", jsx: "jsx", mjs: "js", cjs: "js", ts: "ts", tsx: "tsx" } as Record<string, string>)[
    extname(path).slice(1)
  ] ?? "text";
}

function sectionMap(markdown: string): Map<string, string> {
  const matches = [...markdown.matchAll(/^## (.+)$/gm)];
  const sections = new Map<string, string>();
  matches.forEach((match, index) => sections.set(
    match[1]!.trim(),
    markdown.slice(match.index! + match[0].length, matches[index + 1]?.index ?? markdown.length),
  ));
  return sections;
}

function templateSections(template: string): string[] {
  return [...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim());
}

function templatePlaceholders(template: string): string[] {
  return [...new Set([...stripAuthoringComments(template).matchAll(/<[^>\n]+>/g)].map((match) => match[0]))];
}

function requireBulletFields(errors: string[], label: string, block: string, fields: readonly string[]): void {
  for (const field of fields) {
    if (!new RegExp(`^- ${field}:`, "m").test(block)) errors.push(`${label} is missing - ${field}:`);
  }
}

function headingContent(block: string, level: number, name: string): string | undefined {
  const marker = "#".repeat(level);
  const headings = [...block.matchAll(new RegExp(`^${marker} (.+)$`, "gm"))];
  const index = headings.findIndex((heading) => heading[1]!.trim() === name);
  if (index === -1) return undefined;
  return block.slice(
    headings[index]!.index! + headings[index]![0].length,
    headings[index + 1]?.index ?? block.length,
  ).trim();
}

function requireHeadingFields(
  errors: string[],
  label: string,
  block: string,
  level: number,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = headingContent(block, level, field);
    if (value === undefined) errors.push(`${label} is missing ${"#".repeat(level)} ${field}`);
    else if (!value) errors.push(`${label} has an empty ${"#".repeat(level)} ${field}`);
  }
}

function fencedBlockCount(content: string | undefined): number {
  return content ? [...content.matchAll(/^```[^\n]*\n[\s\S]*?^```\s*$/gm)].length : 0;
}

function requireFences(
  errors: string[],
  label: string,
  content: string | undefined,
  count: number,
): void {
  if (content !== undefined && fencedBlockCount(content) < count) {
    errors.push(`${label} requires at least ${count} fenced code block${count === 1 ? "" : "s"}`);
  }
}

function validateCaseDirections(errors: string[], name: string, content: string): void {
  const directions = [...content.matchAll(/^### (?:Removed|Added|Changed|Added terms|Removed terms)$/gm)];
  for (const [index, heading] of directions.entries()) {
    const block = content.slice(
      heading.index! + heading[0].length,
      directions[index + 1]?.index ?? content.length,
    );
    if (!/^#### Case: .+$/m.test(block)) errors.push(`${name} ${heading[0]} must be omitted when it has no cases`);
  }
}

function caseDirection(content: string, caseIndex: number): string | undefined {
  return [...content.slice(0, caseIndex).matchAll(/^### (Removed|Added|Changed)$/gm)].at(-1)?.[1];
}

function validateProductCaseSection(errors: string[], name: string, content: string): void {
  const cases = [...content.matchAll(/^#### Case: .+$/gm)];
  if (!cases.length) errors.push(`${name} must be omitted when it has no cases`);
  validateCaseDirections(errors, name, content);
  for (const [index, heading] of cases.entries()) {
    const block = content.slice(heading.index! + heading[0].length, cases[index + 1]?.index ?? content.length);
    const label = `${name} ${heading[0]}`;
    requireHeadingFields(errors, label, block, 5, ["Before", "After", "User impact"]);
    requireFences(errors, `${label} Before`, headingContent(block, 5, "Before"), 2);
    const removed = caseDirection(content, heading.index!) === "Removed";
    requireFences(errors, `${label} After`, headingContent(block, 5, "After"), removed ? 1 : 2);
  }
}

function subsection(content: string, name: string): string | undefined {
  const headings = [...content.matchAll(/^### (.+)$/gm)];
  const index = headings.findIndex((heading) => heading[1]!.trim() === name);
  if (index === -1) return undefined;
  return content.slice(
    headings[index]!.index! + headings[index]![0].length,
    headings[index + 1]?.index ?? content.length,
  );
}

export function validatePrBodyStructure(
  body: string,
  metadata: FinalMetadata,
  template: string,
): readonly string[] {
  const errors: string[] = [];
  const content = body.replace(/<!-- niceeval:pr-body\s*\n[\s\S]*?\n-->/, "");
  const sections = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim());
  const allowed = templateSections(template);
  const seen = new Set<string>();
  let previous = -1;
  for (const section of sections) {
    if (seen.has(section)) errors.push(`duplicate section: ${section}`);
    seen.add(section);
    const index = allowed.indexOf(section);
    if (index === -1) errors.push(`section is not in the PR template: ${section}`);
    else if (index < previous) errors.push(`section is out of template order: ${section}`);
    else previous = index;
  }
  if (!seen.has("Problem")) errors.push("required section is missing: Problem");
  for (const placeholder of templatePlaceholders(template)) {
    if (content.includes(placeholder)) errors.push(`unresolved template placeholder: ${placeholder}`);
  }
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  if (/^\s*(?:[-*]\s*)?None(?:\s*(?:—|-).*)?\.?\s*$/gim.test(prose)) {
    errors.push('empty content must be omitted instead of written as "None"');
  }
  for (const literal of metadata.forbid ?? []) {
    if (content.includes(literal)) errors.push(`forbidden stale text remains: ${JSON.stringify(literal)}`);
  }
  for (const field of [
    "Coverage",
    "Starting point",
    "Copyable usage or trigger",
    "Observable result or diagnostic",
    "Contract",
    "Before usage or result",
    "After usage or result",
    "User impact",
  ]) {
    if (new RegExp(`^- ${field}:`, "m").test(content)) errors.push(`legacy summary field remains: - ${field}:`);
  }
  const sectionsByName = sectionMap(content);
  const problem = sectionsByName.get("Problem");
  if (problem) {
    requireBulletFields(errors, "Problem", problem, [
      "User goal",
      "Current limitation",
      "Required capability",
      "User outcome",
    ]);
  }
  const useCases = sectionsByName.get("Use cases");
  if (useCases) {
    validateCaseDirections(errors, "Use cases", useCases);
    const cases = [...useCases.matchAll(/^#### Case: .+$/gm)];
    if (!cases.length) errors.push("Use cases must be omitted when it has no cases");
    for (const [index, heading] of cases.entries()) {
      const block = useCases.slice(heading.index! + heading[0].length, cases[index + 1]?.index ?? useCases.length);
      requireHeadingFields(errors, heading[0], block, 5, ["Starting state", "Action", "Result"]);
      for (const field of ["Starting state", "Action", "Result"]) {
        requireFences(errors, `${heading[0]} ${field}`, headingContent(block, 5, field), 1);
      }
      if (!/\[Canonical Use Case\]\(docs\/feature\/.+\/use-case\/.+\.md(?:#[A-Za-z0-9._-]+)?\)/.test(block)) errors.push(`${heading[0]} must link its canonical leaf Use Case`);
    }
  }
  for (const name of ["Public API", "CLI", "Report components", "Observable behavior and data contracts"]) {
    const section = sectionsByName.get(name);
    if (section) validateProductCaseSection(errors, name, section);
  }
  const environment = sectionsByName.get("Environment variables");
  if (environment) {
    const cases = [...environment.matchAll(/^#### Case: .+$/gm)];
    if (!cases.length) errors.push("Environment variables must be omitted when it has no cases");
    validateCaseDirections(errors, "Environment variables", environment);
    for (const [index, heading] of cases.entries()) {
      const block = environment.slice(
        heading.index! + heading[0].length,
        cases[index + 1]?.index ?? environment.length,
      );
      const label = `Environment variables ${heading[0]}`;
      requireHeadingFields(errors, label, block, 5, [
        "Before",
        "After",
        "Environment boundary",
        "User and security impact",
      ]);
      requireFences(errors, `${label} Before`, headingContent(block, 5, "Before"), 2);
      const removed = caseDirection(environment, heading.index!) === "Removed";
      requireFences(errors, `${label} After`, headingContent(block, 5, "After"), removed ? 1 : 2);
      if (!removed) requireHeadingFields(errors, label, block, 5, ["Necessity"]);
    }
  }
  const packageScripts = sectionsByName.get("Package scripts");
  if (packageScripts) validateProductCaseSection(errors, "Package scripts", packageScripts);
  const terminology = sectionsByName.get("Terminology");
  if (terminology) validateProductCaseSection(errors, "Terminology", terminology);
  const record = sectionsByName.get("Record schema and stored-data upgrade");
  if (record) {
    for (const [name, fields] of [
      ["Case: write a new Record", ["Action", "Result"]],
      ["Case: read an existing Record", ["Action", "Result"]],
      [
        "Case: upgrade or recover stored data",
        ["Version", "Before", "After", "Safety", "User impact", "Evidence"],
      ],
    ] as const) {
      const block = subsection(record, name);
      if (block !== undefined) requireHeadingFields(errors, `Record ${name}`, block, 4, fields);
    }
  }
  const tests = sectionsByName.get("Tests");
  if (tests) {
    if (!/^### `e2e\/.+`$/m.test(tests)) errors.push("Tests must contain at least one test file");
    if (/^- (?:Owner|Covers|Purpose|Protects|Regression|Runs|Asserts):/m.test(tests)) errors.push("Tests must use readable case narratives, not Name: value fields");
  }
  return errors;
}

export function byteReport(body: string): ByteReport {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  const rows = matches.map((match, index) => ({
    name: match[1]!.trim(),
    bytes: Buffer.byteLength(body.slice(match.index!, matches[index + 1]?.index ?? body.length)),
  })).sort((left, right) => right.bytes - left.bytes);
  const width = Math.max(7, ...rows.map((row) => row.name.length));
  const totalBytes = Buffer.byteLength(body);
  const text = [
    `PR body: ${totalBytes.toLocaleString("en-US")} bytes`,
    ...rows.map((row) => `${row.name.padEnd(width)}  ${row.bytes.toLocaleString("en-US").padStart(8)}`),
  ].join("\n");
  return Object.freeze({ totalBytes, rows: Object.freeze(rows), text });
}

function splitManagedBody(body: string): ManagedBody {
  const startMarker = "<!-- codesmith:footer -->";
  const endMarker = "<!-- /codesmith:footer -->";
  const start = body.indexOf(startMarker);
  if (start === -1) return { authored: `${body.trimEnd()}\n` };
  const end = body.indexOf(endMarker, start + startMarker.length);
  if (end === -1 || body.slice(end + endMarker.length).trim()) return { authored: `${body.trimEnd()}\n` };
  return {
    authored: `${body.slice(0, start).trimEnd()}\n`,
    suffix: body.slice(start, end + endMarker.length).trim(),
  };
}

function managedDraftState(draft: string): "managed" | "unmanaged" {
  const metadataBlocks = [...draft.matchAll(/<!-- niceeval:pr-body\s*\n([\s\S]*?)\n-->/g)];
  const editorBlocks = [...draft.matchAll(/<!-- niceeval:pr-editor\s*\n([\s\S]*?)\n-->/g)];
  return metadataBlocks.length === 1 && editorBlocks.length === 1 ? "managed" : "unmanaged";
}

function validateInput(input: PrBodyInput): Effect.Effect<PrBodyInput, PrInputInvalid> {
  if (input.command === "check" && input.remote === true && input.pr === undefined) {
    return Effect.fail(new PrInputInvalid({ message: "remote comparison requires --pr" }));
  }
  if (input.command === "edit") {
    const finding = editorInputFinding(input);
    if (finding !== undefined) return Effect.fail(new PrInputInvalid({ message: finding }));
  }
  return Effect.succeed(input);
}

function currentTemplate(root: string): Effect.Effect<Template, PrBodyError, PrFileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const text = yield* fileSystem.readText(resolve(root, ".github/PULL_REQUEST_TEMPLATE.md"));
    return { text, hash: sha256(text) };
  });
}

function pinnedTemplate(context: RenderContext): Effect.Effect<Template, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const path = ".github/PULL_REQUEST_TEMPLATE.md";
    context.inputFiles.add(path);
    const text = yield* (yield* PrGit).readBlob(context.head!, path);
    return { text, hash: sha256(text) };
  });
}

function currentBranchDraftPath(): Effect.Effect<string | undefined, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const branch = yield* git.run(["branch", "--show-current"]);
    if (!branch) return undefined;
    const gitDir = yield* git.run(["rev-parse", "--absolute-git-dir"]);
    const label = branch
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "branch";
    return resolve(gitDir, "niceeval", "pr-body", `${label}-${sha256(branch).slice(0, 12)}.md`);
  });
}

function resolveDraftPath(
  root: string,
  input: PrBodyInput,
): Effect.Effect<string, PrBodyError, PrGit> {
  if (input.source !== undefined) return Effect.succeed(resolve(root, input.source));
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const gitDir = yield* git.run(["rev-parse", "--absolute-git-dir"]);
    const pr = "pr" in input ? input.pr : undefined;
    if (pr !== undefined) return resolve(gitDir, "niceeval", "pr-body", `${pr}.md`);
    const branchDraft = yield* currentBranchDraftPath();
    if (branchDraft === undefined) {
      return yield* Effect.fail(new PrInputInvalid({
        message: "the default draft path requires a named branch; pass --source <path>",
      }));
    }
    return branchDraft;
  });
}

function resolveReadableDraftPath(
  root: string,
  input: PrBodyInput,
): Effect.Effect<string, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const target = yield* resolveDraftPath(root, input);
    if (yield* fileSystem.exists(target)) return target;
    const pr = "pr" in input ? input.pr : undefined;
    if (input.source === undefined && pr !== undefined && input.command !== "init") {
      const branchDraft = yield* currentBranchDraftPath();
      if (branchDraft !== undefined && (yield* fileSystem.exists(branchDraft))) return branchDraft;
    }
    return target;
  });
}

function defaultBase(): Effect.Effect<string, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const mergeBase = yield* git.run(["merge-base", "HEAD", "origin/main"], { allowFailure: true });
    return mergeBase || (yield* git.run(["rev-parse", "HEAD"]));
  });
}

function repositoryFile(
  root: string,
  path: string,
): Effect.Effect<Readonly<{ absolute: string; relative: string }>, PrBodyError, PrFileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const absolute = resolve(root, path);
    const repoRelative = relative(root, absolute).replaceAll("\\", "/");
    if (!repoRelative || repoRelative.startsWith("../") || repoRelative === "..") {
      return yield* Effect.fail(draftFailure(path, `source path must be a file inside the repository: ${path}`));
    }
    if (!(yield* fileSystem.exists(absolute))) {
      return yield* Effect.fail(draftFailure(path, `source file does not exist: ${repoRelative}`));
    }
    return { absolute, relative: repoRelative };
  });
}

function expandTestDirective(
  root: string,
  sourcePath: string,
  yaml: string,
  base: string,
  context: RenderContext,
): Effect.Effect<Readonly<{ markdown: string; file: string }>, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const git = yield* PrGit;
    const directive = yield* decodeTestDirective(sourcePath, yaml);
    const file = yield* repositoryFile(root, directive.path);
    context.inputFiles.add(file.relative);
    const firstSelector = directive.cases[0]!.selector;
    const sidecarPath = `${directive.path}.cases.json`;
    const sidecarAbsolute = resolve(root, sidecarPath);
    if (!(yield* fileSystem.exists(sidecarAbsolute))) return yield* new PrTestRelationInvalid({ selector: firstSelector, message: `case relation sidecar does not exist: ${sidecarPath}` });
    context.inputFiles.add(sidecarPath);
    const relations = yield* decodeTestRelations(firstSelector, context.head === undefined
      ? yield* fileSystem.readText(sidecarAbsolute)
      : yield* git.readBlob(context.head, sidecarPath));
    if (relations.testFile !== file.relative) return yield* new PrTestRelationInvalid({ selector: firstSelector, message: `sidecar points to ${relations.testFile}, expected ${file.relative}` });
    const narratives: string[] = [];
    for (const item of directive.cases) {
      const separator = item.selector.lastIndexOf("#");
      const selectorPath = item.selector.slice(0, separator);
      const caseId = item.selector.slice(separator + 1);
      if (selectorPath !== file.relative) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `selector path does not match ${file.relative}` });
      const relation = relations.current[caseId];
      if (relation === undefined) return yield* new PrTestRelationInvalid({ selector: item.selector, message: "selector is not a current case" });
      const ownerSeparator = relation.owner.lastIndexOf("#");
      if (ownerSeparator < 1) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `current owner is not a path#anchor reference: ${relation.owner}` });
      const ownerPath = relation.owner.slice(0, ownerSeparator);
      const ownerAbsolute = resolve(root, ownerPath);
      if (!(yield* fileSystem.exists(ownerAbsolute))) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `current owner does not exist: ${relation.owner}` });
      context.inputFiles.add(ownerPath);
      const ownerSource = context.head === undefined
        ? yield* fileSystem.readText(ownerAbsolute)
        : yield* git.readBlob(context.head, ownerPath);
      const owners = yield* Effect.try({
        try: () => testingOwnerContracts([[ownerPath, ownerSource]]),
        catch: (cause) => new PrTestRelationInvalid({ selector: item.selector, message: cause instanceof Error ? cause.message : String(cause) }),
      });
      const owner = owners.find((entry) => entry.ref === relation.owner);
      if (owner === undefined) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `current owner anchor does not exist: ${relation.owner}` });
      const contract = owner.contract;
      const contractPath = contract.split("#", 1)[0]!;
      if (!(yield* fileSystem.exists(resolve(root, contractPath)))) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `canonical contract does not exist: ${contract}` });
      context.inputFiles.add(contractPath);
      if (context.head !== undefined) yield* git.readBlob(context.head, contractPath);
      if (item.regression !== undefined && !relation.regressions.includes(item.regression)) return yield* new PrTestRelationInvalid({ selector: item.selector, message: `declared regression is not current: ${item.regression}` });
      narratives.push([
        `#### \`${item.selector}\``,
        "",
        `${item.behavior.trim()} It exercises ${item.entry.trim()} and asserts ${item.assertion.trim()}. Deleting this case would allow ${item.escape.trim()}. The final contract is [${contract}](${contract}).${item.regression === undefined ? "" : ` It also prevents the regression recorded in [${item.regression}](${item.regression}).`}`,
      ].join("\n"));
    }
    const source = context.head === undefined
      ? yield* fileSystem.readText(file.absolute)
      : yield* git.readBlob(context.head, file.relative);
    let selected = source;
    if (directive.source !== undefined && directive.source !== "full" && directive.source !== "link") {
      const fragmentSource = directive.source;
      const tracked = yield* git.run(["ls-files", "--error-unmatch", "--", file.relative], { allowFailure: true });
      const changed = tracked
        ? changedFinalLines(yield* git.run([
            "diff",
            "--unified=0",
            base,
            ...(context.head === undefined ? [] : [context.head]),
            "--",
            file.relative,
          ], { allowFailure: true }))
        : new Set(Array.from({ length: source.split("\n").length }, (_unused, index) => index + 1));
      selected = yield* pure("render test fragments", () =>
        renderSelectedFragments(file.relative, source, fragmentSource, changed));
    }
    let presentation: string;
    if (directive.source === "link") {
      if (context.linkTarget === undefined) {
        presentation = [
          "> Pending publication: this source=link preview has no PR target yet, so it deliberately emits no GitHub source or diff link.",
          "> The working-tree inputs shown by local render/check are not accepted as commit `H`; create or apply will reread every input from fixed `H` and bind the actual target PR repositories and merge-base.",
        ].join("\n");
      } else {
        presentation = sourceLink(context.linkTarget, base, context.head ?? (yield* git.run(["rev-parse", "HEAD"])), file.relative);
        if (context.head === undefined && !context.sourceLinkPreviewShown) {
          presentation += "\n\n> Preview only: current working-tree inputs have not been accepted as the linked commit. Publishing rereads every input from `H` and rejects drift.";
          context.sourceLinkPreviewShown = true;
        }
      }
    } else {
      presentation = [
        `\`\`\`${codeLanguage(file.relative)}`,
        selected,
        "```",
      ].join("\n");
    }
    return {
      file: file.relative,
      markdown: [
        `### \`${file.relative}\``,
        "",
        narratives.join("\n\n"),
        "",
        presentation,
      ].join("\n"),
    };
  });
}

function expandTestDirectives(
  root: string,
  sourcePath: string,
  draft: string,
  base: string,
  context: RenderContext,
): Effect.Effect<Readonly<{ markdown: string; files: readonly string[] }>, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const expression = /<!-- niceeval:test\s*\n([\s\S]*?)\n-->/g;
    const matches = [...draft.matchAll(expression)];
    const output: string[] = [];
    const files: string[] = [];
    let cursor = 0;
    for (const match of matches) {
      output.push(draft.slice(cursor, match.index));
      const expanded = yield* expandTestDirective(root, sourcePath, match[1]!, base, context);
      output.push(expanded.markdown);
      files.push(expanded.file);
      cursor = match.index! + match[0].length;
    }
    output.push(draft.slice(cursor));
    const markdown = output.join("");
    if (/<!-- niceeval:test\b/.test(markdown)) {
      return yield* Effect.fail(draftFailure(sourcePath, "an invalid niceeval:test directive was not expanded"));
    }
    return { markdown, files: [...new Set(files)] };
  });
}

function editorSectionCount(state: PrBodyEditorState): number {
  return (state.problem === undefined ? 0 : 1)
    + (state.useCases.length === 0 ? 0 : 1)
    + new Set(state.cases.map((entry) => entry.section)).size
    + (state.tests.length === 0 && state.verification === undefined ? 0 : 1);
}

function editDraft(
  root: string,
  input: EditPrBodyInput,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const source = yield* resolveReadableDraftPath(root, input);
    if (!(yield* fileSystem.exists(source))) {
      return yield* Effect.fail(draftFailure(source, `draft does not exist: ${source}\nRun pnpm pr:body init first.`));
    }
    const draft = yield* fileSystem.readText(source);
    const metadataMatches = [...draft.matchAll(/<!-- niceeval:pr-body\s*\n([\s\S]*?)\n-->/g)];
    if (metadataMatches.length !== 1) {
      return yield* Effect.fail(draftFailure(
        source,
        `draft must contain exactly one niceeval:pr-body metadata block; found ${metadataMatches.length}`,
      ));
    }
    const previousMetadata = yield* decodeDraftMetadata(source, metadataMatches[0]![1]!);
    const template = yield* currentTemplate(root);
    const editorMatches = [...draft.matchAll(/<!-- niceeval:pr-editor\s*\n([\s\S]*?)\n-->/g)];
    let state = emptyPrBodyEditorState();
    if (input.operation !== "reset") {
      if (previousMetadata.templateSha256 !== template.hash) {
        return yield* Effect.fail(draftFailure(
          source,
          "PR template changed after this draft was created; run pnpm pr:body edit reset and rebuild the managed draft",
        ));
      }
      if (editorMatches.length !== 1) {
        return yield* Effect.fail(draftFailure(
          source,
          `structured editing requires one niceeval:pr-editor state block; found ${editorMatches.length}. Run pnpm pr:body edit reset first.`,
        ));
      }
      state = yield* decodePrBodyEditorState(source, editorMatches[0]![1]!);
      if (input.operation === "case-remove") {
        const exists = state.cases.some((entry) =>
          entry.section === input.section && entry.direction === input.direction && entry.name === input.name);
        if (!exists) return yield* Effect.fail(draftFailure(source, `case does not exist: ${input.section}/${input.direction}/${input.name}`));
      }
      if (input.operation === "use-case-remove" && !state.useCases.some((entry) => entry.direction === input.direction && entry.name === input.name)) {
        return yield* Effect.fail(draftFailure(source, `Use Case does not exist: ${input.direction}/${input.name}`));
      }
      if (input.operation === "test-remove" && !state.tests.some((entry) => entry.cases.some((item) => item.selector === input.selector))) {
        return yield* Effect.fail(draftFailure(source, `test case does not exist: ${input.selector}`));
      }
    }
    const updated = updateEditorState(state, input);
    const metadata: DraftMetadata = { ...previousMetadata, templateSha256: template.hash };
    yield* fileSystem.writeText(source, [
      metadataComment(metadata),
      "",
      editorStateComment(updated),
      "",
    ].join("\n"));
    return {
      _tag: "DraftEdited",
      path: source,
      operation: input.operation,
      sections: editorSectionCount(updated),
      cases: updated.cases.length,
      tests: updated.tests.length,
    };
  });
}

function renderBody(
  root: string,
  input: PrBodyInput,
  linkTarget?: RenderContext["linkTarget"],
): Effect.Effect<RenderedBody, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const git = yield* PrGit;
    const source = yield* resolveReadableDraftPath(root, input);
    if (!(yield* fileSystem.exists(source))) {
      return yield* Effect.fail(draftFailure(source, `draft does not exist: ${source}\nRun pnpm pr:body init first.`));
    }
    const draft = yield* fileSystem.readText(source);
    if (!/<!-- niceeval:pr-body\b/.test(draft)) {
      return yield* Effect.fail(draftFailure(
        source,
        `draft is not initialized: ${source}\nRun pnpm pr:body init --source <draft-path> to preserve the existing content and add metadata.`,
      ));
    }
    const metadataMatches = [...draft.matchAll(/<!-- niceeval:pr-body\s*\n([\s\S]*?)\n-->/g)];
    if (metadataMatches.length !== 1) {
      return yield* Effect.fail(draftFailure(
        source,
        `draft must contain exactly one niceeval:pr-body metadata block; found ${metadataMatches.length}`,
      ));
    }
    const metadata = yield* decodeDraftMetadata(source, metadataMatches[0]![1]!);
    const head = input.command === "apply" || input.command === "create" || (input.command === "check" && input.remote === true)
      ? yield* git.run(["rev-parse", "HEAD"])
      : undefined;
    const context: RenderContext = { head, linkTarget, inputFiles: new Set() };
    const template = yield* (head === undefined ? currentTemplate(root) : pinnedTemplate(context));
    if (metadata.templateSha256 !== template.hash) {
      return yield* Effect.fail(draftFailure(
        source,
        "PR template changed after this draft was created; reconcile the draft and update templateSha256",
      ));
    }
    yield* git.run(["cat-file", "-e", `${metadata.base}^{commit}`]);
    const withoutMetadata = draft.replace(/<!-- niceeval:pr-body\s*\n[\s\S]*?\n-->/, "");
    const editorMatches = [...withoutMetadata.matchAll(/<!-- niceeval:pr-editor\s*\n([\s\S]*?)\n-->/g)];
    if (editorMatches.length > 1) {
      return yield* Effect.fail(draftFailure(
        source,
        `draft must contain at most one niceeval:pr-editor state block; found ${editorMatches.length}`,
      ));
    }
    if (editorMatches.length !== 1) {
      return yield* Effect.fail(draftFailure(
        source,
        `managed draft must contain exactly one niceeval:pr-editor state block; found ${editorMatches.length}. Run pnpm pr:body edit reset.`,
      ));
    }
    const authored = renderEditorState(yield* decodePrBodyEditorState(source, editorMatches[0]![1]!));
    const expanded = yield* expandTestDirectives(root, source, authored, metadata.base, context);
    const finalMetadata: FinalMetadata = { ...metadata, head: head ?? (yield* git.run(["rev-parse", "HEAD"])) };
    const body = yield* pure("render metadata", () =>
      `${metadataComment(finalMetadata)}\n\n${stripAuthoringComments(expanded.markdown)}\n`);
    return {
      body,
      metadata: finalMetadata,
      referencedFiles: expanded.files,
      inputFiles: [...context.inputFiles].sort(),
      ...(linkTarget === undefined ? {} : { linkRepository: linkTarget.headRepository }),
      ...(linkTarget === undefined ? {} : { targetRepository: linkTarget.baseRepository }),
      draftSha256: sha256(draft),
      source,
    };
  });
}

function validateRendered(
  root: string,
  rendered: RenderedBody,
  remotePr?: number,
  remoteRepository?: string,
): Effect.Effect<ByteReport, PrBodyError, PrFileSystem | PrGit | PrGitHub> {
  return Effect.gen(function* () {
    const template = yield* currentTemplate(root);
    const findings = [...validatePrBodyStructure(rendered.body, rendered.metadata, template.text)];
    const report = byteReport(rendered.body);
    if (report.totalBytes > GITHUB_BODY_LIMIT) {
      findings.push(`body is ${report.totalBytes - GITHUB_BODY_LIMIT} bytes over GitHub's ${GITHUB_BODY_LIMIT}-byte hard limit`);
    }
    if (report.totalBytes > DEFAULT_PR_BODY_BUDGET) {
      findings.push(`body is ${report.totalBytes - DEFAULT_PR_BODY_BUDGET} bytes over the ${DEFAULT_PR_BODY_BUDGET}-byte review budget`);
    }
    if (remotePr !== undefined) {
      const github = yield* PrGitHub;
      const remote = yield* github.view(remotePr, remoteRepository);
      yield* validatePrTarget(rendered, remote, "apply");
      if (remote.headRefOid !== rendered.metadata.head) {
        findings.push(`GitHub PR head ${remote.headRefOid} does not match local HEAD ${rendered.metadata.head}`);
      }
      if (splitManagedBody(remote.body).authored !== rendered.body) {
        findings.push("GitHub PR body is stale relative to the rendered draft");
      }
    }
    if (findings.length) return yield* Effect.fail(new PrBodyCheckFailed({ findings, report: report.text }));
    return report;
  });
}

function requireCommittedSources(
  rendered: RenderedBody,
  action: "apply" | "create",
): Effect.Effect<void, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const dirty: string[] = [];
    for (const path of rendered.inputFiles) {
      yield* git.run(["cat-file", "-e", `${rendered.metadata.head}:${path}`]);
      if ((yield* git.run(["status", "--short", "--", path])).length > 0) dirty.push(path);
    }
    if (dirty.length) {
      return yield* Effect.fail(new PrMutationRejected({
        action,
        message: `${action} requires committed referenced source files:\n${dirty.map((path) => `- ${path}`).join("\n")}`,
      }));
    }
  });
}

function requireStableRenderInputs(
  rendered: RenderedBody,
  action: "apply" | "create",
): Effect.Effect<void, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    const fileSystem = yield* PrFileSystem;
    const currentHead = yield* git.run(["rev-parse", "HEAD"]);
    if (currentHead !== rendered.metadata.head) {
      return yield* Effect.fail(new PrMutationRejected({ action, message: `${action} requires local HEAD ${rendered.metadata.head}; it changed to ${currentHead}` }));
    }
    if (sha256(yield* fileSystem.readText(rendered.source)) !== rendered.draftSha256) {
      return yield* Effect.fail(new PrMutationRejected({ action, message: `${action} requires the managed draft to remain unchanged while publishing` }));
    }
    yield* requireCommittedSources(rendered, action);
  });
}

function validatePrTarget(
  rendered: RenderedBody,
  remote: import("./model.js").GitHubPullRequest,
  action: "apply" | "create",
): Effect.Effect<void, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    if (remote.headRefOid !== rendered.metadata.head) {
      return yield* Effect.fail(new PrRemoteHeadMismatch({ action: "apply", localHead: rendered.metadata.head, remoteHead: remote.headRefOid }));
    }
    if (rendered.linkRepository !== undefined && remote.headRepository !== rendered.linkRepository) {
      return yield* Effect.fail(new PrMutationRejected({
        action,
        message: `${action} requires target head repository ${rendered.linkRepository}; GitHub now reports ${remote.headRepository}`,
      }));
    }
    if (rendered.targetRepository !== undefined && remote.baseRepository !== rendered.targetRepository) {
      return yield* Effect.fail(new PrMutationRejected({
        action,
        message: `${action} requires target base repository ${rendered.targetRepository}; GitHub now reports ${remote.baseRepository}`,
      }));
    }
    const mergeBase = yield* git.run(["merge-base", remote.baseRefOid, rendered.metadata.head]);
    if (mergeBase !== rendered.metadata.base) {
      return yield* Effect.fail(new PrMutationRejected({
        action,
        message: `${action} requires the draft base ${rendered.metadata.base} to equal the target ${remote.baseRefName} merge-base ${mergeBase}`,
      }));
    }
  });
}

function renderedOutputPath(
  name: string,
): Effect.Effect<string, PrBodyError, PrGit> {
  return Effect.gen(function* () {
    const git = yield* PrGit;
    return resolve(yield* git.run(["rev-parse", "--absolute-git-dir"]), "niceeval", "pr-body", name);
  });
}

function applyRendered(
  rendered: RenderedBody,
  pr: number,
  remote: import("./model.js").GitHubPullRequest,
): Effect.Effect<void, PrBodyError, PrFileSystem | PrGit | PrGitHub> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const github = yield* PrGitHub;
    yield* requireStableRenderInputs(rendered, "apply");
    yield* validatePrTarget(rendered, remote, "apply");
    const managed = splitManagedBody(remote.body);
    const appliedBody = managed.suffix
      ? `${rendered.body.trimEnd()}\n\n${managed.suffix}\n`
      : rendered.body;
    if (Buffer.byteLength(appliedBody) > GITHUB_BODY_LIMIT) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "apply",
        message: `refusing to apply: authored body plus managed GitHub footer exceeds ${GITHUB_BODY_LIMIT} bytes`,
      }));
    }
    const output = yield* renderedOutputPath(`${pr}.rendered.md`);
    yield* fileSystem.ensureDirectory(dirname(output));
    yield* fileSystem.writeText(output, appliedBody);
    yield* github.edit(pr, output, remote.baseRepository);
  });
}

function initialize(
  root: string,
  input: Extract<PrBodyInput, { readonly command: "init" }>,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrFileSystem | PrGit> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const git = yield* PrGit;
    const target = yield* resolveDraftPath(root, input);
    const template = yield* currentTemplate(root);
    const base = input.base ?? (yield* defaultBase());
    const metadata: DraftMetadata = {
      base: yield* git.run(["rev-parse", base]),
      templateSha256: template.hash,
    };
    const comment = yield* pure("encode draft metadata", () => metadataComment(metadata));
    const existed = yield* fileSystem.exists(target);
    if (existed) {
      if (input.source === undefined) {
        return yield* Effect.fail(draftFailure(target, `draft already exists: ${target}`));
      }
      const existing = yield* fileSystem.readText(target);
      if (/<!-- niceeval:pr-body\b/.test(existing)) {
        return yield* Effect.fail(draftFailure(target, `draft is already initialized: ${target}`));
      }
      if (existing.trim()) {
        return yield* Effect.fail(draftFailure(
          target,
          "managed drafts cannot import authored Markdown; choose an empty path and use pnpm pr:body edit",
        ));
      }
    }
    yield* fileSystem.ensureDirectory(dirname(target));
    yield* fileSystem.writeText(target, `${comment}\n\n${editorStateComment(emptyPrBodyEditorState())}\n`);
    return { _tag: existed ? "DraftInitialized" : "DraftCreated", path: target };
  });
}

const draftStatus = Effect.fn("PrBody.draftStatus")((
  root: string,
  input: Extract<PrBodyInput, { readonly command: "status" }>,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrFileSystem | PrGit> => Effect.gen(function* () {
  const fileSystem = yield* PrFileSystem;
  const path = yield* resolveReadableDraftPath(root, input);
  if (!(yield* fileSystem.exists(path))) return { _tag: "DraftStatus", path, state: "missing" };
  return { _tag: "DraftStatus", path, state: managedDraftState(yield* fileSystem.readText(path)) };
}));

const discardDraft = Effect.fn("PrBody.discardDraft")((
  root: string,
  input: Extract<PrBodyInput, { readonly command: "discard" }>,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrFileSystem | PrGit> => Effect.gen(function* () {
  const fileSystem = yield* PrFileSystem;
  const path = yield* resolveReadableDraftPath(root, input);
  if (!(yield* fileSystem.exists(path))) {
    return yield* Effect.fail(draftFailure(path, `managed draft does not exist: ${path}`));
  }
  if (managedDraftState(yield* fileSystem.readText(path)) !== "managed") {
    return yield* Effect.fail(draftFailure(
      path,
      "refusing to discard an unmanaged file; only a managed PR body draft can be discarded",
    ));
  }
  yield* fileSystem.deleteFile(path);
  return { _tag: "DraftDiscarded", path };
}));

function createPullRequest(
  root: string,
  input: Extract<PrBodyInput, { readonly command: "create" }>,
  rendered: RenderedBody,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrFileSystem | PrGit | PrGitHub> {
  return Effect.gen(function* () {
    const fileSystem = yield* PrFileSystem;
    const git = yield* PrGit;
    const github = yield* PrGitHub;
    const report = yield* validateRendered(root, rendered);
    yield* requireStableRenderInputs(rendered, "create");
    if (yield* git.run(["status", "--porcelain"])) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "create",
        message: "create requires a clean working tree; commit the intended changes first",
      }));
    }
    const branch = yield* git.run(["branch", "--show-current"]);
    if (!branch) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "create",
        message: "create requires a local branch; detached HEAD is not supported",
      }));
    }
    const upstream = yield* git.run(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { allowFailure: true },
    );
    if (!upstream) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "create",
        message: `create requires ${branch} to have an upstream; push it first`,
      }));
    }
    const upstreamHead = yield* git.run(["rev-parse", "@{upstream}"]);
    if (upstreamHead !== rendered.metadata.head) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "create",
        message: `create requires pushed HEAD ${rendered.metadata.head}; upstream ${upstream} is ${upstreamHead}`,
      }));
    }
    const output = yield* renderedOutputPath("create.rendered.md");
    yield* fileSystem.ensureDirectory(dirname(output));
    yield* fileSystem.writeText(output, rendered.body);
    const url = yield* github.create({
      base: input.base ?? "main",
      head: rendered.linkRepository === undefined || rendered.targetRepository === rendered.linkRepository
        ? branch
        : `${rendered.linkRepository.split("/", 1)[0]}:${branch}`,
      title: input.title,
      bodyFile: output,
      repository: rendered.targetRepository ?? (yield* github.repository()),
    });
    const match = /\/pull\/(\d+)\/?$/.exec(url);
    if (!match) {
      return yield* Effect.fail(new PrMutationRejected({
        action: "create",
        message: `gh pr create returned an unrecognized URL: ${JSON.stringify(url)}`,
      }));
    }
    const pr = Number(match[1]);
    const remote = yield* github.view(pr, rendered.targetRepository);
    yield* applyRendered(rendered, pr, remote);
    yield* requireStableRenderInputs(rendered, "create");
    yield* validateRendered(root, rendered, pr, rendered.targetRepository);
    return { _tag: "PullRequestCreated", pr, url, source: rendered.source, report };
  });
}

export function runPrBodyAt(
  root: string,
  unknownInput: unknown,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrBodyRequirements> {
  return Effect.gen(function* () {
    const decoded = yield* decodePrBodyInput(unknownInput);
    const input = yield* validateInput(decoded);
    if (input.command === "init") return yield* initialize(root, input);
    if (input.command === "status") return yield* draftStatus(root, input);
    if (input.command === "discard") return yield* discardDraft(root, input);
    if (input.command === "edit") return yield* editDraft(root, input);
    const needsLinkTarget = input.command === "create"
      || input.command === "apply"
      || (input.command === "check" && (input.remote === true || input.pr !== undefined))
      || (input.command === "render" && input.pr !== undefined);
    const linkTarget = input.command === "create"
      ? yield* pendingCreateTarget(input.base ?? "main")
      : needsLinkTarget && "pr" in input && input.pr !== undefined
        ? yield* (yield* PrGitHub).view(input.pr)
        : undefined;
    const rendered = yield* renderBody(root, input, linkTarget);
    if (input.command === "render") {
      if (input.out === undefined) {
        return {
          _tag: "BodyRendered",
          destination: "stdout",
          body: rendered.body,
          bytes: Buffer.byteLength(rendered.body),
        };
      }
      const fileSystem = yield* PrFileSystem;
      const output = resolve(root, input.out);
      yield* fileSystem.ensureDirectory(dirname(output));
      yield* fileSystem.writeText(output, rendered.body);
      return {
        _tag: "BodyRendered",
        destination: output,
        body: rendered.body,
        bytes: Buffer.byteLength(rendered.body),
      };
    }
    if (input.command === "create") {
      return yield* createPullRequest(root, input, rendered);
    }
    const report = yield* validateRendered(
      root,
      rendered,
      input.command === "check" && input.remote === true ? input.pr : undefined,
      input.command === "check" && input.remote === true ? rendered.targetRepository : undefined,
    );
    if (input.command === "check") {
      return { _tag: "BodyChecked", report, remoteCompared: input.remote === true };
    }
    if (linkTarget === undefined) {
      return yield* Effect.fail(new PrMutationRejected({ action: "apply", message: "apply requires its target PR before rendering" }));
    }
    yield* applyRendered(rendered, input.pr, linkTarget as import("./model.js").GitHubPullRequest);
    yield* requireStableRenderInputs(rendered, "apply");
    const verifiedReport = yield* validateRendered(root, rendered, input.pr, rendered.targetRepository);
    return { _tag: "BodyApplied", pr: input.pr, source: rendered.source, report: verifiedReport };
  });
}

/** Domain program used by the command contribution; it never owns process output or exit state. */
export function runPrBody(
  input: unknown,
): Effect.Effect<PrBodyOutcome, PrBodyError, PrBodyRequirements> {
  return runPrBodyAt(PR_REPOSITORY_ROOT, input);
}
