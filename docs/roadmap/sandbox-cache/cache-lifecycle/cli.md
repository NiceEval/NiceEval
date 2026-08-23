# CLI

## 命令归属与帮助

根 CLI 显式挂载 Docker feature，但不处理 Docker 的子命令或 flag。根级不存在 `niceeval cache`；
Docker inventory、GC 与 execution profile 全部位于同一个不损失能力的命令树：

```text
$ niceeval docker --help
niceeval docker — Docker-specific administration

Usage:
  niceeval docker profile list [--json]
  niceeval docker profile doctor <alias> [--json]
  niceeval docker cache inventory [--domain <domain-id>] [--json]
  niceeval docker cache gc --domain <domain-id> [--apply <plan-id>] [--json]

Commands:
  profile    inspect and diagnose managed Docker execution profiles
  cache      inspect and safely reclaim NiceEval-owned Docker image cache
```

`niceeval docker cache --help` 只显示 cache 子树；未知根命令由 CLI host 报错，未知 Docker 子命令由
Docker feature 报错。进入 `docker` 后，`--domain`、`--apply` 及未来 Docker 私有 flag
都不经过 core flag parser。JSON stdout 始终只有一个完整文档，诊断只写 stderr。

## 当前选择

```sh
niceeval exp <experiment-prefix> [eval-prefix...] --dry [--json]
```

该命令复用 `exp --dry` 的发现、选择、link 和 physical planning，只读取冻结选择的精确需求。
它可以聚合 host CAS、Docker image store、受管 BuildKit Domain 与只读 Provider observation，但不会合并不同范围的库存或回收权限。

人类输出逐类显示 `required-present`、`required-missing`、`superseded-for-selection` 和 `unverified`。
增长估算必须带样本数、时间范围和 estimate 标记；没有数据时显示 unknown。
真正运行 Experiment 时，在执行前输出同一份简版需求。

JSON stdout 只有一个文档：

```ts
interface CacheStatusDocumentV1 {
  format: "niceeval.cache-status";
  schemaVersion: 1;
  selection: { experimentId: string; evalIds: string[] };
  domains: Array<{
    domainId: string;
    backendKind: "host-cas" | "docker-images" | "buildkit";
    state: "managed" | "read-only" | "unverified";
    requiredPresent: CacheDemandItem[];
    requiredMissing: CacheDemandItem[];
    supersededForSelection: CacheDemandItem[];
  }>;
  providerObservations: UnverifiedProviderCapacityObservation[];
}
```

status 不会产生删除候选，也不会刷新 last successful use。
“当前没有选择”与“可以删除”是两个不同事实。

## Invocation 任务构建反馈

真正运行 Experiment 时，`niceeval exp` 在 Attempt 行之外分别显示运行级任务构建与 Setup prefix 摘要。
它按 `(domainId, BuildKey)` 去重，不把 BuildKey 数写成 Sandbox 数，也不把多个依赖者写成多个 build。

人类反馈使用以下形态：

```text
8 attempts require 4 BuildKeys · 3 cache hits · 1 built once · 2 attempts waited
```

逐 key active 行显示有界 label、短 BuildKey、依赖 Attempt 数和状态：`querying`、`hit`、`queued`、`building`、`publishing`、`leasing`、`ready` 或 `failed`。
共享的是 BuildKey 对应的构建或缓存结果，不是 Attempt；逐 Attempt 的 `creating sandbox` 只在其依赖 key ready 后出现。

JSON progress 与 result 使用独立字段：

```ts
interface MaterializationCacheSummary {
  requiredBuildKeys: number;
  dependentAttempts: number;
  querying: number;
  queued: number;
  building: number;
  readyFromCache: number;
  readyFromBuild: number;
  failed: number;
  waitingAttempts: number;
}

interface MaterializationCacheItem {
  domainId: string;
  buildKey: string;
  label: string;
  dependentAttempts: number;
  state: "querying" | "hit" | "queued" | "building" | "publishing" | "leasing" | "ready" | "failed";
  source?: "cache" | "build";
  operationId?: string;
  error?: { code: string; message: string };
}

interface MaterializationCacheEvent extends ExperimentOutputFields {
  type: "progress" | "result";
  materializationCache: {
    summary: MaterializationCacheSummary;
    items: MaterializationCacheItem[];
  };
}
```

结束摘要从每个 key 的最终状态投影，不累计 progress event。
重试、状态替换或多个 waiter 不得重复增加 hit、built 或 failed。
`hit` 尚未建立 lease；只有 `ready` 且 `source: "cache"` 才进入 `readyFromCache`。

