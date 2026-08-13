# 工作目录访问证据 —— Architecture

访问 evidence 由 Attempt 组织，Assertion evaluator 只消费已封口的有限视图。它不是 Sandbox 的通用观测服务。

## 生命周期

```text
Eval discovery and link
  -> validate workspaceAccess, Sandbox Agent, selectors, and Provider capability
  -> fail required unsupported Provider with sandbox.workspace-access-unsupported
  -> establish canonical workspace root and Attempt-local collector
  -> Agent runtime and child processes run
  -> stop and seal collector
  -> reject proven path escape / required incomplete evidence
  -> evaluate post-run access Assertions
  -> seal Assertions and Verdict
```

required Provider capability 在 link 核对；不支持时不创建 Agent、collector 或 Sandbox。best-effort Provider 不支持时不启用 collector，并封口为 `unavailable / provider-unsupported`。

collector 在 Agent runtime 前就绪，在 Agent teardown 后封口。Eval prepare、test 中的 Sandbox API、Agent teardown 外的 cleanup、Provider build 与 Provider cache 都不写入该 collector。

required 在 matcher 前检查 collection：任何 partial 或 unavailable 直接产生 `workspace-access.collection-incomplete` 并使 Attempt errored。已知正向 witness 仍可保存用于诊断，却不能挽救 Attempt。best-effort 才把已封口 collection 交给三值 matcher。

## 路径规范化与逃逸

工作目录真实根在启动 collector 时以 realpath 固定。每次已归属的访问按内核实际定位的目标处理，不按调用方传入的字符串处理。

1. 定位相对路径时使用 Agent 进程的工作目录。
2. 对所有已存在分量跟随 symlink，清除 `.` 与 `..`。
3. create 与 rename 的不存在目标先定位最近存在的父目录，再附加已校验的尾部分量。
4. 将定位后的真实路径映射回固定工作目录真实根，写入 WorkspaceRelativePath。
5. 已证明根外、或 rename 的 from/to 任一端已证明越界时，产生 `workspace-access.path-escape` 并使 Attempt errored。

无法安全映射为 WorkspaceRelativePath、但也没有证明越界的已归属操作，不编造路径或 path escape；它使 collection 变为 partial 并加入 `path-unresolved`。不能可靠归属至当前 Agent 进程树时加入 `attribution-uncertain`。两者与根外路径错误不同，且都不会把宿主路径回显给 Assertion evidence。

## 证据模型

封口 JSON 直接使用 [Library](library.md) 的 WorkspaceAccessOperation 与 WorkspaceAccessCollection。Architecture 不定义第二套 evidence 形状，也不允许自由文本 limitation 或 reason。

每个 operation 都有 Attempt-local 的 operationId。非 rename operation 以一个 WorkspaceRelativePath 表示目标；rename operation 是独立的 from/to 联合。动作仅为 read、write、create、delete、rename、execute、list 或 metadata，且 list 与 metadata 从不降格为 read。

partial 的 limitations 是封闭集合：

- `path-unresolved`、`attribution-uncertain`；
- `stream-lost`、`stream-truncated`；
- `collector-capacity-exhausted`、`producer-interrupted`。

unavailable 的 reason 也是封闭集合：

- `provider-unsupported`、`collector-start-failed`；
- `stream-lost-before-first-operation`、`producer-interrupted-before-first-operation`。

operation 数量、单路径长度或 collector transport 达到上限时，collector 立即转为 partial 并写下对应 limitation。它不会丢弃 limitation 后继续伪造 complete。已取得的 operation 保留在 sealed collection；无限原始流、syscall 参数和 private 路径均不进入 Assertion attachment。

## 三值求值

| Assertion | 已知命中 | complete 且无命中 | partial / unavailable 且无决定性 witness |
| --- | --- | --- | --- |
| accessedWorkspace | matched | mismatched | unavailable |
| didNotAccessWorkspace | mismatched | matched | unavailable |

required 不使用这张表来挽救 Attempt。collection completeness 是 Eval 执行前提；Assertion severity 是 entry 的既有 policy。required、optional、key、label 与 group 都不能改变 required 的执行错误。

## 物理隔离

evaluator 私有资产的安全性不依赖访问 Assertion。solution、hidden tests、credentials、private fixture 与判分脚本必须在 build、mount、cache 和 Agent namespace 四个边界都物理不可达：

- 不进入 Docker build context、镜像层、Compose context 或 Provider build 输入；
- 不作为 bind mount、volume、上传源、sidecar 文件系统或 Agent cwd 的祖先；
- 不进入 Sandbox cache、Git object cache、package cache、Agent home、进程变量集合、tool config 或诊断 payload；
- 不通过 collector、Record、JSON、人类输出或 live debug 命令回流到 Agent namespace。

collector 自己位于 runner-private 或 Provider-private namespace。Agent 不能读取、写入、再次执行或关闭它；它只得到正常工作目录和被测任务所需的公开资产。

## 删除与迁移边界

referencesAnyPath 从 niceeval/expect 与全部作者面删除。jsonMentionsAnyPath 是唯一的 JSON string-leaf 路径文本 Match，且不承诺真实文件访问。

没有工具输入 Match、diff Match 或 JSON 文本 Match 能替代 workspace access evidence。需要行为级访问判定的 Eval 必须声明 `workspaceAccess: { collection }` 并使用两条 t.sandbox Assertion 之一。

## 生产入口验收

| 入口 | 必须证明 |
| --- | --- |
| niceeval check | collection 预声明、selector 非空、rename 的 from/to/both 封闭分支、Agent 类型与 required Provider capability 在资源创建前有效 |
| niceeval exp --dry --json | collection 模式与 required Provider capability 可审计，但没有伪造访问结果 |
| niceeval exp | required 不完整、best-effort 三值、symlink escape、八种动作、并发 Attempt 与复用 Sandbox 隔离 |
| niceeval show | sealed operation、limitation、unavailable reason 与执行错误可读，且不重新采集 |
