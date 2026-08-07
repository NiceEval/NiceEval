# Sandbox 默认停驻与回收 —— Lifecycle

## Fresh Sandbox

```text
resolve retention policy
  -> write provisioning intent
  -> Provider create + ready
  -> commit active
  -> prepare -> Agent -> test -> Verdict Claim
  -> capture Record evidence
  -> Agent teardown -> cleanup -> Sandbox lifecycle teardown
  -> seal Attempt Record and emit attempt.finished
  -> resolve physical release
     -> suspend -> dormant
     -> or destroy -> gone
  -> update Invocation resource completion
```

Verdict Claim 在业务判定完成时封口。
physical release 随后失败时，Attempt Verdict 与已经封口的 Record 不被改写。

post-teardown checkpoint 只在 Agent teardown、cleanup 与 Sandbox lifecycle teardown 都已尝试后形成。
某一步失败或超时时，checkpoint 标为 cleanup incomplete，并保留实际已经走到的状态。

## 复用池

复用池的活实例仍由同一次 Invocation 独占。
每条 Attempt 领取实例、reset、重新执行 prepare，完成后再归还或退休。

正常归还先 reset 到池 anchor。
Invocation 收尾执行 Sandbox lifecycle teardown 后，checkpoint 是 `pool-reset-anchor-post-teardown`。
默认 `retain: "failed"` 不选择这类池，因此它直接销毁。

失败、reset 不安全或寿命不足导致的退休不再执行题间 reset。
Runner 完成仍可执行的 teardown 后形成 `pool-retired-post-teardown`。
它保存最后一条 locator 与全部 assignment history，默认进入失败类候选。

停驻池不会被下一次 Invocation 自动领取。
teardown 已经执行，registry 也没有证明新配置、Hook 与 reset anchor 仍相同。

## 候选与 release 顺序

每台物理 Sandbox 只在退出 owner 时求值一次：

1. 计算 checkpoint 与 cleanup 状态；
2. 用 `retain` 判断是否为候选；
3. 非候选直接 destroy；
4. 候选按 `release` 选择 suspend 或 destroy；
5. 完成后运行单 record root GC。

同一物理池承接十条 Attempt 仍只产生一个 release 结果。
carried、skipped 与未派发工作不进入这条时序。

## Release failure

### 默认 `auto`

suspend 失败时立即尝试 destroy。
destroy 成功表示资源安全释放，只追加 `retention failed; destroyed safely` warning。
这项 best-effort retention 失败不让 Invocation 判红。

suspend 与 destroy 都失败时，registry 保持 active 或 unknown，并保存两个错误。
Invocation completion 为 incomplete，CLI 退出非零。

### 显式 `retain`

suspend 失败后仍尝试 destroy，避免为了满足留存要求而泄漏 active compute。
即使 destroy 成功，显式要求没有满足，Invocation 也以 `retention-not-satisfied` 判 incomplete。

suspend 与 destroy 都失败时沿用 active/unknown 处置。
下一次运行在同 project 与 Provider 创建资源前必须先 reconcile；无法收敛就拒绝继续 provisioning。

## 中断与崩溃

Ctrl+C 停止新派发，并对已经创建的 Sandbox 执行同一 teardown 与 release 时序。
中断不把 `retain` 改成 destroy，也不跳过 identity 核验。

可捕获的顶层崩溃先尝试 reconcile，再以非零退出。
`SIGKILL` 与断电没有退出码；pre-provision intent、Provider metadata 与 active failsafe 仍然存在。

下一次 `exp` 或 `sandbox prune` 处理悬空 intent：

- `provisioning`：按 token 查找并销毁 bootstrap 未确认的资源；
- `suspending`：inspect 后提交 dormant，或继续安全释放；
- `waking`：inspect 后提交 active，或对同一 logical identity 重试；
- `destroying`：确认资源 gone 后删除 registry；
- `unknown`：核验身份后重试，无法验证则保持并退出非零。

## `sandbox enter`

```text
acquire entry lease
  -> inspect dormant generation
  -> write waking intent
  -> Provider wake with active deadline
  -> commit active generation
  -> print checkpoint + cleanup + deadline
  -> interactive shell
  -> write suspending intent
  -> Provider suspend with new expiry
  -> commit dormant + release lease
```

shell 退出后的 suspend 失败按显式管理命令处理：CLI 非零，并保留可恢复 intent。
active failsafe 仍会在 deadline 停止 compute；它不是让后台进程无限运行的承诺。

## Invocation completion

Attempt completion 与 resource completion 是两条相关但不同的轴：

| 事实 | 所有者 | 失败影响 |
|---|---|---|
| Verdict Claim | Attempt | 决定 passed / failed / errored / skipped |
| Attempt teardown 与 Record seal | Attempt | 决定 Attempt Record 是否完整 |
| physical suspend / destroy | Invocation resource owner | 决定 Invocation 是否 complete |

Invocation 必须等待所有 release 进入 dormant、gone，或持久化为 unknown + resource error。
最后一种状态仍可结束进程，但 completion 为 incomplete、退出码非零。