`materializationCache` 不进入 `sandboxReuse`、结果携带、Sandbox retention 或 orphan 词表。
共享 build failure 的 key 只有一个 operation origin；依赖它的 Attempt 继续按既有结果契约投影各自结局。

Setup prefix 摘要按 `(domainId, SetupPrefixKey)` 去重。逐 key 状态为 `resolving`、`querying`、`hit`、`queued`、`materializing`、`quiescing`、`promoting`、`cloning`、`ready` 或 `failed`。

等待 setup prefix single-flight 或 Provider reservation 的 Attempt 保持 `queued`，并显示 `setup-prefix` 或 `provider-capacity` reason。只有 reservation granted 后才显示 `creating sandbox`；等待者不占普通 sandbox semaphore。

Setup prefix promotion 使用 Provider cache queue。`changeFrequency` 只提供有界公平的排序、promotion 与 retention 提示；不新增作者侧 no-cache，也不改变 key。

## Domain 库存

```sh
niceeval docker cache inventory [--json]
niceeval docker cache inventory --domain <domain-id> [--json]
```

库存命令不加载项目 config、Eval 或 Experiment。
不指定 Domain 时只列 Domain 摘要；指定后才读取单个 Domain 的 entry、lease、root、policy 和 provider inspect 事实。

共享或默认 BuildKit builder 不是 Domain。
不指定 Domain 的库存摘要把它放在独立的 `provider observations` 区块，只显示 `unverified` 总量和 reclaimable estimate。
它不会出现在 `entries`、`evictable` 或 GcPlan 中。

明细按 kind、状态、owner、lease、last successful use 和容量分组。`sandbox-setup-prefix` 额外显示 SetupPrefixKey、change frequency、storage schema、artifact format 与 `copied | parent-backed` dependency。
逻辑大小、共享大小、estimate 与 exact marginal reclaim 分栏展示，不能相加的数字标为 `not additive`。

legacy 明细可以显示 immutable provider id、当前协议不再命中的证明链，以及不带 force 的人工 provider 命令。
输出必须说明该命令不受 NiceEval 管理，跨项目与旧客户端判断由用户承担。
legacy、foreign 和 unverified 不会显示为 evictable。

JSON stdout 使用以下顶层：

```ts
interface CacheInventoryDocumentV1 {
  format: "niceeval.cache-inventory";
  schemaVersion: 1;
  scope: { kind: "domains" } | { kind: "domain"; domainId: string };
  domains: CacheDomainSummary[];
  providerObservations: UnverifiedProviderCapacityObservation[];
  entries?: CacheInventoryEntry[];
}
```

人类输出示例：

```text
Docker task builds · verified-managed · domain 8c3d90b7e5b94458
  4 entries · 1 active-leased · 2 cold-reusable · 1 unverified
  exact marginal reclaim unknown · shared bytes not additive

BuildKit · unverified shared-builder capacity
  total 402.6 GB · provider reclaimable estimate 221.6 GB
  NiceEval ownership unknown · not eligible for NiceEval GC
```

一次没有受管 entry 的真实输出仍完整显示两个不同的所有权范围：

```text
$ niceeval docker cache inventory
Docker images · managed · 8c3d90b7e5b94458 · 0 entries
BuildKit · unverified shared-builder capacity
  total 40.3 GB · provider reclaimable estimate 21.5 GB
  NiceEval ownership unknown · not eligible for NiceEval GC
  Provider prune may affect other projects, builder sessions, and builds currently in progress.
```

Domain 明细 JSON 示例：

```json
{
  "format": "niceeval.cache-inventory",
  "schemaVersion": 1,
  "scope": { "kind": "domain", "domainId": "8c3d90b7e5b94458" },
  "domains": [{
    "domainId": "8c3d90b7e5b94458",
    "providerFamily": "docker",
    "backendKind": "docker-images",
    "state": "verified-managed",
    "entryCount": 4
  }],
  "providerObservations": [],
  "entries": [{
    "entryId": "task-build:7d38…",
    "state": "cold-reusable",
    "immutableResourceIdentity": "sha256:91ac…",
    "lastSuccessfulUseAt": "2026-08-01T02:10:00.000Z",
    "exactMarginalReclaimBytes": null
  }]
}
```

## 两阶段回收

```sh
niceeval docker cache gc --domain <domain-id> [--json]
niceeval docker cache gc --domain <domain-id> --apply <plan-id> [--json]
```

第一条命令只创建预览，并把 immutable GcPlan 持久化到 Domain registry。
第二条命令只执行该 plan 已授权的 entry；`--apply` 不带 plan id 是用法错误。
apply 不能重新规划或加入新候选，只能因为事实漂移而缩减集合。

GcPlan 有效期固定为 15 分钟：

