import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { Effect, Result, Schema, SchemaIssue } from "effect";

import { traceDigest, type TraceDirectoryManifestEntry, type TraceMutationPreimage } from "../trace/relation-mutation.js";
import { DesignIoError, DesignManifestInvalid, designErrorMessage } from "./errors.js";
import type {
  DesignDecisionState,
  DesignFileReceipt,
  DesignManifestDigests,
  DesignPlanReceipt,
} from "./model.js";
import { DESIGN_PAGE_ORDER, DocsTemplateManifestSchema, type DesignPage, type DocsTemplateManifest } from "./schema.js";

export const DESIGN_PROJECTION_START = "<!-- niceeval.docs-index/v1:start -->";
export const DESIGN_PROJECTION_END = "<!-- niceeval.docs-index/v1:end -->";
export const DESIGN_DECISION_TEMPLATE = "docs/_template/design-decision";
export const FEATURE_DESIGN_TEMPLATE = "docs/_template/feature-design";
const MANIFEST_FILE = "manifest.json";

interface LoadedTemplate {
  readonly path: string;
  readonly manifest: DocsTemplateManifest;
  readonly manifestDigest: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly preimages: readonly TraceMutationPreimage[];
}

export interface DesignTemplateBundle {
  readonly designDecision: LoadedTemplate;
  readonly featureDesign: LoadedTemplate;
  readonly digests: DesignManifestDigests;
  readonly preimages: readonly TraceMutationPreimage[];
}

export interface GeneratedDesignFile extends DesignFileReceipt {
  readonly relativePath: string;
  readonly source: string;
}

export interface GeneratedDesignPackage {
  readonly slug: string;
  readonly ref: string;
  readonly title: string;
  readonly state: DesignDecisionState;
  readonly cases: boolean;
  readonly pages: readonly DesignPage[];
  readonly plans: readonly DesignPlanReceipt[];
  readonly files: readonly GeneratedDesignFile[];
  readonly manifestDigests: DesignManifestDigests;
  readonly projection: string;
  readonly projectionDigest: string;
}

const slash = (path: string): string => path.split(sep).join("/");
const message = (cause: unknown): string => designErrorMessage(cause);

function templateFailure(path: string, cause: unknown): DesignManifestInvalid {
  return new DesignManifestInvalid({ path, message: message(cause) });
}

function readTemplateInventory(root: string, templatePath: string): readonly string[] {
  const absolute = resolve(root, templatePath);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const status = lstatSync(path);
      const item = slash(relative(absolute, path));
      if (status.isSymbolicLink()) throw new Error(`${item}: symlink is forbidden`);
      if (status.isDirectory()) {
        visit(path);
      } else if (status.isFile()) {
        files.push(item);
      } else {
        throw new Error(`${item}: special file is forbidden`);
      }
    }
  };
  visit(absolute);
  return files.sort();
}

