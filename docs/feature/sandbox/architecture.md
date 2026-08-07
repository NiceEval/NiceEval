# Sandbox —— 架构

内置 provider 的实现要点、沙箱在 attempt 生命周期里的确切位置,以及给贡献者的扩展路径。使用侧的 API 见 [Library](library.md)。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心固定各环节**的调用顺序**,每个环节**内部做什么**交给两层 `SandboxLayer`、adapter 与 eval 各自的作者(声明面见 [Sandbox Layer](layers.md),完整时序见[三方准备时序](lifecycle.md)):

```text
 Sandbox Case create / build / start / ready
  → Sandbox lifecycle setup                   # 每个实际 Sandbox 一次；可恢复目录或 checkpoint
  → reset 到已知 Case 起点                    # 复用时每 Attempt 都执行
  → template owner 的 prepare 命令          # sandbox.prepare.<owner>:按声明顺序;owner 由配对的 template 归属决定
  → 另一作者 owner 的 prepare 命令          # 同上,随后执行
  → agent.ensure 循环                      # agent.ensure:probe、缺失时配对安装层 install、复检
  → workspace baseline                     # 变更分类账的锚点 commit(runner 私有 git ledger,见下节)
  → Agent runtime setup                    # agent.setup:本 Attempt 的连接与运行配置
  → test(t)                                # ← 驱动 Agent 与读取结果:
  │    t.send()                              #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events);send 窗口内的变化归因给 agent
  │    断言…                                 #   t.sandbox.fileChanged / t.sandbox.diff 读 agent 归因增量
  │    t.sandbox.upload* / runShell         # send 窗口外的普通 eval 归因操作
  → workspace.diff                         # 折叠全部 send 窗口；失败后果由本 Attempt 的证据依赖决定
  → assertions.evaluate → telemetry.collect   # 断言 finalize + Verdict 语义确定(judge 调用在此)、trace 收口
  → Agent runtime teardown                 # finally:agent 收尾先行
  → 已登记 cleanup(全局逆序)               # context.onCleanup() 登记的清理:第二作者 layer 先清,template owner 后清,层内命令逆序
  → commitKeepOrStop()                      # 决定 Scope release 时 stop 还是 suspend
  → Sandbox lifecycle teardown              # 每个实际 Sandbox 一次，setup 的全局逆序
  → Scope release                           # Provider Case finalizer;释放或留存完成后才能封口 result.json
```

