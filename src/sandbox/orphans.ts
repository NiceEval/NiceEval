// 孤儿核对与 prune:强杀路径的实例面兜底(见 docs/feature/sandbox/architecture.md
// 「孤儿核对:强杀路径的实例面兜底」、docs/feature/sandbox/cli.md「sandbox list --orphans」
// 「sandbox prune」)。docker 按 label 查本地 daemon,e2b 按 metadata 过滤 SDK 实例列表;
// vercel 无按元数据检索实例的通道,不参与。核对与销毁以 case 的资源组为单位:Compose case 的
// 伴随容器与网络按 compose project label 拼回一组,整组列出、整组销毁。provider 名分支只允许
// 出现在 sandbox/ 内(见 docs/architecture.md)。

import { destroyDetached } from "./keep.ts";
import {
  classifyRunIdentity,
  DOCKER_COMPOSE_PROJECT_LABEL,
  DOCKER_MAIN_SERVICE_LABEL,
  parseDockerRunIdentity,
  parseE2BRunIdentity,
  type OrphanState,
  type RunIdentity,
} from "./run-identity.ts";

/** Compose case 的资源组:一次核对、一次销毁的最小单位。 */
export interface ComposeResourceGroup {
  kind: "docker-compose";
  projectName: string;
  /** 组内容器 id(短 id);主实例已消失时为空数组。 */
  containerIds: string[];
  /** 组内网络 id;`docker network rm` 用它,展示用 `networkNames`。 */
  networkIds: string[];
  networkNames: string[];
}

export interface OrphanCandidate {
  provider: "docker" | "e2b";
  /** 展示与销毁的主键:单实例是实例 id;Compose 组是主容器短 id,主容器已消失时退回 project 名。 */
  sandboxId: string;
  identity: RunIdentity;
  state: OrphanState;
  /** Compose case 才有:整组列出与整组销毁的资源清单。 */
  resources?: ComposeResourceGroup;
}

/** 孤儿三条件的裁决判据;默认走真实系统探测(`classifyRunIdentity`),测试注入窄判据以
 *  摆脱对当前进程真实启动时刻与 `ps` 可用性的依赖(见 docs/engineering/testing/unit/sandbox.md
 *  「孤儿核对与 prune」)。 */
export type OrphanClassifier = (identity: RunIdentity) => "alive" | OrphanState;

interface DockerContainerInfo {
  Id: string;
  Labels: globalThis.Record<string, string>;
}
interface DockerNetworkInfo {
  Id: string;
  Name: string;
  Labels?: globalThis.Record<string, string>;
}
/** 只声明本模块用到的 dockerode 面,避免把 dockerode 的完整类型拉进核对逻辑。 */
interface DockerClient {
  listContainers(opts: unknown): Promise<DockerContainerInfo[]>;
  listNetworks(opts: unknown): Promise<DockerNetworkInfo[]>;
  getContainer(id: string): { remove(opts: unknown): Promise<unknown> };
  getNetwork(id: string): { remove(): Promise<unknown> };
}

async function dockerClient(): Promise<DockerClient> {
  const { default: Docker } = await import("dockerode");
  return new Docker() as unknown as DockerClient;
}

/** docker 候选:按 `niceeval.host` label 存在性查询本地 daemon 的容器与网络(容器含已停止的)。
 *  daemon 不可用(未装 docker / 未启动)时静默返回空集合——只读核对不能因为本机没有 docker 就
 *  整体报错。 */
async function dockerOrphanCandidates(
  keptIds: ReadonlySet<string>,
  classify: OrphanClassifier,
): Promise<OrphanCandidate[]> {
  let containers: DockerContainerInfo[];
  let networks: DockerNetworkInfo[] = [];
  let docker: DockerClient;
  try {
    docker = await dockerClient();
    containers = (await docker.listContainers({ all: true, filters: { label: ["niceeval.host"] } })) ?? [];
  } catch {
    return [];
  }
  try {
    networks = (await docker.listNetworks({ filters: { label: ["niceeval.host"] } })) ?? [];
  } catch {
    networks = []; // 老 daemon / 无网络检索权限:容器那一半照常核对
  }

  const out: OrphanCandidate[] = [];
  const groups = new Map<string, { containers: DockerContainerInfo[]; networks: DockerNetworkInfo[] }>();
  const groupOf = (project: string) => {
    let g = groups.get(project);
    if (g === undefined) {
      g = { containers: [], networks: [] };
      groups.set(project, g);
    }
    return g;
  };

  for (const info of containers) {
    const project = info.Labels?.[DOCKER_COMPOSE_PROJECT_LABEL];
    if (project !== undefined && project !== "") {
      groupOf(project).containers.push(info);
      continue;
    }
    const id = info.Id.slice(0, 12);
    if (keptIds.has(id)) continue; // 留存注册表已登记的现场是被管理的,不是孤儿
    const identity = parseDockerRunIdentity(info.Labels);
    if (!identity) continue;
    const state = classify(identity);
    if (state === "alive") continue; // 属主 run 还活着,属于并发运行中的另一次 run,不出现在列表里
    out.push({ provider: "docker", sandboxId: id, identity, state });
  }
  for (const net of networks) {
    const project = net.Labels?.[DOCKER_COMPOSE_PROJECT_LABEL];
    if (project === undefined || project === "") continue; // 组外的孤立网络没有可核对的归属
    groupOf(project).networks.push(net);
  }

  for (const [projectName, group] of groups) {
    const candidate = composeGroupCandidate(projectName, group, keptIds, classify);
    if (candidate) out.push(candidate);
  }
  return out;
}

