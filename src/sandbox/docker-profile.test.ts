// cases: docs/engineering/testing/unit/sandbox.md

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DockerExecutionProfileV1Schema,
  DockerProfileError,
  createDockerExecutionProfileV1,
  dockerExecutionProfileSemanticPolicyRevisionOf,
  dockerExecutionProfileV1Digest,
  dockerProfilePublicSummaryOf,
  dockerSandbox,
  indexDockerProfiles,
  parseDockerExecutionProfileV1,
  resolveDockerProfile,
  resolveDockerProfileSelector,
  type DockerExecutionProfileV1Draft,
  type DockerSandboxOptions,
} from "./index.ts";
import {
  dockerfileSandbox,
  dockerImageSandbox,
  sandboxLayerStateOf,
} from "./layer.ts";
import { loadDockerProfileRegistry, loadDockerProfileRegistryAt } from "./docker-profile/runtime.ts";

const GiB = 1024 ** 3;

function profileDraft(profileId = "profile-a"): DockerExecutionProfileV1Draft {
  return {
    schemaVersion: 1,
    profileId,
    securityLevel: "managed-rootless/v1",
    transport: {
      kind: "unix",
      hostMachineIdentity: "host-a",
      dockerSocket: { path: "/run/niceeval/default/docker.sock", peerUid: 1000 },
      controlSocket: {
        path: "/run/niceeval/default/control.sock",
        peerUid: 1000,
        protocol: "niceeval-docker-profile-control/v1",
      },
    },
    backend: {
      kind: "local-systemd",
      machineIdentity: "host-a",
      owner: { uid: 2001, gid: 2001 },
      filesystem: {
        identity: "fs-a",
        mountPath: "/var/lib/niceeval/default",
        dockerRootDir: "/var/lib/niceeval/default/docker",
        limitBytes: 64 * GiB,
      },
      cgroup: {
        aggregatePath: "/sys/fs/cgroup/niceeval/default.slice",
        policyRevision: "cgroup-v1",
        controllers: ["cpu", "memory", "pids"],
      },
    },
    capacity: {
      cpus: 4,
      memoryBytes: 6 * GiB,
      memorySwapBytes: 0,
      pids: 2048,
      maxContainers: 8,
      maxBuilds: 2,
      aggregate: {
        cpus: 5,
        memoryBytes: 8 * GiB,
        memorySwapBytes: 0,
        pids: 4096,
      },
    },
    policy: {
      hostLoopback: false,
      tcpDockerEndpoint: false,
      outerSocketInjection: false,
      privilegedTranslation: "rootless-userns",
      writableRoot: "declared-tmpfs-only",
      network: {
        version: 1,
        dns: { mode: "explicit", servers: ["1.1.1.1", "9.9.9.9"] },
        egress: {
          mode: "rootless-nat",
          allowedProtocols: ["dns", "https"],
          denyPrivateNetworks: true,
          denySiblingSyntheticEndpoints: true,
          denyCidrs: [
            "0.0.0.0/8",
            "10.0.0.0/8",
            "100.64.0.0/10",
            "127.0.0.0/8",
            "169.254.0.0/16",
            "172.16.0.0/12",
            "192.0.0.0/24",
            "192.0.2.0/24",
            "192.168.0.0/16",
            "198.18.0.0/15",
            "198.51.100.0/24",
            "203.0.113.0/24",
            "224.0.0.0/4",
            "240.0.0.0/4",
            "::/0",
          ],
          ipv6: "disabled",
          disableHostLoopback: true,
          portDriver: "none",
          daemonBridge: "none",
          exclusiveNetwork: true,
          icc: false,
        },
      },
    },
  };
}

function profile(profileId = "profile-a") {
  return createDockerExecutionProfileV1(profileDraft(profileId));
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (!(error instanceof DockerProfileError)) throw error;
    return error.code;
  }
  throw new Error("expected DockerProfileError");
}

function managedResources(): NonNullable<Extract<
  DockerSandboxOptions,
  { readonly dockerAccess: { readonly isolation: "managed-rootless" } }
>["resources"]> {
  return {
    cpus: 2,
    memoryBytes: 2 * GiB,
    pidsLimit: 512,
    readOnlyRootfs: true,
    tmpfs: {
      "/var/lib/docker": { sizeBytes: GiB, executable: true },
    },
  };
}

function templateOf(layer: ReturnType<typeof dockerSandbox>) {
  return sandboxLayerStateOf(layer).template;
}

function invokeDockerSandbox(options: unknown): ReturnType<typeof dockerSandbox> {
  return Reflect.apply(dockerSandbox, undefined, [options]);
}

