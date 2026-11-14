# Sandbox —— 架构

内置 provider 的实现要点、沙箱在 attempt 生命周期里的确切位置,以及给贡献者的扩展路径。使用侧的 API 见 [Library](../library/README.md)。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心固定各环节**的调用顺序**,每个环节**内部做什么**交给两层 `SandboxLayer`、adapter 与 eval 各自的作者(声明面见 [Sandbox Layer](../library/layers.md),完整时序见[三方准备时序](lifecycle.md)):

```text
 Sandbox Case create / build / start / ready
  → reset                                     # 复用时每 Attempt 都执行
  → attempt before                            # 四类 owner 的 DAG 按依赖与 changeFrequency 排队
  → agent.install 循环                      # agent.install:probe、缺失时配对安装层 install、复检
  → workspace baseline                     # 变更分类账的锚点 commit(runner 私有 git ledger,见下节)
  → Agent runtime setup                    # agent.setup:本 Attempt 的连接与运行配置
  → test(t)                                # ← 驱动 Agent 与读取结果:
  │    t.send()                              #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events);send 窗口内的变化归因给 agent
  │    断言…                                 #   t.sandbox.fileChanged 等归因断言读 agent 归因增量
  │    t.sandbox.upload* / runShell         # send 窗口外的普通 eval 归因操作
  → workspace.diff                         # 冻结全部 send 区间端点轨迹；失败后果由本 Attempt 的证据依赖决定
  → assertions.evaluate → telemetry.collect   # 断言 finalize + Verdict 语义确定(judge 调用在此)、trace 收口
  → Agent runtime teardown                 # finally:agent 收尾先行
  → attempt after / cleanup                 # 只按实际登记栈全局 LIFO
  → commitKeepOrStop()                      # 决定 Scope release 时 stop 还是 suspend
  → Scope release                           # Provider Case finalizer;释放或留存完成后才能提交 Record 事实
```

这条链的阶段词表以 [Record 的 `LifecyclePhase` 闭集](../../run/architecture/README.md)为唯一权威。
收尾是全局 LIFO:Agent runtime teardown 先行,attempt after 按登记栈逆序执行，Provider Case finalizer 最后整组关闭。
收尾发生在 Verdict 语义确定之后，只能追加 diagnostic，不能反改 Verdict。
Record 事实的提交则必须等 Scope release 完成；两者不是同一个“定稿”时点。

### 中断与留存矩阵

| 路径 | Attempt 收尾 | keep 决策 | Scope release | Record 提交 | Experiment after |
|---|---|---|---|---|---|
| 正常完成 | Agent teardown → cleanup 逆序 | 按 `--keep-sandbox` 提交 | stop 或 suspend | release 后提交 | 全部 Attempt 收尾后执行 |
| Attempt timeout | 同上，逐段有界 | `errored` Verdict 可命中 keep 档位 | stop 或 suspend | release 后提交 Observability diagnostic、Verdict 与 receipt | 全部 Attempt 收尾后执行 |
| Ctrl+C | 已进入的收尾与 finalizer 有界执行 | 不新提交 keep | disposition 保持 stop | 仅已走到提交点的 Attempt 存在 | 执行有界 teardown |
| SIGKILL / 断电 | 无法执行 | 无法提交 | 无法执行 | 在飞 Attempt 不封口 | 无法执行；由 orphan 对账事后回收 |

Ctrl+C 是可处理的中断，SIGKILL 不是。
已封口 Attempt 在两种路径下都保持可读；reader 不为在飞 Attempt 伪造 `errored` Verdict 或终态 lifecycle。
强杀遗留实例只通过创建期标识与 orphan 对账处理。

## 变更归因:send 区间与分类账

`fileChanged` / `fileDeleted` / `notInDiff` / `changedPaths` 这些归因断言回答的是「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。归因由 runner 的**变更分类账**(私有 git ledger)提供:

- **分类账在沙箱内、workdir 外。** ledger 的 git 目录放在 runner 控制的私有路径,以 workdir 为 work-tree。workdir 保持素净——agent 看不到 runner 的 `.git`,eval 需要真实 git repo 时自己 `git init`,agent 在 workdir 里的任何 git 操作都碰不到分类账。
- **受限文件由分类账自己提权读取,不改题目。**

  - Provider 明确支持 root command 时,baseline、区间 commit、导出与 reset 的 runner 私有 Git 命令以 root 执行。Mode `0311` 这类故意不给 Agent 读权限的文件仍能进入 baseline。
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

    t.sandbox.fileChanged("src/app.ts", { after: not(pattern(/callback/)) });
    //  读的是最后一笔包含该路径的 agent delta 的 after 端点;其间的 eval 写入不会被算进 agent 的账
  },
});
```

- **三类 commit 时点。** baseline 一笔（`workspace.baseline` 阶段，各 owner 的 before 与 `agent.install` 循环之后）。
  每次 `t.send()` 进入前,workdir 有尚未入账的变化就落一笔 **eval 归因**(`test(t)` 里 send 前的 fixture 写入与 `runCommand` 副作用都在这类)。
  `t.send()` 返回后落一笔 **agent 归因**。
  `agent.setup` 往 workspace 写 AGENTS.md / skill 也在 send 区间之外,不需要 exclude 一类补丁。
- **沙箱型 send 串行,区间不重叠。** 同一 workdir 上重叠的 send 本身就是写入竞争,合并区间只会掩盖归因不确定性——sandbox 型 session 的 send 经 workspace 信号量串行执行,direct agent 的 send 不受此限。配套的 Adapter 义务:`send()` 返回时,Agent 侧可能写 workdir 的进程必须已退出、或已进入**可证明不再写 workspace 的静止态**(HITL waiting 的典型形态:CLI 进程还挂着等输入,但已停在请求点、不会再动文件)。后台残留写入会落在 send 区间外、被错记成 eval 归因。
- **归因排除清单,runner 私有、baseline 时冻结。** 默认在任意目录深度排除 `.git`、`node_modules`、`__pycache__`、Python venv(`*venv*/`)、常见构建输出与包管理器缓存。不排除的话，before 里一次 `npm install` 或 agent 自建一次 venv 就会让分类账哈希成千上万个依赖文件，后续区间的二进制与缓存变化持续放大 object 库。
- `diff.ignore` / `diff.include` 使用 workdir 根的 gitignore 风格 glob：无 `/` 的 pattern 匹配任意深度的同名项，含 `/` 的 pattern 从 workdir 根匹配，尾 `/` 表示目录。项目自己的 ignore 规则**不**参与归因判断——被项目 ignore 的文件照常入账。
- **nested Git repository 不得变成证据盲区。** 私有 ledger 发现索引 mode `160000`（submodule / nested repo 的 gitlink）立即让当前阶段报执行错误，并列出路径与修法：被测 checkout 应直接位于 `workdir` 根；确实不参与评分的 nested repo 应由 `diff.ignore` 整体排除。只打印 Git warning 后继续会让 repo 内普通文件修改从 agent diff 静默消失，禁止这种降级。
- **agent 归因增量 = 按 send 区间排列的端点轨迹。** `workspace.diff` 阶段从分类账导出每个 send 区间自己的 before/after。collector 在 capture freeze（捕获封口）时，以此形成 origin Attempt 的 `FileChanges` closure（契约见 [Record · Architecture](../../run/architecture/README.md)）。
- **不做跨 send 区间压缩。** 区间之间可能夹着 Eval 写入，压缩会把 Eval 的修改夹带进 agent 的账。「创建又删除」或「改完又改回」也会丢失。持久 File Changes 不保存文件级 `net` 或 hunk。`fileChanged(path)` 与可靠的 `net` 都是读取面从轨迹派生的结果；agent 区间内发生过的改动不因 Eval 事后重写同一路径而消失。
- **导出按固定字节分段。** `workspace.diff` 用一条沙箱内命令完成**全部** agent 区间的路径枚举、文本 blob 读取与二进制尺寸统计，再把内部 payload 自动切成不超过 4,000,000 bytes 的分段。
  - manifest v1 原子发布，固定连续序号、每段长度与 Git blob checksum、总长度。Attempt 级 payload 最多 512 MiB、最多 135 段。
  - 宿主在读取任何分段前先验证 manifest 边界，再按序读取并逐段校验。缺段、重复、乱序、超限、checksum 错误或 trailing bytes 都使 runtime diff unavailable，并形成现有 `capture-failed` partial File Changes。
  - provider 往返量是 `O(totalBytes / partBytes)`，不按路径、send 区间或 blob 逐项调用，也不把大证据灌进命令 stdout。临时 manifest 与分段在成功或失败后都删除。
- 导出对 Sandbox 侧的全部要求是 git 与 POSIX shell 工具(分类账本身已要求 git),不要求 node、python 等运行时。

- **路径与区间上限。** 导出阶段单个 send 区间最多扫描 100,000 个路径；File Changes 最多保留 256 个 send 区间。v1 decoder 继续接受每个区间与整份 Attachment 最多 10,000 个 changes；新 producer 每个区间与整份 Attachment 只保留 1,000 个 changes。超过 producer 保留上限但未超过扫描上限时，collector 保存确定性前缀并写 `collection-cap-reached`，不能把 partial 证据报告为 diff unavailable。1,000 条只是不让 durable 文件变化轨迹膨胀，不承诺大文本最坏情况也满足空文件的性能门。
- **内容与 policy 上限。** 导出阶段单个 send 区间最多扫描 256 MiB 去重文本；File Changes 最多保留 20,000 个 blobs、128 MiB blob bytes 和 16 MiB payload JSON。完整 text revision 与单个 blob 最多 1 MiB。超过保留上限但未超过扫描上限时由 collector 省略后续 content 并写 partial limitation。归因 policy 的 `include` 与 `ignore` 各最多 256 项，每项最多 4,096 UTF-8 bytes。
- **固定截断顺序。** collector 先按 send sequence，再按同一 send 区间内 path 的 ASCII 字节序处理。达到任一采集上限时，它停止在第一个放不下的候选，不跳过该项去采后面的项。已捕获的安全前缀连同 `collection-cap-reached` limitation 写成 `partial`。
- **内容形态不偷换。** 二进制或超过 1 MiB 的 text revision 写为 `elided`，带 `binary` 或 `oversized-text` 原因与 byteLength；这本身是完整采集。content blob 碰到 collection cap 时，text content 写为 `omitted(collection-cap)` 并形成 partial。尺寸在传输前核算。内容被省略时，路径与状态断言仍可确定，依赖文本的断言如实成为 `unavailable`。

File Changes collector 对 Sandbox Attempt 适用时必须封口一个 Attachment。完整空轨迹写
`collection.state: "complete"`；导出、下载或内容校验失败，以及中断，写带安全前缀（可为空）和 limitation 的
`collection.state: "partial"`。它们都不能伪装成 `not-recorded` 或空变化。只有 collector 不适用于该
Attempt 时，family 才不写入并在读取时成为 `not-recorded`。

非 optional 的 diff 消费者需要未取得的部分时，对应 Assertion 的证据输入为 `unavailable`，并据此形成
`errored` Verdict。没有 required 消费者时，partial File Changes 仍持久保存，并在 origin Attempt 的
Observability diagnostics 留下安全问题。Runner 继续用已经取得的命令结果、事件与其它证据完成判定。

FileChanges 的持久读取只由 `available`、`not-recorded`、`unsupported` 或 `invalid` 四态表示；I/O 或权限失败在形成读取值前仍是 typed Record read error。
这条 required / supplemental 分界的单源在 [Assertion 证据与完整性](../../assertions/architecture/evidence.md#判定依赖与补充证据)。
- **作用域就是 workdir,刻意不扩大。** 全文件系统 diff 只有 Docker 有原生通道(容器层 diff),且只有路径没有内容、噪声大、做不了 send 区间归因,按 provider 分支还破坏[核心中立](../../../architecture.md);workdir 之外的世界($HOME、全局安装、PATH)不靠更大的 diff 回答,靠留存现场(见下节)。git 是唯一便携、增量、带内容存储、能支撑逐区间归因的引擎,这是选它的理由,不是历史惯性。

agent 归因之外,最终工作区仍完整可读:`t.sandbox.readText` / `runCommand` 看到的就是最终状态;留存现场(`--keep-sandbox`)保有完整的沙箱现场。在现场中可直接通过原生 `git status` / `git diff` 核对工作区修改，或由固定 Inspection operation 读取已封口事实。

这条链上每个实际执行的环节都被计时并封入 Attempt-owned Observability 的 timing collection：排队与创建分列、各 owner 的 before 逐条形成时间树，收尾段（Agent 收尾 / cleanup / `stop`）在判定口径之外单独计时。

Sandbox 创建成功后，core 只包装一次返回的中性 `Sandbox`。所有经四个公开 `run*()` 方法发出的调用自动挂到当时的 phase、command 或 turn 下。`sandbox.before.<owner>` 的依赖安装、`agent.install` 的 CLI 安装、Adapter runtime、workspace baseline/diff 与 callback after 的回存命令，都能继续展开到真实 shell。Provider 内部用 `runCommand` 转调 `runShell` 只算最外层公开调用一次，不重复计时。

runner 或 Sandbox 知道一段批量工作属于同一个逻辑动作时,在命令外再包一层 `operation` 语义节点。例如 `workspace.diff` 落一次 `export workspace diff` operation,其下是一条涵盖全部区间的批量导出 command 加一次导出文件下载,而不是每个文件各一条 `git show`。

`sandbox.create` 是特殊边界:此时 Sandbox 对象尚不存在,不能靠同一个包装器看到内部步骤。内置 provider 可把真实 SDK 请求、宿主命令或创建子步骤作为 `provider` 节点写入;第三方 provider 没提供细分时只落 `sandbox.create` 合计,不能为了树好看把 API 调用伪装成 shell 命令。Agent CLI 内部自行执行的工具命令也不经过 Sandbox 包装,它们由标准事件流写入,有 OTel 且 correlation 唯一时才在 turn 下显示耗时。

时间树的父级归属使用随 async 调用链传播的显式 timing context,不能用一个可变的“当前 phase/command”全局值——并行命令会串错父级。

runner duration 使用单调时钟,节点同时保存 attempt 内 `startOffsetMs`,从而恢复 sibling 的重叠关系。

命令只落有界脱敏摘要:env value 与 stdout/stderr 不进入 timing；script/argv 先按调用方通过 `CommandOptions.sensitiveValues` 登记的已知值精确替换，再截成 160 字符摘要。

敏感值只驻留 Attempt 内存，full/JSON 读面也不能还原；未登记自由文本不靠键名正则猜测。

operation 的 label 同样有界、脱敏,由拥有该逻辑工作的 producer 写入;展示层不能按命令文本猜业务分组。

这样「沙箱起了多久、before 哪条命令慢、Agent CLI 启动多久、超时死在哪一层、收尾卡没卡」都有数据可查。

阶段与时间树口径见 [Phase Timings](../../../engineering/benchmark/README.md)。`show --json` 与 [Insight](../../insight/README.md) 都通过 [Inspection](../../inspection/README.md) 的固定 operation 读取闭合 Observability facts。

核心固定的是这条调用链本身:Case 就绪后先按 occurrence schedule 满足 action 与 agent.install 循环,再打分类账 baseline；`test(t)` 中的普通上传、turn 和判分命令按源码顺序执行。agent diff 只保留 `send` 区间轨迹，区间外写入属于 Eval 归因。完整路径见 [Eval 用例 · 沙箱 coding 任务](../../eval/use-case/sandbox-coding.md)。

provider 的可写保证不止 `workdir`。
runner 要在 workdir 外的私有路径放沙箱侧运行时文件——OTLP 采集器、变更分类账——落点是系统临时目录,镜像必须让它对运行用户可写。
`/tmp` 不可写属于宿主运行条件缺陷，报错必须点名不可写路径与修法，不透传 SDK 的原始错误串。
它发生在必需的 ledger 等运行路径时仍是执行错误；只阻断 OTLP 接收器等 supplemental 证据时写 diagnostic 并继续，不能用宿主运行条件缺陷这一分类绕过证据依赖边界。

## 命令时限与实例寿命

单条命令未显式传 `timeoutMs` 时，上限从 Attempt deadline 的剩余量派生。云端实例寿命另有服务端安全上界，派生规则、无界 Attempt 默认值与标签通道统一见[复用寿命](../library/reuse.md#两种时间不能混用)。
理由与 [`timeoutMs` 的配置求值链](../../experiments/architecture/README.md)相同:时限在链外另有出处,症状就是「实验声明 20 分钟,命令在整 600 秒被另一层杀掉」——配置的值不生效,报错还落在离配置最远的地方。
用户代码显式给单条命令传更短的 `timeoutMs` 仍然生效,那是有意声明,不是默认值。

作者 cleanup 是独立的收尾阶段，每个 callback 使用 30 秒预算及新的 signal。cleanup 中的命令不继承已耗尽的 Attempt deadline；显式命令 timeout 仍由作者指定。该规则同样适用于 Eval Group 的 checkpoint 回存。

### 命令树与进程寿命

Sandbox 是主实例及伴随资源共有的生命周期边界，但不是每个子进程的隐式 owner。正常 `runCommand` / `runShell` 完成后，关闭 transport、PTY 或 provider session 不得顺带杀死命令有意启动的任务服务；这些服务是否跨命令或跨 Attempt 保留，由 Case、reuse 与 keep 契约决定。

异常路径相反：命令 timeout、取消、Attempt interruption 或 Agent runtime cancellation 时，Provider 必须在 Promise settle 前确认本次**受管命令树**已经终止。能按进程组 / job / cgroup 精确终止就只终止该树；无法证明时必须退休并停止整个 Sandbox。只关闭输出流、让孙进程继续运行，是取消失败而不是成功。

一次逻辑 send（含全部物理重试）只有在 Agent driver 与可能写 workdir 的命令树已终止或进入可证明静止态，且 ledger 与逐次 retry 的 Observability 条目已封口后才能 settle。正常 keep 可保留任务服务，但 Agent teardown 必须保证 driver 不能继续发模型请求；异常路径无法证明静止时，不能把 Case 标成可安全复用。

超时时,它所形成的 Observability diagnostic 与 `errored` Verdict 的归属必须可见。
diagnostic 写明三样：触发的是哪层时限（attempt deadline / 命令显式 `timeout`）、值多少、值取自四层中的哪一层。
报错行与机器侧 `attempt.get` / `attempt.trace`、人工侧 View detail 照实交付这三样，不打一个没有归属说明的 ✗。
provider 自身固有的会话上限(如 Vercel Sandbox 的 session 时长)不能静默充当默认值:deadline 超出它时在派发前就报告该约束,点名 provider 与上限值,不让 attempt 跑到一半被截。

Agent 的原生双向协议使用 provider-only `managedProcess` capability。它包含 argv/env/cwd、stdin bytes、单消费者 stdout/stderr 原始 chunk 流、closeStdin、wait 与 terminate。
它不是公开 `t.sandbox` 作者 facade，也不内建 JSONL、question 或 provider schema。

Docker 支持。E2B 的 2.31.0 `CommandHandle` 映射尚未通过安装后公开入口 E2E，因此与缺少双向字节流的 Vercel 一样显式拒绝，不把未经接管的实现声明成可用能力。
Vercel Sandbox 2.2.1 没有双向 stdin 与 raw output chunk，因此明确 Unsupported。
custom Sandbox 也明确 Unsupported。Agent setup 在写配置或启动进程前抛具名 capability error，不做鸭子类型探测。

managed process acquire 与 Attempt registry 登记是一个失败原子的步骤。登记或后续构造失败会立即有界 release。
正常顺序是 Agent 协议 shutdown/EOF → managed finalizer → Sandbox lifecycle/release。

Docker 的正常 finalizer 不停止容器。`setsid --wait` 把 Docker exec receipt 绑定到原生命令树，强制 terminate 只 kill 已确认的进程组。
身份不明或无法确认静止时标记需要退休，由 runner 的 Sandbox release fallback 收回整实例。
write、close、terminate 与 wait 都共享幂等 receipt；stdin 一进入 closing 就拒绝晚写。
output poll 在 exit、stream error、terminate fallback 与 Scope cleanup 路径清除。

## 留存(keep)与注册表

[`--keep-sandbox`](../cli.md) 的留存决策发生在 attempt 收尾链的最后一步。
Verdict 定稿后按档位提交：`failed` 档是不带值的 flag 的默认值，提交 `failed` / `errored` Verdict 对应的现场，包括被硬超时打断后形成的 `errored` Verdict；`all` 档提交全部 Verdict 对应现场。
此时其余收尾（Agent runtime teardown、已登记 cleanup、diff 采集）已经照常完成；若实例实际退休，已登记的 physical after 随后回存 checkpoint。

attempt 的最终 `locator` 在调度前已经由当前 `RecordWriteSession` 分配完整 `attemptId`，再以 scheme 1 的 SHA-256 前 60 bit 短别名编码；session 的 writer lock 只与其它 writer 互斥，不阻塞 reader。已进入 running 后取消或失败的 attempt 因而仍保留 ID；从未派发的 Planned attempt 不制造 Attempt。
因此登记项、run 收尾反馈与提交进 Record 的 Attempt 事实从第一次观察起就使用同一个 locator，没有留事后补写的时段。

沙箱的 Effect Scope 持有一个只在本 attempt 内可变的 release disposition,初始为 `stop`。attempt deadline 只中断 Scope **里面的 verdict-producing 工作 fiber**,把超时转换成 Observability execution diagnostic 与待写的 `errored` Verdict;它不关闭外层 Scope。Runner 随后仍在同一个 Scope 内执行有界 teardown、收敛 lifecycle 与 diagnostics,再调用 `commitKeepOrStop()`。

这样硬超时现场尚未被 finalizer 销毁,而 Ctrl+C 中断外层 Scope 时 disposition 仍是 `stop`,照常销毁。Scope release 最后按 disposition 执行:只有留存提交成功才跳过 `sandbox.stop()`。

留存提交严格按以下顺序,不能调换:

1. 把完整登记项原子写入持久注册表。一条 = `{ sandboxId, provider, evalId, attempt, experimentId?, locator, verdict, keptAt, workdir, enter?, expiresAt?, state, lease? }`,`state` 初值 `"alive"`(实例此刻还在跑);`lease` 是事后命令的互斥凭据(语义见 [CLI · 条目级 lease](../cli.md#niceeval-sandbox查看与销毁留存的沙箱))。
2. 写入成功后,才把 disposition 改成 `keep` 并从本次 run 的内存收尾集合移除。
3. 写入失败时保持 `stop`,写入 diagnostic,让 Scope finalizer 正常销毁;Attempt 不会伪造已留存的 Record 状态。
4. disposition 为 `keep` 时,Scope release 阶段执行 provider **suspend**(`sandbox.suspend` phase,其边界由 Observability timing 节点表达——e2b pause 的耗时随内存增长,不许藏在计时外)。成功后把登记项 `state` 更新为 `"dormant"`;失败时保持 `"alive"` 并追加 Observability diagnostic。现场仍被注册表管理、仍可 enter,只是没省下资源,**不销毁、不冒充 dormant**。suspend 与任何收尾步骤一样不反改 Verdict。

持久注册表是 `.niceeval/sandboxes/` 下的**逐条目文件**,不是多个 attempt 竞争改写的一份 JSON。

entry id 由 `provider + sandboxId` 做稳定散列;每条先写同目录临时文件、`fsync` 文件后 `rename` 成 `<entry-id>.json`,再 `fsync` 目录;不同 attempt 与不同 niceeval 进程不会互相改写。

留存实例的排查与销毁全面委托给原生成熟 Provider 工具（Docker CLI、Instabox CLI 等），自研管理命令已下线。

受支持的正常返回、异常、超时和 Ctrl+C 路径保持资源受控；无法拦截的进程 `SIGKILL` 或宿主断电留下的实例，由底层 Provider 的硬超时（Server-Side TTL）或标签筛选（如 `label=niceeval`）事后回收。

`nativeCommand` 是 provider 原生的进入命令，直接呈现给用户或 Coding Agent（如 `docker exec -it <id> /bin/bash` 或 `instabox ssh <id>`）；NiceEval 不自建中间终端代理或伪终端隧道，现场接入彻底委托给 Provider 原生 CLI。`expiresAt` 是现场可找回的截止时刻——provider 声明了保留期限才写(vercel 写,e2b pause 无限期保留则不写)。

各 provider 的留存语义——suspend 把现场转入该 provider **最持久的低成本形态(休眠)**,「留下」不等于「继续跑」:

- **Docker** —— suspend = `docker stop`:文件系统落盘持久、不占内存、跨 daemon 重启存活。创建容器时就不带 `AutoRemove`(留存意图必须在创建期传入),`stop()` 改为显式 stop + remove,行为等价。容器带 `niceeval.keep-candidate=true` 标签,正常 run 结束后该标签下只剩已登记的 kept 容器。强杀留下的未登记候选由[孤儿核对](#孤儿核对强杀路径的实例面回退)按运行标识收回。
- 停驻的容器不会自己消失,仍是唯一需要用户主动 stop 的 provider。两个否决项:`docker pause` 不用于留存(内存驻留,daemon 重启即失,反而更脆);`docker commit` 转镜像也不用(引入第二种要管理的资源面,停驻容器已给出同等持久性)。
- **E2B** —— suspend = `pause`:文件系统与内存整体持久化,暂停期间停止计费,现场无限期保留、可 `resume` 找回;没有自然过期时刻,`expiresAt` 不写。
- **Vercel Sandbox** —— suspend = `stop`:sandbox 默认持久,stop 自动打一次 Run 保存文件系统,之后经 `Sandbox.get` / `getOrCreate` 恢复(SDK 原生能力);内存态不保留,唤醒后进程要重新启动。`expiresAt` 写 `keptAt` 加上 Run 的默认保留期限——`snapshotExpiration` 默认 30 天(2,592,000,000ms,从 Run 最后一次使用起算),niceeval 不改写这个参数,默认值就是留存现场实际的保留期限。
- **Incus nested Docker** —— DestroyOnly，不参与留存。`--keep-sandbox` 与 `incusSandbox()` 组合在创建资源前报错。
- **`defineSandbox` 自定义 provider** —— 不参与留存。`niceeval sandbox` 刻意不加载 config / eval 模块,新进程只有序列化登记项,无法安全找回用户对象上的任意 `stopDetached` 函数;只删登记项又会违反「stop = 销毁」。因此 `--keep-sandbox` 与自定义 provider 组合在创建前报清晰错误。需要统一留存生命周期的 provider 应贡献为内置 provider;未来若引入可序列化、可审计的 detached cleanup 协议,再扩这条边界。

`Sandbox` 接口不因留存扩大:没有 pause / detach / keep 方法——「留下」不是沙箱的能力,是 runner 的一次调度决定。是否已停驻、何时过期或收尾成功与否只留在注册表，`phases` 无 `sandbox.stop` 条目。

## Sandbox 的可携带事实只用九个固定运行事实 family

Sandbox 不定义自己的可携带 schema。创建、before、复用和留存仍完整执行，但它们产生的可观察结果按内容封入既有 family：

| 内容 | owner 与 family |
|---|---|
| Adapter terminal Turn 与 usage | origin Attempt 的 Agent Turns |
| 每个物理 send 的 session、顺序与源码位置 | origin Attempt 的 Turn Contexts |
| Sandbox command manifest、结果与 stdout/stderr | origin Attempt 的 Sandbox Commands |
| provider 创建、before 与 lifecycle timing | origin Attempt 或 Run 的 Runner Activities |
| Runner diagnostic sink | origin Attempt 或 Run 的 Runner Diagnostics |
| agent 归因的文件变化 | origin Attempt 的 File Changes |
| 每个物理 send 的 source/timing join | Turn Contexts、Runner Activities 与 Sources 的 reader-side relation |
| source frame 或 build 输入所需的源码闭包 | origin Run 的 Sources |
| Assertion 的 result、coverage 与 Evidence refs | origin Attempt 的 Assertions |
| 超出有界命令摘要的大型具类型对象 | Attempt 或 Run 的 Artifacts |

provider 实例 id、复用池编号、承接序号、live / dormant 状态、workdir、URL、credentials 与 detached cleanup locator
都只属于运行期 Case 或留存注册表。它们不进入 portable Record，不能因读取历史 Attempt 而重建，也不能在恢复现场后补写。

读取一个已知 current family 只会得到 `available`、`not-recorded` 或 `invalid`。这三态描述已发布 closure
的可读性；unknown/future durable bytes 在 reader session 形成前返回 `unsupported-format`，I/O 与 permission
failure 仍是值形成前的 typed Record read error。schema 演进和 migration 只由
Record maintenance 安排，Sandbox 不建立 converter、group 或读取侧 fallback。

公开读取经过固定 Inspection operation 的闭合 result，而不是 Sandbox 直接暴露存储能力：

```sh
# `diff` 调用 `attempt.diff`，`execution` 调用 `attempt.trace`。
niceeval show @<locator> diff --json
niceeval show @<locator> execution --json
```

`history` 从 Observability 闭合 Sandbox 的命令、timing 与 diagnostics；`changes` 从 FileChanges 闭合归因文件事实。
Assertions 与 Sources 分别使用它们发布的 Evidence 与 source result。闭合结果不携带 reader、路径、provider
handle 或可再次写盘的回调。

## 孤儿核对:强杀路径的实例面回退

进程内的收尾集合与 Scope finalizer 顾及不到 `SIGKILL` / 宿主断电——没有任何代码来得及执行,正在跑的沙箱就地变成 provider 侧的无主实例。这条路径的回退不追求「杀不掉的进程也能收尾」(做不到),而是把「事后认领」做成可靠的机器动作:创建时把归属写进实例元数据,事后按归属核对与收回。

- **运行标识在创建期写入。** 每台沙箱实例创建时带运行标识元数据:`host`(宿主机名)、`pid`(runner 进程)、`startedAt`(Run 时刻)。Docker 用容器 label(与 `niceeval.keep-candidate` / provision token 同一机制),E2B 用 SDK `metadata`(与 provision token 同通道)。Vercel Sandbox 没有按元数据检索实例的通道,不参与孤儿核对——它的回退是 provider 自身的保留期限到期回收,这条差异如实写进公开文档,不伪装成全 provider 一致。
- **孤儿的判定是三条「与」**:带 niceeval 运行标识、不在留存注册表、且属主 run 已被证实死亡(标识里的 `host` 等于当前宿主机名,且 `pid` 探测不存活)。三条缺一不可:注册表里的 kept 沙箱是被管理的现场,不是孤儿;属主 run 还活着的实例属于并发运行中的另一次 run,绝不能收;`host` 不匹配或 pid 无法核对的实例标 `unverified`,列出但不自动销毁——误杀一台活实例的代价高于多留一台待人工确认,判定必须偏保守。
- **核对与收回依托 Provider 原生管理工具**:用户使用 Provider 原生命令（如 `docker ps -a` 查看状态，`docker rm -f` / `docker container prune` 销毁已核实孤儿）进行维护，不通过自建注册表伪造管理层。两个通道均走各 provider 的原生链路。
- **核对与收回按 case 的实例及伴随资源整体进行**:单 Sandbox 实例只有主实例;Compose 实例的运行标识写在 project label 上,伴随容器与网络随主实例整组列出、整组销毁。prune 是强杀与中断后唯一的官方收尾手段,case 新增资源种类(sidecar 容器、网络、volume、云端资源)时,把它接入孤儿核对词表是该 case 契约的一部分,不允许有 prune 看不见的残留。
- 实验级 `setup` 起过的外部资源(隧道、共享服务、license 席位)是同一强杀路径的另一半泄漏面,回退在实验面,机制见 [Experiments · 强杀后的收尾回退](../../experiments/architecture/README.md#强杀后的收尾回退收尾登记与启动自愈)。

## Docker provider(本地,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时移除)。
- **执行身份沿用镜像声明** —— 默认以镜像 `USER` 声明的用户跑命令(未声明按 Docker 语义是 root);factory `user` 替换整个 Sandbox 的默认身份,命令传 `{ user: "root" }` 时只这一条换身份(见 [Library · 执行身份](../library/README.md#执行身份))。npm 全局目录与 `PATH` 注入按实际执行身份的 home 定位,不硬编码 UID。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 到执行身份修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧拆分。
- **超时** —— 命令到点销毁流并报错;上限按[时限归属](#命令时限与实例寿命)从 attempt deadline 派生。

这条路径不把 Docker API 交给 Agent。
Agent 需要 `docker` / `compose` 时走 [Nested Docker](../../sandbox-nested-docker/README.md) 的 Incus VM。
`dockerAccess` socket / DinD 不是 adopted nested-Docker public path。

```typescript
const sandbox = await createSandbox({ provider: "docker", runtime: "node24", timeoutMs });
for (const file of workspaceFiles) await sandbox.writeBytes(file.path, file.content);
await sandbox.runCommand("npm", ["install"]);     // cwd 省略 → workdir
```

## Vercel Sandbox provider(云,可弹性扩并发)

需要 Vercel Sandbox 凭据;显式 env 变量路径是 `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的 session 生命周期,必要时 snapshot + rotate,避免长命令被 session 上限截断。
- provider 内部可以批量传输，但对外兑现同一组 `writeText` / `writeBytes` 语义，不暴露另一套批量命名。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种 provider 间切换。