这条链的阶段词表以 [Record 的 `LifecyclePhase` 闭集](../record/architecture.md#两层时间模型生命周期锚点与开放-activity)为唯一权威。
收尾是全局 LIFO:Agent runtime teardown 先行,已登记 cleanup 按全局准备顺序逆序执行；实际 Sandbox 退休时再跑 lifecycle teardown（可回存目录或 checkpoint），Provider Case finalizer 最后整组关闭。
收尾发生在 Verdict 语义确定之后，只能追加 diagnostic，不能反改 Verdict。
`result.json` 的物理封口则必须等 Scope release 完成；两者不是同一个“定稿”时点。

### 中断与留存矩阵

| 路径 | Attempt 收尾 | keep 决策 | Scope release | `result.json` | Experiment teardown |
|---|---|---|---|---|---|
| 正常完成 | Agent teardown → cleanup 逆序 | 按 `--keep-sandbox` 提交 | stop 或 suspend | release 后封口 | 全部 Attempt 收尾后执行 |
| Attempt timeout | 同上，逐段有界 | `errored` 可命中 keep 档位 | stop 或 suspend | release 后封口为 `errored` | 全部 Attempt 收尾后执行 |
| Ctrl+C | 已进入的收尾与 finalizer 有界执行 | 不新提交 keep | disposition 保持 stop | 仅已走到封口点的 Attempt 存在 | 执行有界 teardown |
| SIGKILL / 断电 | 无法执行 | 无法提交 | 无法执行 | 在飞 Attempt 不封口 | 无法执行；由 orphan 对账事后回收 |

Ctrl+C 是可处理的中断，SIGKILL 不是。
已封口 Attempt 在两种路径下都保持可读；reader 不为在飞 Attempt 伪造 `errored`。
强杀遗留实例只通过创建期标识与 orphan 对账处理。

## 变更归因:send 窗口与分类账

`t.sandbox.diff` / `fileChanged` / `fileDeleted` / `notInDiff` 回答的是「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。归因由 runner 的**变更分类账**(私有 git ledger)提供:

- **分类账在沙箱内、workdir 外。** ledger 的 git 目录放在 runner 控制的私有路径,以 workdir 为 work-tree。workdir 保持素净——agent 看不到 runner 的 `.git`,eval 需要真实 git repo 时自己 `git init`,agent 在 workdir 里的任何 git 操作都碰不到分类账。
- **受限文件由分类账自己提权读取,不改题目。**

  - Provider 明确支持 root command 时,baseline、窗口 commit、导出与 reset 的 runner 私有 Git 命令以 root 执行。Mode `0311` 这类故意不给 Agent 读权限的文件仍能进入锚点。
  - 提权不进入 Agent 命令。脚本不对 workdir 做 `chmod` / `chown`,文件 owner 与 mode 保持题目原样。
  - Provider 不支持 root command 时沿标准用户执行。普通可读 workspace 照常工作；遇到受限文件则明确报告能力缺口并建议换支持提权的 Provider,不能静默忽略该文件或替 Agent 放宽权限。
下面这条 eval 把每一行写入落到哪本账上标在原地:

```typescript
export default defineEval({
  diff: { ignore: ["fixtures/**"], include: ["node_modules/some-pkg/**"] },
  //  合成顺序固定:默认清单 ∪ ignore,再被 include 打洞
  //  → agent 改 fixtures/ 下的文件不进 agent diff;node_modules/some-pkg 里被 patch 的文件进
  //  清单在锚点时冻结:agent 或 fixture 事后写 .gitignore 影响不了它

  async test(t) {
    await t.sandbox.writeText("src/app.ts", SEED);
    //  写在 send 之前 → 下一次 t.send() 进入前落一笔 eval 归因

    t.sandbox.fileChanged("src/app.ts");
    //  第一次 t.send() 之前 agent 归因增量恒为空 → 这条如实失败
    //  起始 fixture 制造不了假阳性,这正是分类账存在的理由

    await t.send("把 src/app.ts 改成 async/await。");
    //  send 窗口:从进入到返回的全部 workspace 变化落一笔 agent 归因

    t.check(t.sandbox.diff.get("src/app.ts"), excludes(/callback/));
    //  读的是最后触及该文件那个窗口的终态;窗口之间夹着的 eval 写入不会被算进 agent 的账
  },
});
```

- **三类 commit 时点。** 锚点一笔(`workspace.baseline` 阶段,两层 prepare 命令与 `agent.ensure` 循环之后);每次 `t.send()` 进入前,workdir 有未记录变化就落一笔 **eval 归因**(`test(t)` 里 send 前的 fixture 写入与 `runCommand` 副作用都在这类);`t.send()` 返回后落一笔 **agent 归因**。`agent.setup` 往 workspace 写 AGENTS.md / skill 也在 send 窗口之外,不需要 exclude 一类补丁。
- **沙箱型 send 串行,窗口不重叠。** 同一 workdir 上重叠的 send 本身就是写入竞争,合并窗口只会掩盖归因不确定性——sandbox 型 session 的 send 经 workspace 信号量串行执行,direct agent 的 send 不受此限。配套的 Adapter 义务:`send()` 返回时,Agent 侧可能写 workdir 的进程必须已退出、或已进入**可证明不再写 workspace 的静止态**(HITL waiting 的典型形态:CLI 进程还挂着等输入,但已停在请求点、不会再动文件)——后台残留写入会落在窗口外、被错记成 eval 归因。
- **归因排除清单,runner 私有、锚点时冻结。** 默认在任意目录深度排除 `.git`、`node_modules`、`__pycache__`、Python 虚拟环境(`*venv*/`)、常见构建产物与包管理器缓存——不排除的话,prepare 命令里一次 `npm install` 或 agent 自建一次 venv 就会让分类账哈希成千上万个依赖文件,后续窗口的二进制与缓存变化持续放大 object 库。`diff.ignore` / `diff.include` 使用 workdir 根的 gitignore 风格 glob：无 `/` 的 pattern 匹配任意深度的同名项，含 `/` 的 pattern 从 workdir 根匹配，尾 `/` 表示目录。项目自己的 ignore 规则**不**参与归因判断——被项目 ignore 的文件照常记录。
- **nested Git repository 不得变成证据盲区。** 私有 ledger 发现索引 mode `160000`（submodule / nested repo 的 gitlink）立即让当前阶段报执行错误，并列出路径与修法：被测 checkout 应直接位于 `workdir` 根；确实不参与评分的 nested repo 应由 `diff.ignore` 整体排除。只打印 Git warning 后继续会让 repo 内普通文件修改从 agent diff 静默消失，禁止这种降级。
- **agent 归因增量 = 逐窗口 delta 序列,不做跨窗口压缩。** `workspace.diff` 阶段从分类账导出每个 send 窗口自己的 before/after,按时序落盘为 `diff.json`(形状见 [Results · diff.json](../record/architecture.md#diffjson))。不压成单一 before/after 是硬约束:窗口之间可能夹着 eval 写入,压缩会把 eval 的修改夹带进 agent 的账;「创建又删除」「改完又改回」也会被压没。文件级摘要(`net` / 触及窗口)与 `diff.get(path)`(最后触及窗口的终态)都是读取面从窗口序列派生的视图,agent 窗口内发生过的改动不因 eval 事后覆盖而被抹掉。
- **导出往返是常数次。** `workspace.diff` 用一条沙箱内命令完成**全部** agent 窗口的路径枚举、文本 blob 读取与二进制尺寸统计,结果写进沙箱内的导出文件,宿主经文件通道一次下载并在宿主侧解析校验——provider 往返数与窗口数、文件数都无关,不能退化成逐文件或逐窗口的远端调用,也不把大证据灌进命令 stdout 通道。导出对沙箱环境的全部要求是 git 与 POSIX shell 工具(分类账本身已要求 git),不要求 node、python 等运行时。单窗口上限:最多导出 10,000 个路径、64 MiB 文本 blob 证据,预算只数真正要传输的字节(文本 before/after 实际字节)。二进制不内联内容、只记字节数,不占预算;超过单文件阈值(1 MiB)的文本按二进制同款处理——记 `status` 与字节数、内容显式省略(`elided`,形状见 [Results · diff.json](../record/architecture.md#diffjson)),同样不占预算。尺寸核算先于内容传输。内容被省略的条目,存在性与 `status` 断言照常成立;内容断言在读取那一刻如实报证据不可用,不静默判过或判败。

导出命令、下载或解析失败时不得伪造空窗口。
非 optional 的 diff 消费者存在时，失败使对应断言 `unavailable`，并令 Attempt `errored`。
没有 required 消费者时，失败只记 `workspace-diff-unavailable` diagnostic，并省略 `diff.json`。
Runner 继续用已经取得的命令结果、事件与其它证据完成判定。
这条 required / supplemental 分界的单源在 [Assertion 证据与完整性](../assertions/architecture/evidence.md#判定依赖与补充证据)。
- **作用域就是 workdir,刻意不扩大。** 全文件系统 diff 只有 Docker 有原生通道(容器层 diff),且只有路径没有内容、噪声大、做不了 send 窗口归因,按 provider 分支还破坏[核心中立](../../architecture.md);workdir 之外的世界($HOME、全局安装、PATH)不靠更大的 diff 回答,靠留存现场(见下节)。git 是唯一便携、增量、带内容存储、能支撑逐窗口归因的引擎,这是选它的理由,不是历史惯性。

agent 归因之外,最终工作区仍完整可读:`t.sandbox.readText` / `runCommand` 看到的就是最终状态;留存现场(`--keep-sandbox`)保有含分类账的完整沙箱。逐窗口回放变更历史有公开入口——[`niceeval sandbox history` / `sandbox diff`](cli.md#回放留存现场的变更历史sandbox-history-diff),不需要摸 ledger 的内部路径。

这条链上每个实际执行的环节都被计时并落进 `result.json` 的 `phases`——排队与创建分列、两层 prepare 命令逐条形成时间树、收尾段(agent 收尾 / cleanup / `stop`)在判定口径之外单独记录。

Sandbox 创建成功后,core 只包装一次返回的中性 `Sandbox`:所有经四个公开 `run*()` 方法发出的调用自动挂到当时的 phase/command/turn 下,所以 `sandbox.prepare.<owner>` 的依赖安装、`agent.ensure` 的 CLI 安装、adapter 启动 Agent CLI、workspace baseline/diff 与 lifecycle hook 的回存命令都能继续展开到真实 shell。provider 内部用 `runCommand` 转调 `runShell` 只算最外层公开调用一次,不重复计时。

runner 或 Sandbox 知道一段批量工作属于同一个逻辑动作时,在命令外再包一层 `operation` 语义节点;例如 `workspace.diff` 记录一次 `export workspace diff` operation,其下是一条覆盖全部窗口的批量导出 command 加一次导出文件下载,而不是每个文件各一条 `git show`。

`sandbox.create` 是特殊边界:此时 Sandbox 对象尚不存在,不能靠同一个包装器看到内部步骤。内置 provider 可把真实 SDK 请求、宿主命令或创建子步骤作为 `provider` 节点写入;第三方 provider 没提供细分时只记录 `sandbox.create` 合计,不能为了树好看把 API 调用伪装成 shell 命令。Agent CLI 内部自行执行的工具命令也不经过 Sandbox 包装,它们由标准事件流记录,有 OTel 且 correlation 唯一时才在 turn 下显示耗时。

时间树的父级归属使用随 async 调用链传播的显式 timing context,不能用一个可变的“当前 phase/command”全局值——并行命令会串错父级。runner duration 使用单调时钟,节点同时保存 attempt 内 `startOffsetMs`,从而恢复 sibling 的重叠关系。命令只落有界脱敏摘要:env value 与 stdout/stderr 不进入 timing；script/argv 先按调用方通过 `CommandOptions.sensitiveValues` 登记的已知值精确替换，再截成 160 字符摘要。敏感值只驻留 Attempt 内存，full/JSON 读面也不能还原；未登记自由文本不靠键名正则猜测。operation 的 label 同样有界、脱敏,由拥有该逻辑工作的 producer 写入;展示层不能解析命令文本猜业务分组。这样「沙箱起了多久、prepare 哪条命令慢、Agent CLI 启动多久、超时死在哪一层、收尾卡没卡」都有数据可查。阶段与时间树口径见 [Phase Timings](../../engineering/benchmark/README.md),终端的有界/full 两档入口是 [`niceeval show --timing`](../reports/show/timing.md),网页入口是 `niceeval view` 的 Attempt 详情。

核心固定的是这条调用链本身:Case 就绪后先按 owner 顺序执行两层 prepare 命令与 agent.ensure 循环,再打分类账锚点；`test(t)` 中的普通上传、turn 和判分命令按源码顺序执行。agent diff 只折叠 `send` 窗口，窗口外写入属于 eval 归因。完整路径见 [Eval 用例 · 沙箱 coding 任务](../eval/use-case/sandbox-coding.md)。

provider 的可写保证不止 `workdir`。
runner 要在 workdir 外的私有路径放沙箱侧运行时文件——OTLP 采集器、变更分类账——落点是系统临时目录,镜像必须让它对运行用户可写。
`/tmp` 不可写是环境缺陷，报错必须点名不可写路径与修法，不透传 SDK 的原始错误串。
它发生在必需的 ledger 等运行路径时仍是执行错误；只阻断 OTLP 接收器等 supplemental 证据时写 diagnostic 并继续，不能用环境缺陷这一分类绕过证据依赖边界。

## 时限归属:attempt deadline 是唯一默认

attempt 内的一切沙箱时限都从 attempt deadline **派生**,provider 层没有独立默认:实例寿命请求覆盖 deadline 加收尾预留([复用寿命](reuse.md)同一规则),单条命令未显式传 `timeout` 时,上限就是 deadline 的剩余量。
理由与 [`timeoutMs` 的解析链](../experiments/architecture.md#配置解析链一次求值处处同源)相同:时限多一个链外来源,症状就是「实验声明 20 分钟,命令在整 600 秒被另一层杀掉」——配置的值不生效,报错还落在离配置最远的地方。
用户代码显式给单条命令传更短的 `timeoutMs` 仍然生效,那是有意声明,不是默认值。

### 命令树与进程寿命

Sandbox 是资源组的生命周期边界，但不是每个子进程的隐式 owner。正常 `runCommand` / `runShell` 完成后，关闭 transport、PTY 或 provider session 不得顺带杀死命令有意启动的任务服务；这些服务是否跨命令或跨 Attempt 保留，由 Case、reuse 与 keep 契约决定。

异常路径相反：命令 timeout、取消、Attempt interruption 或 Agent runtime cancellation 时，Provider 必须在 Promise settle 前确认本次**受管命令树**已经终止。能按进程组 / job / cgroup 精确终止就只终止该树；无法证明时必须退休并停止整个 Sandbox。只关闭输出流、让孙进程继续运行，是取消失败而不是成功。

一次逻辑 send（含全部物理重试）只有在 Agent driver 与可能写 workdir 的命令树已终止或进入可证明静止态，且 ledger / retryAttempts 已记账后才能 settle。正常 keep 可保留任务服务，但 Agent teardown 必须保证 driver 不能继续发模型请求；异常路径无法证明静止时，不能把 Case 标成可安全复用。

超时把 attempt 转成 `errored` 时,归属必须可见。
`result.json` 落盘三样:触发的是哪层时限(attempt deadline / 命令显式 `timeout`)、值多少、值从四层来源的哪层解析而来。
报错行与 [`niceeval show --timing`](../reports/show/timing.md) 照实印这三样,不打一个没有归属说明的 ✗。
provider 自身固有的会话上限(如 Vercel Sandbox 的 session 时长)不能静默充当默认值:deadline 超出它时在派发前就报环境约束,点名 provider 与上限值,不让 attempt 跑到一半被截。

## 留存(keep)与注册表

[`--keep-sandbox`](cli.md) 的留存决策发生在 attempt 收尾链的最后一步。
verdict 定稿后按档位提交：`failed` 档是不带值的 flag 的默认值，提交 `failed` / `errored`，包括被硬超时打断的 `errored`；`all` 档提交全部 verdict。
此时其余收尾(agent teardown、已登记 cleanup、diff 采集)已经照常完成；若实例实际退休，lifecycle `teardown()` 随后回存其 checkpoint。

attempt 的最终 `locator` 在调度前已经由预分配的 `runId` 与 `{evalId, attempt}` 算好并通过记录根碰撞登记。
因此登记项、run 收尾反馈与 `result.json` 从第一次写入起就使用同一个 locator，没有事后补写窗口。

沙箱的 Effect Scope 持有一个只在本 attempt 内可变的 release disposition,初始为 `stop`。attempt deadline 只中断 Scope **里面的 verdict-producing 工作 fiber**,把超时转换成 `errored` draft;它不关闭外层 Scope。runner 随后仍在同一个 Scope 内执行有界 teardown、定稿 verdict,再调用 `commitKeepOrStop()`。这样硬超时现场尚未被 finalizer 销毁,而 Ctrl+C 中断外层 Scope 时 disposition 仍是 `stop`,照常清理。Scope release 最后按 disposition 执行:只有留存提交成功才跳过 `sandbox.stop()`。

留存提交严格按以下顺序,不能调换:

1. 把完整登记项原子写入持久注册表。一条 = `{ sandboxId, provider, evalId, attempt, experimentId?, locator, verdict, keptAt, workdir, enter?, expiresAt?, state, lease? }`,`state` 初值 `"alive"`(实例此刻还在跑);`lease` 是事后命令的互斥凭据(语义见 [CLI · 条目级 lease](cli.md#niceeval-sandbox查看与销毁留存的沙箱))。
2. 写入成功后,才把 disposition 改成 `keep` 并从本次 run 的内存清理集合移除。
3. 写入失败时保持 `stop`,记录 diagnostic,让 Scope finalizer 正常销毁;该 attempt 的 `sandbox.kept` 不得写成 `true`。
4. disposition 为 `keep` 时,Scope release 阶段执行 provider **suspend**(`sandbox.suspend` phase,有界计时——e2b pause 的耗时随内存增长,不许藏在计时外):成功后把登记项 `state` 更新为 `"dormant"`;失败时保持 `"alive"` 并追加 diagnostic——现场仍被注册表管理、仍可 enter,只是没省下资源,**不销毁、不冒充 dormant**。suspend 与任何收尾步骤一样不反改 verdict。

持久注册表是 `.niceeval/sandboxes/` 下的**逐条目文件**,不是多个 attempt 竞争改写的一份 JSON。entry id 由 `provider + sandboxId` 做稳定散列;每条先写同目录临时文件、`fsync` 文件后 `rename` 成 `<entry-id>.json`,再 `fsync` 目录;不同 attempt 与不同 niceeval 进程不会覆盖彼此。`sandbox stop` 先完成 detached 销毁(实例已不存在也算完成),再删除对应条目并同步目录;销毁失败则保留条目并退出 1,不能为了让列表变干净而制造无主资源。受支持的正常返回、异常、超时和 Ctrl+C 路径因此保持:沙箱要么仍在内存清理集合,要么已有可被 `list` / `stop` 发现的持久条目。无法拦截的进程 `SIGKILL` / 宿主断电不承诺分布式原子性;这类外部中断留下的实例由[孤儿核对](#孤儿核对强杀路径的实例面回退)按创建期写入的运行标识事后收回。

`enter` 是 provider 原生的进入命令,记进注册表供直连与审计;日常入口是 [`niceeval sandbox enter <id>`](cli.md#sandbox-enter),由它负责唤醒、进入与退出后重新休眠。`expiresAt` 是现场可找回的截止时刻——provider 声明了保留期限才写(vercel 写,e2b pause 无限期保留则不写)。

`sandbox list` / `stop` 按注册表条目的 `provider` 名路由到各 provider 的 **detached 销毁**能力——不需要原来的 run 进程或 `Sandbox` 实例还活着(docker:`rm -f`;e2b / vercel:SDK 按 id kill)。这层按名字路由发生在 CLI / 注册表边界,符合[核心中立](../../architecture.md)的分界:运行器与评分路径仍不感知 provider 名。

各 provider 的留存语义——suspend 把现场转入该 provider **最持久的低成本形态(休眠)**,「留下」不等于「继续跑」:

- **Docker** —— suspend = `docker stop`:文件系统落盘持久、不占内存、跨 daemon 重启存活。创建容器时就不带 `AutoRemove`(留存意图必须在创建期传入),`stop()` 改为显式 stop + remove,行为等价;容器带 `niceeval.keep-candidate=true` 标签,正常 run 结束后该标签下只剩已登记的 kept 容器;强杀留下的未登记候选由[孤儿核对](#孤儿核对强杀路径的实例面回退)按运行标识收回。停驻的容器不会自己消失,仍是唯一需要用户主动清理的 provider。两个否决项:`docker pause` 不用于留存(内存驻留,daemon 重启即失,反而更脆);`docker commit` 转镜像也不用(引入第二种要管理的资源面,停驻容器已给出同等持久性)。
- **E2B** —— suspend = `pause`:文件系统与内存整体持久化,暂停期间停止计费,现场无限期保留、可 `resume` 找回;没有自然过期时刻,`expiresAt` 不写。
- **Vercel Sandbox** —— suspend = `stop`:sandbox 默认持久,stop 自动打一次 Run 保存文件系统,之后经 `Sandbox.get` / `getOrCreate` 恢复(SDK 原生能力);内存态不保留,唤醒后进程要重新启动。`expiresAt` 写 `keptAt` 加上 Run 的默认保留期限——`snapshotExpiration` 默认 30 天(2,592,000,000ms,从 Run 最后一次使用起算),niceeval 不覆盖这个参数,默认值就是留存现场实际的保留期限。
- **Local** —— 不参与留存,`--keep-sandbox` 组合在创建前报错:本地档从不销毁,现场天然留在用户的工作树里,无需注册表纳管(见[本地执行](local.md))。
- **`defineSandbox` 自定义 provider** —— 不参与留存。`niceeval sandbox` 刻意不加载 config / eval 模块,新进程只有序列化登记项,无法安全找回用户对象上的任意 `stopDetached` 函数;只删登记项又会违反「stop = 销毁」。因此 `--keep-sandbox` 与自定义 provider 组合在创建前报清晰错误。需要统一留存生命周期的 provider 应贡献为内置 provider;未来若引入可序列化、可审计的 detached cleanup 协议,再扩这条边界。

`Sandbox` 接口不因留存扩大:没有 pause / detach / keep 方法——「留下」不是沙箱的能力,是 runner 的一次调度决定。留存的 attempt 在 `result.json` 落 `sandbox: { provider, sandboxId, kept: true }`(字段契约见 [Results](../record/architecture.md#resultjson)),`phases` 无 `sandbox.stop` 条目。

## 孤儿核对:强杀路径的实例面回退

进程内的清理集合与 Scope finalizer 覆盖不到 `SIGKILL` / 宿主断电——没有任何代码来得及执行,正在跑的沙箱就地变成 provider 侧的无主实例。这条路径的回退不追求「杀不掉的进程也能收尾」(做不到),而是把「事后认领」做成可靠的机器动作:创建时把归属写进实例元数据,事后按归属核对与收回。

- **运行标识在创建期写入。** 每台沙箱实例创建时带运行标识元数据:`host`(宿主机名)、`pid`(runner 进程)、`startedAt`(Run 时刻)。Docker 用容器 label(与 `niceeval.keep-candidate` / provision token 同一机制),E2B 用 SDK `metadata`(与 provision token 同通道)。Vercel Sandbox 没有按元数据检索实例的通道,不参与孤儿核对——它的回退是 provider 自身的保留期限到期回收,这条差异如实写进公开文档,不伪装成全 provider 一致。
- **孤儿的判定是三条「与」**:带 niceeval 运行标识、不在留存注册表、且属主 run 已被证实死亡(标识里的 `host` 等于当前宿主机名,且 `pid` 探测不存活)。三条缺一不可:注册表里的 kept 沙箱是被管理的现场,不是孤儿;属主 run 还活着的实例属于并发运行中的另一次 run,绝不能收;`host` 不匹配或 pid 无法核对的实例标 `unverified`,列出但不自动销毁——误杀一台活实例的代价高于多留一台待人工确认,判定必须偏保守。
- **核对与收回分成只读、破坏两个入口**:[`niceeval sandbox list --orphans`](cli.md#sandbox-list---orphans) 只读列出,[`niceeval sandbox prune`](cli.md#sandbox-prune) 销毁已核实孤儿;`unverified` 只有显式 `--force` 才销毁。两个入口与 sandbox 命令组其余成员同一契约:不读 config、不执行用户代码,销毁走各 provider 的 detached 通道。
- **核对与收回以 case 的资源组为单位**:单 Sandbox case 的资源组只有主实例;Compose case 的运行标识写在 project label 上,伴随容器与网络随主实例整组列出、整组销毁。prune 是强杀与中断后唯一的官方收尾手段,case 新增资源种类(sidecar 容器、网络、volume、云端资源组)时,把它接入孤儿核对词表是该 case 契约的一部分,不允许有 prune 看不见的残留。
- 实验级 `setup` 起过的外部资源(隧道、共享服务、license 席位)是同一强杀路径的另一半泄漏面,回退在实验面,机制见 [Experiments · 强杀后的收尾回退](../experiments/architecture.md#强杀后的收尾回退收尾登记与启动自愈)。

## Docker provider(本地,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **DinD 是 provider-owned 启动协议** —— `dockerAccess.mode: "dind"` 显式替换派生镜像原有 `Entrypoint` / `Cmd`。
- **DinD 使用真正的 init** —— bootstrap 校验官方 dind 工具面，再执行 `docker-init -- node ...`。Node supervisor 同时持有 dockerd 与既有 keeper。
- **DinD 子进程共用一个终止协议** —— spawn error、子进程提前退出或 TERM / INT 都只提交一次 shutdown。
- **DinD daemon 不能单独死亡** —— daemon 意外退出使 outer container 非零退出。
- **DinD 时间边界** —— dockerd shutdown timeout 为 2 秒，supervisor grace 为 3 秒，`docker stop` 为 5 秒，provider cleanup watchdog 为 8 秒。
- **DinD TTL 预留关闭时间** —— keeper 的 timeout 从真实容器 TTL 中扣除 3 秒。`ensureLifetime` 仍以含 grace 的真实 cutoff 答复，不依赖 Runner 活着。
- **DinD 诊断在删除前获取** —— daemon 日志只保留有界尾部。bootstrap 失败、daemon 提前退出或 readiness timeout 都先收集日志，再删除创建失败的容器。
- **Agent 日志语义不变** —— `appendLog` 与 streamed output 仍由 keeper 写入 `docker logs`。
- **执行身份沿用镜像声明** —— 默认以镜像 `USER` 声明的用户跑命令(未声明按 Docker 语义是 root);factory `user` 覆盖整个 Sandbox 的默认身份,命令传 `{ user: "root" }` 时只这一条换身份(见 [Library · 执行身份](library.md#执行身份))。npm 全局目录与 `PATH` 注入按实际执行身份的 home 解析,不硬编码 UID。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 到执行身份修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧解析。
- **超时** —— 命令到点销毁流并报错;上限按[时限归属](#时限归属attempt-deadline-是唯一默认)从 attempt deadline 派生。

```typescript
const sandbox = await createSandbox({ provider: "docker", runtime: "node24", timeoutMs });
for (const file of workspaceFiles) await sandbox.writeBytes(file.path, file.content);
await sandbox.runCommand("npm", ["install"]);     // cwd 省略 → workdir
```

## Vercel Sandbox provider(云,可弹性扩并发)

需要 Vercel Sandbox 凭据;显式环境变量路径是 `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的 session 生命周期,必要时 snapshot + rotate,避免长命令被 session 上限截断。
- provider 内部可以批量传输，但对外兑现同一组 `writeText` / `writeBytes` 语义，不暴露另一套批量命名。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种 provider 间切换。

## E2B provider(云,微 VM)

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;`template` 由 `e2bSandbox({ template })` 声明,必填(见 [Sandbox Layer](layers.md#template-bearing-factory)),不用 e2b 账号侧的默认模板。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`user` 直接透传 `commands.run` 的同名参数。
- `commands.run` 的 event stream EOF 不是直接 shell 的完成边界。正常 shell 已退出、但 `nohup ... &` 等任务服务仍持有 stdout/stderr 时，provider 采集前台输出与 exit code 后断开 transport；它不等待该服务退出，也不杀它。完成帧只接受 supervisor 在取得子进程状态后写出的十进制 exit code，wrapper 源码、转义诊断或子进程回显中出现的 marker 字面量都不是完成边界。timeout、取消、协议完整性失败或 interruption 仍退休整台 VM，避免未确认终止的命令树进入 reuse / keep。
- 文件用 `files.read` / `files.write`(文本 + 二进制)。
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作记录。要 node24 / 烘焙好 agent CLI,用预制模板 `e2bSandbox({ template: "niceeval-agents" })`——参数的典型用途正是把 agent CLI 烘焙进模板,让后续 eval 跳过安装直接开跑(构建工作流见 [Library · 预制环境](library/prebuilt-environments.md))。

## Local provider(宿主机,零隔离)

契约与安全边界的单一来源是[本地执行](local.md),这里只列实现要点:

- **直跑宿主进程** —— `runCommand` 按 argv `child_process` 起进程(不经 shell),`runShell` 整段交给宿主 shell;`cwd` 默认 `workdir`,`env` 叠加宿主默认环境。路径解析共用 `src/sandbox/paths.ts` 的同一份实现。
- **私有 GIT_DIR 在 workdir 外的宿主侧** —— 变更分类账以用户目录为 work-tree、git 目录放 runner 自有路径,不写用户的 `.git`,`stop()` 时随 runner 资源一并清理;工作树本身一个字节不动。
- **独占串行声明** —— provider 元数据声明 `exclusive`,并发语义由 [Runner](../../runner.md#调度有界并发) 按中性声明执行,核心无 provider 名分支;推荐并发默认值 1。
- **不参与 provisioning 重试** —— 创建不经网络控制面,失败都是确定性错误,第一次如实抛出。
- **不参与预制环境** —— 无 image / template / snapshot 参数,宿主机本身就是环境。

## Provisioning 失败与重试

`createSandbox()` 跨网络调用 provider 控制面,失败按两个维度分类:**性质**(瞬时还是确定性)决定要不要重试,**后果**(远端是否可能已经创建了实例)决定能不能直接重试。

**性质**:瞬时失败的本质是"再等等就好"——限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)与传输层瞬时错误;确定性失败是"配置就是错的"——模板不存在、凭据缺失、权限不足,重试没有意义,识别出即第一次抛出。两个方向的误判代价不对称:把瞬时误判成确定性,一个本可自愈的 attempt 被白白判死;把确定性误判成瞬时,只多花封顶的退避时间,最后仍如实抛出原始错误——只慢不错。分类器因此偏向宽认瞬时,并接受有界的误判代价(存在把确定性错误包装成 5xx 文案的 SDK,反例见 memory 的 sandbox-provision-ratelimit-retry 条目)。

**后果**:同为瞬时,重试的安全性完全不同——

- **拒绝类**(请求确定没被受理):限流响应、连接建立失败(DNS 解析失败、连接被拒、TLS 握手失败)。
- **歧义类**(请求可能已被受理、只是响应丢了):响应中途的连接重置(`fetch failed`、`other side closed`)、请求超时、5xx。

这个分类描述的是**单个请求**,而被重试的单元是 provider 的整个 `create()`——它通常不止一个请求:SDK 创建调用之后还有初始化步骤(E2B 备工作区目录;Docker 启动容器、补装基础工具、修工作区属主)。一个被归入拒绝类的 429 完全可能来自实例已创建成功之后的初始化请求,「拒绝类 ⇒ 远端没有实例」对闭包整体不成立。盲目重试会在远端积累没有任何一方持有 id 的实例——泄漏计费资源,也打破[「不留无主沙箱」](#留存keep与注册表)的不变量。防泄漏因此是两道独立的防线:

- **kill-on-failure(provider 义务)**:`create()` 内部一旦拿到实例句柄,后续任何失败都先尽力销毁实例再抛出原始错误(销毁本身失败不掩盖原始错误)。这条与分类、与是否重试都无关——句柄在手,清理就是 `create()` 自己的责任,不可重试的失败同样适用。
- **重试前对账(重试层义务)**:每次 create 请求把一次性 provision token 写进 provider 原生元数据;有检索通道的 provider,**任何重试之前都按 token 检索远端**,查到的实例先销毁再重建,不区分拒绝类还是歧义类——分类器看不出错误落在闭包内哪个请求上,一次检索的成本远低于一台漏杀实例的计费。不做断线收养,重建比重连语义干净,冷启动成本本来就要付。对账排在退避睡眠**之后**:限流场景下紧跟失败发出的检索大概率同样被限流,睡醒再查;这也给刚受理的实例出现在列表里留了时间。**对账失败即放弃重试**,抛回原始 create 错误并留 diagnostic——对账是重试的硬前置,查不到账就重试与盲重试无异。

provider 没有按元数据检索实例的通道时:拒绝类直接指数退避重试(封顶次数 + 抖动),安全性由该 provider `create()` 的单请求形态或 kill-on-failure 保证;歧义类不重试、第一次抛出——宁可判死一个 attempt,不留一台计费的无主实例。

分类分两层,都留在 sandbox/ 内、不外泄到 Adapter / Runner:各内置 provider 先把自己 SDK 原生的限流错误(e2b 的 `RateLimitError`、vercel 的 `APIError{ response.status: 429 }`、docker 拉镜像时 message 里的 `toomanyrequests`)归入拒绝类;provider 没认出的错误再过一遍与文件 IO 重试共用的保守瞬时分类器(见下节),由错误形态落进拒绝类或歧义类。

各内置 provider 的对账通道与重试面:

- **Docker** —— 容器创建时即带 provision token label(与留存候选的 `niceeval.keep-candidate` 标签同一机制),对账 = 按 label 查询本地容器、force remove(容器已不存在视作对账完成)。create 闭包在容器创建后还有 start、基础工具安装、工作区属主一串 exec,这些步骤失败由 kill-on-failure 直接 force remove。拒绝类主要是拉镜像限流(发生在容器创建之前)。
- **Docker Compose** —— build 与 up 都复用同一套瞬时分类和退避。build 以同一 BuildKey 重建即可收敛；up 的 projectName 与 overlay 在整个重试闭包内固定，每次重试前先对同一 project 执行独立于 Attempt signal 的有界 `compose down --volumes --remove-orphans`，清掉半启动服务后再 up。附着主服务后由 Docker provider 探测 分类账所需的 git；题目镜像没带时以 root 通过已有的 apt/apk/dnf/yum 补齐，而不是要求每条 Eval 修改 Dockerfile。整个 case 最终仍由资源组 finalizer 回收；即使前向工作已经 timeout/cancel，finalizer 也拿新的 8s cleanup signal。只有真实回收成功才解除 registry 所有权；失败追加 `sandbox-stop-failed` diagnostic、保留 project labels 供同轮强清重试或 `sandbox prune` 事后认领，不改写原 Attempt verdict。
- **E2B** —— create 经 `metadata` 打 provision token,对账走 SDK 实例列表的 metadata 过滤,查到即 kill(实例已不存在视作对账完成)。创建成功后的工作区准备命令失败由 kill-on-failure 先 kill 再抛。真实跑分中两类都出现过:`Sandbox.create` 阶段的 `fetch failed · other side closed`(歧义类),与创建成功之后初始化请求撞 429 被归入拒绝类(反例见 memory 的 e2b-provision-429-duplicate-sandbox 条目)——都由重试前对账兜住。
- **Vercel Sandbox** —— create 是单个 SDK 调用、没有初始化尾巴;SDK 对 429 已内建多次退避重试(读 `Retry-After`),外层对拒绝类的封顶次数相应收窄,避免「外层次数 × 内层次数」在请求量和退避时长两个维度同时放大;SDK 没有按元数据检索实例的通道,歧义类第一次抛出。

重试循环由各内置 `ProviderModule<Plan>` 自己拥有。
`runtime.ts` 只调用 plan 私绑的闭包，不维护 adapter registry:

- 退避睡眠期间临时归还并发槽位(`retry.ts` 的 `ProvisionSlot`),睡醒后再排队要回来——在退避的 attempt 只是在等,不该攥着 `sandboxSem` 的名额陪跑 `setTimeout`,不然一批 429 会把整批实际并发拖成远低于 `--max-concurrency` 声明值的个位数。
- 重试全部耗尽后仍按原语义走:`verdict: "errored"`(基建问题,不是 agent 表现);对账中销毁的实例不额外报错,只留 diagnostic。

**对外的空间轴映射**:内部的两维分类不外泄,但确定性配置死因向 attempt 层浮出时附带[执行失败分类](../error-classification/README.md)的 `scope`,由止损闸消费。判据仍是可证明性,按死因的配置来源定档。凭据缺失、权限不足来自实验级配置,附带 `scope: "experiment"`。模板不存在按 template owner 定档。Experiment 是 template owner 时,同一模板由它选中的全部 Eval 共享,附带 `scope: "experiment"`。Eval 是 template owner 时,同因必死只能证明到共享同一模板的范围,词表里可证明的档是 `scope: "eval"`——错杀健康模板的 eval 比多撞几次死模板更贵。瞬时失败重试耗尽后不附带 scope:死因不可证明为兄弟共享。

Provisioning 的分类只覆盖"创建沙箱"这一步。沙箱创建成功后被 provider 终止属于 lifecycle failure,不能当成同一个实例里的普通 IO 失败继续重试;应保留明确终止原因,由 attempt 层决定是否允许重新创建整个环境。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 已创建 Sandbox 的文件 IO 重试

所有 provider(含 `defineSandbox`)返回的 Sandbox 都经过同一个包装层。包装层只对固定目标的幂等文件操作做默认重试:`readText`、`readBytes`、`pathExists`、`writeText`、`writeBytes`、`uploadFile`、`uploadDirectory`、`downloadFile`、`downloadDirectory`。目录传输即使只完成一部分,重跑仍覆盖同一组目标路径。

默认最多 3 次,指数退避并带抖动。只有传输层的瞬时错误进入重试:429、5xx、`fetch failed`、连接重置、临时 DNS / 网络不可达。文件不存在、权限错误、路径错误、取消、Sandbox terminated 都第一次抛出。`pathExists` 遇瞬时传输错误必须继续抛出,不能伪装成 `false`。

`runCommand`、`runShell`、`appendLog`、`stop` 永远不隐式重试:框架不知道命令在失败前产生了哪些副作用。需要重试命令时由调用者把幂等性写成显式业务策略。IO 重试全部耗尽后抛回原始 error,让 attempt 保存错误链与 partial evidence。

## 再接一个 provider

两条路,取决于新 provider 是不是打算贡献回 niceeval:

- **贡献进 niceeval**(像 docker/vercel/e2b 那样内置):实现 `Sandbox` 接口的一个类。
  接口包含 `create()`、`workdir`、run/read/write/stop/up-down-load。
  路径解析直接用 `src/sandbox/paths.ts`，不要自己再写一份。
  同时交付 template-bearing factory 与只读 `ProviderModule<Plan>`。
  factory 以 provider 原生纯数据声明完整起点，同时选定 Provider。
  planner 产出 provider 私有 typed Plan；module 的 build/materialize 闭包消费同一 Plan。
  case 义务清单见 [Sandbox Case](case.md)。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](library.md#自定义-providerdefinesandbox),身份与留存义务见 [Sandbox Case · 自定义 case](case.md#自定义-case)。

**核心定义接口, provider 各自实现**,两条路都不改核心其余部分。niceeval 的沙箱抽象刻意保持小(只需 run/read/write/stop),让接一个新 provider 的成本最低。

内置 provider 除接口外还要交付两个故事:预制环境(factory 消费的产物参数、构建归原生工具、共享/过期语义如实文档化,义务清单见 [Library · 新 provider 的预制环境义务](library/prebuilt-environments.md#新-provider-的预制环境义务))与留存(detached 销毁能力,见[留存与注册表](#留存keep与注册表))。

## 实现纪律

路径解析规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置 provider 共用;不允许每个 provider 各自复制一遍 `startsWith("/")` 判断——规则有多份实现,就会有 provider 悄悄不一致。`defineSandbox` 自定义 provider 只需声明自己的 `workdir` 字符串即可获得同一套行为。

不要硬编码 `/workspace`——它不是任何 provider 的真实 workdir,按它写的文件会落在 agent cwd 和变更分类账之外(agent 看不见、diff 采不到)。写法是省略 `targetDir` / `cwd`,需要绝对路径时用 `sandbox.workdir`。

包装或装饰 `Sandbox` 实例(路径归一化、日志代理这类中间层)时，只转发正式接口：`SandboxOperations`、宿主传输、`stop()` 与可选 `appendLog()`。留存不藏在 `Sandbox` 的动态成员上，而是 Case materialize 时单独返回 `SandboxRetention`；wrapper 因此不可能把 suspend/wake 能力静默吃掉。

provider 原生 SDK 的其余未知方法不属于公共契约,不承诺透传——需要新能力时显式建模成接口成员或 case 能力句柄,不开 `sandbox.native` 逃生口(裁决见 [memory 条目](../../../memory/sandbox-native-escape-hatch-rejected.md))。

## 性能:预制环境、Sandbox 复用与 Sandbox 预热

沙箱冷启动和重复安装是关键路径上的大头。优先级如下:

1. 把稳定重依赖做进 Docker image、E2B template 或 Vercel snapshot;每次 attempt 只从这个起点创建。
2. layer 的 `prepare()` 只做按 experiment / eval 变化的小配置与预检,昂贵动作靠真实检查快速命中；跨 Attempt 的实际 Sandbox 目录、服务或 checkpoint 都归 lifecycle hook。
3. 仍有必要时再考虑 Sandbox 预热或 Sandbox 复用。

- **Sandbox 预热** —— 按近期派发量提前创建 Sandbox,Attempt 到来时直接领取,把创建移出 Attempt 路径。
- **Sandbox 复用** —— Experiment 的 `sandboxReuse: true` 让多条 Attempt 共用 Sandbox。
  Case create / ready 每复用窗口一次;两层作者 prepare、agent.ensure 循环与 Agent runtime 仍每 Attempt 执行,昂贵准备靠 探测 命中快速返回。
  派发前确认 Sandbox 复用寿命,不足时续期或更换 Sandbox。
  完整契约见 [Sandbox 复用](reuse.md)。

预制环境的构建与发布归项目和 Provider 原生工具；NiceEval 的 template factory 参数负责消费（工作流见 [Library · 预制环境](library/prebuilt-environments.md)）。
Sandbox 预热与 Sandbox 复用是 [Runner](../../runner.md) 的调度职责。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 使用侧 API:路径、root、prepare 命令、自定义 provider。
- [Runner](../../runner.md) —— 预热与复用的调度职责。
