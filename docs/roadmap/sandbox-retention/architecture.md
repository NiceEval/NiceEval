# Sandbox 默认停驻与回收 —— Architecture

## 两种 Provider 边界

Attempt 内的 live handle 只负责执行与不可恢复销毁：

```ts
interface Sandbox extends SandboxOperations, SandboxTransferOperations {
  readonly workdir: string;
  readonly sandboxId: string;
  readonly otlpHost: string | null;
  destroy(): Promise<void>;
  appendLog?(line: string): Promise<void>;
}
```

`Sandbox.stop()` 不存在。
一个已停驻的 live object 也不能被继续调用；恢复由可序列化 controller 按逻辑身份完成。

```ts
type SandboxManagementCapability =
  | { readonly kind: "process-scoped"; readonly reason: string }
  | {
      readonly kind: "managed";
      readonly controllerId: string;
      readonly controllerSchemaVersion: number;
      readonly activeFailsafe: true;
      readonly dormancy:
        | { readonly kind: "provider-bounded"; readonly maxIdleMs: number }
        | { readonly kind: "unbounded" };
    };

interface ManagedSandboxController {
  discover(query: ProvisionQuery): Promise<readonly ProviderResourceGroup[]>;
  inspect(logicalProviderId: string): Promise<ManagedInspection>;
  wake(ref: DormantRef, input: ManagedOperation): Promise<ActiveGeneration>;
  suspend(ref: ActiveRef, input: ManagedOperation): Promise<DormantGeneration>;
  destroy(ref: ManagedRef, input: ManagedOperation): Promise<"destroyed" | "gone">;
}
```

registry 只保存 `controllerId` 与版本，不序列化任意 callback。
内置 Provider 或可发现 plugin 用这两个值恢复 controller。

## Provider 能力矩阵

| Provider | logical identity | dormant 形态 | `auto` | 显式 `retain` |
|---|---|---|---|---|
| Docker | container / Compose project identity | stopped container 与伴随资源 | destroy | 支持，需 active failsafe |
| E2B | sandbox id | paused filesystem + memory | destroy | 支持，dormant 无硬到期 |
| Vercel | persistent sandbox name | stopped named sandbox + snapshot | suspend | 支持，Provider 到期 |
| Local | 无隔离资源 | 宿主工作树 | destroy | 不支持 |
| process-scoped custom | callback handle | 无 detached controller | destroy | 不支持 |

矩阵不是永久 allowlist。
controller schema version 必须绑定能力证明；Provider 行为漂移或无法复核时，`auto` 立即退回 destroy。

