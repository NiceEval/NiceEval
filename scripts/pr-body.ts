import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
const DEFAULT_BUDGET = 62 * 1024;
const GITHUB_LIMIT = 65_536;
type Command = "init" | "render" | "check" | "apply";

interface Options {
  command: Command;
  pr?: number;
  source?: string;
  out?: string;
  base?: string;
  budget: number;
  remote: boolean;
}
interface DraftMetadata { base: string; templateSha256: string; forbid?: string[] }
interface FinalMetadata extends DraftMetadata { head: string }
interface FragmentSpec { from: string; through: string }
interface TestDirective {
  path: string;
  purpose: string;
  protects: string;
  runs: string;
  asserts: string;
  source?: "full" | { fragments: FragmentSpec[]; reason: string };
}
interface RenderedBody { body: string; metadata: FinalMetadata; referencedFiles: string[] }
interface ManagedBody { authored: string; suffix?: string }

const HELP = `NiceEval PR body compiler

Usage:
  pnpm pr:body init (--source <path> | --pr <number>) [--base <ref>]
  pnpm pr:body render (--source <path> | --pr <number>) [--out <path>]
  pnpm pr:body check (--source <path> | --pr <number>) [--no-remote]
  pnpm pr:body apply --pr <number> [--source <path>]

Commands:
  init    Create a draft, or initialize an existing handwritten --source draft.
  render  Expand source directives and emit the final Markdown body.
  check   Render and validate the body; with --pr, compare it with GitHub.
  apply   Validate, verify the PR head, then update the GitHub PR body.

Options:
  --pr <number>       GitHub PR number and default draft identity.
  --source <path>     Draft path. Defaults inside this worktree's Git dir.
  --out <path>        Rendered output path. Omit to print to stdout.
  --base <ref>        Locked base for a new draft. Defaults to merge-base with origin/main.
  --budget <bytes>    Review budget before GitHub's hard limit (default ${DEFAULT_BUDGET}).
  --no-remote         Skip GitHub body/head comparison during check.

Workflow:
  1. pnpm pr:body init --source <draft.md>
  2. Edit the initialized draft and remove unused template sections.
  3. pnpm pr:body check --source <draft.md> --no-remote
  4. pnpm pr:body render --source <draft.md> --out <body.md>
  5. Create the PR with <body.md>, then use apply and check --pr after the PR exists.

Embed an exact test source in the Markdown draft:
  <!-- niceeval:test
  path: e2e/report/test/report-show.test.ts
  purpose: feature + bug regression
  protects: Public behavior that would escape without this owner.
  runs: Public commands or browser actions exercised by the test.
  asserts: Independent expected outcomes checked by the test.
  source: full
  -->

To excerpt a large file, replace source with unique complete-line anchors:
  source:
    reason: unchanged helpers unrelated to this PR
    fragments:
      - from: 'test("first retained owner", async () => {'
        through: '}); // first retained owner'
`;

function fail(message: string): never { throw new Error(message) }

function git(args: string[], allowFailure = false): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return "";
    fail(`git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    fail(`gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex") }
function positiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^\d+$/.test(value)) fail(`${flag} requires a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${flag} requires a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const command = argv.shift();
  if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(HELP);
    process.exit(command === undefined ? 1 : 0);
  }
  if (!["init", "render", "check", "apply"].includes(command)) fail(`unknown command ${JSON.stringify(command)}\n\n${HELP}`);
  const options: Options = { command: command as Command, budget: DEFAULT_BUDGET, remote: command === "check" };
  while (argv.length) {
    const flag = argv.shift();
    switch (flag) {
      case "--pr": options.pr = positiveInteger(argv.shift(), flag); break;
      case "--source": options.source = argv.shift() ?? fail(`${flag} requires a path`); break;
      case "--out": options.out = argv.shift() ?? fail(`${flag} requires a path`); break;
      case "--base": options.base = argv.shift() ?? fail(`${flag} requires a git ref`); break;
      case "--budget": options.budget = positiveInteger(argv.shift(), flag); break;
      case "--no-remote": options.remote = false; break;
      case "--help": case "-h": process.stdout.write(HELP); process.exit(0);
      default: fail(`unknown option ${JSON.stringify(flag)}`);
    }
  }
  if (options.command === "apply" && !options.pr) fail("apply requires --pr <number>");
  if (!options.source && !options.pr) fail(`${options.command} requires --pr <number> or --source <path>`);
  if (options.out && options.command !== "render") fail("--out is only valid with render");
  if (options.base && options.command !== "init") fail("--base is only valid with init");
  if (options.budget > GITHUB_LIMIT) fail(`--budget cannot exceed GitHub's ${GITHUB_LIMIT}-byte limit`);
  return options;
}

