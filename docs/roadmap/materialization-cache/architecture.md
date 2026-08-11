# Architecture

## V1 架构裁决

V1 的 Agent 安装正确性路径固定为宿主内容寻址 artifact cache，再由 Sandbox 启动阶段的 Ensure 注入。
同一 artifact 可以服务多个任务，不按 task × Agent 提交 Docker image。

task × Agent commit、只读 artifact mount、OCI manifest 重组、共享 payload layer 和专属 BuildKit builder 均不属于 V1。
共享或默认 BuildKit builder 只报告 `unverified` 容量，不进入 NiceEval GC。

## Materialization Domain

Domain 是一个 cache backend 的独立所有权和回收边界：

```ts
interface DomainIdentity {
  ownerId: string;
  backendKind: "host-cas" | "docker-images" | "buildkit";
  backendIdentity: string;
  cacheProtocolVersion: number;
}
```

host CAS、Docker image store 和 BuildKit 是三个 Domain，不能用 Docker daemon id 代替其它 backend identity。
`cache status` 可以聚合多个 Domain 的需求，库存明细、GcPlan 和 apply 始终只属于一个 Domain。

`ownerId` 是当前 OS 用户保存在 `~/.local/state/niceeval/` 的随机 UUID。
owner state 丢失会产生新 owner；旧 owner 的资源不会被新 owner 自动接管。

各 backend identity 使用以下事实：

| backend | identity |
|---|---|
| host CAS | CAS format version、CAS root 内持久随机 UUID、可验证 filesystem 或 volume identity 的摘要 |
| Docker image store | daemon id、storage driver、NiceEval sentinel volume 内持久随机 UUID 的摘要 |
| BuildKit | 专属 builder 与 node identity、worker identity、受管 storage epoch 的摘要 |

CAS root 初始化时原子写入 UUID 并完成 durable commit。
Docker sentinel UUID 必须同时通过 daemon inspect 与 volume 内容验证。
任一组成事实不可验证时，Domain 只读。

identity 变化会创建新 Domain，禁止 rebind 或 adopt。
owner state 丢失、Docker daemon 或 sentinel 变化、CAS 换盘、builder worker 或 storage epoch 变化都适用此规则。
V1 不提供 Domain 迁移。

普通 Docker Domain 只允许同一 OS host 通过本地 Unix socket 访问。
TCP、SSH context、远端 daemon 或多 host writer 只能执行 status 和 inventory，不能创建受管 entry 或 apply GC。
managed profile 只有在唯一 controller 提供 durable registry、fencing 和 conditional mutation 时才允许多 host 写入与回收。

## Registry 与权威事实

普通本地 Domain 的权威 registry 位于：

```text
$XDG_STATE_HOME/niceeval/cache/domains/<domain-id>/registry.sqlite
```

SQLite 使用 WAL 与 `synchronous=FULL`。
短事务提交是 registry 的 durability boundary；provider 长操作不得持有 SQLite 或 Domain 全局锁。
managed profile controller 提供语义等价的 durable transaction log。

registry 授权 ownership、manifest、operation lineage 和状态。
provider inspect 验证资源存在性、immutable identity 和实际引用。
命中或删除要求两侧事实一致；冲突时不能让一侧替代另一侧，entry 转为 `unverified`。

provider label 单独不能取得删除授权。
registry 中的持久化事实单独也不能证明 provider 资源仍是同一对象。
只有 registry 与 manifest 双向匹配的 immutable Docker image root 属于 NiceEval。
base image、用户拉取的 task image、共享 parent 和 layer 都不是删除目标。

## Cache Manifest

精确 key 是完整 manifest 经过 canonical serialization 后的摘要：

```ts
interface CacheManifest {
  schemaVersion: number;
  kind: "agent-artifact" | "task-build";
  provider: {
    family: string;
    backendIdentity: string;
    os: string;
    arch: string;
    libc?: string;
  };
  task?: { buildKey: string; locator: string };
  agent?: {
    ensure: { agent: string; version: string; revision: string };
    installer: { agent: string; version: string; revision: string; mode: string };
    artifactDigest?: string;
    installTarget: { user: string; home: string; prefix: string };
  };
  materializer: { id: string; revision: string };
  cacheProtocolVersion: number;
  intentProjection?: { version: number; value: unknown };
}
```

缺少必需兼容轴或遇到未知 schema 时，entry 为 `unverified`。
`intentProjection` 只解释同一意图的旧配方，不授予命中、迁移或删除资格。

## 两级 fencing

`domainAuthorityEpoch` 标识当前 Domain authority。
它只在 registry 恢复或替换、managed controller leadership 接管或重启时变化。
普通本地客户端打开同一健康 registry 不会提升 epoch。

