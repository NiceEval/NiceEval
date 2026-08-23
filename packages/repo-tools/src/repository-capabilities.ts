import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, ParseResult, Schema } from "effect";

import { errorMessage, RepoToolError } from "./errors.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REGISTRY_FILE = "docs/engineering/repository-capabilities/registry.json";

const CapabilityKindSchema = Schema.Literal("build", "check", "generate", "run", "serve", "workflow");
const RepositoryCommandSchema = Schema.Struct({
  script: Schema.String,
  kind: CapabilityKindSchema,
  design: Schema.String,
});
const RepositoryWorkflowSchema = Schema.Struct({
  id: Schema.String,
  script: Schema.String,
  skill: Schema.optional(Schema.String),
  implementations: Schema.Array(Schema.String),
  guards: Schema.Array(Schema.String),
});
export const CapabilityRegistrySchema = Schema.Struct({
  commands: Schema.Array(RepositoryCommandSchema),
  workflows: Schema.Array(RepositoryWorkflowSchema),
});
const PackageManifestSchema = Schema.Struct({
  scripts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});

export type CapabilityRegistry = typeof CapabilityRegistrySchema.Type;
export type RepositoryCommand = typeof RepositoryCommandSchema.Type;
export type RepositoryWorkflow = typeof RepositoryWorkflowSchema.Type;
type PackageManifest = typeof PackageManifestSchema.Type;

function readJson<A, I>(path: string, schema: Schema.Schema<A, I>): Effect.Effect<A, RepoToolError> {
  const absolute = join(ROOT, path);
  return Effect.try({
    try: () => readFileSync(absolute, "utf8"),
    catch: (error) => new RepoToolError({ operation: "read", path, message: errorMessage(error) }),
  }).pipe(
    Effect.flatMap((text) => Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (error) => new RepoToolError({ operation: "parse JSON", path, message: errorMessage(error) }),
    })),
    Effect.flatMap((input) => Schema.decodeUnknown(schema, { errors: "all" })(input).pipe(
      Effect.mapError((error) => new RepoToolError({
        operation: "decode",
        path,
        message: ParseResult.TreeFormatter.formatErrorSync(error),
      })),
    )),
  );
}

function pathPart(reference: string): string {
  return reference.split("#", 1)[0] ?? "";
}

export function validateCapabilityRegistry(
  registry: CapabilityRegistry,
  manifest: PackageManifest,
  fileExists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const scripts = manifest.scripts ?? {};
  const commandNames = registry.commands.map((command) => command.script);
  const workflowIds = registry.workflows.map((workflow) => workflow.id);

  for (const duplicate of commandNames.filter((name, index) => commandNames.indexOf(name) !== index)) {
    problems.push(`command ${JSON.stringify(duplicate)} is registered more than once`);
  }
  for (const duplicate of workflowIds.filter((id, index) => workflowIds.indexOf(id) !== index)) {
    problems.push(`workflow ${JSON.stringify(duplicate)} is registered more than once`);
  }

  for (const script of Object.keys(scripts)) {
    if (!commandNames.includes(script)) problems.push(`package script ${JSON.stringify(script)} has no capability entry`);
  }
  for (const command of registry.commands) {
    if (!(command.script in scripts)) {
      problems.push(`capability command ${JSON.stringify(command.script)} is missing from package.json`);
    }
    const design = pathPart(command.design);
    if (!design || !fileExists(design)) {
      problems.push(`capability command ${JSON.stringify(command.script)} has missing design ${JSON.stringify(command.design)}`);
    }
  }

  for (const workflow of registry.workflows) {
    if (!commandNames.includes(workflow.script)) {
      problems.push(`workflow ${JSON.stringify(workflow.id)} points to unregistered script ${JSON.stringify(workflow.script)}`);
    }
    const files = [
      ...workflow.implementations,
      ...workflow.guards,
      ...(workflow.skill === undefined ? [] : [workflow.skill]),
    ];
    for (const file of files) {
      if (!fileExists(file)) {
        problems.push(`workflow ${JSON.stringify(workflow.id)} points to missing file ${JSON.stringify(file)}`);
      }
    }
    for (const guard of workflow.guards) {
      if (!guard.startsWith("lint/")) {
        problems.push(`workflow ${JSON.stringify(workflow.id)} guard must live under lint/: ${JSON.stringify(guard)}`);
      }
    }
  }

  return [...new Set(problems)].sort();
}

export interface CatalogEntry extends RepositoryCommand {
  readonly workflow?: string;
  readonly skill?: string;
}

export function catalogEntries(registry: CapabilityRegistry): readonly CatalogEntry[] {
  const workflows = new Map(registry.workflows.map((workflow) => [workflow.script, workflow]));
  return registry.commands.map((command) => {
    const workflow = workflows.get(command.script);
    return {
      ...command,
      ...(workflow === undefined ? {} : { workflow: workflow.id }),
      ...(workflow?.skill === undefined ? {} : { skill: workflow.skill }),
    };
  });
}

export const loadCapabilityRegistry: Effect.Effect<CapabilityRegistry, RepoToolError> = readJson(
  REGISTRY_FILE,
  CapabilityRegistrySchema,
);

export const loadCapabilityCatalog: Effect.Effect<readonly CatalogEntry[], RepoToolError> = loadCapabilityRegistry.pipe(
  Effect.map(catalogEntries),
);

export const checkCapabilityRegistry: Effect.Effect<readonly string[], RepoToolError> = Effect.all({
  registry: loadCapabilityRegistry,
  manifest: readJson("package.json", PackageManifestSchema),
}).pipe(
  Effect.map(({ manifest, registry }) => validateCapabilityRegistry(
    registry,
    manifest,
    (path) => existsSync(join(ROOT, path)),
  )),
);

export function listCapabilities(pattern: string | undefined, json: boolean): Effect.Effect<void, RepoToolError> {
  return loadCapabilityCatalog.pipe(
    Effect.map((entries) => entries.filter((entry) => {
      if (pattern === undefined) return true;
      const values = [entry.script, entry.kind, entry.design, entry.workflow, entry.skill];
      return values.filter((value): value is string => value !== undefined)
        .join(" ")
        .toLowerCase()
        .includes(pattern.toLowerCase());
    })),
    Effect.flatMap((entries) => Effect.sync(() => {
      if (json) process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      else if (entries.length === 0) process.stdout.write("No repository capabilities matched.\n");
      else {
        for (const entry of entries) {
          process.stdout.write(
            `${entry.script}\t${entry.kind}\t${entry.design}${entry.skill ? `\t${entry.skill}` : ""}\n`,
          );
        }
      }
    })),
  );
}

export function checkCapabilities(json: boolean): Effect.Effect<void, RepoToolError> {
  return checkCapabilityRegistry.pipe(
    Effect.flatMap((problems) => Effect.sync(() => {
      if (json) process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, problems }, null, 2)}\n`);
      else if (problems.length === 0) process.stdout.write("Repository capability catalog is closed.\n");
      else process.stderr.write(`${problems.join("\n")}\n`);
      if (problems.length > 0) process.exitCode = 1;
    })),
  );
}
