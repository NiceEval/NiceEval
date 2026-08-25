import { readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { Effect, ParseResult, Schema } from "effect";
import { parseDocument } from "yaml";

import {
  ResearchFileError,
  ResearchFormatError,
  ResearchInputError,
  ResearchPathError,
  researchErrorMessage,
  type ResearchError,
} from "./errors.js";
import {
  RESEARCH_FORMAT,
  RESEARCH_MARKER,
  ResearchCommandInputSchema,
  ResearchFrontmatterSchema,
  type ResearchCheckFinding,
  type ResearchCheckReceipt,
  type ResearchCommandInput,
  type ResearchContent,
  type ResearchFrontmatter,
  type ResearchMutationReceipt,
  type ResearchOutcome,
} from "./model.js";
import { publishNewDirectory, publishNewFile, readResearchFile, sha256 } from "./publication.js";

const RESEARCH_ROOT = "docs/research";
const TEMPLATE_ROOT = "docs/_template/research";
const REQUIRED_BLOCKS = [
  "Observed version or date",
  "Primary sources",
  "External boundary",
  "NiceEval mapping",
  "Absorb, do not copy",
  "Next evidence",
] as const;

type Inspection =
  | { readonly kind: "legacy" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "v1"; readonly frontmatter: ResearchFrontmatter };

function decodeUnknown<A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
  input: unknown,
): Effect.Effect<A, ResearchInputError> {
  return Schema.decodeUnknown(schema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new ResearchInputError({
      message: `${path}: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
    })),
  );
}

function relativeFromReference(ref: string): string {
  return ref.slice("research:".length);
}

function referenceFor(relativePath: string): string {
  return `research:${relativePath}`;
}

function pageTarget(path: string): string {
  return `${RESEARCH_ROOT}/${path}.md`;
}

function packageTarget(path: string): string {
  return `${RESEARCH_ROOT}/${path}`;
}

function packageRootTarget(path: string): string {
  return `${packageTarget(path)}/README.md`;
}

function pageContent(content: ResearchContent, parent?: string): string {
  const frontmatter = [
    "---",
    `research: ${JSON.stringify(RESEARCH_FORMAT)}`,
    `title: ${JSON.stringify(content.title)}`,
    `observed-on: ${JSON.stringify(content.observedOn)}`,
    ...(content.version === undefined ? [] : [`version: ${JSON.stringify(content.version)}`]),
    "primary-sources:",
    ...content.sources.map((source) => `  - ${JSON.stringify(source)}`),
    ...(parent === undefined ? [] : [`parent: ${JSON.stringify(parent)}`]),
    "---",
  ].join("\n");
  const observation = content.version === undefined
    ? `Observed on ${content.observedOn}.`
    : `Observed on ${content.observedOn}; fixed version: ${content.version}.`;
  return JSON.stringify({
    "{{frontmatter}}": frontmatter,
    "{{marker}}": RESEARCH_MARKER,
    "{{title}}": content.title,
    "{{observation}}": observation,
    "{{primary-sources}}": content.sources.map((source) => `- <${source}>`).join("\n"),
    "{{boundary}}": content.boundary,
    "{{mapping}}": content.mapping,
    "{{absorb}}": content.absorb,
    "{{next-evidence}}": content.nextEvidence,
  });
}

function renderTemplate(template: string, encodedVariables: string): Effect.Effect<string, ResearchFormatError> {
  return Effect.try({
    try: () => {
      const variables = JSON.parse(encodedVariables) as Record<string, string>;
      const expected = Object.keys(variables);
      for (const key of expected) {
        if (!template.includes(key)) throw new Error(`template is missing ${key}`);
      }
      return expected.reduce((result, key) => result.replaceAll(key, variables[key]!), template);
    },
    catch: (error) => new ResearchFormatError({
      path: TEMPLATE_ROOT,
      message: `Cannot render the Research template: ${researchErrorMessage(error)}`,
    }),
  });
}

function loadTemplate(
  root: string,
  name: "PAGE.md" | "PACKAGE.md",
): Effect.Effect<string, ResearchFileError | ResearchPathError> {
  return readResearchFile(root, `${TEMPLATE_ROOT}/${name}`);
}

function parseV1Document(
  path: string,
  source: string,
): Effect.Effect<ResearchFrontmatter, ResearchFormatError | ResearchInputError> {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u);
  if (frontmatter === null) {
    return Effect.fail(new ResearchFormatError({ path, message: "Missing Research v1 YAML frontmatter." }));
  }
  if (!source.includes(RESEARCH_MARKER)) {
    return Effect.fail(new ResearchFormatError({ path, message: `Missing required marker ${RESEARCH_MARKER}.` }));
  }
  return Effect.try({
    try: () => {
      const document = parseDocument(frontmatter[1]!);
      if (document.errors.length > 0) throw document.errors[0]!;
      return document.toJSON() as unknown;
    },
    catch: (error) => new ResearchFormatError({
      path,
      message: `Invalid Research v1 YAML frontmatter: ${researchErrorMessage(error)}`,
    }),
  }).pipe(Effect.flatMap((value) => decodeUnknown(path, ResearchFrontmatterSchema, value)));
}

function inspectDocument(path: string, source: string): Effect.Effect<Inspection> {
  if (!source.includes(RESEARCH_MARKER)) {
    return Effect.succeed({ kind: "legacy" });
  }
  return parseV1Document(path, source).pipe(
    Effect.map((frontmatter): Inspection => ({ kind: "v1", frontmatter })),
    Effect.catchAll((error): Effect.Effect<Inspection> => Effect.succeed({ kind: "invalid", message: error.message })),
  );
}

function blockContent(source: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(new RegExp(`^## ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s|$)`, "mu"));
  return match?.[1]?.replace(/<!--[^]*?-->/gu, "").trim();
}

function structureFindings(path: string, source: string): ResearchCheckFinding[] {
  const findings: ResearchCheckFinding[] = [];
  for (const heading of REQUIRED_BLOCKS) {
    const body = blockContent(source, heading);
    if (body === undefined || body.length === 0) {
      findings.push({
        path,
        code: "missing-required-block",
        message: `Research v1 requires a non-empty “${heading}” block.`,
      });
    }
  }
  const sources = blockContent(source, "Primary sources");
  if (sources !== undefined && !/(?:<https?:\/\/[^>]+>|\[[^\]]+\]\(https?:\/\/[^)]+\))/u.test(sources)) {
    findings.push({
      path,
      code: "missing-primary-source-link",
      message: "The Primary sources block must contain at least one HTTP(S) source link; the author remains responsible for choosing first-party material.",
    });
  }
  return findings;
}

function checkV1Page(path: string, source: string): Effect.Effect<ResearchCheckFinding[]> {
  return inspectDocument(path, source).pipe(Effect.map((inspection) => {
    if (inspection.kind === "legacy") {
      return [{
        path,
        code: "legacy-unmanaged" as const,
        message: "This target is legacy/unmanaged: migrate it to Research v1 before checking it.",
      }];
    }
    if (inspection.kind === "invalid") {
      return [{ path, code: "invalid-v1" as const, message: inspection.message }];
    }
    return structureFindings(path, source);
  }));
}

function readAndCheckPage(root: string, path: string): Effect.Effect<ResearchCheckFinding[], ResearchFileError | ResearchPathError> {
  return readResearchFile(root, path).pipe(Effect.flatMap((source) => checkV1Page(path, source)));
}

function createReceipt(
  command: ResearchMutationReceipt["command"],
  dryRun: boolean,
  target: string,
  contentDigest: string,
): ResearchMutationReceipt {
  const ref = referenceFor(target);
  const action = command === "create-page"
    ? "create a standalone page"
    : command === "create-package"
    ? "create a package root"
    : "add a package-owned page";
  return {
    format: "niceeval.docs-research/receipt/v1",
    command,
    dryRun,
    ref,
    target,
    changedPaths: [target],
    preimage: { kind: "absent" },
    contentDigest,
    summary: dryRun
      ? `Would ${action}: ${ref}.`
      : `${action[0]!.toUpperCase()}${action.slice(1)}: ${ref}.`,
  };
}

function createPage(
  root: string,
  path: string,
  content: ResearchContent,
  dryRun: boolean,
  parent?: string,
): Effect.Effect<ResearchMutationReceipt, ResearchError> {
  const target = pageTarget(path);
  return Effect.all({
    template: loadTemplate(root, "PAGE.md"),
    variables: Effect.succeed(pageContent(content, parent)),
  }).pipe(
    Effect.flatMap(({ template, variables }) => renderTemplate(template, variables)),
    Effect.flatMap((rendered) => publishNewFile(root, target, rendered, dryRun)),
    Effect.map(({ digest }) => createReceipt(parent === undefined ? "create-page" : "add-page", dryRun, target, digest)),
  );
}

function createPackage(
  root: string,
  path: string,
  content: ResearchContent,
  dryRun: boolean,
): Effect.Effect<ResearchMutationReceipt, ResearchError> {
  const target = packageTarget(path);
  const rootPage = packageRootTarget(path);
  return Effect.all({
    template: loadTemplate(root, "PACKAGE.md"),
    variables: Effect.succeed(pageContent(content)),
  }).pipe(
    Effect.flatMap(({ template, variables }) => renderTemplate(template, variables)),
    Effect.flatMap((rendered) => publishNewDirectory(root, target, [{ path: "README.md", content: rendered }], dryRun)),
    Effect.map(({ digest }) => createReceipt("create-package", dryRun, rootPage, digest)),
  );
}

function requireV1Package(
  root: string,
  parent: string,
): Effect.Effect<void, ResearchFileError | ResearchPathError | ResearchFormatError | ResearchInputError> {
  const target = relativeFromReference(parent);
  if (!target.endsWith("/README.md")) {
    return Effect.fail(new ResearchInputError({ message: "add-page requires an exact Research package-root ref ending in /README.md." }));
  }
  return readResearchFile(root, target).pipe(
    Effect.flatMap((source) => parseV1Document(target, source)),
    Effect.flatMap((frontmatter) => frontmatter.parent === undefined
      ? Effect.void
      : Effect.fail(new ResearchFormatError({ path: target, message: "A package root cannot declare a parent Research ref." }))),
  );
}

function walkMarkdownPages(root: string, start: string): Effect.Effect<readonly string[], ResearchFileError | ResearchPathError> {
  return Effect.try({
    try: () => {
      const directory = resolve(root, start);
      const pages: string[] = [];
      const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const candidate = resolve(current, entry.name);
          const path = relative(root, candidate).split(sep).join("/");
          if (entry.isDirectory()) walk(candidate);
          else if (entry.isFile() && entry.name.endsWith(".md")) pages.push(path);
        }
      };
      walk(directory);
      return pages.sort();
    },
    catch: (error) => new ResearchFileError({ operation: "enumerate package pages", path: start, message: researchErrorMessage(error) }),
  });
}

