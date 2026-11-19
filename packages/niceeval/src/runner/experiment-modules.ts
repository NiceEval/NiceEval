import { configLoaderInputs } from "../load-config.ts";
import type { ExecutionLoaderInputs } from "../loaders/runtime.ts";
import type { Config, DiscoveredExperiment } from "../types.ts";
import { rootedModuleIdentity, type EvalModuleProjection, type ModuleFact } from "./module-graph.ts";
import { syntaxNode, type SourceReplacement, type SyntaxNode } from "./source-normalization.ts";

const experimentGraphs = new WeakMap<
  DiscoveredExperiment,
  { graph: EvalModuleProjection; inputs: ExecutionLoaderInputs }
>();
const executionSources = new WeakMap<DiscoveredExperiment, ExperimentExecutionSource>();

export interface ExperimentExecutionSource {
  readonly digest: string;
  readonly unresolved: EvalModuleProjection["unresolved"];
  readonly paths: readonly string[];
  readonly experimentInputs: ExecutionLoaderInputs;
  readonly configInputs?: ExecutionLoaderInputs | undefined;
  readonly managedInputDigests: {
    readonly data: ReadonlyMap<string, string>;
    readonly criteria: ReadonlyMap<string, string>;
  };
}

export function attachExperimentModules(
  experiment: DiscoveredExperiment,
  graph: EvalModuleProjection,
  inputs: ExecutionLoaderInputs,
): DiscoveredExperiment {
  experimentGraphs.set(experiment, { graph, inputs });
  executionSources.delete(experiment);
  return experiment;
}

const nameOf = (node: unknown): string | undefined =>
  syntaxNode(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : undefined;
const stringOf = (node: unknown): string | undefined =>
  syntaxNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
const nodes = (value: unknown): SyntaxNode[] => (Array.isArray(value) ? value.filter(syntaxNode) : []);

function expression(node: unknown): SyntaxNode | undefined {
  if (!syntaxNode(node)) return undefined;
  if (["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"].includes(node.type))
    return expression(node.expression);
  return node;
}

/** No evaluation, getters, coercion, spreads, or computed keys in this subset. */
function pureConfiguration(node: unknown): boolean {
  const value = expression(node);
  if (value === undefined) return false;
  if (value.type === "Literal")
    return (
      value.regex === undefined &&
      value.bigint === undefined &&
      (value.value === null || ["string", "number", "boolean"].includes(typeof value.value))
    );
  if (value.type === "TemplateLiteral") return nodes(value.expressions).length === 0;
  if (value.type === "UnaryExpression" && ["+", "-", "!", "~"].includes(String(value.operator)))
    return pureConfiguration(value.argument);
  if (value.type === "ArrayExpression")
    return (
      Array.isArray(value.elements) && value.elements.every((element) => element === null || pureConfiguration(element))
    );
  if (value.type === "ObjectExpression") return nodes(value.properties).every(pureProperty);
  return false;
}

function pureProperty(node: SyntaxNode): boolean {
  return (
    node.type === "Property" &&
    node.computed !== true &&
    node.method !== true &&
    node.shorthand !== true &&
    node.kind === "init" &&
    pureConfiguration(node.value)
  );
}

function directConfiguration(program: SyntaxNode): SyntaxNode | undefined {
  const imports = new Map<string, "direct" | "namespace">();
  for (const statement of nodes(program.body)) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      stringOf(statement.source) !== "niceeval"
    )
      continue;
    for (const specifier of nodes(statement.specifiers)) {
      const local = nameOf(specifier.local);
      if (local === undefined || specifier.importKind === "type") continue;
      if (nameOf(specifier.imported) === "defineExperiment" || stringOf(specifier.imported) === "defineExperiment")
        imports.set(local, "direct");
      if (specifier.type === "ImportNamespaceSpecifier") imports.set(local, "namespace");
    }
  }
  const statement = nodes(program.body).find((node) => node.type === "ExportDefaultDeclaration");
  const call = expression(statement?.declaration);
  if (
    call?.type !== "CallExpression" ||
    call.optional === true ||
    !Array.isArray(call.arguments) ||
    call.arguments.length !== 1
  )
    return undefined;
  const callee = expression(call.callee);
  const local = nameOf(callee);
  const direct = local !== undefined && imports.get(local) === "direct";
  const namespace =
    callee?.type === "MemberExpression" &&
    callee.computed !== true &&
    imports.get(nameOf(callee.object) ?? "") === "namespace" &&
    nameOf(callee.property) === "defineExperiment";
  const configuration = expression(call.arguments[0]);
  return (direct || namespace) && configuration?.type === "ObjectExpression" ? configuration : undefined;
}

/** Keep executable properties in order. Materialized configuration has its own
 * identity, so adding a literal field or its separator must not change this one. */
function configurationReplacements(fact: ModuleFact): SourceReplacement[] {
  if (fact.program === undefined) return [];
  const config = directConfiguration(fact.program);
  if (config === undefined) return [];
  if (
    fact.comments?.some(
      (comment) => comment.start >= config.start && comment.end <= config.end && /@jsx\w*\b/u.test(comment.value),
    )
  )
    return [];

  const result: SourceReplacement[] = [];
  let start = config.start;
  for (const prop of nodes(config.properties)) {
    if (pureProperty(prop)) continue;
    result.push({ start, end: prop.start, value: "configuration" });
    start = prop.end;
  }
  result.push({ start, end: config.end, value: "configuration" });
  return result;
}

// @concord-code
// @concord-implements docs/feature/experiments/architecture/source-identity.md
// @concord-implements docs/feature/experiments/use-case/move-files.md
export function getExperimentExecutionSource(
  experiment: DiscoveredExperiment,
  config: Config,
): ExperimentExecutionSource | undefined {
  const registered = experimentGraphs.get(experiment);
  if (registered === undefined) return undefined;
  const configInputs = configLoaderInputs(config, registered.graph.root);
  const source = experimentModuleSource(experiment, registered.graph, registered.inputs);
  return configInputs === undefined ? source : { ...source, configInputs };
}

function experimentModuleSource(
  experiment: DiscoveredExperiment,
  graph: EvalModuleProjection,
  experimentInputs: ExecutionLoaderInputs,
): ExperimentExecutionSource {
  const cached = executionSources.get(experiment);
  if (cached !== undefined) return cached;
  const entry = graph.entry ?? graph.modules[0]?.path;
  const rootIsImported = graph.modules.some((fact) => fact.edges.some((edge) => edge.path === entry));
  const managedInputDigests = { data: new Map<string, string>(), criteria: new Map<string, string>() };
  for (const fact of graph.modules) {
    for (const input of fact.managedInputs ?? []) {
      if (input.kind === "data" || input.kind === "criteria") {
        for (const [file, digest] of input.contentDigests) managedInputDigests[input.kind].set(file, digest);
      }
    }
  }
  const result = {
    experimentInputs,
    managedInputDigests,
    digest: rootedModuleIdentity(graph, {
      role: "experiment",
      replacements: (fact) => (!rootIsImported && fact.path === entry ? configurationReplacements(fact) : []),
    }),
    unresolved: graph.unresolved,
    paths: graph.modules.map((fact) => fact.path),
  };
  executionSources.set(experiment, result);
  return result;
}
