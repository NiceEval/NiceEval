import { Effect } from "effect";
import { upsertManagedBlock } from "../util.ts";
import {
  ProjectFileSystem,
  ProjectManifestFacts,
  ProjectProcessFacts,
  ProjectPlatformError,
  type ProjectManagedPath,
} from "./services.ts";
import {
  BUNDLED_INDEX_PATH,
  AGENT_RULE_BEGIN,
  AGENT_RULE_END,
  AGENT_SKILL_MANAGED,
  agentRuleContent,
  agentSkillContent,
  NICEEVAL_CONFIG_TEMPLATE,
} from "./templates.ts";

/** Reports initialization and every managed guidance target without hiding partial writes. */
export interface ProjectInitializationReceipt {
  readonly projectRoot: string;
  readonly evals: "created" | "existing";
  readonly config: "created" | "existing";
  readonly agentInstructions: readonly {
    readonly path: string;
    readonly change: "created" | "updated" | "unchanged";
  }[];
  readonly prefersEsm: boolean;
}

/** Initialize through the owning platform services; validate all guidance before writing it. */
export interface ProjectHostSDK {
  readonly initialize: () => Effect.Effect<
    ProjectInitializationReceipt,
    ProjectPlatformError,
    ProjectFileSystem | ProjectManifestFacts | ProjectProcessFacts
  >;
}

function invalid(resource: string, message: string): ProjectPlatformError {
  return new ProjectPlatformError({ operation: "write-file", resource, cause: message, message });
}

const initializeProject = Effect.fn("project.initialize")(function* () {
  const processFacts = yield* ProjectProcessFacts;
  const projectRoot = yield* processFacts.cwd;
  const guidance = yield* processFacts.guidance(projectRoot);
  const fileSystem = yield* ProjectFileSystem;
  const manifest = yield* ProjectManifestFacts;
  if ((yield* fileSystem.pathKind({ root: projectRoot, path: BUNDLED_INDEX_PATH })) !== "file") {
    return yield* invalid(
      guidance.indexPath,
      `bundled-docs-not-on-disk: ${guidance.indexPath} must exist on disk. Install NiceEval in this directory and retry init. Yarn Plug'n'Play and installations without node_modules are not supported.`,
    );
  }
  const root = guidance.repositoryRoot;
  const targets: Exclude<ProjectManagedPath, "evals">[] = [];
  for (const path of ["AGENTS.md", "CLAUDE.md"] as const) {
    if ((yield* fileSystem.pathKind({ root, path })) !== "missing") targets.push(path);
  }
  if (targets.length === 0) targets.push("AGENTS.md");
  const content = agentRuleContent(guidance.indexPath, guidance.command);
  const planned: {
    path: Exclude<ProjectManagedPath, "evals">;
    text: string;
    change: "created" | "updated" | "unchanged";
  }[] = [];
  for (const path of [...targets, ".agents/skills/niceeval/SKILL.md", ".claude/skills/niceeval/SKILL.md"] as const) {
    const existing = yield* fileSystem.readText({ root, path });
    let text: string;
    if (targets.includes(path)) {
      const source = existing ?? "";
      const begins = [...source.matchAll(/<!-- BEGIN:niceeval-agent-rules -->/g)];
      const ends = [...source.matchAll(/<!-- END:niceeval-agent-rules -->/g)];
      if (
        (begins.length !== 0 || ends.length !== 0) &&
        (begins.length !== 1 || ends.length !== 1 || begins[0]!.index > ends[0]!.index)
      ) {
        const line = source
          .slice(0, Math.min(begins[0]?.index ?? Infinity, ends[0]?.index ?? Infinity))
          .split("\n").length;
        return yield* invalid(
          path,
          `agent-rules-markers-invalid: ${path}:${line}: Keep exactly one BEGIN/END niceeval-agent-rules pair in that order, or remove both markers, then retry init.`,
        );
      }
      text = upsertManagedBlock(source, AGENT_RULE_BEGIN, AGENT_RULE_END, content);
    } else {
      if (existing !== null && !existing.includes(AGENT_SKILL_MANAGED)) {
        return yield* invalid(
          path,
          `agent-skill-not-managed: ${path}: This skill belongs to you. Move it aside before retrying init.`,
        );
      }
      text = agentSkillContent(content);
    }
    planned.push({ path, text, change: existing === null ? "created" : text === existing ? "unchanged" : "updated" });
  }

  const evals = yield* fileSystem.ensureDirectory({ root: projectRoot, path: "evals" });
  const existingConfig = yield* fileSystem.readText({ root: projectRoot, path: "niceeval.config.ts" });
  if (existingConfig === null) {
    yield* fileSystem.writeText({ root: projectRoot, path: "niceeval.config.ts", text: NICEEVAL_CONFIG_TEMPLATE });
  }
  const updated: string[] = [];
  for (let index = 0; index < planned.length; index++) {
    const target = planned[index]!;
    if (target.change !== "unchanged") {
      yield* fileSystem.writeText({ root, path: target.path, text: target.text }).pipe(
        Effect.mapError((cause) =>
          invalid(
            target.path,
            `init write failed: ${target.path}. Updated: ${updated.join(", ") || "none"}. Not updated: ${planned
              .slice(index)
              .map((item) => item.path)
              .join(", ")}. Fix the I/O error and retry init. ${String(cause.cause)}`,
          ),
        ),
      );
      updated.push(target.path);
    }
  }
  const moduleKind = yield* manifest.moduleKind(projectRoot);
  return Object.freeze({
    projectRoot,
    evals,
    config: existingConfig === null ? ("created" as const) : ("existing" as const),
    agentInstructions: planned.map(({ path, change }) => Object.freeze({ path, change })),
    prefersEsm: moduleKind === "esm",
  });
});

/** Project initialization entry; provide the platform services before running. */
export const projectHost: ProjectHostSDK = Object.freeze({ initialize: initializeProject });