function checkPackage(root: string, ref: string, target: string): Effect.Effect<ResearchCheckReceipt, ResearchFileError | ResearchPathError> {
  return Effect.gen(function*() {
    const rootSource = yield* readResearchFile(root, target);
    const findings = yield* checkV1Page(target, rootSource);
    const rootInspection = yield* inspectDocument(target, rootSource);
    if (rootInspection.kind === "v1" && rootInspection.frontmatter.parent !== undefined) {
      findings.push({
        path: target,
        code: "invalid-package-root",
        message: "A checked package root must not declare a parent Research ref.",
      });
    }
    const pages = yield* walkMarkdownPages(root, dirname(target));
    const owned: string[] = [target];
    for (const page of pages) {
      if (page === target) continue;
      const source = yield* readResearchFile(root, page);
      const inspection = yield* inspectDocument(page, source);
      if (inspection.kind === "legacy") {
        findings.push({
          path: page,
          code: "legacy-unmanaged",
          message: "This package member is legacy/unmanaged; migrate it to Research v1 or move it outside this package.",
        });
        continue;
      }
      if (inspection.kind === "invalid") {
        findings.push({ path: page, code: "invalid-v1", message: inspection.message });
        continue;
      }
      if (inspection.frontmatter.parent !== ref || dirname(page) !== dirname(target)) {
        findings.push({
          path: page,
          code: "unmanaged-v1",
          message: `This v1 page is not explicitly owned by ${ref}.`,
        });
        continue;
      }
      owned.push(page);
      findings.push(...structureFindings(page, source));
    }
    return {
      format: "niceeval.docs-research/check/v1",
      command: "check",
      ok: findings.length === 0,
      ref,
      target,
      checkedPaths: owned,
      findings,
      summary: findings.length === 0
        ? `Research v1 check passed for ${ref}.`
        : `Research v1 check failed for ${ref} with ${findings.length} finding(s).`,
    };
  });
}