`entryGeneration` 是每个 entry 独立递增的 fence。
状态转换通过短事务比较并交换以下 tuple：

```text
(domainAuthorityEpoch, entryId, operationId, entryGeneration, expectedState)
```

无关 entry、heartbeat 和 inventory 不改变该 entry 的 generation。
epoch 变化后，旧长操作停止发布，并把未发布的 Provider 构建资源交给 DestroyOnly reconcile。

同一 `(domainId, keyDigest)` 只有一个 active slot。
第一个 writer 在短事务内创建 `reserved → building`、build lease 和 generation，然后在事务外构建。
后来的 writer 等待并复用当前 builder 的结果，不得并行发布。

只有 reconcile 确认旧 holder 已结束，且不存在 provider 引用或 durable root 时，新 writer 才能提升 generation 并接管。
发布时重新检查 tuple；比较并交换失败的 Provider 构建资源不得发布，按 operation identity 回收。

## Entry 发布状态机

entry 按以下顺序进入命中索引：

```text
reserved → building → provider resource created → published → indexed
```

1. `reserved` 事务保存 manifest digest、operation id、generation，并 durable commit。
2. `building` 事务完成后，provider 在锁外生成带 Domain、entry、operation、generation 和 manifest 标签的未发布资源。
3. 发布方 inspect immutable resource identity，把 prepared resource identity 写入 registry 并 durable commit，再发布 managed reference。
4. `published` 事务保存经过验证的 resource identity。
5. 独立事务把精确 key 写入命中索引并转为 `indexed`；只有 `indexed` 可命中。

崩溃恢复遵循以下规则：

| 崩溃事实 | reconcile |
|---|---|
| reserved 或 building 且无资源 | 标记 abandoned，回收 operation scratch |
| provider 有资源但 registry 无 prepared identity | 列为 `owned-claim-unverified`，不可命中或自动删除 |
| prepared 持久化事实与 identity、labels 完全匹配 | 在新 generation 下恢复 publish 或 index |
| published 未 indexed | 复核后补 index；无法复核则 `unverified` |
| indexed 资源缺失或 identity 漂移 | 移出命中索引并转为 `unverified` |

## Lease 与 durable root

精确 key lookup、验证 `indexed` 和插入 lease 必须在同一个 registry write transaction 完成。
事务提交后，consumer 才能 inspect、open、copy、mount 或启动容器。

```ts
interface CacheLease {
  leaseId: string;
  domainId: string;
  entryId: string;
  keyDigest: string;
  kind: "build" | "read" | "handoff";
  operationId: string;
  domainAuthorityEpoch: number;
  entryGeneration: number;
  holder: {
    hostId: string;
    bootId: string;
    pid: number;
    processStart: string;
  };
  heartbeatSequence: number;
  heartbeatAt: string;
  expiresAt: string;
  state: "active" | "released" | "expired-unverified" | "ended";
}
```

默认 heartbeat 为 10 秒，TTL 为 60 秒，reconcile grace 为 30 秒。
到 `expiresAt + grace` 之前，lease 始终否决 GC。
TTL 到期只触发 reconcile，不授予删除资格。

相同 boot 下 PID 与 process start 仍匹配时，停滞 lease 为 `expired-unverified`，继续否决 GC。
只有 boot 已变化，或相同 boot 下能确认旧进程已死亡，临时 lease 才能结束。
holder、时钟或 registry 事实不可验证时同样为 `unverified`。

managed controller 使用自身 monotonic deadline 和持久化 wall-time 状态。
只有显式 release，或受管 host agent 以新 fence 证明旧进程与 session 已终止，才结束 lease。
网络断联、controller 重启后尚未 reattest 或 host agent 不可达时，lease 无限期保持 `unverified`。

持续使用 cache 的 Sandbox 依赖 durable root，而不是 heartbeat：

```ts
interface CacheRoot {
  rootId: string;
  domainId: string;
  entryId: string;
  sandboxId: string;
  sandboxResourceIdentity: string;
  operationId: string;
  domainAuthorityEpoch: number;
  entryGeneration: number;
  state: "prepared" | "active" | "releasing";
  createdAt: string;
}
```

短 lease 有效时，先 durable commit `prepared` root，再建立 provider 引用。
inspect 确认引用后把 root 转为 `active`，最后释放短 lease，因此不存在无保护空窗。
Sandbox retention 确认 provider 对象已销毁并再次复核无引用后，才能解除 root。

copy 型 host CAS 命中在 lease 下 open、校验、复制、close，完成后释放 lease。
mount 或持续读取型命中先建立 durable root，再释放 lease。
GC 不能依赖 Unix 已打开文件可在 unlink 后继续读取的行为。

## GC policy

