// 单 Dockerfile 构建身份的唯一解析边界。physical planner 与 Run 级 build collector
// 必须消费同一份结果，避免携带决策看到的 identity 与真正构建使用的 BuildKey 分叉。

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { buildContextIdentityContribution } from "../runner/leak-gate.ts";
import type { JsonValue } from "../shared/types.ts";
import {
  computeBuildKey,
  unresolvedProviderFingerprintMarker,
  type BuildKey,
} from "./identity.ts";

export const DOCKERFILE_MATERIALIZER_REVISION = "dockerfile-2";

export interface DockerfileBuildIdentityInput {
  readonly provider: "docker" | "e2b";
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly platform: string;
  readonly baseDir?: string;
  readonly label?: string;
}

export interface DockerfileBuildIdentity {
  readonly buildKey: BuildKey;
  readonly contextDir: string;
  readonly dockerfilePath: string;
  readonly dockerfile: string;
  readonly contextFilterRules: string;
  readonly providerIdentityMarker?: JsonValue;
}

export class DockerfileBuildIdentityError extends Data.TaggedError("DockerfileBuildIdentityError")<{
  readonly stage: "dockerfile" | "context" | "identity";
  readonly message: string;
}> {}

function identityError(
  stage: DockerfileBuildIdentityError["stage"],
  cause: unknown,
): DockerfileBuildIdentityError {
  return new DockerfileBuildIdentityError({
    stage,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

export function resolveDockerfileBuildIdentity(
  input: DockerfileBuildIdentityInput,
): Effect.Effect<DockerfileBuildIdentity, DockerfileBuildIdentityError> {
  return Effect.gen(function* () {
    const rawContext = input.context instanceof URL ? fileURLToPath(input.context) : input.context;
    const contextDir = isAbsolute(rawContext)
      ? rawContext
      : resolvePath(input.baseDir ?? process.cwd(), rawContext);
    const dockerfilePath = resolvePath(contextDir, input.dockerfile ?? "Dockerfile");
    const dockerfile = yield* Effect.tryPromise({
      try: () => readFile(dockerfilePath, "utf8"),
      catch: () => new DockerfileBuildIdentityError({
        stage: "dockerfile",
        message: `Dockerfile not found at ${dockerfilePath}`,
      }),
    });
    const { contextDigest, contextFilterRules } = yield* buildContextIdentityContribution({
      contextDir,
      label: input.label ?? "Dockerfile sandbox",
    }).pipe(Effect.mapError((cause) => identityError("context", cause)));
    return yield* Effect.try({
      try: () => {
        const base = dockerfileBaseIdentity(dockerfile, input.target);
        const buildKey = computeBuildKey({
          builderKind: `${input.provider}-dockerfile`,
          builderRevision: DOCKERFILE_MATERIALIZER_REVISION,
          platform: input.platform,
          dockerfile,
          contextDigest,
          fromDigest: base.fromDigest,
          contextFilterRules,
          ...(input.buildArgs !== undefined ? { buildArgs: input.buildArgs } : {}),
          ...(input.target !== undefined ? { target: input.target } : {}),
        });
        return Object.freeze({
          buildKey,
          contextDir,
          dockerfilePath,
          dockerfile,
          contextFilterRules,
          ...(base.providerIdentityMarker === undefined ? {} : { providerIdentityMarker: base.providerIdentityMarker }),
        });
      },
      catch: (cause) => identityError("identity", cause),
    });
  });
}

/** 多阶段 Dockerfile 的外部 base 身份；内部 stage 引用与 scratch 不要求 registry digest。 */
export function dockerfileBaseIdentity(
  dockerfile: string,
  target?: string,
): { readonly fromDigest: string; readonly providerIdentityMarker?: JsonValue } {
  const stages: Array<{ ref: string; name?: string }> = [];
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = line.match(/^\s*FROM\s+(?:(?:--\S+)\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
    if (match?.[1] !== undefined) {
      stages.push({ ref: match[1], ...(match[2] !== undefined ? { name: match[2] } : {}) });
    }
  }
  const targetIndex = target === undefined
    ? stages.length - 1
    : stages.findIndex(({ name }) => name?.toLowerCase() === target.toLowerCase());
  const included = stages.slice(0, targetIndex >= 0 ? targetIndex + 1 : stages.length);
  const aliases = new Set<string>();
  const bases: string[] = [];
  let hasUnresolvedBase = included.length === 0;
  for (const stage of included) {
    const ref = stage.ref.toLowerCase();
    if (ref === "scratch") {
      bases.push("scratch");
    } else if (aliases.has(ref)) {
      bases.push(`stage:${ref}`);
    } else {
      const digest = digestFromReference(stage.ref);
      if (digest === undefined) {
        hasUnresolvedBase = true;
        bases.push(`unresolved:${stage.ref}`);
      } else {
        bases.push(digest);
      }
    }
    if (stage.name !== undefined) aliases.add(stage.name.toLowerCase());
  }
  return Object.freeze({
    fromDigest: JSON.stringify(bases),
    ...(hasUnresolvedBase
      ? {
          providerIdentityMarker: unresolvedProviderFingerprintMarker(
            "sandbox.base-image-unresolved",
            "Dockerfile FROM is not pinned to a sha256 digest.",
          ),
        }
      : {}),
  });
}

function digestFromReference(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const index = ref.indexOf("@sha256:");
  if (index < 0) return undefined;
  const digest = ref.slice(index + 1);
  return /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest : undefined;
}