function loadTemplate(
  root: string,
  templatePath: string,
  expectedKinds: readonly string[],
  expectedOptionalKeys: readonly string[],
): Effect.Effect<LoadedTemplate, DesignManifestInvalid> {
  const manifestPath = `${templatePath}/${MANIFEST_FILE}`;
  return Effect.try({
    try: () => {
      const absoluteManifest = resolve(root, manifestPath);
      const manifestSource = readFileSync(absoluteManifest, "utf8");
      const input: unknown = JSON.parse(manifestSource);
      const decoded = Schema.decodeUnknownResult(DocsTemplateManifestSchema, {
        errors: "all",
        onExcessProperty: "error",
      })(input);
      if (Result.isFailure(decoded)) {
        throw new Error(SchemaIssue.makeFormatterDefault()(decoded.failure.issue));
      }
      const manifest = decoded.success;
      if (JSON.stringify([...manifest.applicableKinds].sort()) !== JSON.stringify([...expectedKinds].sort())) {
        throw new Error(`applicableKinds must be exactly ${expectedKinds.join(", ")}`);
      }
      const optionalKeys = Object.keys(manifest.optionalFiles).sort();
      if (JSON.stringify(optionalKeys) !== JSON.stringify([...expectedOptionalKeys].sort())) {
        throw new Error(`optionalFiles keys must be exactly ${expectedOptionalKeys.join(", ")}`);
      }
      const declared = [
        ...manifest.requiredFiles,
        ...Object.values(manifest.optionalFiles).flat(),
      ].sort();
      if (new Set(declared).size !== declared.length) throw new Error("a template file is declared more than once");
      const inventory = readTemplateInventory(root, templatePath).filter((path) => path !== MANIFEST_FILE);
      if (JSON.stringify(inventory) !== JSON.stringify(declared)) {
        throw new Error(`manifest inventory differs: declared ${declared.join(", ")}; found ${inventory.join(", ")}`);
      }
      const sources = new Map(declared.map((path) => [
        path,
        readFileSync(resolve(root, templatePath, path), "utf8"),
      ]));
      const manifestDigest = traceDigest(JSON.stringify({
        format: manifest.format,
        applicableKinds: [...manifest.applicableKinds].sort(),
        requiredFiles: [...manifest.requiredFiles].sort(),
        optionalFiles: Object.fromEntries(Object.entries(manifest.optionalFiles)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, paths]) => [name, [...paths].sort()])),
        files: declared.map((path) => {
          const templateSource = sources.get(path);
          if (templateSource === undefined) throw new Error(`${path}: source disappeared while computing the manifest digest`);
          return { path, digest: traceDigest(templateSource) };
        }),
      }));
      const preimagePaths = [manifestPath, ...declared.map((path) => `${templatePath}/${path}`)];
      return {
        path: templatePath,
        manifest,
        manifestDigest,
        sources,
        preimages: preimagePaths.map((path) => {
          const absolutePath = resolve(root, path);
          return { path: absolutePath, digest: traceDigest(readFileSync(absolutePath)) };
        }),
      };
    },
    catch: (cause) => templateFailure(manifestPath, cause),
  });
}

export function loadDesignTemplates(root: string): Effect.Effect<DesignTemplateBundle, DesignManifestInvalid> {
  return Effect.all({
    designDecision: loadTemplate(root, DESIGN_DECISION_TEMPLATE, ["design"], ["cases"]),
    featureDesign: loadTemplate(root, FEATURE_DESIGN_TEMPLATE, ["feature", "roadmap", "design-plan"], DESIGN_PAGE_ORDER),
  }).pipe(Effect.map(({ designDecision, featureDesign }) => ({
    designDecision,
    featureDesign,
    digests: {
      designDecision: designDecision.manifestDigest,
      featureDesign: featureDesign.manifestDigest,
    },
    preimages: [...designDecision.preimages, ...featureDesign.preimages]
      .sort((left, right) => left.path.localeCompare(right.path)),
  })));
}

function source(template: LoadedTemplate, path: string): string {
  const value = template.sources.get(path);
  if (value === undefined) throw new Error(`${template.path}/${path}: source is missing after manifest validation`);
  return value;
}

function nodeFrontmatter(kind: "design" | "design-plan"): string {
  return `---\nformat: niceeval.docs-node/v1\nkind: ${kind}\nrelations: {}\n---\n\n`;
}

function removeCasesNavigation(value: string): string {
  return value
    .replace(/ · \[CASES\]\(CASES\.md\)/gu, "")
    .replace(/\[CASES\]\(CASES\.md\) · /gu, "");
}

function decisionReadmeScaffold(value: string): string {
  const lines = value.split(/\r?\n/u);
  const navigation = lines.findIndex((line) => line.startsWith("**相关文档**"));
  return navigation < 0 ? value : `${lines[0] ?? ""}\n\n${lines.slice(navigation).join("\n")}`;
}

