// niceeval/sandbox 公开导出:「在哪里跑」相关的类型 + 工厂 + 扩展点。
// 具体 provider 实现类(DockerSandbox / VercelSandbox / E2BSandbox)是内部实现细节,不在此导出——
// 需要自定义 provider 时用 defineSandbox(),不需要绕开 resolve.ts 直接 new 内置类。

export { dockerSandbox, vercelSandbox, e2bSandbox, localSandbox, defineSandbox } from "../define.ts";
export { createCheckpoint, restoreCheckpoint } from "./checkpoint.ts";

export type {
  Sandbox,
  SandboxHandle,
  SandboxFile,
  SandboxProvider,
  SandboxOption,
  SandboxSpec,
  SandboxRuntime,
  SandboxHook,
  SandboxHookContext,
  DockerSandboxSpec,
  VercelSandboxSpec,
  E2BSandboxSpec,
  LocalSandboxSpec,
  CustomSandboxSpec,
  CommandResult,
  CommandOptions,
} from "../types.ts";