function draftPath(options: Options): string {
  if (options.source) return resolve(ROOT, options.source);
  return resolve(git(["rev-parse", "--absolute-git-dir"]), "niceeval", "pr-body", `${options.pr}.md`);
}
function currentTemplate(): { text: string; hash: string } {
  const text = readFileSync(TEMPLATE_PATH, "utf8");
  return { text, hash: sha256(text) };
}
function defaultBase(): string { return git(["merge-base", "HEAD", "origin/main"], true) || git(["rev-parse", "HEAD"]) }
function metadataComment(metadata: DraftMetadata | FinalMetadata): string {
  return `<!-- niceeval:pr-body\n${stringifyYaml(metadata).trimEnd()}\n-->`;
}
function init(options: Options): void {
  const target = draftPath(options);
  const template = currentTemplate();
  const metadata: DraftMetadata = {
    base: git(["rev-parse", options.base ?? defaultBase()]),
    templateSha256: template.hash,
  };
  if (existsSync(target)) {
    if (!options.source) fail(`draft already exists: ${target}`);
    const existing = readFileSync(target, "utf8");
    if (/<!-- niceeval:pr-body\b/.test(existing)) fail(`draft is already initialized: ${target}`);
    if (existing.trim()) {
      writeFileSync(target, `${metadataComment(metadata)}\n\n${existing}`);
      process.stdout.write(`Initialized existing draft ${target}\n`);
      return;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${metadataComment(metadata)}\n\n${template.text.trimEnd()}\n`);
  process.stdout.write(`Created ${target}\n`);
}

function parseMetadata(draft: string): DraftMetadata {
  const matches = [...draft.matchAll(/<!-- niceeval:pr-body\s*\n([\s\S]*?)\n-->/g)];
  if (matches.length !== 1) fail(`draft must contain exactly one niceeval:pr-body metadata block; found ${matches.length}`);
  const parsed = parseYaml(matches[0][1]) as unknown;
  if (!parsed || typeof parsed !== "object") fail("niceeval:pr-body metadata must be a YAML object");
  const value = parsed as Record<string, unknown>;
  if (typeof value.base !== "string" || !value.base) fail("niceeval:pr-body metadata requires base");
  if (typeof value.templateSha256 !== "string" || !value.templateSha256) fail("niceeval:pr-body metadata requires templateSha256");
  if (value.forbid !== undefined && (!Array.isArray(value.forbid) || value.forbid.some((item) => typeof item !== "string"))) {
    fail("niceeval:pr-body forbid must be a list of literal strings");
  }
  return { base: value.base, templateSha256: value.templateSha256, forbid: value.forbid as string[] | undefined };
}

function repositoryPath(path: string): { absolute: string; relative: string } {
  const absolute = resolve(ROOT, path);
  const repoRelative = relative(ROOT, absolute).replaceAll("\\", "/");
  if (!repoRelative || repoRelative.startsWith("../") || repoRelative === "..") fail(`source path must be a file inside the repository: ${path}`);
  if (!existsSync(absolute)) fail(`source file does not exist: ${repoRelative}`);
  return { absolute, relative: repoRelative };
}
function uniqueLineIndex(lines: string[], anchor: string, label: string, path: string): number {
  const matches = lines.flatMap((line, index) => line === anchor ? [index] : []);
  if (matches.length !== 1) fail(`${path}: ${label} anchor must match one exact complete line; found ${matches.length}: ${JSON.stringify(anchor)}`);
  return matches[0];
}
function changedFinalLines(base: string, path: string): Set<number> {
  if (!git(["ls-files", "--error-unmatch", "--", path], true)) {
    const lineCount = readFileSync(resolve(ROOT, path), "utf8").trimEnd().split("\n").length;
    return new Set(Array.from({ length: lineCount }, (_unused, index) => index + 1));
  }
  const diff = git(["diff", "--unified=0", base, "--", path], true);
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
function omissionMarker(path: string, before: string, after: string, reason: string): string {
  if (!before.trim() || !after.trim()) fail(`${path}: omission anchors cannot be blank lines`);
  if (reason.includes("\n") || reason.includes(";")) fail(`${path}: omission reason must be one line without semicolons`);
  return `// … omitted: file=${path}; before=${before}; after=${after}; reason=${reason}`;
}
function nearestUniqueLine(lines: string[], indices: number[], label: string, path: string): string {
  for (const index of indices) {
    const candidate = lines[index];
    if (candidate.trim() && lines.filter((line) => line === candidate).length === 1) return candidate;
  }
  fail(`${path}: cannot find a unique non-blank ${label} omission anchor; retain more source around the boundary`);
}
function renderFragments(path: string, source: string, spec: Exclude<TestDirective["source"], "full" | undefined>, base: string): string {
  if (!Array.isArray(spec.fragments) || !spec.fragments.length) fail(`${path}: source.fragments must not be empty`);
  if (typeof spec.reason !== "string" || !spec.reason.trim()) fail(`${path}: fragment source requires a non-empty reason`);
  const lines = source.split("\n");
  const ranges = spec.fragments.map((fragment, index) => {
    if (!fragment || typeof fragment.from !== "string" || typeof fragment.through !== "string") fail(`${path}: fragment ${index + 1} requires string from and through anchors`);
    const start = uniqueLineIndex(lines, fragment.from, `fragment ${index + 1} from`, path);
    const end = uniqueLineIndex(lines, fragment.through, `fragment ${index + 1} through`, path);
    if (end < start) fail(`${path}: fragment ${index + 1} ends before it starts`);
    return { start, end };
  }).sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index++) if (ranges[index].start <= ranges[index - 1].end) fail(`${path}: source fragments overlap`);
  const included = new Set<number>();
  for (const range of ranges) for (let index = range.start; index <= range.end; index++) included.add(index + 1);
  const missed = [...changedFinalLines(base, path)].filter((line) => !included.has(line));
  if (missed.length) fail(`${path}: fragments omit base→working-tree changed final lines: ${missed.join(", ")}`);
  const rendered: string[] = [];
  let previousEnd = -1;
  for (const range of ranges) {
    if (range.start > previousEnd + 1) {
      const before = previousEnd >= 0
        ? lines[previousEnd]
        : nearestUniqueLine(lines, Array.from({ length: range.start }, (_unused, index) => range.start - index - 1), "before", path);
      rendered.push(omissionMarker(path, before, lines[range.start], spec.reason));
    }
    rendered.push(lines.slice(range.start, range.end + 1).join("\n"));
    previousEnd = range.end;
  }
  if (previousEnd < lines.length - 1) {
    const after = nearestUniqueLine(lines, Array.from({ length: lines.length - previousEnd - 1 }, (_unused, index) => previousEnd + index + 1), "after", path);
    rendered.push(omissionMarker(path, lines[previousEnd], after, spec.reason));
  }
  return rendered.join("\n");
}
function codeLanguage(path: string): string {
  return ({ js: "js", jsx: "jsx", mjs: "js", cjs: "js", ts: "ts", tsx: "tsx" } as Record<string, string>)[extname(path).slice(1)] ?? "text";
}
function parseTestDirective(yaml: string): TestDirective {
  const parsed = parseYaml(yaml) as unknown;
  if (!parsed || typeof parsed !== "object") fail("niceeval:test directive must be a YAML object");
  const value = parsed as Record<string, unknown>;
  for (const field of ["path", "purpose", "protects", "runs", "asserts"] as const) {
    if (typeof value[field] !== "string" || !value[field]) fail(`niceeval:test requires non-empty ${field}`);
  }
  if (value.source !== undefined && value.source !== "full") {
    if (!value.source || typeof value.source !== "object" || Array.isArray(value.source)) {
      fail("niceeval:test source must be full or a fragments object");
    }
    const source = value.source as Record<string, unknown>;
    if (!Array.isArray(source.fragments) || typeof source.reason !== "string") {
      fail("niceeval:test fragment source requires fragments and reason");
    }
  }
  return value as unknown as TestDirective;
}
function expandTestDirectives(draft: string, base: string): { markdown: string; files: string[] } {
  const files: string[] = [];
  const markdown = draft.replace(/<!-- niceeval:test\s*\n([\s\S]*?)\n-->/g, (_match, yaml: string) => {
    const directive = parseTestDirective(yaml);
    const file = repositoryPath(directive.path);
    const source = readFileSync(file.absolute, "utf8").trimEnd();
    const selected = !directive.source || directive.source === "full" ? source : renderFragments(file.relative, source, directive.source, base);
    files.push(file.relative);
    return [`### \`${file.relative}\``, "", `- Purpose: \`${directive.purpose}\``, `- Protects: ${directive.protects}`, `- Runs: ${directive.runs}`, `- Asserts: ${directive.asserts}`, "", `\`\`\`${codeLanguage(file.relative)}`, selected, "```"].join("\n");
  });
  return { markdown, files: [...new Set(files)] };
}
function stripAuthoringComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function render(options: Options): RenderedBody {
  const source = draftPath(options);
  if (!existsSync(source)) fail(`draft does not exist: ${source}\nRun pnpm pr:body init first.`);
  const draft = readFileSync(source, "utf8");
  if (!/<!-- niceeval:pr-body\b/.test(draft)) {
    fail(`draft is not initialized: ${source}\nRun pnpm pr:body init --source <draft-path> to preserve the existing content and add metadata.`);
  }
  const metadata = parseMetadata(draft);
  const template = currentTemplate();
  if (metadata.templateSha256 !== template.hash) fail("PR template changed after this draft was created; reconcile the draft and update templateSha256");
  git(["cat-file", "-e", `${metadata.base}^{commit}`]);
  const withoutMetadata = draft.replace(/<!-- niceeval:pr-body\s*\n[\s\S]*?\n-->/, "");
  const expanded = expandTestDirectives(withoutMetadata, metadata.base);
  if (/<!-- niceeval:test\b/.test(expanded.markdown)) fail("an invalid niceeval:test directive was not expanded");
  const finalMetadata: FinalMetadata = { ...metadata, head: git(["rev-parse", "HEAD"]) };
  return {
    body: `${metadataComment(finalMetadata)}\n\n${stripAuthoringComments(expanded.markdown)}\n`,
    metadata: finalMetadata,
    referencedFiles: expanded.files,
  };
}

function sectionMap(markdown: string): Map<string, string> {
  const matches = [...markdown.matchAll(/^## (.+)$/gm)];
  const sections = new Map<string, string>();
  matches.forEach((match, index) => sections.set(match[1].trim(), markdown.slice(match.index! + match[0].length, matches[index + 1]?.index ?? markdown.length)));
  return sections;
}
function templateSections(): string[] { return [...currentTemplate().text.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()) }
function templatePlaceholders(): string[] {
  return [...new Set([...stripAuthoringComments(currentTemplate().text).matchAll(/<[^>\n]+>/g)].map((match) => match[0]))];
}
function requireBulletFields(errors: string[], label: string, block: string, fields: string[]): void {
  for (const field of fields) {
    if (!new RegExp(`^- ${field}:`, "m").test(block)) errors.push(`${label} is missing - ${field}:`);
  }
}
function headingContent(block: string, level: number, name: string): string | undefined {
  const marker = "#".repeat(level);
  const headings = [...block.matchAll(new RegExp(`^${marker} (.+)$`, "gm"))];
  const index = headings.findIndex((heading) => heading[1].trim() === name);
  if (index === -1) return undefined;
  return block.slice(headings[index].index! + headings[index][0].length, headings[index + 1]?.index ?? block.length).trim();
}
function requireHeadingFields(errors: string[], label: string, block: string, level: number, fields: string[]): void {
  for (const field of fields) {
    const value = headingContent(block, level, field);
    if (value === undefined) errors.push(`${label} is missing ${"#".repeat(level)} ${field}`);
    else if (!value) errors.push(`${label} has an empty ${"#".repeat(level)} ${field}`);
  }
}
function fencedBlockCount(content: string | undefined): number {
  return content ? [...content.matchAll(/^```[^\n]*\n[\s\S]*?^```\s*$/gm)].length : 0;
}
function requireFences(errors: string[], label: string, content: string | undefined, count: number): void {
  if (content !== undefined && fencedBlockCount(content) < count) errors.push(`${label} requires at least ${count} fenced code block${count === 1 ? "" : "s"}`);
}
function validateCaseDirections(errors: string[], name: string, content: string): void {
  const directions = [...content.matchAll(/^### (?:Removed|Added|Changed|Added terms|Removed terms)$/gm)];
  for (const [index, heading] of directions.entries()) {
    const block = content.slice(heading.index! + heading[0].length, directions[index + 1]?.index ?? content.length);
    if (!/^#### Case: .+$/m.test(block)) errors.push(`${name} ${heading[0]} must be omitted when it has no cases`);
  }
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
    const removed = content.slice(0, heading.index!).trimEnd().endsWith("### Removed");
    requireFences(errors, `${label} After`, headingContent(block, 5, "After"), removed ? 1 : 2);
  }
}
function subsection(content: string, name: string): string | undefined {
  const headings = [...content.matchAll(/^### (.+)$/gm)];
  const index = headings.findIndex((heading) => heading[1].trim() === name);
  if (index === -1) return undefined;
  return content.slice(headings[index].index! + headings[index][0].length, headings[index + 1]?.index ?? content.length);
}
function validateStructure(body: string, metadata: FinalMetadata): string[] {
  const errors: string[] = [];
  const content = body.replace(/<!-- niceeval:pr-body\s*\n[\s\S]*?\n-->/, "");
  const sections = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
  const allowed = templateSections();
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
  for (const placeholder of templatePlaceholders()) if (content.includes(placeholder)) errors.push(`unresolved template placeholder: ${placeholder}`);
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  if (/^\s*(?:[-*]\s*)?None(?:\s*(?:—|-).*)?\.?\s*$/gim.test(prose)) errors.push('empty content must be omitted instead of written as "None"');
  for (const literal of metadata.forbid ?? []) if (content.includes(literal)) errors.push(`forbidden stale text remains: ${JSON.stringify(literal)}`);
  for (const field of ["Coverage", "Starting point", "Copyable usage or trigger", "Observable result or diagnostic", "Contract", "Before usage or result", "After usage or result", "User impact"]) {
    if (new RegExp(`^- ${field}:`, "m").test(content)) errors.push(`legacy summary field remains: - ${field}:`);
  }
  const sectionsByName = sectionMap(content);
  const problem = sectionsByName.get("Problem");
  if (problem) requireBulletFields(errors, "Problem", problem, ["User goal", "Current limitation", "Required capability", "User outcome"]);

  const useCases = sectionsByName.get("Use cases");
  if (useCases) {
    const cases = [...useCases.matchAll(/^### Case: .+$/gm)];
    if (!cases.length) errors.push("Use cases must be omitted when it has no cases");
    for (const [index, heading] of cases.entries()) {
      const block = useCases.slice(heading.index! + heading[0].length, cases[index + 1]?.index ?? useCases.length);
      requireHeadingFields(errors, heading[0], block, 4, ["Starting state", "Action", "Result"]);
      for (const field of ["Starting state", "Action", "Result"]) requireFences(errors, `${heading[0]} ${field}`, headingContent(block, 4, field), 1);
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
      const block = environment.slice(heading.index! + heading[0].length, cases[index + 1]?.index ?? environment.length);
      const label = `Environment variables ${heading[0]}`;
      requireHeadingFields(errors, label, block, 5, ["Before", "After", "Environment boundary", "User and security impact"]);
      requireFences(errors, `${label} Before`, headingContent(block, 5, "Before"), 2);
      const removed = environment.slice(0, heading.index!).trimEnd().endsWith("### Removed");
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
      ["Case: upgrade or recover stored data", ["Version", "Before", "After", "Safety", "User impact", "Evidence"]],
    ] as const) {
      const block = subsection(record, name);
      if (block !== undefined) requireHeadingFields(errors, `Record ${name}`, block, 4, [...fields]);
    }
  }

  const tests = sectionsByName.get("Tests");
  if (tests) {
    const owners = [...tests.matchAll(/^### `.+`$/gm)];
    for (const [index, heading] of owners.entries()) {
      const block = tests.slice(heading.index! + heading[0].length, owners[index + 1]?.index ?? tests.length);
      requireBulletFields(errors, heading[0], block, ["Purpose", "Protects", "Runs", "Asserts"]);
    }
  }
  for (const match of body.matchAll(/^- Purpose:\s*(.+)$/gm)) {
    const purpose = match[1].trim().replace(/^`|`$/g, "");
    if (!["feature", "bug regression", "feature + bug regression"].includes(purpose)) errors.push(`invalid test Purpose: ${purpose}`);
  }
  return errors;
}
function byteReport(body: string): string {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  const rows = matches.map((match, index) => ({ name: match[1].trim(), bytes: Buffer.byteLength(body.slice(match.index!, matches[index + 1]?.index ?? body.length)) })).sort((a, b) => b.bytes - a.bytes);
  const width = Math.max(7, ...rows.map((row) => row.name.length));
  return [`PR body: ${Buffer.byteLength(body).toLocaleString("en-US")} bytes`, ...rows.map((row) => `${row.name.padEnd(width)}  ${row.bytes.toLocaleString("en-US").padStart(8)}`)].join("\n");
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
function validate(rendered: RenderedBody, options: Options, compareRemote: boolean): void {
  const errors = validateStructure(rendered.body, rendered.metadata);
  const bytes = Buffer.byteLength(rendered.body);
  if (bytes > GITHUB_LIMIT) errors.push(`body is ${bytes - GITHUB_LIMIT} bytes over GitHub's ${GITHUB_LIMIT}-byte hard limit`);
  if (bytes > options.budget) errors.push(`body is ${bytes - options.budget} bytes over the ${options.budget}-byte review budget`);
  if (compareRemote) {
    if (!options.pr) fail("remote comparison requires --pr");
    const remote = JSON.parse(gh(["pr", "view", String(options.pr), "--json", "body,headRefOid"])) as { body: string; headRefOid: string };
    if (remote.headRefOid !== rendered.metadata.head) errors.push(`GitHub PR head ${remote.headRefOid} does not match local HEAD ${rendered.metadata.head}`);
    if (splitManagedBody(remote.body).authored !== rendered.body) errors.push("GitHub PR body is stale relative to the rendered draft");
  }
  process.stdout.write(`${byteReport(rendered.body)}\n`);
  if (errors.length) fail(`PR body check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.stdout.write("PR body check passed.\n");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "init") return init(options);
  const rendered = render(options);
  if (options.command === "render") {
    if (!options.out) return void process.stdout.write(rendered.body);
    const output = resolve(ROOT, options.out);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, rendered.body);
    process.stdout.write(`Rendered ${output} (${Buffer.byteLength(rendered.body)} bytes)\n`);
    return;
  }
  if (options.command === "check") return validate(rendered, options, options.remote);
  validate(rendered, options, false);
  const dirty = rendered.referencedFiles.filter((path) => git(["status", "--short", "--", path]).length > 0);
  if (dirty.length) fail(`apply requires committed referenced source files:\n${dirty.map((path) => `- ${path}`).join("\n")}`);
  const remote = JSON.parse(gh(["pr", "view", String(options.pr), "--json", "body,headRefOid"])) as { body: string; headRefOid: string };
  if (remote.headRefOid !== rendered.metadata.head) fail(`refusing to apply: GitHub PR head ${remote.headRefOid} does not match local HEAD ${rendered.metadata.head}`);
  const managed = splitManagedBody(remote.body);
  const appliedBody = managed.suffix ? `${rendered.body.trimEnd()}\n\n${managed.suffix}\n` : rendered.body;
  if (Buffer.byteLength(appliedBody) > GITHUB_LIMIT) {
    fail(`refusing to apply: authored body plus managed GitHub footer exceeds ${GITHUB_LIMIT} bytes`);
  }
  const output = resolve(git(["rev-parse", "--absolute-git-dir"]), "niceeval", "pr-body", `${options.pr}.rendered.md`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, appliedBody);
  gh(["pr", "edit", String(options.pr), "--body-file", output]);
  process.stdout.write(`Updated PR #${options.pr} from ${draftPath(options)}\n`);
}

try { main() } catch (error) {
  process.stderr.write(`pr:body: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