function typeContracts(): void {
  const source = { type: "image", image: "node:24" } as const;
  const ordinary: DockerSandboxOptions = { source };
  const managed: DockerSandboxOptions = {
    source,
    dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" },
    resources: managedResources(),
  };
  // @ts-expect-error managed-rootless declares a managed branch and therefore requires all resource fields.
  dockerSandbox({ source, dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" } });
  // @ts-expect-error DinD has no default isolation and can never silently become raw privileged.
  dockerSandbox({ source, dockerAccess: { mode: "dind" } });
  void ordinary;
  void managed;
}
void typeContracts;

describe("Docker execution profile v1 pure descriptor", () => {
  it("production registry固定在/etc，只有内部测试helper接收目录", () => {
    expect(loadDockerProfileRegistry).toHaveLength(0);
    expect(loadDockerProfileRegistryAt).toHaveLength(1);
  });

  it("规范化并冻结完整 descriptor，且把 allocatable 与 aggregate 分开保留", () => {
    const result = profile();

    expect(result.capacity).toEqual({
      cpus: 4,
      memoryBytes: 6 * GiB,
      memorySwapBytes: 0,
      pids: 2048,
      maxContainers: 8,
      maxBuilds: 2,
      aggregate: {
        cpus: 5,
        memoryBytes: 8 * GiB,
        memorySwapBytes: 0,
        pids: 4096,
      },
    });
    expect(result.policy.network).toMatchObject({
      version: 1,
      dns: { mode: "explicit", servers: ["1.1.1.1", "9.9.9.9"] },
      egress: {
        mode: "rootless-nat",
        allowedProtocols: ["dns", "https"],
        denyPrivateNetworks: true,
        denySiblingSyntheticEndpoints: true,
        ipv6: "disabled",
        disableHostLoopback: true,
        portDriver: "none",
        daemonBridge: "none",
        exclusiveNetwork: true,
        icc: false,
      },
    });
    expect(result.policy.network.egress.denyCidrs).toContain("198.18.0.0/15");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.policy.network)).toBe(true);
    expect(Object.isFrozen(result.policy.network.dns.servers)).toBe(true);
    expect(Schema.is(DockerExecutionProfileV1Schema)(result)).toBe(true);
    expect(dockerProfilePublicSummaryOf(result)).not.toHaveProperty("transport");
  });

  it("把 DNS/egress 语义纳入 revision 与 digest，而不把容量或 socket 混入 policy revision", () => {
    const first = profile();
    const originalDraft = profileDraft();
    const changedDraft: DockerExecutionProfileV1Draft = {
      ...originalDraft,
      policy: {
        ...originalDraft.policy,
        network: {
          ...originalDraft.policy.network,
          dns: { ...originalDraft.policy.network.dns, servers: ["8.8.8.8", "9.9.9.9"] },
        },
      },
    };
    const second = createDockerExecutionProfileV1(changedDraft);

    expect(second.semanticPolicyRevision).not.toBe(first.semanticPolicyRevision);
    expect(dockerExecutionProfileV1Digest(second)).not.toBe(dockerExecutionProfileV1Digest(first));

    const capacityDraft = profileDraft();
    const capacityOnlyDraft: DockerExecutionProfileV1Draft = {
      ...capacityDraft,
      capacity: { ...capacityDraft.capacity, cpus: 4.5 },
    };
    expect(dockerExecutionProfileSemanticPolicyRevisionOf(capacityOnlyDraft)).toBe(first.semanticPolicyRevision);
  });

  it("拒绝私网与 198.18/15 synthetic DNS、反向容量和语义 revision 伪造", () => {
    for (const server of ["10.0.0.1", "198.18.1.1"]) {
      const original = profileDraft();
      const invalid: DockerExecutionProfileV1Draft = {
        ...original,
        policy: {
          ...original.policy,
          network: {
            ...original.policy.network,
            dns: { ...original.policy.network.dns, servers: [server] },
          },
        },
      };
      expect(errorCode(() => createDockerExecutionProfileV1(invalid))).toBe(
        "sandbox.docker-profile-schema-invalid",
      );
    }

    const original = profileDraft();
    const reversed: DockerExecutionProfileV1Draft = {
      ...original,
      capacity: {
        ...original.capacity,
        aggregate: { ...original.capacity.aggregate, cpus: 3 },
      },
    };
    expect(errorCode(() => createDockerExecutionProfileV1(reversed))).toBe(
      "sandbox.docker-profile-capacity-invalid",
    );

    const mismatch = profile();
    expect(errorCode(() => parseDockerExecutionProfileV1({ ...mismatch, semanticPolicyRevision: "ffffffff" }))).toBe(
      "sandbox.docker-profile-semantic-policy-mismatch",
    );
  });

  it("对未知 schema version 与 security level 返回稳定错误码", () => {
    const unknownVersion = { ...profileDraft(), schemaVersion: 2, semanticPolicyRevision: "unused" };
    expect(errorCode(() => parseDockerExecutionProfileV1(unknownVersion))).toBe(
      "sandbox.docker-profile-unknown-version",
    );

    const unsupportedSecurity = { ...profileDraft(), securityLevel: "rootful/v1", semanticPolicyRevision: "unused" };
    expect(errorCode(() => parseDockerExecutionProfileV1(unsupportedSecurity))).toBe(
      "sandbox.docker-profile-security-level-unsupported",
    );

    const networkVersion = profile();
    expect(errorCode(() => parseDockerExecutionProfileV1({
      ...networkVersion,
      policy: {
        ...networkVersion.policy,
        network: { ...networkVersion.policy.network, version: 2 },
      },
    }))).toBe("sandbox.docker-profile-schema-invalid");
  });
});

