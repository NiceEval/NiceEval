// 定义入口:把用户对象规格化成核心认得的形状。路径即身份 —— 这里禁止手写 id,
// 由发现阶段从文件路径推导(见 runner/discover.ts)。

import type {
  Agent,
  Config,
  EvalDef,
  ExperimentDef,
  RemoteAgentDef,
  SandboxAgentDef,
} from "./types.ts";

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
  if (!def.name) throw new Error("defineSandboxAgent 需要 name。");
  return {
    name: def.name,
    kind: "sandbox",
    capabilities: { ...SANDBOX_DEFAULT_CAPS, ...(def.capabilities ?? {}) },
    send: def.send,
  };
}

/** 远程 / 进程内 agent:在 send 里直接驱动你的函数 / 服务。 */
export function defineAgent(def: RemoteAgentDef): Agent {
  if (!def.name) throw new Error("defineAgent 需要 name。");
  return {
    name: def.name,
    kind: "remote",
    capabilities: { ...REMOTE_DEFAULT_CAPS, ...(def.capabilities ?? {}) },
    send: def.send,
  };
}

/** 会话型 eval。禁止提供 id —— 从路径推导。 */
export function defineEval(def: EvalDef): EvalDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error("defineEval 不接受 id —— id 由文件路径推导。");
  }
  if (typeof def.test !== "function") {
    throw new Error("defineEval 需要一个 async test(t) 函数。");
  }
  return def;
}

/** 实验:可签入的运行配置(怎么跑这批 eval)。 */
export function defineExperiment(def: ExperimentDef): ExperimentDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error("defineExperiment 不接受 id —— id 由文件路径推导。");
  }
  if (!def.agent) throw new Error("defineExperiment 需要 agent。");
  return def;
}

/** 项目级配置。 */
export function defineConfig(config: Config): Config {
  return config;
}