每个 Domain 保存以下 versioned policy：

```ts
interface DomainGcPolicyV1 {
  policyVersion: 1;
  minimumAgeMs: number;
  maxAgeByKindMs: {
    "agent-artifact": number | null;
    "task-build": number | null;
  };
  pressure: { highUsedPercent: number; lowUsedPercent: number };
  execution: "explicit-only" | "controller-automatic";
}
```

V1 默认值如下：

| 字段 | 默认值 |
|---|---|
| minimum age | 24 小时 |
| agent-artifact max age | 90 天 |
| task-build max age | 30 天 |
| pressure high / low | 85% / 75% |
| 普通本地 backend execution | `explicit-only` |
| managed controller execution | `controller-automatic` |

`max-age/<kind>` 规则选择已过 `protectedUntil`，且 `lastSuccessfulUseAt ?? createdAt` 超过对应 max age 的 entry。
`pressure/high-to-low` 只在总容量、used 和每项边际可回收量均为 verified exact 时启用。
它从已过 minimum age 的 `cold-reusable` 中选择，直到预计 used 不高于 low watermark。

排序固定为最后成功使用时间升序、创建时间升序、entry id 字节序。
时间缺失时 entry 为 `unverified`，不能猜成最老。
`superseded-for-selection` 只用于解释，不能改变优先级或删除资格。
`legacy`、`foreign` 和 `unverified` 在任何 policy 下都不能成为 `evictable`。

`lastSuccessfulUseAt` 只在资源完整交付给 consumer 后更新。
status、inventory、planning、lease acquire、build 失败和交付失败都不刷新时间。
新 entry 固定 `protectedUntil = createdAt + minimumAge`；调短 policy 不能缩短已有保护期。

配置边界为：minimum age 1 小时至 365 天；非空 max age 不小于 minimum age且不超过 3650 天；high 为 50% 至 95%；low 为 10% 至 90%，并至少低于 high 5 个百分点。
越界配置拒绝加载；普通 Docker 不能配置自动执行。

每个候选保存 `policyVersion`、`ruleId`、`observedAt`、时间与容量 evidence、order key。
CLI 以这些事实回答为何可删。

## 删除状态机

人工 GC 只能执行 CLI 已持久化的 GcPlan 授权集合。
每项删除先在短事务中复核 plan、manifest、identity、lease、root 和 policy，并比较交换为：

```text
indexed → deleting(planId, operationId, entryGeneration)
```

`deleting` 阻止新 lease。
删除方只取得该 entry 的进程间排他锁，在 registry 事务外执行 provider inspect 与 immutable delete。
其它 entry 可继续 hit、build 和 heartbeat。

删除前，provider 的 container、mount、snapshot parent 或其它实际引用拥有最终否决权。
inspect 不可用也否决删除。
provider 调用前后都验证 domain authority epoch；epoch 变化时停止。

provider delete 后必须 re-inspect：

| 事实 | 结果 |
|---|---|
| immutable resource 不存在 | `tombstoned` |
| 响应丢失，但 resource 已不存在 | `tombstoned`，outcome 为 already absent |
| 完整相同 resource 仍存在 | 最多幂等重试一次；仍失败则恢复 indexed 并报告失败 |
| locator 指向不同 identity | 转为 `unverified`，不得继续删除 |

host CAS 在 `deleting` 后，以 entry lock 把 digest path 原子移动到同 filesystem quarantine，再 tombstone 和 unlink。
managed adapter 必须用 domain epoch 与 entry generation 做 conditional delete。
reconcile 与重复 apply 使用相同 entry lock 和状态机，保证幂等。

## Legacy 与容量

legacy 资源永不进入 GcPlan、NiceEval apply 或自动迁移。
即使能反推旧完整 key，也只能证明当前协议不会命中，不能证明其它项目、owner 或旧客户端不再使用。
库存可以给出 immutable id、证明链和不带 force 的人工 provider 命令，但 NiceEval 不执行该命令。

逻辑大小只说明单项视图，不可累加。
精确边际可回收量等于删除候选后、保留其它全部 root 时不再可达的 CAS 内容。
只有完整内容图能产生 exact 值；Docker `system df` 或逐镜像 `UniqueSize` 未验证时只能标为 estimate。

构建 peak scratch 与稳态 cache 分列。
缺失需求的增长区间必须展示同 kind、配方和平台的样本数与时间范围；没有实测时显示 unknown。

## DestroyOnly 临时资源

缓存构建临时容器和工作目录携带 operation identity、Run identity、domain epoch 与 entry generation。
它们恒为 DestroyOnly，不能继承 Sandbox 留存语义。
正常退出、超时、取消、publish 竞争失败和崩溃 reconcile 都必须能够定位并销毁它们。