describe("Docker profile registry pure resolution", () => {
  it("按唯一 alias 解析 descriptor、保留 source，并校验 root-owned 文件事实", () => {
    const descriptor = profile();
    const registry = indexDockerProfiles([{
      alias: "default",
      descriptor,
      source: "/etc/niceeval/docker-profiles/default.json",
      fileFacts: { ownerUid: 0, mode: 0o644, parentModes: [0o755, 0o755] },
    }]);
    const resolved = resolveDockerProfile(registry, "default");

    expect(resolved.profileId).toBe(descriptor.profileId);
    expect(resolved.descriptorDigest).toBe(dockerExecutionProfileV1Digest(descriptor));
    expect(resolved.source).toBe("/etc/niceeval/docker-profiles/default.json");
    expect(resolveDockerProfileSelector(registry, descriptor.profileId)).toEqual(resolved);
    expect(errorCode(() => indexDockerProfiles([{
      alias: "unsafe",
      profile: descriptor,
      fileFacts: { isSymlink: true },
    }]))).toBe("sandbox.docker-profile-registry-symlink");
    expect(errorCode(() => indexDockerProfiles([{
      alias: "wrong-owner",
      profile: descriptor,
      fileFacts: { ownerUid: 1000 },
    }]))).toBe("sandbox.docker-profile-registry-owner-invalid");
    expect(errorCode(() => indexDockerProfiles([{
      alias: "writable",
      profile: descriptor,
      fileFacts: { mode: 0o664 },
    }]))).toBe("sandbox.docker-profile-registry-mode-invalid");
    expect(errorCode(() => indexDockerProfiles([{
      alias: "writable-parent",
      profile: descriptor,
      fileFacts: { parentWritable: true },
    }]))).toBe("sandbox.docker-profile-registry-parent-writable");
  });

  it("拒绝 duplicate stable ID、同 alias 多 descriptor 与 alias/ID selector 歧义", () => {
    const first = profile("stable-a");
    const second = profile("stable-b");
    expect(errorCode(() => indexDockerProfiles({ default: [first, second] }))).toBe(
      "sandbox.docker-profile-registry-ambiguous-alias",
    );
    expect(errorCode(() => indexDockerProfiles([
      { alias: "one", profile: first },
      { alias: "two", profile: first },
    ]))).toBe("sandbox.docker-profile-registry-duplicate-id");

    const left = profile("right");
    const right = profile("left");
    const ambiguous = indexDockerProfiles([
      { alias: "left", profile: left },
      { alias: "right", profile: right },
    ]);
    expect(errorCode(() => resolveDockerProfileSelector(ambiguous, "left"))).toBe(
      "sandbox.docker-profile-registry-ambiguous-alias",
    );
  });

  it("透传 descriptor unknown version、拒绝未知 alias，并验证已建 index 的 digest", () => {
    const unknownVersion = { ...profileDraft("versioned"), schemaVersion: 2, semanticPolicyRevision: "unused" };
    expect(errorCode(() => indexDockerProfiles([{ alias: "versioned", profile: unknownVersion }]))).toBe(
      "sandbox.docker-profile-unknown-version",
    );

    const registry = indexDockerProfiles([{ alias: "known", profile: profile() }]);
    expect(errorCode(() => resolveDockerProfile(registry, "missing"))).toBe(
      "sandbox.docker-profile-registry-alias-not-found",
    );
    const forged = {
      ...registry,
      entries: [{ ...registry.entries[0], descriptorDigest: "sha256:forged" }],
    };
    expect(errorCode(() => resolveDockerProfile(forged, "known"))).toBe(
      "sandbox.docker-profile-registry-entry-invalid",
    );
  });
});

