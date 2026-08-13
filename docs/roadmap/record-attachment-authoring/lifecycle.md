# RecordAttachment adapter SPI —— Lifecycle

## Owner 与 occurrence

| linked occurrence | binding owner | producer window |
|---|---|---|
| Eval Plugin | 当前 actual Attempt | Agent ready 后到 Attempt seal 前 |
| Experiment Plugin pair occurrence | 当前 actual Attempt | 同上 |
| Experiment Plugin Run occurrence | 当前 Run | Run setup 到 Run teardown 后 |
| framework built-in producer | 对应 Run 或 Attempt | package-owned window |
| Group、provider、Agent、Report、projector、converter | 无 | 不取得 binding 或 live session |

Experiment Plugin 的 Run 与 pair／Attempt occurrence 共享 mount provenance，但 authority 与 Scope 独立。每个 occurrence
只看到自己的 binding declaration；没有 owner-wide adapter enumeration。

## Link 在资源之前

```text
adapter definitions + installations + owner-specific bindings
  → compile every adapter
  → validate installation identity
  → validate owner-specific fragment
  → reject duplicate owner/name bindings
  → freeze behavior identity and link plan
  → only then create Run / Sandbox / Agent / Attempt resources
```

伪造 adapter、owner mismatch、duplicate family、Plugin occurrence conflict 或 invalid behavior identity 都是零资源 link
failure。installation 不补齐 producer binding，producer mount 也不自动安装 migration trust。

## Owner open 是 linearization point

对每个 actual owner，binding 在 owner open 时完成四件事：

1. 从 exact linked binding 推导 host-internal grant；
2. 原子 reserve `(owner, name)`；
3. 登记 pending tracked producer obligation；
4. 建立该 binding 的 child Scope。

reservation 不等到 SDK callback 或 adaptation 才取得。这样两个 occurrence 不能竞速写同一 family，也不存在 first-call
wins、last-wins 或失败后替换。

carry／reuse 的 historical Attempt 不打开 owner producer，因此不 reserve、不 acquire session，也不产生新 Attachment。

## Attempt bracket

一个 actual Attempt 的顺序固定为：

```text
owner open
  → reserve all binding families + register pending obligations
  → Agent ready
  → open each producer session in linked order
  → Hosted beforeAttempt hooks
  → Eval body / logical sends
  → Hosted afterAttempt hooks with exhaustive primary exit
  → seal producer sessions
  → release sessions
  → adapt sealed domain values
  → submit canonical commands
  → drain all obligations
  → validate domain aggregate
  → seal Attempt
```

多项 binding 按 linked contributor 顺序 open，并按逆序 seal／release。一项失败不能阻止已经 acquire 的其它 session
收尾。`attempt` 是 nominal execution identity；producer 看不到 Record owner ref、draft 或 lease。

`seal` 在全部 Hosted `afterAttempt` 停稳后运行，并取得 `completed | failed | before-hook-failed | interrupted` 的穷尽
primary exit。正常测量缺口必须返回 explicit empty、partial 或 unavailable 的 sealed domain value。

如果 seal 成功但 release 失败，host 不执行 adaptation。binding 仍以 failure 收束，避免先发出 accepted contribution
再由资源释放推翻。

## Run bracket

Run binding 使用同一 total obligation：

```text
Run owner open + reserve
  → open Run producer sessions
  → Experiment setup
  → selected pair execution / carry
  → Experiment teardown
  → seal + release Run sessions
  → adapt + canonical commands
  → validate Run aggregate
  → flush Run + create complete marker
```

Run producer session 不借给 Attempt hook。Experiment Plugin 的 Attempt binding 在每个 actual gap Attempt 内另开 Scope。

## total obligation 的终态

每个 binding 只能得到两个终态：

```text
accepted:
  one sealed value + successful release + successful adaptation + durable write

failed:
  any open / seal / release / adaptation / validation / durable failure,
  defect, interruption, missing value, or duplicate value
```

没有 optional、ignored 或 best-effort 终态。一个 mounted producer 若正常测不到事实，仍需写入领域定义的 explicit state。
未挂载该 SDK 的历史 Attempt 才会在 reader 中表现为 Attachment `unavailable`。

失败会 poison owner。多个 binding 的 failures 按稳定 owner/name 顺序聚合；completion race 不决定主错误。

## Effect v3 Scope 与 release failure

producer lifecycle、blob Stream 与 canonical commands 属于 owner 的 Effect v3 Scope。公共 SDK callback 不启动
`Effect.runPromise`；Promise provider 只在 SDK 边界用 `Effect.tryPromise` 适配一次。

Effect 3.22.1 的 `Effect.acquireRelease` finalizer error 固定为 `never`。host 因此显式捕获 seal 与 release 的完整
`Exit`／`Cause`，把 typed failure、defect 与 interruption加入 owner lifecycle aggregation。Scope finalizer 在登记
failure 后自身收束为 `Effect<void, never, ...>`，不能只 log 或吞掉 release failure。

owner interruption 会中断 still-running producer 与 blob Streams，并等待全部 finalizer。不存在 owner 已结束、session
或 write 仍在 detached fiber 中成功的路径。

## adaptation 与 canonical command

只有 producer seal 与 release 都成功，host 才把 sealed value 交给 adapter：

```text
sealed domain value
  → pure current adaptation
  → package-owned payload snapshot
  → schema / plain-data / blob closure validation
  → canonical tracked command
  → generic writer
  → accepted event
```

adaptation 失败与 command 失败都 poison owner。adapter 没有 retry writer；要重试外部采集必须由领域 producer 在自己的
明确 policy 内完成，并计入 behavior identity。

## publication barrier

Attempt seal 前必须：

1. 停止 external hooks；
2. seal／release全部 external binding sessions；
3. adapt 并 drain canonical commands；
4. 由成功 accepted events 形成 Plugin provenance；
5. 完成 framework official bindings；
6. drain owner tracked set 到 quiescence；
7. 若 poisoned 则拒绝 publication，否则 seal Attempt。

Run 在全部 Attempt references、Run bindings、aggregate contract 与 portable writes 成功后，才最后创建 `complete`。中断
留下的 incomplete Run 不是 published Record fact，可由 `niceeval clean` 处理。

## 读取与 migration

reader 在 frozen snapshot 中 materialize Attachment；projector只解释 immutable available value。两者不打开 producer
Scope，也不调用 adapter `adapt`。

migration host 先形成 opaque plan，再根据 application 的 explicit decision mint exact-plan authorization。执行在
exclusive maintenance Scope 中运行 adjacent converter。converter 只持 source value 与 target builder；不能回到 producer
lifecycle、重新 open meter、读取当前宿主运行条件或发布新 owner。
