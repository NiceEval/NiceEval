// niceeval/sandbox 公开导出:「在哪里跑」相关的类型 + 工厂 + 扩展点。
// 具体 provider 实现类(DockerSandbox / VercelSandbox / E2BSandbox)是内部实现细节,不在此导出——
// 需要自定义 provider 时用 defineSandbox(),不需要直接 new 内置实现类。

export { defineSandbox } from "../define.ts";
export {
  CustomSandboxMaterializationError,
  sandboxLayer,
  sandboxRequirements,
  dockerSandbox,
  dockerComposeSandbox,
  e2bSandbox,
  vercelSandbox,
  defineSandboxCase,
} from "./layer.ts";
export { incusSandbox } from "./incus.ts";
export { command, shell, defineSandboxCommand } from "./commands.ts";
export {
  actionRef,
  changeFrequency,
  defineSandboxAction,
  gitCheckout,
  sandboxStep,
  sandboxState,
  SandboxActionDefinitionError,
  uploadDirectory,
  uploadFile,
  writeBytes,
  writeText,
} from "./action.ts";
export { checkout, installTool } from "./prepare-commands.ts";
export { SandboxCommandExitError } from "./operations.ts";
export { registerSandboxContent, sandboxContent } from "./content.ts";
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
  normalizeSandboxCapture,
} from "./record/attachment.ts";
export type {
  SandboxCaptureInput,
  SandboxCaptureInputError,
} from "./record/attachment.ts";
export {
  NICEEVAL_BUB_DOCKER_IMAGE,
  NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  NICEEVAL_CODEX_DOCKER_IMAGE,
  NICEEVAL_HERMES_DOCKER_IMAGE,
  NICEEVAL_OPENCLAW_DOCKER_IMAGE,
  NICEEVAL_OPENCODE_DOCKER_IMAGE,
  NICEEVAL_OMP_DOCKER_IMAGE,
  NICEEVAL_DEEPSEEK_HARNESS_DOCKER_IMAGE,
} from "./docker-agent-image.ts";

export type {
  SandboxLayer,
  SandboxLayerKind,
  SandboxRequirementsOptions,
  SandboxRequirement,
  DockerExecutionRequirement,
  DockerImageSource,
  DockerfileSource,
  DockerSandboxSource,
  DockerSandboxAccess,
  DockerSandboxOptions,
  DockerSandboxCommonOptions,
  DockerSandboxReadiness,
  ManagedDockerResources,
  DockerComposeSandboxOptions,
  DockerSandboxResources,
  DockerSandboxTmpfsOptions,
  E2BSandboxOptions,
  VercelSandboxOptions,
  CustomProviderSandboxOptions,
  CustomCaseSandboxOptions,
  CustomCaseServices,
  CustomCaseMaterializedServices,
  CustomCaseMaterializeResult,
  SandboxTargetPlatform,
  SandboxLeakGate,
} from "./layer.ts";
export type { IncusSandboxOptions, IncusSandboxResources } from "./incus.ts";

export type {
  SandboxCommand,
  SandboxCommandContext,
  SandboxCommandTarget,
  SandboxCleanupCommand,
  SandboxCommandIdentity,
  SandboxCommandDefinition,
  SandboxCommandIdentityValue,
  SandboxCommandOptions,
  SandboxExecOptions,
  CommandActionOptions,
  CommandAfterActionOptions,
  CommandActionFactory,
  ShellActionInput,
  ShellAfterActionInput,
  ShellActionFactory,
  StableSandboxCommand,
  AttemptRef,
} from "./commands.ts";