describe("dockerSandbox factory profile wiring", () => {
  it("保留非 profile image/Dockerfile 兼容，并通过穷尽 source 联合产出声明", () => {
    expect(() => dockerSandbox({ source: { type: "image", image: "node:24" } })).not.toThrow();
    expect(templateOf(dockerSandbox({
      source: { type: "dockerfile", context: "/tmp/context", file: "Dockerfile.eval", target: "runtime" },
    })).kind).toBe("dockerfile");
  });

  it("socket与raw DinD是显式且不同的identity，socket宿主路径不进入可分享identity", () => {
    const firstSocket = templateOf(dockerSandbox({
      source: { type: "image", image: "docker:29-cli" },
      dockerAccess: { mode: "socket", socketPath: "/var/run/docker.sock" },
    }));
    const secondSocket = templateOf(dockerSandbox({
      source: { type: "image", image: "docker:29-cli" },
      dockerAccess: { mode: "socket", socketPath: "/run/user/1000/docker.sock" },
    }));
    const raw = templateOf(dockerSandbox({
      source: { type: "image", image: "docker:29-dind" },
      dockerAccess: { mode: "dind", isolation: "raw-privileged" },
    }));

    expect(firstSocket.identity).toEqual(secondSocket.identity);
    expect(firstSocket.identity).toMatchObject({
      publishable: {
        dockerAccess: { mode: "socket" },
        readiness: { command: ["docker", "info"] },
      },
    });
    expect(raw.identity).toMatchObject({
      publishable: {
        dockerAccess: { mode: "dind", isolation: "raw-privileged" },
        readiness: { command: ["docker", "info"] },
      },
    });
    expect(raw.identity).not.toEqual(firstSocket.identity);
  });

  it("DinD没有默认isolation，socket路径必须规范，且新旧字段不能组合", () => {
    expect(() => invokeDockerSandbox({
      source: { type: "image", image: "docker:29-dind" },
      dockerAccess: { mode: "dind" },
    })).toThrow(/isolation/);
    expect(() => dockerSandbox({
      source: { type: "image", image: "docker:29-cli" },
      dockerAccess: { mode: "socket", socketPath: "./docker.sock" },
    })).toThrow(/normalized absolute path/);
    expect(() => dockerImageSandbox({
      image: "docker:29-dind",
      dockerAccess: { mode: "dind", isolation: "raw-privileged" },
      privileged: "rootless",
    })).toThrow(/cannot be combined/);
  });

  it("managed DinD 必须 profile与完整资源，且profile alias不进入可分享identity", () => {
    expect(errorCode(() => dockerSandbox({
      source: { type: "image", image: "node:24" },
      dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" },
    } as never))).toBe("sandbox.docker-profile-resources-required");

    const first = templateOf(dockerSandbox({
      source: { type: "image", image: "node:24" },
      dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" },
      resources: managedResources(),
      readiness: { command: ["docker", "info"], user: "node", timeoutMs: 30_000, intervalMs: 250 },
    }));
    const second = templateOf(dockerSandbox({
      source: { type: "image", image: "node:24" },
      dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "another-machine-alias" },
      resources: managedResources(),
      readiness: { command: ["docker", "info"], user: "node", timeoutMs: 60_000, intervalMs: 1_000 },
    }));
    expect(first.identity).toEqual(second.identity);
    expect(first.identity).toMatchObject({
      publishable: {
        dockerAccess: { mode: "dind", isolation: "managed-rootless" },
        resources: {
          cpus: 2,
          memoryBytes: 2 * GiB,
          pidsLimit: 512,
          readOnlyRootfs: true,
          tmpfs: { "/var/lib/docker": { sizeBytes: GiB, executable: true } },
        },
        readiness: { command: ["docker", "info"], user: "node" },
      },
    });
  });

  it("旧 image/Dockerfile factory 也不允许绕过 profile 资源边界", () => {
    expect(errorCode(() => dockerImageSandbox({ image: "node:24", privileged: "rootless" }))).toBe(
      "sandbox.docker-profile-required",
    );
    expect(errorCode(() => dockerfileSandbox({ context: "/tmp/context", profile: "default" }))).toBe(
      "sandbox.docker-profile-resources-required",
    );
  });
});
