import { Data } from "effect";
import type { JsonValue } from "../../shared/types.ts";

/**
 * Docker profile 在声明、schema 和 registry 边界使用的稳定错误码。
 *
 * 这些错误只描述纯数据解析事实；它们不代表 control service、watchdog 或 Docker provider
 * 的运行时失败。后续 runtime 层可以在不改变这里的错误码的前提下附加自己的失败分类。
 */
export type DockerProfileErrorCode =
  | "sandbox.docker-profile-schema-invalid"
  | "sandbox.docker-profile-unknown-version"
  | "sandbox.docker-profile-security-level-unsupported"
  | "sandbox.docker-profile-semantic-policy-mismatch"
  | "sandbox.docker-profile-capacity-invalid"
  | "sandbox.docker-profile-registry-entry-invalid"
  | "sandbox.docker-profile-registry-duplicate-id"
  | "sandbox.docker-profile-registry-ambiguous-alias"
  | "sandbox.docker-profile-registry-alias-not-found"
  | "sandbox.docker-profile-registry-symlink"
  | "sandbox.docker-profile-registry-owner-invalid"
  | "sandbox.docker-profile-registry-mode-invalid"
  | "sandbox.docker-profile-registry-parent-writable"
  | "sandbox.docker-profile-required"
  | "sandbox.docker-profile-resources-required";

export interface DockerProfileErrorOptions {
  readonly code: DockerProfileErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly alias?: string;
  readonly profileId?: string;
  readonly candidates?: readonly string[];
  readonly details?: JsonValue;
}

/** 纯数据 profile 边界的统一、可判别错误。 */
export class DockerProfileError extends Data.TaggedError("DockerProfileError")<DockerProfileErrorOptions> {}

export function dockerProfileError(options: DockerProfileErrorOptions): DockerProfileError {
  return new DockerProfileError({
    ...options,
    ...(options.candidates === undefined ? {} : { candidates: Object.freeze([...options.candidates]) }),
  });
}