function planReadmeScaffold(value: string): string {
  const lines = value.split(/\r?\n/u);
  const body = lines.findIndex((line) => line === "## 解决的问题");
  return body < 0 ? value : `${lines[0] ?? ""}\n\n${lines.slice(body).join("\n")}`;
}

function substitute(value: string, placeholder: string, replacement: string): string {
  return value.replaceAll(placeholder, replacement).replaceAll("../../SVG-DESIGN.md", "../../../SVG-DESIGN.md");
}

function pagePaths(template: LoadedTemplate, pages: readonly DesignPage[]): readonly string[] {
  return pages.flatMap((page) => template.manifest.optionalFiles[page] ?? []);
}

export function renderDesignProjection(
  plans: readonly DesignPlanReceipt[],
  state: DesignDecisionState,
): string {
  const selected = state._tag === "decided"
    ? plans.find((plan) => plan.ref === state.selectedPlan)
    : undefined;
  const planLines = plans.map((plan) =>
    `- [${plan.selector}${selected?.ref === plan.ref ? "（已选择）" : ""}](${plan.selector}/README.md)`
  );
  const decision = selected === undefined
    ? "裁决：尚未写入 `relations.selectedPlan`。"
    : `裁决：[${selected.selector}](${selected.selector}/README.md)。`;
  return [
    DESIGN_PROJECTION_START,
    "## 候选方案索引（生成）",
    "",
    ...planLines,
    "",
    decision,
    DESIGN_PROJECTION_END,
  ].join("\n");
}

export function replaceDesignProjection(readme: string, projection: string): string | undefined {
  const start = readme.indexOf(DESIGN_PROJECTION_START);
  const end = readme.indexOf(DESIGN_PROJECTION_END);
  if (start < 0 || end < start || readme.indexOf(DESIGN_PROJECTION_START, start + 1) >= 0 ||
    readme.indexOf(DESIGN_PROJECTION_END, end + 1) >= 0) return undefined;
  const after = end + DESIGN_PROJECTION_END.length;
  return `${readme.slice(0, start)}${projection}${readme.slice(after)}`;
}

export function extractDesignProjection(readme: string): string | undefined {
  const start = readme.indexOf(DESIGN_PROJECTION_START);
  const end = readme.indexOf(DESIGN_PROJECTION_END);
  if (start < 0 || end < start || readme.indexOf(DESIGN_PROJECTION_START, start + 1) >= 0 ||
    readme.indexOf(DESIGN_PROJECTION_END, end + 1) >= 0) return undefined;
  return readme.slice(start, end + DESIGN_PROJECTION_END.length);
}

