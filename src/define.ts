// 定义入口:把用户对象规格化成核心认得的形状。路径即身份 —— 这里禁止手写 id,
// 由发现阶段从文件路径推导(见 runner/discover.ts)。

import type {
  Agent,
  Config,
  DockerSandboxSpec,
  E2BSandboxSpec,
  EvalDef,
  ExperimentDef,
  RemoteAgentDef,
  SandboxAgentDef,
  VercelSandboxSpec,
} from "./types.ts";
import { t } from "./i18n/index.ts";

const SANDBOX_DEFAULT_CAPS = {
  conversation: true,
  toolObservability: true,
  workspace: true,
} as const;

const REMOTE_DEFAULT_CAPS = {
  conversation: true,
  toolObservability: true,
} as const;

/** 沙箱型 agent:在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。 */
export function defineSandboxAgent(def: SandboxAgentDef): Agent {
  if (!def.name) throw new Error(t("define.sandboxAgentNameRequired"));
  return {
    name: def.name,
    kind: "sandbox",
    capabilities: { ...SANDBOX_DEFAULT_CAPS, ...(def.capabilities ?? {}) },
    setup: def.setup,
    tracing: def.tracing,
    send: def.send,
    teardown: def.teardown,
  };
}

/** 远程 / 进程内 agent:在 send 里直接驱动你的函数 / 服务。 */
export function defineAgent(def: RemoteAgentDef): Agent {
  if (!def.name) throw new Error(t("define.agentNameRequired"));
  return {
    name: def.name,
    kind: "remote",
    capabilities: { ...REMOTE_DEFAULT_CAPS, ...(def.capabilities ?? {}) },
    setup: def.setup,
    tracing: def.tracing,
    send: def.send,
    teardown: def.teardown,
  };
}

/** 会话型 eval。禁止提供 id —— 从路径推导。 */
export function defineEval(def: EvalDef): EvalDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error(t("define.evalIdRejected"));
  }
  if (typeof def.test !== "function") {
    throw new Error(t("define.evalTestRequired"));
  }
  return def;
}

/** 实验:可签入的运行配置(怎么跑这批 eval)。 */
export function defineExperiment(def: ExperimentDef): ExperimentDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error(t("define.experimentIdRejected"));
  }
  if (!def.agent) throw new Error(t("define.experimentAgentRequired"));
  return def;
}

/** 项目级配置。 */
export function defineConfig(config: Config): Config {
  return config;
}

// ───────────────────────── Sandbox 工厂 ─────────────────────────
// Sandbox 与 agent 一样用数据结构带参数(见 docs/sandbox.md)。这些工厂只是把
// 后端 + 参数包成 spec 对象;真正的行为在 sandbox/<backend>.ts 里,由 resolve.ts 派发。

/** Docker 沙箱:本地容器。`image` 可覆盖默认 `node:*-slim`(预制模板:烘焙好 agent CLI 的镜像)。 */
export function dockerSandbox(opts: Omit<DockerSandboxSpec, "backend"> = {}): DockerSandboxSpec {
  return { backend: "docker", ...opts };
}

/** Vercel Sandbox:microVM。`snapshotId` 从已有快照起(预制模板:烘焙好 agent CLI 的快照)。 */
export function vercelSandbox(opts: Omit<VercelSandboxSpec, "backend"> = {}): VercelSandboxSpec {
  return { backend: "vercel", ...opts };
}

/** E2B 沙箱。`template` 选 e2b 模板名/ID(预制模板:如 `"fasteval-agents"`);省略用 e2b 默认 `"base"`。 */
export function e2bSandbox(opts: Omit<E2BSandboxSpec, "backend"> = {}): E2BSandboxSpec {
  return { backend: "e2b", ...opts };
}