/** 资源组的判定:身份取组内任一成员(优先主服务容器),留存注册表登记了组内任一容器就整组免动。 */
function composeGroupCandidate(
  projectName: string,
  group: { containers: DockerContainerInfo[]; networks: DockerNetworkInfo[] },
  keptIds: ReadonlySet<string>,
  classify: OrphanClassifier,
): OrphanCandidate | undefined {
  const containerIds = group.containers.map((c) => c.Id.slice(0, 12));
  if (containerIds.some((id) => keptIds.has(id))) return undefined;

  const main = group.containers.find((c) => c.Labels?.[DOCKER_MAIN_SERVICE_LABEL] === "true");
  const identity =
    (main ? parseDockerRunIdentity(main.Labels) : undefined) ??
    group.containers.map((c) => parseDockerRunIdentity(c.Labels)).find((i) => i !== undefined) ??
    group.networks.map((n) => parseDockerRunIdentity(n.Labels)).find((i) => i !== undefined);
  if (!identity) return undefined;

  const state = classify(identity);
  if (state === "alive") return undefined;
  return {
    provider: "docker",
    // 主容器已消失(只剩网络或 sidecar)时退回 project 名,组仍然被列出、被收回。
    sandboxId: main ? main.Id.slice(0, 12) : (containerIds[0] ?? projectName),
    identity,
    state,
    resources: {
      kind: "docker-compose",
      projectName,
      containerIds,
      networkIds: group.networks.map((n) => n.Id),
      networkNames: group.networks.map((n) => n.Name),
    },
  };
}

/** e2b 候选:走 SDK 实例列表,client 侧按 metadata 是否带运行标识过滤。凭据缺失/网络失败时
 *  静默返回空集合(同 docker 的宽容降级)。 */
async function e2bOrphanCandidates(
  keptIds: ReadonlySet<string>,
  classify: OrphanClassifier,
): Promise<OrphanCandidate[]> {
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
        const state = classify(identity);
        if (state === "alive") continue;
        out.push({ provider: "e2b", sandboxId: info.sandboxId, identity, state });
      }
    }
  } catch {
    return out; // 部分翻页失败时返回已收集的部分结果,不因一次网络抖动清空整份只读列表
  }
  return out;
}

/** `sandbox list --orphans` 的数据源:docker + e2b 并发查询,已排除留存注册表条目。
 *  `classify` 省略时用真实系统探测(`classifyRunIdentity`);测试注入窄判据换取确定性,
 *  不依赖 `ps` 是否可用或当前进程的真实启动时刻。 */
export async function listOrphanCandidates(
  keptIds: ReadonlySet<string>,
  classify: OrphanClassifier = classifyRunIdentity,
): Promise<OrphanCandidate[]> {
  const [docker, e2b] = await Promise.all([
    dockerOrphanCandidates(keptIds, classify),
    e2bOrphanCandidates(keptIds, classify),
  ]);
  return [...docker, ...e2b];
}

/** `niceeval exp` 启动残留提醒专用:只做 docker 零成本核对,云 provider 不在启动期探测。 */
export async function dockerOrphanCount(keptIds: ReadonlySet<string>): Promise<number> {
  return (await dockerOrphanCandidates(keptIds, classifyRunIdentity)).length;
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
 * Compose 资源组按组销毁:组内容器与网络一起收回,不留只剩网络的半截残留。
 * 不触碰留存注册表条目——已登记现场的销毁是 `sandbox stop` 的职责。
 */
export async function pruneOrphans(keptIds: ReadonlySet<string>, force: boolean): Promise<PruneOutcome> {
  const candidates = await listOrphanCandidates(keptIds);
  const targets = candidates.filter((c) => c.state === "orphan" || (force && c.state === "unverified"));
  const pruned: OrphanCandidate[] = [];
  const failed: { candidate: OrphanCandidate; message: string }[] = [];
  for (const c of targets) {
    try {
      if (c.resources) await destroyComposeGroup(c.resources);
      else await destroyDetached(c.provider, c.sandboxId);
      pruned.push(c);
    } catch (e) {
      failed.push({ candidate: c, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const unverifiedRemaining = force ? 0 : candidates.filter((c) => c.state === "unverified").length;
  return { pruned, failed, unverifiedRemaining };
}

/**
 * 整组销毁:强杀留下的组没有 compose 文件可回放(overlay 在临时目录里,随进程一起没了),
 * 所以直接按 id 删容器再删网络——先容器后网络,网络还有容器接着时 daemon 会拒绝删除。
 * 已不存在的资源(404)算已完成,与单实例销毁的幂等口径一致。
 */
async function destroyComposeGroup(group: ComposeResourceGroup): Promise<void> {
  const docker = await dockerClient();
  for (const id of group.containerIds) {
    await ignoreMissing(() => docker.getContainer(id).remove({ force: true, v: true }));
  }
  for (const id of group.networkIds) {
    await ignoreMissing(() => docker.getNetwork(id).remove());
  }
}

async function ignoreMissing(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) return;
    throw e;
  }
}