Docker 停止后 writable layer 会持续占用本机磁盘，Docker 不提供容器 TTL。
官方也把 `container prune` 定义为另行删除 stopped container 的动作。
参见 [Docker run](https://docs.docker.com/reference/cli/docker/container/run/) 与 [container prune](https://docs.docker.com/reference/cli/docker/container/prune/)。

E2B pause 保存 filesystem、memory、进程与 loaded variables，且 paused Sandbox 没有自动删除期限。
参见 [E2B persistence](https://e2b.dev/docs/sandbox/persistence)。

Vercel persistent sandbox 使用稳定 name 跨 session 保存 filesystem。
controller 把 `snapshotExpiration` 设为 `idleTtlMs`，并只保留最近一代 snapshot。
参见 [Vercel persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence)。

完整 Sandbox 可能包含 Agent 写入的未知敏感数据。
已知值脱敏不能证明 filesystem 已无凭据，因此“能 suspend”不等于“可默认 suspend”。

## 稳定 identity 与 registry

CLI 使用 NiceEval 生成的 `retentionId`。
Provider session 或 container id 是一代执行事实，不承担跨 wake 的用户身份。

```ts
interface RetentionEntryV2 {
  readonly schemaVersion: 2;
  readonly retentionId: string;
  readonly projectId: string;
  readonly controllerId: string;
  readonly controllerSchemaVersion: number;
  readonly logicalProviderId: string;
  readonly policy: ResolvedRetentionPolicy;
  readonly provenance: RetentionProvenance;
  readonly checkpoint: RetainedCheckpoint | null;
  readonly lastUsedAt: string;
  readonly pruneAfter: string | null;
  readonly providerExpiresAt: string | null;
  readonly state: RetainedState;
  readonly lease?: RetentionLease;
}

interface RetentionProvenance {
  readonly purpose: "attempt" | "judge" | "reuse-pool";
  readonly runId: string;
  readonly experimentId: string;
  readonly locators: readonly string[];
  readonly parentLocator?: string;
}
```

`checkpoint` 在 provisioning 与 active 阶段是 `null`，physical release 前才提交 post-teardown 值。
Judge 使用 `purpose: "judge"` 和 `parentLocator`；reuse pool 逐次追加 assignment locator，但不把其中任一条设成当前 owner。

条目仍是 `.niceeval/sandboxes/` 下的逐文件原子持久项。
每次变更先写同目录临时文件、同步文件、rename，再同步目录。
revision 与 lease 使用 compare-and-swap，两个进程不能同时 wake、suspend 或 destroy 同一资源。

## 状态机

```ts
type RetainedState =
  | {
      readonly tag: "provisioning";
      readonly operationId: string;
      readonly attemptNo: number;
      readonly provisionToken: string;
      readonly activeDeadlineAt: string;
    }
  | { readonly tag: "active"; readonly generation: number; readonly provider: ActiveGeneration }
  | { readonly tag: "suspending"; readonly generation: number; readonly operationId: string }
  | { readonly tag: "dormant"; readonly generation: number; readonly provider: DormantGeneration }
  | { readonly tag: "waking"; readonly generation: number; readonly operationId: string }
  | { readonly tag: "destroying"; readonly operationId: string; readonly providerRefs: readonly ProviderRef[] }
  | {
      readonly tag: "unknown";
      readonly lastStable: "active" | "dormant";
      readonly providerRefs: readonly ProviderRef[];
      readonly errors: readonly ManagedOperationError[];
    };
```

所有 Provider 副作用先持久化 operation intent，再发请求。
controller 用 `operationId` 与 logical identity inspect，重复执行必须收敛到同一状态。

## Provisioning 先登记

物理 create 之前，Runner 已经知道 retention id、logical provider id 和 provision token。
创建顺序固定为：

1. 原子写入 `provisioning` intent；
2. Provider create 携带 project、retention、operation 与 provision token metadata；
3. 完成 bootstrap 与 ready；
4. 原子提交 `active`；
5. 把 live Sandbox 交给 Attempt 或复用池。

pre-intent 写失败时不调用 Provider。
create 超时但可能成功时，Runner 不收养 bootstrap 状态未知的资源；它先按 token 发现并销毁整组资源。

每次 create retry 使用递增 attempt number 与新 token。
开始下一次之前，controller 必须证明上一 token 的资源集合为空。

active commit 失败时，尚在进程内的 handle 立即 destroy，再按 token 复核。
无法销毁或复核时保留 intent、写入 resource error，并阻止同 project 与 Provider 继续 provisioning。

managed Provider 必须支持按 metadata 列出主 Sandbox 及全部伴随资源，或按确定性 logical identity inspect 它们。
Docker 使用 label，E2B 使用 metadata，Vercel 使用唯一 persistent name。
Compose 的 container、network 与 volume 必须作为一组发现。

## 代际与崩溃恢复

Vercel 的 persistent sandbox 是稳定逻辑实体，每次 wake 可以产生新 VM session。
registry generation 随 wake 递增，Attempt Record 仍保存当时真正执行的 provider session id。

`suspending`、`waking` 或 `destroying` 期间崩溃时，registry 不猜操作结果。
下一次 `exp` 启动或显式 `prune` 按 logical identity inspect，再提交观察到的安全终态。

Provider 自己暴露独立 snapshot 代际时，controller 必须发现全部新旧引用。
只有新代确认可恢复后才删除旧代；不支持原子 rotation 或完整枚举的 Provider 不能声明 managed。

## Checkpoint 与 provenance

```ts
type RetainedCheckpoint =
  | {
      readonly kind: "fresh-post-teardown";
      readonly locator: string;
      readonly cleanup: "complete" | "incomplete";
    }
  | {
      readonly kind: "pool-reset-anchor-post-teardown";
      readonly locators: readonly string[];
      readonly cleanup: "complete" | "incomplete";
    }
  | {
      readonly kind: "pool-retired-post-teardown";
      readonly lastLocator: string;
      readonly locators: readonly string[];
      readonly cleanup: "complete" | "incomplete";
    };
```

fresh checkpoint 由一条 Attempt 派生，但仍是收尾后的 filesystem。
pool 的 `locators` 是 assignment history；正常池停在 reset anchor，失败退休池只标出最后使用者。

跨 Provider 的公共保证不包含 memory、进程、网络连接与 process env。
E2B 原生 pause 可以多保留状态，但读取面只能把它显示为 Provider-specific observation。

## Release failure

| 情形 | `auto` | 显式 `retain` | Invocation |
|---|---|---|---|
| suspend 失败，destroy 成功 | warning，移除 registry | `retention-not-satisfied` | 前者可 complete；后者 incomplete |
| suspend 与 destroy 都失败 | 保留 active/unknown | 保留 active/unknown | incomplete，退出非零 |
| intent 后进程崩溃 | 等待 reconcile | 等待 reconcile | 可捕获崩溃退出非零 |

release failure 不反写 Attempt Verdict。
资源仍可能 active 或 unknown 时，Invocation 写 `resourceErrors`，并阻止同 Provider 新建更多资源。

active failsafe 在 Provider create 时建立，不依赖父进程继续存活。
Vercel session timeout、E2B `onTimeout: "pause"` 和受约束 Docker PID 1 deadline 分别兑现该保证。

Docker 显式 retain 要求非 root Agent execution identity。
Provider session 上限、Invocation deadline、Attempt deadline 与 `maxActiveMs` 都不能给出有限上界时，规划在 create 前拒绝。

## GC 与身份核验

自动 GC 在 `exp` 启动和每个物理 release 后运行。
没有 NiceEval 进程时，只有 Provider 到期是墙钟保证；本地 `pruneAfter` 只是下一次 GC 的资格。

超过单 record root 数量上限时，条目按以下顺序淘汰；同类最旧的 `lastUsedAt` 先删：

1. cleanup 完整的 pool reset anchor；
2. cleanup 完整的 fresh passed；
3. cleanup 完整的 fresh failed / errored；
4. cleanup 完整的 retired pool；
5. cleanup 不完整的任意 checkpoint。

默认 `retain: "failed"` 会直接销毁前两类。
它们只在显式 `retain: "all"` 或混存 registry 中参与数量收敛。

prune 与 delete 都不能越过有效 lease、metadata 不匹配或不完整资源枚举。
unverified orphan 永不自动销毁，也没有 `force` 或只删 registry 的路径。

## Record 分工

Attempt Record 保存执行时的 `sandboxId`、Provider、reuse 事实和可选 `retentionId`。
这些字段是不可变执行事实。

registry 保存当前 generation、dormant/active 状态、到期、错误与 assignment history。
enter、suspend、delete 或 prune 不回写历史 Attempt Record。
