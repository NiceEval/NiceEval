import fc from "fast-check";
import { expect, test } from "vitest";
import { dockerSandbox, type DockerSandboxSource } from "niceeval/sandbox";

const image = { type: "image", image: "fixture:local" } satisfies DockerSandboxSource;
const dockerfile = { type: "dockerfile", context: "." } satisfies DockerSandboxSource;
const socket = { dockerAccess: { mode: "socket", socketPath: "/var/run/docker.sock" } } as const;
const raw = { dockerAccess: { mode: "dind", isolation: "raw-privileged" } } as const;
const managed = {
  dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "fixture" },
  resources: { cpus: 1, memoryBytes: 1024 ** 3, pidsLimit: 128, dockerDataBytes: 1024 ** 3, readOnlyRootfs: true },
} as const;

// @feature docs/feature/sandbox-nested-docker/library.md#非法组合
test("dockerSandbox names the retired Docker access option when rejecting it", () => {
  fc.assert(
    fc.property(fc.constantFrom(image, dockerfile), fc.constantFrom(socket, raw, managed), (source, legacy) => {
      const options = { source, ...legacy };
      expect(() => dockerSandbox(options)).toThrow(
        expect.objectContaining({ name: "TypeError", message: expect.stringContaining("dockerSandbox options.dockerAccess") }),
      );
    }),
    { examples: [[image, socket]] },
  );
});
