import { Effect } from "effect";
import { upsertManagedBlock } from "../util.ts";
import {
  ProjectFileSystem,
  ProjectManifestFacts,
  ProjectProcessFacts,
  type ProjectPlatformError,
  type ProjectPathKind,
} from "./services.ts";
import {
  AGENT_RULE_BEGIN,
  AGENT_RULE_CONTENT,
  AGENT_RULE_END,
  NICEEVAL_CONFIG_TEMPLATE,
} from "./templates.ts";

export interface ProjectInitializationReceipt {
  readonly projectRoot: string;
  readonly evals: "created" | "existing";
  readonly config: "created" | "existing";
  readonly agentInstructions: {
    readonly path: "AGENTS.md" | "CLAUDE.md";
    readonly change: "created" | "updated" | "unchanged";
  };
  readonly prefersEsm: boolean;
}

export interface ProjectHostSDK {
  /** Owns all templates, target selection, and idempotent write policy. */
  readonly initialize: () => Effect.Effect<
    ProjectInitializationReceipt,
    ProjectPlatformError,
    ProjectFileSystem | ProjectManifestFacts | ProjectProcessFacts
  >;
}

function instructionTarget(input: {
  readonly agentsKind: ProjectPathKind;
  readonly claudeKind: ProjectPathKind;
}): "AGENTS.md" | "CLAUDE.md" {
  return input.agentsKind === "file"
    ? "AGENTS.md"
    : input.claudeKind === "file"
      ? "CLAUDE.md"
      : "AGENTS.md";
}

function initializeProject(): Effect.Effect<
  ProjectInitializationReceipt,
  ProjectPlatformError,
  ProjectFileSystem | ProjectManifestFacts | ProjectProcessFacts
> {
  return Effect.gen(function* () {
    const processFacts = yield* ProjectProcessFacts;
    const projectRoot = yield* processFacts.cwd;
    const fileSystem = yield* ProjectFileSystem;
    const manifest = yield* ProjectManifestFacts;

    const evals = yield* fileSystem.ensureDirectory({ root: projectRoot, path: "evals" });
    const existingConfig = yield* fileSystem.readText({
      root: projectRoot,
      path: "niceeval.config.ts",
    });
    if (existingConfig === null) {
      yield* fileSystem.writeText({
        root: projectRoot,
        path: "niceeval.config.ts",
        text: NICEEVAL_CONFIG_TEMPLATE,
      });
    }

    const agentsKind = yield* fileSystem.pathKind({ root: projectRoot, path: "AGENTS.md" });
    const claudeKind = yield* fileSystem.pathKind({ root: projectRoot, path: "CLAUDE.md" });
    const target = instructionTarget({ agentsKind, claudeKind });
    const existingInstructions = yield* fileSystem.readText({ root: projectRoot, path: target });
    const nextInstructions = upsertManagedBlock(
      existingInstructions ?? "",
      AGENT_RULE_BEGIN,
      AGENT_RULE_END,
      AGENT_RULE_CONTENT,
    );
    const instructionChange = existingInstructions === null
      ? "created" as const
      : nextInstructions === existingInstructions
        ? "unchanged" as const
        : "updated" as const;
    if (instructionChange !== "unchanged") {
      yield* fileSystem.writeText({ root: projectRoot, path: target, text: nextInstructions });
    }

    const moduleKind = yield* manifest.moduleKind(projectRoot);
    return Object.freeze({
      projectRoot,
      evals,
      config: existingConfig === null ? "created" as const : "existing" as const,
      agentInstructions: Object.freeze({ path: target, change: instructionChange }),
      prefersEsm: moduleKind === "esm",
    });
  });
}

export const projectHost: ProjectHostSDK = Object.freeze({
  initialize: initializeProject,
});
