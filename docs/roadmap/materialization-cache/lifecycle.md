# Materialization Cache —— Lifecycle

本篇描述 Git repository 从作者声明到 Sandbox workspace 的完整时序。
公开类型以 [Library](library.md) 为单源，内部实体以 [Architecture](architecture.md) 为单源。

## Owner

| Owner | 拥有 | 不得做什么 |
|---|---|---|
| Eval / Experiment 作者 | `repository`、`commit`、`into` 与 prepare 顺序 | 不提供 cache path、mount、credential 或 history policy |
| Runner | demand 收集、single-flight、lease、时序与失败归属 | 不按 command id 或 Provider 名推导 Git 行为 |
| Host materializer | SourcePool acquisition、Projection 生成与验证 | 不把 SourcePool path 或 handle 交给 Sandbox |
| Sandbox consumer | 分块接收、全新 `.git`、checkout 与终态复验 | 不借用上一 Attempt metadata，不保留交付临时文件 |
| Cache Domain | registry、fencing、inventory 与 GC | 不用项目选择推导全局删除资格 |

## 从声明到 Agent

```text
discovery / link
  验证 repository、commit、into
  生成纯 GitSourceProjectionDemand
        ↓
Run planning
  按 DemandKey 去重
  不执行网络、Git 进程或写盘
        ↓
host prepare
  projection hit → 取得 read lease
  projection miss → SourcePool coverage 检查
                    → 只补齐缺失 commit
                    → 生成并验证 projection
                    → 原子发布
        ↓
Sandbox create / reuse lease
        ↓
每 Attempt prepare 中的原声明位置
  projection read lease
  分块传入随机临时路径
  校验 byte size + pack digest
  文件操作删除旧 .git 与旧 worktree 内容
  导入全新 object database
  复验精确 object set
  detached checkout 声明 commit
  删除交付材料
  释放 read lease
        ↓
agent.ensure → Agent runtime → test
```

host prepare 可以早于 Sandbox create，因为 repository 与 commit 不依赖目标 Sandbox 平台。
不同 Demand 并行，相同 Demand 共享一次 reservation、build 与发布结果。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Demand link / planning | 每 Run 一次 | 每 Run 一次 |
| SourcePool fetch | 按缺失 coverage | 按缺失 coverage |
| Projection lookup / build | 每个唯一 Demand | 每个唯一 Demand |
| Sandbox create | 每 Attempt | 每个复用周期 |
| Projection consumer | 每 Attempt | 每 Attempt |
| 删除旧 `.git` | 每 Attempt | 每 Attempt |
| Agent 可见 object set 复验 | 每 Attempt | 每 Attempt |
| Projection read lease | 持续到本次传输与导入结束 | 持续到本次传输与导入结束 |

Sandbox 复用不会把上一题的 `.git`、SourceProjection 或临时 bundle 当作命中材料。
命中发生在宿主 Domain；每条 Attempt 仍重新执行安全 consumer。

## 生成与发布

SourcePool fetch 持有 pool write lease。
fetch 成功后先持久化 coverage generation，再允许 projection builder 取得 read lease。

builder 用直接指向 commit 的临时 ref 生成 self-contained、non-thin 投影。
它在全新对象库中枚举全部实际对象，并与 commit ancestor closure 的预期集合逐项相等比较。

发布顺序为：

```text
reserved → building → bytes prepared → manifest durable → published → indexed
```

只有 `indexed` Projection 可以命中。
发布后 Projection 不再依赖 SourcePool；pool 可以先于 projection 回收。

## 流式交付

交付在 read lease 下顺序执行：

1. 从宿主 CAS 分块读取到 Sandbox 随机临时路径。
2. Sandbox 校验总字节数与 SHA-256。
3. 临时文件原子 rename 成本次受管输入。
4. 导入全新 Git object database。
5. 枚举实际 object set，并与 manifest 的 object-set digest 和数量复核。
6. 验证 detached HEAD、空 refs、clean worktree 与禁止 metadata。
7. 删除受管输入并确认路径不存在。
8. 释放 read lease。

交付禁止 mount、hardlink、alternate、promisor 或 local clone。
这些机制会让 Sandbox 在投影之外继续读取 SourcePool。

## 失败与 Sandbox taint

| 失败点 | 结果 |
|---|---|
| link 输入非法 | 选择错误；零 origin、零 cache 写入、零 Sandbox create |
| SourcePool fetch 失败 | 当前 Attempt `errored`；没有 Sandbox taint |
| Projection 生成或验证失败 | 不发布 entry；scratch reconcile；没有 Sandbox taint |
| Sandbox create 失败 | Projection lease 释放；沿用 Provider 错误语义 |
| 传输、digest、导入或终态复验失败 | Attempt `errored`；当前 Sandbox taint 并退休 |
| 取消发生在 host prepare | 停止受管 Git 进程；未发布资源 reconcile |
| 取消发生在 Sandbox consumer | 删除临时材料；当前 Sandbox 退休 |

taint 是不可逆归还决定。
workdir reset 成功不能证明 workdir 外 scratch 或已执行 hook 不存在，因此不能让同一物理实例继续承接 Attempt。

## 回收

SourcePool 与 SourceProjection 独立成为 GC candidate：

- 删除 SourcePool 不影响已发布 Projection。
- 删除 Projection 后，如果 SourcePool 已包含 commit 所需对象，可以零 origin 请求重建。
- 两者都删除后，下一次需求重新访问 origin。
- active fetch/read lease、projection read lease 与未完成 reconcile 都否决删除。

V1 对 SourcePool 只做整池回收，不做逐 object GC。
