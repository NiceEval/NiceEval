// 孤儿核对与 prune:强杀路径的实例面兜底(见 docs/feature/sandbox/architecture.md
// 「孤儿核对:强杀路径的实例面兜底」、docs/feature/sandbox/cli.md「sandbox list --orphans」
// 「sandbox prune」)。docker 按 label 查本地 daemon,e2b 按 metadata 过滤 SDK 实例列表;
// vercel 无按元数据检索实例的通道,不参与。provider 名分支只允许出现在 sandbox/ 内
// (见 docs/architecture.md)。

import { destroyDetached } from "./keep.ts";
import {
  classifyRunIdentity,
  parseDockerRunIdentity,
  parseE2BRunIdentity,
  type OrphanState,
  type RunIdentity,
} from "./run-identity.ts";

export interface OrphanCandidate {
  provider: "docker" | "e2b";
  sandboxId: string;
  identity: RunIdentity;
  state: OrphanState;
}

/** docker 候选:按 `niceeval.host` label 存在性查询本地 daemon(含已停止容器)。daemon 不可用
 *  (未装 docker / 未启动)时静默返回空集合——只读核对不能因为本机没有 docker 就整体报错。 */
async function dockerOrphanCandidates(keptIds: ReadonlySet<string>): Promise<OrphanCandidate[]> {
  let containers: { Id: string; Labels: Record<string, string> }[];
  try {
    const { default: Docker } = await import("dockerode");
    containers = await new Docker().listContainers({ all: true, filters: { label: ["niceeval.host"] } });
  } catch {
    return [];
  }
  const out: OrphanCandidate[] = [];
  for (const info of containers) {
    const id = info.Id.slice(0, 12);
    if (keptIds.has(id)) continue; // 留存注册表已登记的现场是被管理的,不是孤儿
    const identity = parseDockerRunIdentity(info.Labels);
    if (!identity) continue;
    const state = classifyRunIdentity(identity);
    if (state === "alive") continue; // 属主 run 还活着,属于并发运行中的另一次 run,不出现在列表里
    out.push({ provider: "docker", sandboxId: id, identity, state });
  }
  return out;
}

/** e2b 候选:走 SDK 实例列表,client 侧按 metadata 是否带运行标识过滤。凭据缺失/网络失败时
 *  静默返回空集合(同 docker 的宽容降级)。 */
async function e2bOrphanCandidates(keptIds: ReadonlySet<string>): Promise<OrphanCandidate[]> {
  const out: OrphanCandidate[] = [];
  try {
    const { Sandbox: E2BSdkSandbox } = await import("e2b");
    const paginator = E2BSdkSandbox.list({ apiKey: process.env.E2B_API_KEY });
    while (paginator.hasNext) {
      const items = await paginator.nextItems();
      for (const info of items) {
        if (keptIds.has(info.sandboxId)) continue;
        const identity = parseE2BRunIdentity(info.metadata);
        if (!identity) continue;
        const state = classifyRunIdentity(identity);
        if (state === "alive") continue;
        out.push({ provider: "e2b", sandboxId: info.sandboxId, identity, state });
      }
    }
  } catch {
    return out; // 部分翻页失败时返回已收集的部分结果,不因一次网络抖动清空整份只读列表
  }
  return out;
}

/** `sandbox list --orphans` 的数据源:docker + e2b 并发查询,已排除留存注册表条目。 */
export async function listOrphanCandidates(keptIds: ReadonlySet<string>): Promise<OrphanCandidate[]> {
  const [docker, e2b] = await Promise.all([dockerOrphanCandidates(keptIds), e2bOrphanCandidates(keptIds)]);
  return [...docker, ...e2b];
}

/** `niceeval exp` 启动残留提醒专用:只做 docker 零成本核对,云 provider 不在启动期探测。 */
export async function dockerOrphanCount(keptIds: ReadonlySet<string>): Promise<number> {
  return (await dockerOrphanCandidates(keptIds)).length;
}

export interface PruneOutcome {
  pruned: OrphanCandidate[];
  failed: { candidate: OrphanCandidate; message: string }[];
  /** `--force` 未传时,核实为 unverified 但本次没有销毁的剩余数量。 */
  unverifiedRemaining: number;
}

/**
 * 销毁已核实的孤儿(`orphan`);`force` 时连 `unverified` 一起销毁。幂等(`destroyDetached`
 * 已把"实例已不存在"当成功处理);单台失败列出继续处理其余,不因一台失败中止整批。
 * 不触碰留存注册表条目——已登记现场的销毁是 `sandbox stop` 的职责。
 */
export async function pruneOrphans(keptIds: ReadonlySet<string>, force: boolean): Promise<PruneOutcome> {
  const candidates = await listOrphanCandidates(keptIds);
  const targets = candidates.filter((c) => c.state === "orphan" || (force && c.state === "unverified"));
  const pruned: OrphanCandidate[] = [];
  const failed: { candidate: OrphanCandidate; message: string }[] = [];
  for (const c of targets) {
    try {
      await destroyDetached(c.provider, c.sandboxId);
      pruned.push(c);
    } catch (e) {
      failed.push({ candidate: c, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const unverifiedRemaining = force ? 0 : candidates.filter((c) => c.state === "unverified").length;
  return { pruned, failed, unverifiedRemaining };
}