function checkResearch(root: string, ref: string): Effect.Effect<ResearchCheckReceipt, ResearchFileError | ResearchPathError> {
  const target = relativeFromReference(ref);
  if (target.endsWith("/README.md")) return checkPackage(root, ref, target);
  return readAndCheckPage(root, target).pipe(Effect.map((findings) => ({
    format: "niceeval.docs-research/check/v1" as const,
    command: "check" as const,
    ok: findings.length === 0,
    ref,
    target,
    checkedPaths: [target],
    findings,
    summary: findings.length === 0
      ? `Research v1 check passed for ${ref}.`
      : `Research v1 check failed for ${ref} with ${findings.length} finding(s).`,
  })));
}

function runDecodedResearchAt(root: string, input: ResearchCommandInput): Effect.Effect<ResearchOutcome, ResearchError> {
  switch (input.command) {
    case "create-page":
      return createPage(root, input.path, input.content, input.dryRun);
    case "create-package":
      return createPackage(root, input.path, input.content, input.dryRun);
    case "add-page":
      return requireV1Package(root, input.parent).pipe(
        Effect.flatMap(() => createPage(
          root,
          `${relativeFromReference(input.parent).slice(0, -"/README.md".length).replace(`${RESEARCH_ROOT}/`, "")}/${input.page}`,
          input.content,
          input.dryRun,
          input.parent,
        )),
      );
    case "check":
      return checkResearch(root, input.ref);
  }
}

