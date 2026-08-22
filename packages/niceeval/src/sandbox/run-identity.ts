// 沙箱创建期写入的运行标识元数据:host(宿主机名)、pid(runner 进程)、startedAt(快照时刻)。
// docker 用容器 label、e2b 用 SDK metadata——与既有 `niceeval.keep-candidate` / provision token
// 同一机制同通道;vercel 没有按元数据检索实例的通道,不写、不报错(见
// docs/feature/sandbox/architecture.md「孤儿核对:强杀路径的实例面兜底」)。

import { hostname } from "node:os";
import { execFileSync } from "node:child_process";

export interface RunIdentity {
  host: string;
  pid: number;
  startedAt: string;
}

/** 创建沙箱时快照一次当前 runner 进程的运行标识。 */
export function currentRunIdentity(): RunIdentity {
  return { host: hostname(), pid: process.pid, startedAt: new Date().toISOString() };
}

export const DOCKER_HOST_LABEL = "niceeval.host";
export const DOCKER_PID_LABEL = "niceeval.pid";
export const DOCKER_STARTED_AT_LABEL = "niceeval.started-at";

/** Compose 自己给组内容器与网络打的 project label——孤儿核对靠它把一组资源拼回来。 */
export const DOCKER_COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
/** 受管 overlay 打在 mainService 上的标记:资源组里哪一台是主实例。 */
export const DOCKER_MAIN_SERVICE_LABEL = "niceeval.main-service";

export const E2B_HOST_METADATA = "niceeval-host";
export const E2B_PID_METADATA = "niceeval-pid";
export const E2B_STARTED_AT_METADATA = "niceeval-started-at";

export function dockerRunIdentityLabels(identity: RunIdentity): globalThis.Record<string, string> {
  return {
    [DOCKER_HOST_LABEL]: identity.host,
    [DOCKER_PID_LABEL]: String(identity.pid),
    [DOCKER_STARTED_AT_LABEL]: identity.startedAt,
  };
}

export function e2bRunIdentityMetadata(identity: RunIdentity): globalThis.Record<string, string> {
  return {
    [E2B_HOST_METADATA]: identity.host,
    [E2B_PID_METADATA]: String(identity.pid),
    [E2B_STARTED_AT_METADATA]: identity.startedAt,
  };
}

/** 从 docker label 集合解出运行标识;缺任何一个字段视为没有标识(非 niceeval 容器)。 */
export function parseDockerRunIdentity(labels: globalThis.Record<string, string> | undefined): RunIdentity | undefined {
  if (!labels) return undefined;
  return parseRunIdentityFields(labels[DOCKER_HOST_LABEL], labels[DOCKER_PID_LABEL], labels[DOCKER_STARTED_AT_LABEL]);
}

/** 从 e2b SDK 返回的 metadata 解出运行标识;缺任何一个字段视为没有标识。 */
export function parseE2BRunIdentity(metadata: globalThis.Record<string, string> | undefined): RunIdentity | undefined {
  if (!metadata) return undefined;
  return parseRunIdentityFields(
    metadata[E2B_HOST_METADATA],
    metadata[E2B_PID_METADATA],
    metadata[E2B_STARTED_AT_METADATA],
  );
}

function parseRunIdentityFields(
  host: string | undefined,
  pidRaw: string | undefined,
  startedAt: string | undefined,
): RunIdentity | undefined {
  if (host === undefined || pidRaw === undefined || startedAt === undefined) return undefined;
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid)) return undefined;
  return { host, pid, startedAt };
}

/**
 * 同宿主 pid 存活探测(`process.kill(pid, 0)` 语义):进程存在即活(`EPERM` 表示存在但无权限信号,
 * 仍算活),`ESRCH`(或其它异常)视为不存活。
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type OrphanState = "orphan" | "unverified";

/** 返回 pid 的操作系统启动时刻；无法可靠取得时留给调用方保守降级。 */
export function pidStartedAt(pid: number): string | undefined {
  try {
    // macOS 与常见 Linux 均支持 lstart；避免 /proc 专有格式和时钟 tick 换算。
    const raw = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const timestamp = Date.parse(raw);
    return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * 孤儿三条件里「属主 run 已被证实死亡」这一条的裁决:`"alive"` 表示属主还活着(调用方应把这类
 * 实例整个排除在孤儿列表之外,不是标 unverified);host 不匹配当前宿主机时无法核对 pid,归
 * `"unverified"`;host 匹配且 pid 不存活才是 `"orphan"`。偏保守——host 不匹配时宁可多一条
 * unverified,也不错误地当活实例处理。
 */
export function classifyRunIdentity(
  identity: RunIdentity,
  readPidStartedAt: (pid: number) => string | undefined = pidStartedAt,
): "alive" | OrphanState {
  if (identity.host !== hostname()) return "unverified";
  if (!isPidAlive(identity.pid)) return "orphan";
  const startedAt = readPidStartedAt(identity.pid);
  const ownerStartedAt = Date.parse(identity.startedAt);
  if (startedAt === undefined || Number.isNaN(ownerStartedAt)) return "unverified";
  // 同一 pid 的当前进程比登记 run 晚启动，说明宿主已复用 pid，原 owner 必已死亡。
  return Date.parse(startedAt) > ownerStartedAt ? "orphan" : "alive";
}
