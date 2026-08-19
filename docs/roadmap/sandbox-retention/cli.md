# Sandbox 默认停驻与回收 —— CLI

本页定义运行策略与事后管理命令。
动态状态单源是 `.niceeval/sandboxes/` registry；Attempt Record 不随事后操作改写。

## 运行策略

```bash
niceeval exp local onboarding/tool-first
niceeval exp local onboarding/tool-first --sandbox-release=destroy
niceeval exp local onboarding/tool-first --sandbox-release=retain --sandbox-retain=all
```

| flag | 值 | 作用域 |
|---|---|---|
| `--sandbox-release` | `auto` / `retain` / `destroy` | 本次 Invocation 的物理释放策略 |
| `--sandbox-retain` | `failed` / `all` | 本次 Invocation 的候选口径 |

flag 的优先级高于 `defineConfig({ sandboxRetention })`，但不改变携带资格。
被携带的 Attempt 没有本次物理 Sandbox；要重新执行仍使用 `--rerun`。

`--keep-sandbox` 是拒绝输入，退出码为 2。
错误必须指向本页两项 flag 和项目级配置，不能静默映射到新策略。

plan 与运行开头显示求值结果：

```text
SANDBOX RETENTION  retain failed · release auto · idle 24h · local waterline 20
  vercel  suspend, provider expiry 24h
  docker  destroy, dormant state has no provider expiry
```

## 管理命令

```bash
niceeval sandbox list
niceeval sandbox enter <retention-id>
niceeval sandbox suspend <retention-id...>
niceeval sandbox delete <retention-id...>
niceeval sandbox delete --all
niceeval sandbox prune
niceeval sandbox prune --dry
```

`sandbox stop` 是拒绝输入，退出码为 2：

```text
stop is ambiguous; use `niceeval sandbox suspend` to retain,
or `niceeval sandbox delete` to destroy.
```

这条硬错误保护旧的 `sandbox stop --all` 自动化。
升级后的命令不会把原本要求销毁的脚本静默改成只停驻。

所有命令从当前目录向上发现最近的 `.niceeval/`。
仓库外使用 `--record <record-root>`；找不到 registry 时不静默返回空集合。

## `sandbox list`

`list` 只执行 inspect，不更改 registry 或 Provider 资源。
它显示稳定 `retentionId`，不要求用户记住某一代 provider session id。

```text
ID        PROVIDER  STATE    CHECKPOINT                    EXPIRES
rtn_8f3a  vercel    dormant  saved after Attempt @1efw5…   in 18h
rtn_91c2  docker    dormant  used by 4 attempts             no provider expiry
rtn_a10e  vercel    unknown  cleanup did not finish         check Provider console
```

每项同时显示 cleanup complete/incomplete、最近错误、active deadline 与下一步命令。
pool 的 locators 标为 assignment history，不显示成 Sandbox owner。

legacy v1 条目标为 `LEGACY`，只提供明确 `delete` 命令。
它们缺少 pre-provision intent、代际和硬到期证明，不能 `enter` 或 `suspend`。

## `sandbox enter`

`enter` 只接受 dormant v2 条目。
它先核验 controller identity 与 lease，再 wake 并打开交互 shell。

进入前打印 checkpoint、cleanup 状态和 `active until <timestamp>`。
跨 Provider 只保证 post-teardown filesystem，不保证 memory、旧进程、网络连接或 process env。

shell 退出后，CLI 必须重新 suspend，并刷新 `lastUsedAt`、`pruneAfter` 与 Provider 到期时间。
达到 active deadline 时 Provider 停止 Sandbox，shell 可以断开。
本契约不提供 `--leave-running`。

## `sandbox suspend`

`suspend` 让 active v2 资源进入 dormant；已经 dormant 时幂等成功。
它不能越过其它进程的有效 lease，也不能操作 legacy 条目或身份核验失败的资源。

suspend 成功后才提交 registry 状态。
调用失败时保持 operation intent，并按 [release failure](lifecycle.md#release-failure)处理。

## `sandbox delete`

`delete` 是唯一的显式不可恢复动作。
指定 id 与 `--all` 都逐条核验 Provider metadata、主 Sandbox 及伴随资源 identity 和 lease。

Provider 报告资源已不存在时，删除 registry 条目并输出 `already gone`。
Provider 不可达、metadata 不匹配、伴随资源枚举不完整或存在有效 lease 时，保留条目并退出 1。
没有只删 registry 的 `forget` 命令。

legacy v1 只允许按 `list` 显示的明确 id 删除。
CLI 用旧条目中的 provider 与精确 sandbox id inspect；不能只凭本地文件存在就认定归属。

## `sandbox prune`

`prune` 使用与自动 GC 相同的安全判据：

- v2 metadata 与 registry 的 project、retention id、operation token 一致；
- controller inspect 能证明主 Sandbox 与全部伴随资源的归属；
- 没有有效 lease；
- 条目超过 TTL 或单一 `.niceeval` RecordStore 数量上限，或资源是已核实的同宿主 orphan。

`--dry` 只列出会销毁的资源和理由。
正式执行时，destroy 成功或 inspect 证明 gone 后才移除 registry。

`prune` 不处理 legacy v1 或 unverified orphan，也不提供 `--force`。
无法验证的资源保留为 `unknown`，命令退出 1，并要求用户到 Provider 控制面核对。

## 退出码

| 结果 | 退出码 |
|---|---:|
| 所有目标成功、已经处于目标状态，或没有候选 | 0 |
| 任一资源不可验证、被 lease 占用或 Provider 操作失败 | 1 |
| 参数错误、`sandbox stop`、`--keep-sandbox` 或不支持的 legacy 操作 | 2 |