## Incus provider(专用 kernel nested Docker)

Experiment 用 `incusSandbox()` 选择一次性 VM。
guest 执行身份是 `node` uid 1000，workdir 是 `/home/sandbox/workspace`，`otlpHost` 为 `null`。
guest 内运行普通 dockerd，不是 Docker-inside-Docker。
V1 DestroyOnly；requirement / capability、domain 与 doctor 见 [Nested Docker](../../sandbox-nested-docker/README.md)。

## E2B provider(云,微 VM)

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;`template` 由 `e2bSandbox({ template })` 声明,必填(见 [Sandbox Layer](../library/layers.md#template-bearing-factory)),不用 e2b 账号侧的默认模板。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`user` 直接透传 `commands.run` 的同名参数。
- `commands.run` 的 event stream EOF 不是直接 shell 的完成边界。正常 shell 已退出、但 `nohup ... &` 等任务服务仍持有 stdout/stderr 时，provider 采集前台输出与 exit code 后断开 transport；它不等待该服务退出，也不杀它。完成帧只接受 supervisor 在取得子进程状态后写出的十进制 exit code，wrapper 源码、转义诊断或子进程回显中出现的 marker 字面量都不是完成边界。timeout、取消、协议完整性失败或 interruption 仍退休整台 VM，避免未确认终止的命令树进入 reuse / keep。
- 文件用 `files.read` / `files.write`(文本 + 二进制)。
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作说明。要 node24 / 烘焙好 agent CLI,用预制模板 `e2bSandbox({ template: "niceeval-agents" })`——参数的典型用途正是把 agent CLI 烘焙进模板,让后续 eval 跳过安装直接开跑(构建工作流见 [Library · 预制实例](../library/prebuilt-environments.md))。
- Before cache 的 Base 身份是 template 引用当前指向的 build，而不是 template 名字；同名 template 重建会产生新 build，旧前缀不得命中。规则见 [远端 snapshot Before cache · E2B](remote-snapshot-cache.md#e2b)。

## OpenSandbox provider

OpenSandbox provider 通过服务 API 将一个远端 Sandbox 绑定到现有 Attempt resource group；创建、命令、文件与销毁均由 provider 持有，Runner 不按名称分支。公开声明见 [Library](../library/README.md#opensandbox)。Docker、Kubernetes 等 runtime 由 OpenSandbox 服务端选择，不进入 NiceEval 的选项、计划 identity 或准入判断。服务部署和隔离策略归基础设施；provider 不从 runtime 名称推断专用 kernel 或 DockerExecution。

`openSandbox` 使用官方 `@alibaba-group/opensandbox` SDK，依赖延迟加载。连接地址和 API key 从 `OPEN_SANDBOX_DOMAIN`、`OPEN_SANDBOX_API_KEY` 读取，API key 只进宿主 transport，不进入 identity、镜像变量集合或命令。

所有请求使用 server proxy 并保留 SDK 返回的 endpoint 路由与认证 header。当前接入使用服务代理，不要求 execd 的 secureAccess；服务必须使用仅可信宿主可访问的私有入口，或在 HTTP/WebSocket 全路径前置鉴权。控制 API key 本身不能保护上游免鉴权的 proxy 路由。禁用 SDK create telemetry。目标平台由声明显式给出，不能从宿主架构推断远端镜像。

起点是 image，工作目录为 `/home/sandbox/workspace`。发布 identity 包含 image、目标平台、资源限制、user、pathPrepend 与 lifetimeMs；连接与凭据不构成可分享内容。单实例只有一个销毁 owner。创建不自动重试歧义结果；获取实例后立即登记 Scope finalizer，ready 或工作目录初始化失败也销毁。作者必须显式声明有限的 lifetimeMs，实例仍随 Scope 关闭；该寿命不得短于 Attempt 剩余时限与 30 秒收尾预留。有限寿命负责客户端崩溃后的最终回收，不替代取消确认。服务拒绝该寿命时保留真实失败，不静默缩短。

每次创建携带随机 provision token。创建失败后按该 token 查询并销毁已分配的实例，不接管其它请求。服务仍在处理但尚未返回的分配无法由一次查询排除，有限寿命约束这种未知状态；查询或销毁失败与原始创建失败一并报告。

服务必须在销毁成功响应前终止实例及其进程，provider 才能将该响应作为回收确认。只返回异步删除受理或控制对象消失的服务不满足该契约，须在服务接入验收时验证；调用方声明 runtime 字符串不能替代这项证据。

命令经原生 argv 执行，shell 明确为 `bash -lc`；cwd、env、身份与 PATH 由 provider 归一化。非零退出返回实际 exitCode，缺失终态不能伪装成功。超时、取消或命令流中断时销毁整个实例，并等待销毁确认后结束命令；这使跨命令后台任务无法在失联后继续执行。正常命令结束保留后台服务。文件接口复用统一 transfer 语义，文本与字节不混用。

保留、暂停与复用报告 Unsupported / DestroyOnly；rootfs Before cache 见 [远端 snapshot Before cache · OpenSandbox](remote-snapshot-cache.md#opensandbox)。受管双向进程通过下述 pipe 桥接兑现；镜像必须提供 Node.js 22 或更新版本。缺少运行时直接报错，不能退化成单次 shell。验收检查 argv 注入、非零退出、二进制与目录往返、超时及取消后实例不可访问、创建后初始化失败回收、独立实例隔离和凭据不进入 sandbox。

### OpenSandbox 受管进程

交互 adapter 使用 execd 的 `/pty` WebSocket pipe 模式，不能使用会合并 stderr 或回显输入的 PTY 模式。provider 通过同源 server proxy 取得 endpoint 和认证 header；连接地址必须与控制服务同源，不把控制凭据转交第三方 endpoint。

镜像内 Node 24 作为 provider 的字节桥接运行时。桥接进程启动独立 process group 的目标 argv，stdin 协议显式区分写字节、关闭 stdin 和 terminate；stdout/stderr 以 base64 frame 分离传输。每次写入确认在目标 stdin 的 write callback 后返回，EOF 在 end callback 后确认。桥接协议不进入公开 API，也不把 stdout 当作 JSONL 文本命令输出来重新分词。

目标退出或 terminate 后，桥接先 KILL 同一 process group，并从 Linux procfs 确认没有非 zombie 成员，再发布目标 exitCode/signal。确认超时、桥接错误、WebSocket 意外关闭或缺少完整终态时退休整个 Sandbox。正常完成后删除 PTY session；资源关闭可重入，失败必须保留 Provider finalizer 失败事实。Node 缺失时返回明确启动失败，不能报告交互能力已经可用。

## Instabox snapshot Provider

`instabox.ts` 拥有纯配置校验、template identity 和 Provider plan；`instabox/` 拥有 HTTPS 协议解码、Machine 资源、SSH 命令与文件传输。Runner 继续只使用统一 Provider 契约，不按 Instabox 名称分支。

固定服务 origin、snapshot ID、Provider revision、Linux x64 GNU 平台、显式寿命、规范化资源和 PATH 前缀组成 identity。Machine ID、创建幂等键、SSH token 与 API key 不参与 identity；不同 snapshot ID 保守地视为不同 Sandbox 起点，不声称内容等价。配置求值不访问网络。

`materialize` 先验证 snapshot 的具体 ID 与 ready 状态，再以唯一幂等键创建 Machine。请求禁止自动 Vault 或 Org Secrets 注入，明确设置 delete deadline、资源与禁用自动暂停。收费计划必须允许这些设置；拒绝不能降级为可能暂停的机器。创建返回 operation 后，立刻登记资源回收，再等待 operation succeeded 与运行就绪。创建响应失联时只用相同幂等键重取受理结果，不发起第二次逻辑创建。无法取得身份时报告无法确认回收，服务端 delete deadline 是最后上界。

每个 Machine 的 Scope 拥有一次删除职责。失败、取消与正常退出均调用 DELETE，附带确认 ID 和稳定删除幂等键，等待 operation succeeded。已有 operation 冲突时等待其终态后再删除；404 表示资源已不存在。删除失败保持未回收状态并传播错误，不能先标记成功。Snapshot 不由 Attempt Scope 拥有。

HTTPS API 返回值在边界通过 Schema 解码；错误只交付 HTTP 状态、服务错误 code，不转交可能回显凭据的响应正文。默认请求有有界传输超时，资源等待由 Attempt deadline 或显式 lifetime 限制。回收使用独立有界时限，不继承已取消的 Attempt signal。

SSH token 仅由已认证 HTTPS 获取，并以响应中的 SHA256 host key fingerprint 校验 SSH gateway。每台 Machine 只持有一条 SSH 连接，命令与受管进程各占其中一个 channel；连接启用 keepalive，禁用 PTY，stdin 与两个输出流保留原始字节。连接在第一次需要时建立，随 Machine 的 Scope 关闭。一条命令的固定开销是一次 channel 往返，不含握手：同一台 Machine 上连续 20 条 `true` 的总耗时不得超过单条耗时加 20 次往返，验收按这个关系断言，不写死毫秒数。

Sandbox 内 Node supervisor 以 argv 启动目标进程，显式设置 cwd 与 env；参数不作为 shell 源码解释。受管 shell 只在 `runShell` 时选择 Bash。默认非 root 身份来自 snapshot，root 命令由免密 sudo 进入同一 supervisor。

supervisor 不依赖 SSH 会话存活。它为每个进程在 Machine 上建一个只属于该进程的 spool 目录，把 stdout、stderr 按原始字节追加写入各自的文件，进程结束后原子写入退出文件（退出码或信号）。channel 只是这些文件的读取端：客户端保存每个流已经交付的字节偏移，读到退出文件之后进程才算结束。

stdin 同样按偏移交付。supervisor 把已经写进目标进程管道的 stdin 字节数持久化在 spool 里，EOF 是否已送达也在其中；客户端保留尚未被确认的字节，收到确认后才丢弃。Agent 驱动进程这类全程开着 stdin 的双向进程靠这一条跨过断线：它运行时间最长，丢一次就是整个 Attempt。普通命令的前台进程结束后写入退出文件，不等待后台服务继承的管道关闭；有意启动的独立服务继续运行。

连接断开不等于进程丢失。连接或 channel 异常时，Provider 在 60 秒内最多重连 3 次，重连成功后从已交付的偏移继续读取同一个 spool，并向 supervisor 取回已接收的 stdin 字节数，从该偏移补发未确认的字节与 EOF。调用方看到的输出不重复、不缺失，目标进程收到的 stdin 不重复、不缺失，命令事实只有一条。同一台 Machine 上的全部进程共用这一次重连。重连期间命令自己的时限照常计时。以下情况才退休并删除整台 Machine，等待确认后再 settle：

- 重连次数或时限用完；
- 重连后 spool 目录或 supervisor 不存在；
- 命令超时或取消。

退休时抛出的错误写明触发原因（keepalive 超时、连接被对端关闭、channel 错误、握手失败等 ssh 层给出的原因）、重连次数、进程已运行时长和已交付的字节数，随 Attempt 的 failure diagnostic 保存。错误文本不含 token。成功重连写一条 `sandbox-transport-reconnected` Observability diagnostic，带同样的原因与次数，不改变命令结果与 Verdict。Machine 因传输失败退休之后，对同一个 Sandbox 的后续命令与文件操作都以这次退休的原因失败，不把服务端返回的 404 当作首要错误交给调用方。正常退出只归还 channel。外层 Scope 最终删除实例，包含其余后代进程。

文件使用原生 HTTP bytes 接口。目录上传把整棵目录打成一个归档，经一次 HTTP 写入送达，再用一条命令展开并一次设好全部权限位；命令条数与目录里的文件数、目录数无关。目录下载同样是一条归档命令加一次 HTTP 读取。归档展开失败按命令失败处理，不留下只展开了一部分却报告成功的目录。Provider 只将文件不存在解释为 false；权限与传输失败继续抛错。reuse、retention 与 Nested Docker capability 都明确 Unsupported，不以快照存在推定这些能力；Before cache 见 [远端 snapshot Before cache · Instabox](remote-snapshot-cache.md#instabox)。

验收由安装后的公开入口驱动：校验非法配置、从固定 snapshot 创建实例、读写二进制文件、argv 特殊字符、非零退出、流式输出、双向 Agent 进程、取消与正常收尾。使用真实 API 读回 Machine 不存在和基础 snapshot 仍 ready，并回收验收专属快照。命令超过 600 秒的支持由无 HTTP exec 的传输路径保证，长时实际运行另行按成本执行。连接复用、断线续读与目录传输另有四条验收：

- 同一台 Machine 上连续命令的耗时关系。
- 命令运行中由测试从客户端一侧强行断开 SSH 连接，命令仍以原退出码结束、输出逐字节完整，并留下 `sandbox-transport-reconnected`。
- 一个持续读写 stdin 的双向进程在两次写入之间被断开，重连后对端收到的字节序列与发送的完全一致，EOF 只送达一次。
- 上传一棵含多层目录与可执行文件的目录后，Record 里只有一条展开命令，权限位读回一致。

## Provisioning 失败与重试

`createSandbox()` 跨网络调用 provider 控制面,失败按两个维度分类:**性质**(瞬时还是确定性)决定要不要重试,**后果**(远端是否可能已经创建了实例)决定能不能直接重试。

**性质**:瞬时失败的本质是"再等等就好"——限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)与传输层瞬时错误;确定性失败是"配置就是错的"——模板不存在、凭据缺失、权限不足,重试没有意义,识别出即第一次抛出。两个方向的误判代价不对称:把瞬时误判成确定性,一个本可自愈的 attempt 被白白判死;把确定性误判成瞬时,只多花封顶的退避时间,最后仍如实抛出原始错误——只慢不错。分类器因此偏向宽认瞬时,并接受有界的误判代价(存在把确定性错误包装成 5xx 文案的 SDK,反例见 memory 的 sandbox-provision-ratelimit-retry 条目)。

**后果**:同为瞬时,重试的安全性完全不同——

- **拒绝类**(请求确定没被受理):限流响应、连接建立失败(DNS 查询失败、连接被拒、TLS 握手失败)。
- **歧义类**(请求可能已被受理、只是响应丢了):响应中途的连接重置(`fetch failed`、`other side closed`)、请求超时、5xx。

这个分类描述的是**单个请求**,而被重试的单元是 provider 的整个 `create()`——它通常不止一个请求:SDK 创建调用之后还有初始化步骤(E2B 备工作区目录;Docker 启动容器、补装基础工具、修工作区属主)。一个被归入拒绝类的 429 完全可能来自实例已创建成功之后的初始化请求,「拒绝类 ⇒ 远端没有实例」对闭包整体不成立。盲目重试会在远端积累没有任何一方持有 id 的实例——泄漏计费资源,也打破[「不留无主沙箱」](#留存keep与注册表)的不变量。防泄漏因此是两道独立的防线:

- **kill-on-failure(provider 义务)**:`create()` 内部一旦拿到实例句柄,后续任何失败都先尽力销毁实例再抛出原始错误(销毁本身失败不掩盖原始错误)。这条与分类、与是否重试都无关——句柄在手,销毁就是 `create()` 自己的责任,不可重试的失败同样适用。
- **重试前对账(重试层义务)**:每次 create 请求把一次性 provision token 写进 provider 原生元数据;有检索通道的 provider,**任何重试之前都按 token 检索远端**,查到的实例先销毁再重建,不区分拒绝类还是歧义类。分类器看不出错误落在闭包内哪个请求上,一次检索的成本远低于一台漏杀实例的计费。不做断线收养,重建比重连语义干净,冷启动成本本来就要付。对账排在退避睡眠**之后**:限流场景下紧跟失败发出的检索大概率同样被限流,睡醒再查;这也给刚受理的实例出现在列表里留了时间。**对账失败即放弃重试**,抛回原始 create 错误并留 diagnostic——对账是重试的硬前置,查不到账就重试与盲重试无异。

provider 没有按元数据检索实例的通道时:拒绝类直接指数退避重试(封顶次数 + 抖动),安全性由该 provider `create()` 的单请求形态或 kill-on-failure 保证;歧义类不重试、第一次抛出——宁可判死一个 attempt,不留一台计费的无主实例。

分类分两层,都留在 sandbox/ 内、不外泄到 Adapter / Runner。
各内置 provider 先把自己 SDK 原生的限流错误(e2b 的 `RateLimitError`、vercel 的 `APIError{ response.status: 429 }`、docker 拉镜像时 message 里的 `toomanyrequests`)归入拒绝类。
provider 没认出的错误再过一遍与文件 IO 重试共用的保守瞬时分类器(见下节),由错误形态落进拒绝类或歧义类。

各内置 provider 的对账通道与重试面:

- **Docker** —— 容器创建时即带 provision token label(与留存候选的 `niceeval.keep-candidate` 标签同一机制),对账 = 按 label 查询本地容器、force remove(容器已不存在视作对账完成)。create 闭包在容器创建后还有 start、基础工具安装、工作区属主一串 exec,这些步骤失败由 kill-on-failure 直接 force remove。拒绝类主要是拉镜像限流(发生在容器创建之前)。
- **Docker Compose** —— build 与 up 都复用同一套瞬时分类和退避。build 以同一 BuildKey 重建即可收敛。
- up 的 projectName 与 overlay 在整个重试闭包内固定，每次重试前先对同一 project 执行独立于 Attempt signal 的有界 `compose down --volumes --remove-orphans`，清掉半启动服务后再 up。
- 附着主服务后由 Docker provider 探测分类账所需的 git；题目镜像没带时以 root 通过已有的 apt/apk/dnf/yum 补齐，而不是要求每条 Eval 修改 Dockerfile。
- 整个 case 最终仍由主实例及伴随资源的 finalizer 回收；即使前向工作已经 timeout/cancel，finalizer 也拿新的 8s cleanup signal。
- 只有真实回收成功才解除 registry 所有权；失败追加 `sandbox-stop-failed` Observability diagnostic、保留 project labels 供同轮强清重试或原生 CLI 工具事后回收，不改写原 Attempt 的 Verdict。
- **E2B** —— create 经 `metadata` 打 provision token,对账走 SDK 实例列表的 metadata 过滤,查到即 kill(实例已不存在视作对账完成)。创建成功后的工作区准备命令失败由 kill-on-failure 先 kill 再抛。真实跑分中两类都出现过:`Sandbox.create` 阶段的 `fetch failed · other side closed`(歧义类),与创建成功之后初始化请求撞 429 被归入拒绝类(反例见 memory 的 e2b-provision-429-duplicate-sandbox 条目)。都由重试前对账兜住。
- **Vercel Sandbox** —— create 是单个 SDK 调用、没有初始化尾巴。SDK 对 429 已内建多次退避重试(读 `Retry-After`),外层对拒绝类的封顶次数相应收窄,避免「外层次数 × 内层次数」在请求量和退避时长两个维度同时放大;SDK 没有按元数据检索实例的通道,歧义类第一次抛出。

重试循环由各内置 `ProviderModule<Plan>` 自己拥有。
`runtime.ts` 只调用 plan 私绑的闭包，不维护 adapter registry:

- 退避睡眠期间临时归还并发名额(`retry.ts` 的 `ProvisionSlot`),睡醒后再排队要回来。在退避的 attempt 只是在等,不该攥着 `sandboxSem` 的名额陪跑 `setTimeout`,不然一批 429 会把整批实际并发拖成远低于 `--max-concurrency` 声明值的个位数。
- 重试全部耗尽后仍按原语义形成 `errored` Verdict(基建问题,不是 agent 表现);对账中销毁的实例不额外报错,只留 Observability diagnostic。

**对外的空间轴映射**:内部的两维分类不外泄,但确定性配置死因向 attempt 层浮出时附带[执行失败分类](../../error-classification/README.md)的 `scope`,由失败熔断消费。判据仍是可证明性,按死因的配置声明位置定档。凭据缺失、权限不足来自实验级配置,附带 `scope: "experiment"`。模板不存在按 template owner 定档。Experiment 是 template owner 时,同一模板由它选中的全部 Eval 共享,附带 `scope: "experiment"`。Eval 是 template owner 时,同因必死只能证明到共享同一模板的范围,词表里可证明的档是 `scope: "eval"`——错杀健康模板的 eval 比多撞几次死模板更贵。

瞬时失败重试耗尽后不附带 scope:死因不可证明为兄弟共享。

Provisioning 的分类只涵盖"创建沙箱"这一步。沙箱创建成功后被 provider 终止属于 lifecycle failure,不能当成同一个实例里的普通 IO 失败继续重试;应保留明确终止原因,由 attempt 层决定是否允许重新创建整个 Sandbox。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 已创建 Sandbox 的文件 IO 重试

所有 provider(含 `defineSandbox`)返回的 Sandbox 都经过同一个包装层。包装层只对固定目标的幂等文件操作做默认重试:`readText`、`readBytes`、`pathExists`、`writeText`、`writeBytes`、`uploadFile`、`uploadDirectory`、`downloadFile`、`downloadDirectory`。目录传输即使只完成一部分,重跑仍写入同一组目标路径。

默认最多 3 次,指数退避并带抖动。只有传输层的瞬时错误进入重试:429、5xx、`fetch failed`、连接重置、临时 DNS / 网络不可达。文件不存在、权限错误、路径错误、取消、Sandbox terminated 都第一次抛出。`pathExists` 遇瞬时传输错误必须继续抛出,不能伪装成 `false`。

`runCommand`、`runShell`、`appendLog`、`stop` 永远不隐式重试:框架不知道命令在失败前产生了哪些副作用。需要重试命令时由调用者把幂等性写成显式业务策略。IO 重试全部耗尽后抛回原始 error,让 attempt 保存错误链与 partial evidence。

## 再接一个 provider

两条路,取决于新 provider 是不是打算贡献回 niceeval:

- **贡献进 niceeval**：实现 `Sandbox` 接口、template-bearing factory 与只读 `ProviderModule<Plan>`。接口包含 `create()`、`workdir`、run、文本/字节读写、stop 与宿主传输。路径定位复用 `src/sandbox/paths.ts`。factory 用 Provider 原生纯数据声明起点；module 的 build/create 闭包消费同一 typed Plan。完整义务见 [Case](case.md)。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](../library/README.md#自定义-providerdefinesandbox),身份与留存义务见 [Case · 自定义 case](case.md#自定义-case)。

**核心定义接口，Provider 各自实现**，两条路都不改 core 其余部分。Sandbox 抽象只保留 run、文本/字节读写、stop 与宿主传输，让新 Provider 的接入面保持有限。

内置 provider 除接口外还要交付两个故事:预制实例(factory 消费的构建输出参数、构建归原生工具、共享/过期语义如实文档化,义务清单见 [Library · 新 provider 的预制实例义务](../library/prebuilt-environments.md#新-provider-的预制实例义务))与留存(detached 销毁能力,见[留存与注册表](#留存keep与注册表))。

## 实现纪律

路径定位规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置 provider 共用;不允许每个 provider 各自复制一遍 `startsWith("/")` 判断。规则有多份实现,就会有 provider 悄悄不一致。`defineSandbox` 自定义 provider 只需声明自己的 `workdir` 字符串即可获得同一套行为。

不要硬编码 `/workspace`——它不是任何 provider 的真实 workdir,按它写的文件会落在 agent cwd 和变更分类账之外(agent 看不见、diff 采不到)。写法是省略 `targetDir` / `cwd`,需要绝对路径时用 `sandbox.workdir`。

包装或装饰 `Sandbox` 实例(路径归一化、日志代理这类中间层)时，只转发正式接口：`SandboxOperations`、宿主传输、`stop()` 与可选 `appendLog()`。留存不藏在 `Sandbox` 的动态成员上，而是 Case creation 单独返回 `SandboxRetention`；wrapper 因此不可能把 suspend/wake 能力静默吃掉。

provider 原生 SDK 的其余未知方法不属于公共契约,不承诺透传——需要新能力时显式建模成接口成员或 case 能力句柄,不开 `sandbox.native` 逃生口(裁决见 [memory 条目](../../../../memory/sandbox-native-escape-hatch-rejected.md))。

## Before cache

Before cache 的身份、Provider 能力矩阵、降级规则与运行事实归属见 [Before cache](before-cache.md)；E2B、OpenSandbox 与 Instabox 的远端 snapshot 契约见 [远端 snapshot Before cache](remote-snapshot-cache.md)，持久账本见 [Data Model](../data-model.md)。

## 性能:预制实例、Sandbox 复用与 Sandbox 预热

沙箱冷启动和重复安装是关键路径上的大头。优先级如下:

1. 把稳定重依赖做进 Docker image、E2B template 或 Vercel snapshot;每次 attempt 只从这个起点创建。
2. layer 的 `before()` 按 typed inputs 自动编译 attempt occurrence；稳定重动作形成靠前的 prefix，频繁变化的配置形成靠后的 prefix。运行期资源成功取得后用 `context.onCleanup()` 登记释放。
3. 仍有必要时再考虑 Sandbox 预热或 Sandbox 复用。

- **Sandbox 预热** —— 按近期派发量提前创建 Sandbox,Attempt 到来时直接领取,把创建移出 Attempt 路径。
- **Sandbox 复用** —— Experiment 的 `sandboxReuse: true` 让多条 Attempt 共用 Sandbox。
  Case create / ready 每个实际实例满足一次；before、agent.install 循环与 Agent runtime 每 Attempt 满足一次。before 缓存命中 restore verified state，miss 或 unsupported 才调用 action。
  派发前确认 Sandbox 复用寿命,不足时续期或更换 Sandbox。
  完整契约见 [Sandbox 复用](../library/reuse.md)。

预制实例的构建与发布归项目和 Provider 原生工具；NiceEval 的 template factory 参数负责消费（工作流见 [Library · 预制实例](../library/prebuilt-environments.md)）。
Sandbox 预热与 Sandbox 复用是 [Runner](../../../runner.md) 的调度职责。

## Docker-owned cache inventory projection

Docker cache repository 以单个只读 inventory operation 在同一 transaction snapshot 中列出 task-build 与 before-cache entry 及其 active lease 与 hold。该 operation 不做 startup reconcile、lease prune、provider mutation 或 GC planning。Docker administration 再复核 task-build image identity，并把两类 entry 投影为以 `kind` 判别的公开联合；Before cache 只采用 registry 已有 state，不因 inventory 改变 generation 或索引。

公开 identity 只包含定位 artifact 所需的 task build key/tag/image id，或 before-cache entry id/key/image/base image id；计数只聚合 entry-local lease 与 hold。holder、operation lineage、声明正文和 GC lock 留在 repository 内部。Before cache 的公开归属不扩大 GC：现有 task-build plan/apply 是唯一删除入口。

## 相关阅读

- [README](../README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](../library/README.md) —— 使用侧 API：路径、root、before action、自定义 provider。
- [Before cache](before-cache.md) 与 [远端 snapshot Before cache](remote-snapshot-cache.md) —— 前缀身份、Provider 能力与远端 snapshot 契约。
- [Data Model](../data-model.md) —— 远端 snapshot 账本。
- [Nested Docker](../../sandbox-nested-docker/README.md) —— requirement、Incus VM、DestroyOnly 与 doctor。
- [Runner](../../../runner.md) —— 预热与复用的调度职责。
