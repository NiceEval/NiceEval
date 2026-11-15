// Provider-owned retained-scene commands and in-run suspension.
import type { Sandbox } from "../types.ts";
import { sandboxCapabilities } from "./backend.ts";

export async function suspendSandbox(sandbox: Sandbox): Promise<void> {
  const suspend = sandboxCapabilities(sandbox).suspend;
  if (suspend._tag === "Unsupported") {
    throw new Error(`sandbox provider has no suspend capability (sandboxId=${sandbox.sandboxId})`);
  }
  await suspend.value();
}

/** Live-scene command for --pause-on-failure, before suspension. */
export function nativeEnterCommand(provider: string, sandboxId: string): string | undefined {
  switch (provider) {
    case "docker":
      return `docker exec -it ${sandboxId} /bin/bash`;
    case "instabox":
      return `instabox ssh ${sandboxId}`;
    case "e2b":
      return `e2b sandbox connect ${sandboxId}`;
    case "vercel":
      return `sandbox connect ${sandboxId}`;
    default:
      return undefined;
  }
}

/** Only providers declaring retention have a retained-scene command contract. */
export function retainedSandboxCommands(
  provider: string,
  sandboxId: string,
): {
  readonly nativeCommand: string;
  readonly cleanCommand: string;
} {
  switch (provider) {
    case "docker":
      return {
        nativeCommand: `docker start ${sandboxId} && docker exec -it ${sandboxId} /bin/bash`,
        cleanCommand: `docker rm -f ${sandboxId}`,
      };
    case "e2b":
      return { nativeCommand: `e2b sandbox connect ${sandboxId}`, cleanCommand: `e2b sandbox kill ${sandboxId}` };
    case "vercel":
      return { nativeCommand: `sandbox connect ${sandboxId}`, cleanCommand: `sandbox remove ${sandboxId}` };
    default:
      throw new Error(`sandbox provider "${provider}" has no retained-scene native command contract`);
  }
}

/**
 * Vercel 持久沙箱的默认快照保留期限:`snapshotExpiration` 默认 2,592,000,000ms(30 天),
 * 从快照最后一次使用起算(官方文档 vercel.com/docs/sandbox/concepts/persistent-sandboxes)。
 * niceeval 的 `VercelSandbox.create()` 不传自定义 `snapshotExpiration`,这个默认值就是
 * suspend(`stop()`,自动打快照)之后实际生效的保留期限。
 */
const VERCEL_DEFAULT_SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 留存授予时计算 `expiresAt`，只有 provider 声明了保留期限才输出。
 *
 * - **vercel**:写 `keptAt` + 默认快照保留期(30 天)。
 * - **e2b**:不写——官方文档("paused sandboxes are kept indefinitely; there is no
 *   automatic deletion or time-to-live limit")明确 pause 没有自然过期时刻。
 * - **docker**:不写——docker 的留存是本地停驻容器,不是「远端保留期限」这个概念。
 */
export function computeExpiresAt(provider: string, keptAt: string): string | undefined {
  switch (provider) {
    case "vercel":
      return new Date(Date.parse(keptAt) + VERCEL_DEFAULT_SNAPSHOT_EXPIRATION_MS).toISOString();
    default:
      return undefined;
  }
}
