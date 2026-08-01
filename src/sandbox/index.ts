// niceeval/sandbox 公开导出:「在哪里跑」相关的类型 + 工厂 + 扩展点。
// 具体 provider 实现类(DockerSandbox / VercelSandbox / E2BSandbox)是内部实现细节,不在此导出——
// 需要自定义 provider 时用 defineSandbox(),不需要绕开 resolve.ts 直接 new 内置类。

// 新 SandboxLayer factory 不与旧 provider spec 工厂做兼容重载。旧实现仍留在 define.ts 供
// Runner 迁移期间内部使用；无命名冲突的 dockerSandbox/defineSandbox 暂保留原入口。
export { dockerSandbox, defineSandbox } from "../define.ts";
export {
  sandboxLayer,
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
  e2bSandbox,
  vercelSandbox,
  localSandbox,
} from "./layer.ts";
export { command, shell, defineSandboxCommand } from "./commands.ts";
export { registerSandboxContent } from "./content.ts";
export {
  composeSandbox,
  defineSandboxCase,
  planSandboxCase,
  materializePlannedCase,
  isSandboxSource,
  validateSpecEnvironmentCases,
} from "./case.ts";
export {
  COMPOSE_MATERIALIZER_REVISION,
  dockerComposeMaterializer,
  dockerComposeBuildProvider,
  collectComposeBuilds,
  composeBuildWorksFromPlan,
  attachComposeLeakGateHints,
  leakGateHintsFromComposeFile,
  inspectComposeYaml,
  assertComposeBlacklist,
  findComposeBlacklistViolations,
  buildComposeOverlay,
  materializeDockerComposeCase,
} from "./compose.ts";
export {
  createMaterializedCase,
  prebuiltProductSlotsOf,
  specWithPrebuiltProduct,
  assertKeepAllowedForCase,
  assertCustomCapabilitiesHonored,
  hasGroupKeep,
  caseCapabilitiesOf,
  isSingleSandboxCaseKind,
  SINGLE_SANDBOX_CASE_KINDS,
} from "./resolve.ts";
export type { CreateMaterializedCaseOpts } from "./resolve.ts";
export type { PrebuiltProductSlots, SingleSandboxCaseKind } from "./single-case.ts";
export {
  registerCustomGroupKeep,
  lookupCustomGroupKeep,
  destroyCustomGroupKeep,
  wakeCustomGroupKeep,
  clearCustomGroupKeepRegistry,
} from "./custom-group-keep.ts";
export {
  computeBuildKey,
  computeCaseKey,
  resolveFloatingImageTag,
  credentialIdentityContribution,
  assertPureDataIdentity,
  caseCarryEligible,
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

export type { RegisteredSandboxContent } from "./content.ts";

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

export type {
  SandboxSource,
  ComposeSandboxSource,
  DockerfileSandboxSource,
  SandboxCaseKind,
  SandboxSourceKind,
  SandboxCapability,
  ServiceController,
  MaterializedSandboxCase,
  SandboxGroupEntry,
  SandboxResourceGroup,
  DockerEnvironmentCase,
  E2BEnvironmentCase,
  VercelEnvironmentCase,
  CustomEnvironmentCase,
  SandboxMaterializer,
  SandboxMaterializers,
  PlannedSandboxCase,
  CasePlanResult,
} from "./case.ts";

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