export type {
  CheckoutGitSandboxStepInput,
  ExecSandboxStepInput,
  NonEmptySandboxSteps,
  PutBytesSandboxStepInput,
  PutTextSandboxStepInput,
  SandboxAction,
  SandboxActionDefinition,
  SandboxActionFamily,
  SandboxActionFingerprintPlan,
  SandboxActionPlan,
  SandboxActionRef,
  SandboxActionState,
  SandboxState,
  SandboxActionInstanceOptions,
  SandboxAfterAction,
  SandboxAfterActionOptions,
  SandboxBeforeActionOptions,
  SandboxCapability,
  SandboxChangeFrequency,
  SandboxStep,
  SandboxStepPlan,
  SandboxTransferSource,
  TransferDirectorySandboxStepInput,
  TransferFileSandboxStepInput,
  GitCheckoutActionFactory,
  GitCheckoutActionInput,
  GitCheckoutAfterActionInput,
  UploadDirectoryActionFactory,
  UploadDirectoryActionInput,
  UploadDirectoryAfterActionInput,
  UploadFileActionFactory,
  UploadFileActionInput,
  UploadFileAfterActionInput,
  WriteBytesActionFactory,
  WriteBytesActionInput,
  WriteBytesAfterActionInput,
  WriteTextActionFactory,
  WriteTextActionInput,
  WriteTextAfterActionInput,
} from "./action.ts";

export type { CheckoutOptions, InstallToolOptions } from "./prepare-commands.ts";

export type {
  RegisteredSandboxContent,
  SandboxContent,
  SandboxContentFactory,
} from "./content.ts";

export type {
  Sandbox,
  SandboxOperations,
  SandboxTransferOperations,
  SandboxProvider,
  SandboxRuntime,
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
  SandboxBuildRef,
  MaterializationScopeId,
  SandboxBuildLookup,
  SandboxBuildArtifactSource,
  SandboxBuildUseHandle,
  SandboxBuildExecutionContext,
  SandboxBuildPreparation,
  SandboxBuildFailure,
  PrepareSandboxBuildsOptions,
} from "./build-coordinator.ts";

export { materializationScopeId, sandboxBuildRef } from "./build-coordinator.ts";

export {
  DockerProfileError,
  dockerProfileError,
} from "./docker-profile/errors.ts";
export type {
  DockerProfileErrorCode,
  DockerProfileErrorOptions,
} from "./docker-profile/errors.ts";
export {
  DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION,
  DOCKER_PROFILE_SCHEMA_VERSION,
  DOCKER_PROFILE_NETWORK_POLICY_VERSION,
  DOCKER_PROFILE_NETWORK_DENY_CIDRS,
  DockerExecutionProfileV1Schema,
  DockerExecutionProfileSchema,
  createDockerExecutionProfileV1,
  decodeDockerExecutionProfileV1,
  dockerExecutionProfileSemanticPolicyRevisionOf,
  dockerProfileSemanticPolicyRevisionOf,
  dockerExecutionProfileV1Digest,
  dockerProfileDigestOf,
  dockerProfilePublicSummaryOf,
  isDockerExecutionProfileV1,
  makeDockerExecutionProfileV1,
  parseDockerExecutionProfile,
  parseDockerExecutionProfileV1,
} from "./docker-profile/schema.ts";
export type {
  DockerExecutionProfileSecurityLevel,
  DockerExecutionProfileV1,
  DockerExecutionProfileV1Draft,
  DockerProfileNetworkPolicy,
  DockerProfilePublicSummary,
  DockerProfileUnixEndpoint,
} from "./docker-profile/schema.ts";
export {
  createDockerProfileRegistry,
  indexDockerProfiles,
  parseDockerProfileRegistry,
  resolveDockerExecutionProfile,
  resolveDockerProfile,
  resolveDockerProfileAlias,
  resolveDockerProfileSelector,
} from "./docker-profile/registry.ts";
export type {
  DockerProfileRegistryEntry,
  DockerProfileRegistryFileFacts,
  DockerProfileRegistryIndex,
  DockerProfileRegistryInput,
  DockerProfileRegistryOptions,
  ResolvedDockerProfileEntry,
} from "./docker-profile/registry.ts";
