/**
 * Public documentation API examples are executable guidance, not prose.
 * This lint guards migrations that the readability lint intentionally skips
 * inside code fences and inline CLI snippets.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");
const RULES_FILE = "docs/writing-rules.json";

interface ApiRuleBase {
  readonly roots: readonly string[];
  readonly use: string;
  readonly why: string;
}

interface RejectedCliFlagRule extends ApiRuleBase {
  readonly flag: string;
}

interface RemovedFactoryRule extends ApiRuleBase {
  readonly name: string;
}

interface OrdinaryFactChainRule extends ApiRuleBase {
  readonly method: string;
}

interface RemovedScoreOverloadRule extends ApiRuleBase {
  readonly callee: string;
}

interface RemovedEvaluationKindRule extends ApiRuleBase {
  readonly value: string;
}

interface PublicApiExampleRules {
  readonly rejectedCliFlags: readonly RejectedCliFlagRule[];
  readonly removedFactories: readonly RemovedFactoryRule[];
  readonly ordinaryFactChainMethods: readonly OrdinaryFactChainRule[];
  readonly removedScoreOverloads: readonly RemovedScoreOverloadRule[];
  readonly removedEvaluationKinds: readonly RemovedEvaluationKindRule[];
}

interface WritingRules {
  readonly publicApiExamples: PublicApiExampleRules;
}

export interface ApiExampleLintHit {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

interface CodeBlock {
  readonly source: string;
  readonly firstContentLine: number;
}

const rules = (): PublicApiExampleRules => {
  const parsed: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  return parsed.publicApiExamples;
};

function filesAt(root: string): string[] {
  const absolute = join(ROOT, root);
  if (!statSync(absolute).isDirectory()) return [root];
  return readdirSync(absolute).sort().flatMap((name) => {
    const relative = join(root, name);
    return statSync(join(ROOT, relative)).isDirectory()
      ? filesAt(relative)
      : /\.mdx?$/.test(name)
        ? [relative]
        : [];
  });
}

function filesFor(rule: ApiRuleBase): string[] {
  return [...new Set(rule.roots.flatMap(filesAt))].sort();
}

function typeScriptBlocks(content: string): CodeBlock[] {
  const lines = content.split("\n");
  const blocks: CodeBlock[] = [];
  let language: string | undefined;
  let firstContentLine = 0;
  let body: string[] = [];

  for (const [index, raw] of lines.entries()) {
    const opening = /^\s*```([\w-]*)\s*$/.exec(raw);
    if (language === undefined) {
      if (!opening) continue;
      language = opening[1].toLowerCase();
      firstContentLine = index + 2;
      body = [];
      continue;
    }
    if (/^\s*```\s*$/.test(raw)) {
      if (["ts", "tsx", "typescript", "js", "jsx", "javascript"].includes(language)) {
        blocks.push({ source: body.join("\n"), firstContentLine });
      }
      language = undefined;
      body = [];
      continue;
    }
    body.push(raw);
  }

  return blocks;
}

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node, firstContentLine: number): number {
  return firstContentLine + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
}

function ruleMessage(rule: ApiRuleBase, found: string): string {
  return `公开示例使用了${found}——改用${rule.use};${rule.why}`;
}

export function lintApiCodeExample(
  file: string,
  source: string,
  firstContentLine = 1,
  configuredRules: PublicApiExampleRules = rules(),
): ApiExampleLintHit[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: ApiExampleLintHit[] = [];
  const factoryRules = new Map(configuredRules.removedFactories.map((rule) => [rule.name, rule]));
  const chainRules = new Map(configuredRules.ordinaryFactChainMethods.map((rule) => [rule.method, rule]));
  const scoreRules = new Map(configuredRules.removedScoreOverloads.map((rule) => [rule.callee, rule]));

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const rule = factoryRules.get(node.text);
      if (rule) {
        hits.push({
          file,
          line: sourceLine(sourceFile, node, firstContentLine),
          rule: rule.name,
          message: ruleMessage(rule, `已删除的 ${rule.name}`),
        });
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const chainRule = chainRules.get(method);
      const receiver = node.expression.expression.getText(sourceFile);
      const isRemovedAuthorFactFactory = method !== "fact" || receiver === "t";
      if (chainRule && isRemovedAuthorFactFactory) {
        hits.push({
          file,
          line: sourceLine(sourceFile, node.expression.name, firstContentLine),
          rule: `ordinary-fact.${method}`,
          message: ruleMessage(chainRule, `普通 Fact/Match 的 .${method}() 链`),
        });
      }

      const callee = node.expression.getText(sourceFile);
      const scoreRule = scoreRules.get(callee);
      if (scoreRule && node.arguments.length === 2 && !ts.isObjectLiteralExpression(node.arguments[1])) {
        hits.push({
          file,
          line: sourceLine(sourceFile, node.expression, firstContentLine),
          rule: `${callee}(label, number)`,
          message: ruleMessage(scoreRule, `${callee}(label, number)`),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hits;
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lintRemovedEvaluationKinds(configuredRules: PublicApiExampleRules): ApiExampleLintHit[] {
  return configuredRules.removedEvaluationKinds.flatMap((rule) => {
    const pattern = new RegExp(`evaluationKind\\s*:\\s*["']${escapedRegExp(rule.value)}["']`, "g");
    return filesFor(rule).flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8").split("\n").flatMap((line, index) => {
        const occurrences = [...line.matchAll(pattern)].length;
        return Array.from({ length: occurrences }, () => ({
          file,
          line: index + 1,
          rule: `evaluationKind:${rule.value}`,
          message: ruleMessage(rule, `evaluationKind: ${JSON.stringify(rule.value)}`),
        }));
      }),
    );
  });
}

function lintRejectedCliFlags(configuredRules: PublicApiExampleRules): ApiExampleLintHit[] {
  return configuredRules.rejectedCliFlags.flatMap((rule) =>
    filesFor(rule).flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8").split("\n").flatMap((line, index) => {
        const occurrences = line.split(rule.flag).length - 1;
        return Array.from({ length: occurrences }, () => ({
          file,
          line: index + 1,
          rule: rule.flag,
          message: ruleMessage(rule, `已拒绝的 CLI flag ${rule.flag}`),
        }));
      }),
    ),
  );
}

function lintConfiguredCodeExamples(configuredRules: PublicApiExampleRules): ApiExampleLintHit[] {
  const codeRules: ApiRuleBase[] = [
    ...configuredRules.removedFactories,
    ...configuredRules.ordinaryFactChainMethods,
    ...configuredRules.removedScoreOverloads,
    ...configuredRules.removedEvaluationKinds,
  ];
  const files = [...new Set(codeRules.flatMap(filesFor))].sort();

  return files.flatMap((file) => {
    const content = readFileSync(join(ROOT, file), "utf8");
    return typeScriptBlocks(content).flatMap((block) =>
      lintApiCodeExample(file, block.source, block.firstContentLine, configuredRules),
    );
  });
}

export function lintPublicApiExamples(): ApiExampleLintHit[] {
  const configuredRules = rules();
  return [
    ...lintRejectedCliFlags(configuredRules),
    ...lintRemovedEvaluationKinds(configuredRules),
    ...lintConfiguredCodeExamples(configuredRules),
  ]
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
}

export function formatApiExampleLintHits(hits: readonly ApiExampleLintHit[]): string {
  if (hits.length === 0) return "";
  return [
    ...hits.map((hit) => `${hit.file}:${hit.line}  ${hit.message}`),
    "",
    `共 ${hits.length} 条公开 API 示例命中。先改示例，再重跑 pnpm lint。`,
  ].join("\n");
}