/**
 * Research-owned command program. It deliberately creates no Trace RepoRef,
 * Trace generation, journal, or transaction: Research is independent input to
 * product decisions, not a Docs Trace node.
 */
export function runResearchAt(
  root: string,
  input: unknown,
): Effect.Effect<ResearchOutcome, ResearchError> {
  return decodeUnknown("Research command input", ResearchCommandInputSchema, input).pipe(
    Effect.flatMap((decoded) => runDecodedResearchAt(root, decoded)),
  );
}

export function renderResearchOutcome(outcome: ResearchOutcome): string {
  if (outcome.command !== "check") return outcome.summary;
  if (outcome.ok) return outcome.summary;
  return [outcome.summary, ...outcome.findings.map((finding) => `- ${finding.path}: ${finding.message}`)].join("\n");
}

export function renderResearchError(error: ResearchError): string {
  switch (error._tag) {
    case "ResearchInputError":
      return `Research input is invalid: ${error.message}`;
    case "ResearchPathError":
      return `Research path ${error.path} is invalid: ${error.message}`;
    case "ResearchConflictError":
      return `Research target ${error.path} conflicts: ${error.message}`;
    case "ResearchFileError":
      return `Research ${error.operation} failed for ${error.path}: ${error.message}`;
    case "ResearchFormatError":
      return `Research v1 format is invalid in ${error.path}: ${error.message}`;
  }
}

export { RESEARCH_FORMAT, RESEARCH_MARKER, sha256 };