function receiptFile(packageRoot: string, relativePath: string, sourceText: string): GeneratedDesignFile {
  const bytes = Buffer.byteLength(sourceText);
  return {
    relativePath,
    path: `${packageRoot}/${relativePath}`,
    digest: traceDigest(sourceText),
    byteLength: bytes,
    source: sourceText,
  };
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function generateDesignPackage(input: {
  readonly bundle: DesignTemplateBundle;
  readonly slug: string;
  readonly title: string;
  readonly planCount: number;
  readonly cases: boolean;
  readonly pages: readonly DesignPage[];
}): GeneratedDesignPackage {
  const packageRoot = `docs/design/${input.slug}`;
  const pages = DESIGN_PAGE_ORDER.filter((page) => input.pages.includes(page));
  const plans: DesignPlanReceipt[] = Array.from({ length: input.planCount }, (_, index) => {
    const selector = `PLAN-${index + 1}`;
    return {
      selector,
      ref: `${packageRoot}/${selector}/README.md`,
      title: `${input.title} · ${selector}`,
      pages,
    };
  });
  const state: DesignDecisionState = { _tag: "undecided" };
  const projection = renderDesignProjection(plans, state);
  const files: GeneratedDesignFile[] = [];

  for (const path of input.bundle.designDecision.manifest.requiredFiles) {
    let rendered = substitute(source(input.bundle.designDecision, path), "<决策主题名>", input.title);
    if (path === "README.md") {
      rendered = decisionReadmeScaffold(rendered);
      rendered = `${nodeFrontmatter("design")}${rendered.trimEnd()}\n\n${projection}\n`;
    }
    if (!input.cases) rendered = removeCasesNavigation(rendered);
    files.push(receiptFile(packageRoot, path, rendered));
  }
  if (input.cases) {
    for (const path of input.bundle.designDecision.manifest.optionalFiles.cases ?? []) {
      const rendered = substitute(source(input.bundle.designDecision, path), "<决策主题名>", input.title);
      files.push(receiptFile(packageRoot, path, rendered));
    }
  }

  for (const plan of plans) {
    const selectedPaths = [...input.bundle.featureDesign.manifest.requiredFiles, ...pagePaths(input.bundle.featureDesign, pages)];
    for (const path of selectedPaths) {
      let rendered = substitute(source(input.bundle.featureDesign, path), "<功能或候选名>", plan.title);
      if (path === "README.md") {
        rendered = planReadmeScaffold(rendered);
        rendered = `${nodeFrontmatter("design-plan")}${rendered.trimEnd()}\n`;
      }
      files.push(receiptFile(packageRoot, `${plan.selector}/${path}`, rendered));
    }
  }

  return {
    slug: input.slug,
    ref: `${packageRoot}/README.md`,
    title: input.title,
    state,
    cases: input.cases,
    pages,
    plans,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    manifestDigests: input.bundle.digests,
    projection,
    projectionDigest: traceDigest(projection),
  };
}

export function generatedDirectoryManifest(
  generated: GeneratedDesignPackage,
): readonly TraceDirectoryManifestEntry[] {
  const directories = new Set<string>(["."]);
  for (const file of generated.files) {
    let cursor = dirname(file.relativePath);
    while (cursor !== ".") {
      directories.add(slash(cursor));
      cursor = dirname(cursor);
    }
  }
  return [
    ...[...directories].map((path): TraceDirectoryManifestEntry => ({ kind: "directory", path, mode: 0o755 })),
    ...generated.files.map((file): TraceDirectoryManifestEntry => ({
      kind: "file",
      path: file.relativePath,
      mode: 0o644,
      byteLength: file.byteLength,
      digest: file.digest,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function stageGeneratedDesign(
  root: string,
  generated: GeneratedDesignPackage,
): Effect.Effect<{ readonly stagePath: string; readonly targetPath: string }, DesignIoError> {
  const parent = resolve(root, "docs/design");
  const stageName = `.stage-${randomUUID()}`;
  const stage = resolve(parent, stageName);
  return Effect.try({
    try: () => {
      mkdirSync(stage, { mode: 0o755 });
      chmodSync(stage, 0o755);
      const directories = new Set<string>([stage]);
      for (const file of generated.files) {
        const target = resolve(stage, file.relativePath);
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        chmodSync(dirname(target), 0o755);
        directories.add(dirname(target));
        const descriptor = openSync(target, "wx", 0o644);
        try {
          fchmodSync(descriptor, 0o644);
          writeFileSync(descriptor, file.source, "utf8");
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
      for (const directory of [...directories].sort((left, right) => right.length - left.length)) fsyncDirectory(directory);
      fsyncDirectory(parent);
      return {
        stagePath: `docs/design/${stageName}`,
        targetPath: `docs/design/${generated.slug}`,
      };
    },
    catch: (cause) => {
      rmSync(stage, { recursive: true, force: true });
      return new DesignIoError({ operation: "stage design", path: slash(relative(root, stage)), message: message(cause) });
    },
  });
}

export function removeDesignStage(root: string, stagePath: string): Effect.Effect<void, DesignIoError> {
  return Effect.try({
    try: () => rmSync(resolve(root, stagePath), { recursive: true, force: true }),
    catch: (cause) => new DesignIoError({ operation: "remove design stage", path: stagePath, message: message(cause) }),
  });
}
