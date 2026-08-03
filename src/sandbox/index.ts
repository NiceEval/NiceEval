// niceeval/sandbox 公开导出:「在哪里跑」相关的类型 + 工厂 + 扩展点。
// 具体 provider 实现类(DockerSandbox / VercelSandbox / E2BSandbox)是内部实现细节,不在此导出——
// 需要自定义 provider 时用 defineSandbox(),不需要直接 new 内置实现类。

export { defineSandbox } from "../define.ts";
export {
  CustomSandboxMaterializationError,
  sandboxLayer,
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
  e2bSandbox,
  vercelSandbox,
  localSandbox,
  defineSandboxCase,
} from "./layer.ts";
export { command, shell, defineSandboxCommand } from "./commands.ts";
export { checkout, installTool } from "./prepare-commands.ts";
export { SandboxCommandExitError } from "./operations.ts";
export { registerSandboxContent } from "./content.ts";
export {
  COMPOSE_MATERIALIZER_REVISION,
  dockerComposeBuildProvider,
  collectComposeBuilds,
  leakGateHintsFromComposeFile,
  inspectComposeYaml,
  assertComposeBlacklist,
  findComposeBlacklistViolations,
  buildComposeOverlay,
  materializeDockerComposeProviderCase,
} from "./compose.ts";
export {
  computeBuildKey,
  computeCaseKey,
  resolveFloatingImageTag,
  credentialIdentityContribution,
  assertPureDataIdentity,
  looksLikeDigestRef,
} from "./identity.ts";
export {
  SANDBOX_BUILD_ACTIVITY,
  prepareSandboxBuilds,
  startSandboxBuilds,
  buildFailureOrigin,
} from "./build-coordinator.ts";
export { createCheckpoint, restoreCheckpoint } from "./checkpoint.ts";
export {
  NICEEVAL_BUB_DOCKER_IMAGE,
  NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  NICEEVAL_CODEX_DOCKER_IMAGE,
  NICEEVAL_HERMES_DOCKER_IMAGE,
  NICEEVAL_OPENCLAW_DOCKER_IMAGE,
  NICEEVAL_OPENCODE_DOCKER_IMAGE,
} from "./docker-agent-image.ts";

export type {
  SandboxLayer,
  SandboxLayerKind,
  DockerComposeSandboxOptions,
  DockerfileSandboxOptions,
  DockerImageSandboxOptions,
  E2BSandboxOptions,
  VercelSandboxOptions,
  LocalSandboxOptions,
  CustomProviderSandboxOptions,
  CustomCaseSandboxOptions,
  CustomCaseServices,
  CustomCaseMaterializedServices,
  CustomCaseMaterializeResult,
  SandboxTargetPlatform,
  SandboxLeakGate,
} from "./layer.ts";

export type {
  SandboxCommand,
  SandboxCommandContext,
  SandboxCommandTarget,
  SandboxCleanupCommand,
  SandboxCommandIdentity,
  SandboxCommandIdentityValue,
  SandboxCommandOptions,
  StableSandboxCommand,
  AttemptRef,
} from "./commands.ts";

export type { CheckoutOptions, InstallToolOptions } from "./prepare-commands.ts";

export type { RegisteredSandboxContent } from "./content.ts";

export type {
  Sandbox,
  EvalSandbox,
  SandboxOperations,
  SandboxTransferOperations,
  SandboxProvider,
  SandboxRuntime,
  SandboxHook,
  SandboxHookContext,
  CommandResult,
  CommandOptions,
  SuccessfulCommandResult,
} from "../types.ts";

export type {
  SandboxCaseKind,
  ServiceController,
  MaterializedSandboxCase,
  SandboxGroupEntry,
  SandboxResourceGroup,
  SandboxMaterializeContext,
} from "./case-types.ts";

export type {
  BuildKey,
  CaseKey,
  BuildKeyInput,
  CaseKeyInput,
  ImageRefResolution,
  CredentialRef,
} from "./identity.ts";

export type {
  ComposeBuildCollection,
  ComposeInspection,
  ComposeServiceInspection,
  ComposeBlacklistFinding,
  ComposeOverlay,
  MaterializeComposeOpts,
} from "./compose.ts";

export type {
  SandboxBuildWork,
  SandboxBuildProvider,
  SandboxBuildExecutionContext,
  SandboxBuildPreparation,
  SandboxBuildFailure,
  PrepareSandboxBuildsOptions,
} from "./build-coordinator.ts";