```ts
interface GcPlanV1 {
  schemaVersion: 1;
  planId: string;
  domainId: string;
  ownerId: string;
  backendIdentity: string;
  issuerEpoch: string;
  registrySafetyRevision: number;
  policyVersion: number;
  observedAt: string;
  expiresAt: string;
  candidates: Array<{
    entryId: string;
    keyDigest: string;
    immutableResourceIdentity: string;
    manifestDigest: string;
    evidenceDigest: string;
    evidence: {
      createdAt: string;
      lastSuccessfulUseAt: string | null;
      protectedUntil: string;
      capacity: null | {
        domainUsedBytes: number;
        domainCapacityBytes: number;
        exactMarginalReclaimBytes: number;
      };
    };
    ruleId: string;
    orderKey: string;
  }>;
}
```

plan 的 canonical digest 随持久化 plan 保存，plan 本身不能更新；outcome 另行追加。
跨本机 boot 或 controller epoch、plan 过期、owner/backend/policy 变化和 digest 损坏会拒绝整单。
registry safety revision 保存观察点；无关 entry 的后续变更不会扩大或自动拒绝 plan。

apply 对每个原候选重新检查 entry state、manifest、immutable identity、lease、durable root 和 provider reference。
新 lease、root 或单项事实漂移会跳过该项并继续其它项。
Domain authority、fence 或 backend verification 丢失会停止整单，未处理项标为 not attempted。

普通本地 backend 永远不会后台自动删除。
managed controller 在 verified used 达到 85% 时可以自动创建并立即执行同形状 plan，直至预计 used 不高于 75%。
controller 同样保留 plan 和 outcome audit，不能绕过两阶段持久化步骤。

## Preview JSON

`cache gc --json` 的 stdout 只有一个 JSON 文档：

```ts
interface CacheGcPlanDocumentV1 {
  format: "niceeval.cache-gc-plan";
  schemaVersion: 1;
  plan: GcPlanV1;
  summary: {
    candidateCount: number;
    exactReclaimBytes: number | null;
  };
}
```

每个候选保存 policy version、rule id、observed time、时间与容量 evidence 以及确定 order key。
人类输出用这些字段解释“为什么该删”，而不是用 repository 名、创建时间或容器引用数单独推断。

```text
GC preview 3b3e7f0d… · domain 8c3d90b7e5b94458 · expires in 15m
  2 candidates · rule max-age/task-build
  exact reclaim unknown
Apply with: niceeval docker cache gc --domain 8c3d90b7e5b94458 --apply 3b3e7f0d…
```

## Apply JSON

`cache gc --apply <plan-id> --json` 的 stdout 只有一个 JSON 文档：

```ts
interface CacheGcOutcomeDocumentV1 {
  format: "niceeval.cache-gc-outcome";
  schemaVersion: 1;
  planId: string;
  domainId: string;
  startedAt: string;
  finishedAt: string;
  outcomes: Array<{
    entryId: string;
    resourceIdentity: string;
    status: "deleted" | "already-absent" | "skipped" | "failed" | "not-attempted";
    reasonCode:
      | "deleted"
      | "already-absent"
      | "lease-acquired"
      | "root-present"
      | "provider-reference"
      | "entry-state-changed"
      | "manifest-changed"
      | "resource-changed"
      | "unverified"
      | "delete-conflict"
      | "delete-failed"
      | "domain-stopped";
    message: string;
  }>;
  summary: {
    deleted: number;
    alreadyAbsent: number;
    skipped: number;
    failed: number;
    notAttempted: number;
    exactReclaimedBytes: number | null;
  };
}
```

重复 apply 读取已有 outcome，并按 architecture 的 deleting 状态机恢复，结果幂等。
JSON 模式的 stdout 不含日志；诊断写入 stderr。

```text
GC outcome 3b3e7f0d… · 1 deleted · 1 skipped · 0 failed
  deleted task-build:7d38… · max-age/task-build
  skipped task-build:a102… · lease-acquired
```

## 退出码

| code | 含义 |
|---|---|
| 0 | status、inventory 或 preview 成功；apply 全部 deleted / already absent；空 plan 也成功 |
| 1 | apply 有 skipped、failed 或 not attempted，包含部分成功 |
| 2 | CLI 用法或 selector 错误 |
| 3 | plan expired，或 issuer、backend、owner、policy、digest 不匹配而整单拒绝 |
| 4 | Domain authority、registry 或 provider 在安全处理前不可用 |

整单拒绝使用稳定 reason code：`plan-expired`、`issuer-changed`、`backend-changed`、`owner-changed`、`policy-changed`、`plan-corrupt`。
没有 force 路径可以绕过 active lease、durable root、provider reference、legacy、foreign 或 unverified 门。
