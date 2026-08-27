import { incusError, type IncusProviderError } from "./errors.ts";

export const INCUS_IMAGE_LOCATOR = /^([A-Za-z0-9][A-Za-z0-9._:/-]*)@sha256:([a-f0-9]{64})$/u;
/** Trusted-image property that proves guest-init will mount a block Docker data disk. */
export const INCUS_IMAGE_GUEST_INIT_PROPERTY = "niceeval.guest-init";
export const INCUS_GUEST_INIT_BLOCK_DOCKER_DATA = "block-docker-data/v1";

export interface IncusImageLocator {
  readonly name: string;
  readonly digest: string;
  readonly locator: string;
}

export function parseIncusImageLocator(value: unknown, path: string): IncusImageLocator {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a digest-pinned locator name@sha256:<64 lowercase hex>`);
  }
  const match = INCUS_IMAGE_LOCATOR.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw incusError(
      "sandbox-artifact-unverified",
      `${path} must be name@sha256:<64 lowercase hex>; aliases and short prefixes are rejected.`,
      ["Pin the Incus image to an exact sha256 digest before planning."],
    );
  }
  return Object.freeze({
    name: match[1],
    digest: match[2],
    locator: `${match[1]}@sha256:${match[2]}`,
  });
}

export function parseTrustedImageLocator(value: string, path: string): IncusImageLocator | IncusProviderError {
  try {
    return parseIncusImageLocator(value, path);
  } catch (cause) {
    return cause instanceof Error && "code" in cause
      ? cause as IncusProviderError
      : incusError(
          "sandbox-artifact-unverified",
          `${path} ${JSON.stringify(value)} is not a digest-pinned locator.`,
          ["List trustedImages as name@sha256:<64 lowercase hex>."],
          cause,
        );
  }
}

export function displayIncusOrigin(input: {
  readonly image: string;
  readonly project: string;
  readonly storagePool: string;
}): string {
  return `${input.image} project=${input.project} pool=${input.storagePool}`;
}
