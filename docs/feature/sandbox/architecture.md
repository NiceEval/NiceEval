# Sandbox —— 架构

内置 provider 的实现要点、沙箱在 attempt 生命周期里的确切位置,以及给贡献者的扩展路径。使用侧的 API 见 [Library](library.md)。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心固定住各个钩子**的调用顺序**,每个钩子**内部做什么**交给 sandbox spec / eval / agent 各自的作者:

```text
 createSandbox(provider, timeout)
  → sandbox.setup?.(sandbox, ctx)          # 环境层:experiment.sandbox 链上的 .setup() 钩子(可能多个,按追加顺序);没挂就跳过
  → workspace baseline                     # 变更分类账的锚点 commit(runner 私有 git ledger,见下节)
  → EvalDef.setup?.(sandbox, ctx)          # 这条 eval 的任务 Fixture(如果定义了);ctx 绑定 eval.setup feedback
  → SandboxAgent.setup?.(sandbox, ctx)     # agent 自己的一次性预置(装 CLI / 写主配置)
  → test(t)                                # ← 交给 eval 作者,顺序由它自己决定:
  │    t.sandbox.writeFiles(...) / uploadFiles(...) / uploadDirectory(...)  # 默认落到 workdir;eval 归因
  │    t.send()                              #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events);send 窗口内的变化归因给 agent
  │    t.sandbox.runCommand(...)             #   手工跑校验命令,cwd 默认 workdir(可以晚于 t.send(),agent 天然看不到,也不进 agent diff)
  │    断言…                                 #   t.sandbox.fileChanged / t.sandbox.diff 读 agent 归因增量 / t.check(commandSucceeded)
  → workspace.diff                         # 从分类账折叠 agent 归因增量(见下节)
  → scoring.evaluate → telemetry.collect   # 断言 finalize + 判定(judge 调用在此)、trace 收口
  → EvalDef.setup 的 cleanup               # finally:eval 级收尾先跑
  → SandboxAgent.teardown?.(sandbox, ctx)   # finally:agent 级收尾
  → sandbox.teardown?.(sandbox, ctx)        # finally:环境层收尾最后跑,销毁前——回存跨 attempt 状态用这个时机
   → commitKeepOrStop()                     # verdict 已定稿,命中时原子登记后留存;否则 sandbox.stop()(见下)
```

这条链的阶段词表以 [Results 的 `LifecyclePhase` 闭集](../results/architecture.md#resultjson)为唯一权威,本节只描述沙箱切片。环境层钩子排在最前、也收在最后,不是任意选择:它准备的是**环境**(装二进制、预热模型、写 hook 文件),不是这条 eval 的任务材料,必须先于分类账锚点跑——像镜像构建先于代码挂载——环境产物因此不进入任何归因视图。teardown 顺序对称颠倒:eval 级 cleanup 先跑,agent 级收尾其次(它可能还要用沙箱做收尾动作,比如导出 transcript),环境层收尾最后跑、销毁前一刻——这个位置正好用来把状态回存到沙箱外部。整个收尾段发生在判定之后,只能追加 diagnostic,不能反改 verdict——若某个步骤决定结果正确性,它就不是收尾,应写进 `test(t)` 主链。

## 变更归因:send 窗口与分类账

`t.sandbox.diff` / `fileChanged` / `fileDeleted` / `notInDiff` 回答的是「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。归因由 runner 的**变更分类账**(私有 git ledger)提供:

- **分类账在沙箱内、workdir 外。** ledger 的 git 目录放在 runner 控制的私有路径,以 workdir 为 work-tree。workdir 保持素净——agent 看不到 runner 的 `.git`,eval 需要真实 git repo 时自己 `git init`,agent 在 workdir 里的任何 git 操作都碰不到分类账。
- **三类 commit 时点。** 锚点一笔(`workspace.baseline` 阶段,环境层钩子之后);每次 `t.send()` 进入前,workdir 有未记录变化就落一笔 **eval 归因**(fixture 写入、`EvalDef.setup` / `SandboxAgent.setup` 的落位、`runCommand` 副作用都在这类);`t.send()` 返回后落一笔 **agent 归因**——这个 **send 窗口**内的全部 workspace 变化。
- **沙箱型 send 串行,窗口不重叠。** 同一 workdir 上重叠的 send 本身就是写入竞争,合并窗口只会掩盖归因不确定性——sandbox 型 session 的 send 经 workspace 信号量串行执行,remote agent 的 send 不受此限。配套的 Adapter 义务:`send()` 返回时,Agent 侧可能写 workdir 的进程必须已退出、或已进入**可证明不再写 workspace 的静止态**(HITL waiting 的典型形态:CLI 进程还挂着等输入,但已停在请求点、不会再动文件)——后台残留写入会落在窗口外、被错记成 eval 归因。
- **归因排除清单,runner 私有、锚点时冻结。** 默认在任意目录深度排除 `.git`、`node_modules`、`__pycache__`、Python 虚拟环境(`*venv*/`)、常见构建产物与包管理器缓存——不排除的话,`EvalDef.setup` 里一次 `npm install` 或 agent 自建一次 venv 就会让分类账哈希成千上万个依赖文件,后续窗口的二进制与缓存变化持续放大 object 库。`diff.ignore` / `diff.include` 使用 workdir 根的 gitignore 风格 glob：无 `/` 的 pattern 匹配任意深度的同名项，含 `/` 的 pattern 从 workdir 根匹配，尾 `/` 表示目录。清单在锚点时冻结,agent 或 fixture 写 `.gitignore` 影响不了它(项目自己的 ignore 规则也**不**参与归因判断——被项目 ignore 的文件照常记录);eval 要评分被排除目录时经 `defineEval({ diff: { include: [...] } })` 显式加回,`diff.ignore` 追加排除。
- **nested Git repository 不得变成证据盲区。** 私有 ledger 发现索引 mode `160000`（submodule / nested repo 的 gitlink）立即让当前阶段报执行错误，并列出路径与修法：被测 checkout 应直接位于 `workdir` 根；确实不参与评分的 nested repo 应由 `diff.ignore` 整体排除。只打印 Git warning 后继续会让 repo 内普通文件修改从 agent diff 静默消失，禁止这种降级。
- **agent 归因增量 = 逐窗口 delta 序列,不做跨窗口压缩。** `workspace.diff` 阶段从分类账导出每个 send 窗口自己的 before/after,按时序落盘为 `diff.json`(形状见 [Results · diff.json](../results/architecture.md#diffjson))。不压成单一 before/after 是硬约束:窗口之间可能夹着 eval 写入,压缩会把 eval 的修改夹带进 agent 的账;「创建又删除」「改完又改回」也会被压没。文件级摘要(`net` / 触及窗口)与 `diff.get(path)`(最后触及窗口的终态)都是读取面从窗口序列派生的视图,agent 窗口内发生过的改动不因 eval 事后覆盖而被抹掉。
- **导出往返是常数次。** `workspace.diff` 用一条沙箱内命令完成**全部** agent 窗口的路径枚举、文本 blob 读取与二进制尺寸统计,结果写进沙箱内的导出文件,宿主经文件通道一次下载并在宿主侧解析校验——provider 往返数与窗口数、文件数都无关,不能退化成逐文件或逐窗口的远端调用,也不把大证据灌进命令 stdout 通道。导出对沙箱环境的全部要求是 git 与 POSIX shell 工具(分类账本身已要求 git),不要求 node、python 等运行时。单窗口上限:最多导出 10,000 个路径、64 MiB blob 证据(文本按 before/after 实际字节、二进制按尺寸计),尺寸核算先于内容传输;越界或导出命令失败时 `workspace.diff` 明确报执行错误,不得伪造成空窗口让文件断言产生假阴性。
- **第一次 `t.send()` 之前,agent 归因增量恒为空。** 此时 `fileChanged` 如实失败——起始 fixture 制造不了假阳性,这正是分类账存在的理由。`t.send()` 之后写入的隐藏校验文件同样进不了 agent diff:「校验材料对 agent 不可见」与「校验材料不污染归因」由同一机制保证。`agent.setup` 往 workspace 写 AGENTS.md / skill 也在 send 窗口之外,不需要 exclude 一类补丁。
- **作用域就是 workdir,刻意不扩大。** 全文件系统 diff 只有 Docker 有原生通道(容器层 diff),且只有路径没有内容、噪声大、做不了 send 窗口归因,按 provider 分支还破坏[核心中立](../../architecture.md);workdir 之外的世界($HOME、全局安装、PATH)不靠更大的 diff 回答,靠留存现场(见下节)。git 是唯一便携、增量、带内容存储、能支撑逐窗口归因的引擎,这是选它的理由,不是历史惯性。

agent 归因之外,最终工作区仍完整可读:`t.sandbox.readFile` / `runCommand` 看到的就是最终状态;留存现场(`--keep-sandbox`)保有含分类账的完整沙箱。逐窗口回放变更历史有公开入口——[`niceeval sandbox history` / `sandbox diff`](cli.md#回放留存现场的变更历史sandbox-history--diff),不需要摸 ledger 的内部路径。

这条链上每个实际执行的环节都被计时并落进 `result.json` 的 `phases`——排队与创建分列、`setup` / `teardown` 钩子链逐钩子形成时间树、收尾段(agent 收尾 / 环境层收尾 / `stop`)在判定口径之外单独记录。Sandbox 创建成功后,core 只包装一次返回的中性 `Sandbox`:所有经 `runCommand()` / `runShell()` 发出的公开调用自动挂到当时的 phase/hook/turn 下,所以 `eval.setup` 的依赖安装、`agent.setup` 的 CLI 安装与配置、adapter 启动 Agent CLI、workspace baseline/diff 以及 teardown 回存命令都能继续展开到真实 shell。provider 内部用 `runCommand` 转调 `runShell` 只算最外层公开调用一次,不重复计时。runner 或 Sandbox 知道一段批量工作属于同一个逻辑动作时,在命令外再包一层 `operation` 语义节点;例如 `workspace.diff` 记录一次 `export workspace diff` operation,其下是一条覆盖全部窗口的批量导出 command 加一次导出文件下载,而不是每个文件各一条 `git show`。

`sandbox.create` 是特殊边界:此时 Sandbox 对象尚不存在,不能靠同一个包装器看到内部步骤。内置 provider 可把真实 SDK 请求、宿主命令或创建子步骤作为 `provider` 节点写入;第三方 provider 没提供细分时只记录 `sandbox.create` 合计,不能为了树好看把 API 调用伪装成 shell 命令。Agent CLI 内部自行执行的工具命令也不经过 Sandbox 包装,它们由标准事件流记录,有 OTel 且 correlation 唯一时才在 turn 下显示耗时。

时间树的父级归属使用随 async 调用链传播的显式 timing context,不能用一个可变的“当前 phase/hook”全局值——并行 hook 或并行命令会串错父级。runner duration 使用单调时钟,节点同时保存 attempt 内 `startOffsetMs`,从而恢复 sibling 的重叠关系。命令只落有界脱敏摘要:env value、stdout/stderr 与可能含 secret 的完整长脚本不进入 timing 记录。operation 的 label 同样有界、脱敏,由拥有该逻辑工作的 producer 写入;展示层不能解析命令文本猜业务分组。这样「沙箱起了多久、setup 哪个 hook/命令慢、Agent CLI 启动多久、超时死在哪一层、收尾卡没卡」都有数据可查。阶段与时间树口径见 [Phase Timings](../../engineering/benchmark/README.md),终端的有界/full 两档入口是 [`niceeval show --timing`](../reports/show/timing.md),网页入口是 `niceeval view` 的 Attempt 详情。

核心固定的是这条调用链本身(创建后先环境层钩子、再打分类账锚点、再 eval Fixture、再 agent 预置;agent 归因增量在评分前折叠完成,收尾段按 eval → agent → 环境层的顺序在判定之后执行)。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval 用例 · 沙箱 coding 任务](../eval/use-case/sandbox-coding.md)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。provider 保证 `workdir` 存在且对非 root 用户可写;命令工作目录用 `runCommand` / `runShell` 的 `cwd` option 表达,默认 `workdir`,不提供可变的 `setWorkingDirectory`。

## 留存(keep)与注册表

[`--keep-sandbox`](cli.md) 的留存决策发生在 attempt 收尾链的最后一步:verdict 定稿后按档位提交——`failed` 档(裸 flag 的缺省值)提交 `failed` / `errored`(含硬超时打断的 `errored`),`all` 档全部 verdict 都提交;此时其余收尾(agent teardown、环境层 teardown、diff 采集)已经照常完成。attempt 的最终 `locator` 在调度前已经由 invocation 的 `snapshotStartedAt` 与 attempt 身份算好,因此登记项、run 收尾反馈与 `result.json` 从第一次写入起就使用同一个 locator,没有事后补写窗口。

沙箱的 Effect Scope 持有一个只在本 attempt 内可变的 release disposition,初始为 `stop`。attempt deadline 只中断 Scope **里面的 verdict-producing 工作 fiber**,把超时转换成 `errored` draft;它不关闭外层 Scope。runner 随后仍在同一个 Scope 内执行有界 teardown、定稿 verdict,再调用 `commitKeepOrStop()`。这样硬超时现场尚未被 finalizer 销毁,而 Ctrl+C 中断外层 Scope 时 disposition 仍是 `stop`,照常清理。Scope release 最后按 disposition 执行:只有留存提交成功才跳过 `sandbox.stop()`。

留存提交严格按以下顺序,不能调换:

1. 把完整登记项原子写入持久注册表。一条 = `{ sandboxId, provider, evalId, attempt, experimentId?, locator, verdict, keptAt, workdir, enter?, expiresAt?, state, lease? }`,`state` 初值 `"alive"`(实例此刻还在跑);`lease` 是事后命令的互斥凭据(语义见 [CLI · 条目级 lease](cli.md#niceeval-sandbox查看与销毁留存的沙箱))。
2. 写入成功后,才把 disposition 改成 `keep` 并从本次 run 的内存清理集合移除。
3. 写入失败时保持 `stop`,记录 diagnostic,让 Scope finalizer 正常销毁;该 attempt 的 `sandbox.kept` 不得写成 `true`。
4. disposition 为 `keep` 时,Scope release 阶段执行 provider **suspend**(`sandbox.suspend` phase,有界计时——e2b pause 的耗时随内存增长,不许藏在计时外):成功后把登记项 `state` 更新为 `"dormant"`;失败时保持 `"alive"` 并追加 diagnostic——现场仍被注册表管理、仍可 enter,只是没省下资源,**不销毁、不冒充 dormant**。suspend 与任何收尾步骤一样不反改 verdict。

持久注册表是 `.niceeval/sandboxes/` 下的**逐条目文件**,不是多个 attempt 竞争改写的一份 JSON。entry id 由 `provider + sandboxId` 做稳定散列;每条先写同目录临时文件、`fsync` 文件后 `rename` 成 `<entry-id>.json`,再 `fsync` 目录;不同 attempt 与不同 niceeval 进程不会覆盖彼此。`sandbox stop` 先完成 detached 销毁(实例已不存在也算完成),再删除对应条目并同步目录;销毁失败则保留条目并退出 1,不能为了让列表变干净而制造无主资源。受支持的正常返回、异常、超时和 Ctrl+C 路径因此保持:沙箱要么仍在内存清理集合,要么已有可被 `list` / `stop` 发现的持久条目。无法拦截的进程 `SIGKILL` / 宿主断电不承诺分布式原子性;这类外部中断留下的实例由[孤儿核对](#孤儿核对强杀路径的实例面兜底)按创建期写入的运行标识事后收回。

`enter` 是 provider 原生的进入命令,记进注册表供直连与审计;日常入口是 [`niceeval sandbox enter <id>`](cli.md#sandbox-enter),由它负责唤醒、进入与退出后重新休眠。`expiresAt` 是现场可找回的截止时刻——provider 声明了保留期限才写(vercel 写,e2b pause 无限期保留则不写)。

`sandbox list` / `stop` 按注册表条目的 `provider` 名路由到各 provider 的 **detached 销毁**能力——不需要原来的 run 进程或 `Sandbox` 实例还活着(docker:`rm -f`;e2b / vercel:SDK 按 id kill)。这层按名字路由发生在 CLI / 注册表边界,符合[核心中立](../../architecture.md)的分界:运行器与评分路径仍不感知 provider 名。

各 provider 的留存语义——suspend 把现场转入该 provider **最持久的低成本形态(休眠)**,「留下」不等于「继续跑」:

- **Docker** —— suspend = `docker stop`:文件系统落盘持久、不占内存、跨 daemon 重启存活。创建容器时就不带 `AutoRemove`(留存意图必须在创建期传入),`stop()` 改为显式 stop + remove,行为等价;容器带 `niceeval.keep-candidate=true` 标签,正常 run 结束后该标签下只剩已登记的 kept 容器;强杀留下的未登记候选由[孤儿核对](#孤儿核对强杀路径的实例面兜底)按运行标识收回。停驻的容器不会自己消失,仍是唯一需要用户主动清理的 provider。两个否决项:`docker pause` 不用于留存(内存驻留,daemon 重启即失,反而更脆);`docker commit` 转镜像也不用(引入第二种要管理的资源面,停驻容器已给出同等持久性)。
- **E2B** —— suspend = `pause`:文件系统与内存整体持久化,暂停期间停止计费,现场无限期保留、可 `resume` 找回;没有自然过期时刻,`expiresAt` 不写。
- **Vercel Sandbox** —— suspend = `stop`:sandbox 默认持久,stop 自动打一次快照保存文件系统,之后经 `Sandbox.get` / `getOrCreate` 恢复(SDK 原生能力);内存态不保留,唤醒后进程要重新启动。`expiresAt` 写 `keptAt` 加上快照的默认保留期限——`snapshotExpiration` 默认 30 天(2,592,000,000ms,从快照最后一次使用起算),niceeval 不覆盖这个参数,默认值就是留存现场实际的保留期限。
- **Local** —— 不参与留存,`--keep-sandbox` 组合在创建前报错:本地档从不销毁,现场天然留在用户的工作树里,无需注册表纳管(见[本地执行](local.md))。
- **`defineSandbox` 自定义 provider** —— 不参与留存。`niceeval sandbox` 刻意不加载 config / eval 模块,新进程只有序列化登记项,无法安全找回用户对象上的任意 `stopDetached` 函数;只删登记项又会违反「stop = 销毁」。因此 `--keep-sandbox` 与自定义 provider 组合在创建前报清晰错误。需要统一留存生命周期的 provider 应贡献为内置 provider;未来若引入可序列化、可审计的 detached cleanup 协议,再扩这条边界。

`Sandbox` 接口不因留存扩大:没有 pause / detach / keep 方法——「留下」不是沙箱的能力,是 runner 的一次调度决定。留存的 attempt 在 `result.json` 落 `sandbox: { provider, sandboxId, kept: true }`(字段契约见 [Results](../results/architecture.md#resultjson)),`phases` 无 `sandbox.stop` 条目。

## 孤儿核对:强杀路径的实例面兜底

进程内的清理集合与 Scope finalizer 覆盖不到 `SIGKILL` / 宿主断电——没有任何代码来得及执行,正在跑的沙箱就地变成 provider 侧的无主实例。这条路径的兜底不追求「杀不掉的进程也能收尾」(做不到),而是把「事后认领」做成可靠的机器动作:创建时把归属写进实例元数据,事后按归属核对与收回。

- **运行标识在创建期写入。** 每台沙箱实例创建时带运行标识元数据:`host`(宿主机名)、`pid`(runner 进程)、`startedAt`(快照时刻)。Docker 用容器 label(与 `niceeval.keep-candidate` / provision token 同一机制),E2B 用 SDK `metadata`(与 provision token 同通道)。Vercel Sandbox 没有按元数据检索实例的通道,不参与孤儿核对——它的兜底是 provider 自身的保留期限到期回收,这条差异如实写进公开文档,不伪装成全 provider 一致。
- **孤儿的判定是三条「与」**:带 niceeval 运行标识、不在留存注册表、且属主 run 已被证实死亡(标识里的 `host` 等于当前宿主机名,且 `pid` 探测不存活)。三条缺一不可:注册表里的 kept 沙箱是被管理的现场,不是孤儿;属主 run 还活着的实例属于并发运行中的另一次 run,绝不能收;`host` 不匹配或 pid 无法核对的实例标 `unverified`,列出但不自动销毁——误杀一台活实例的代价高于多留一台待人工确认,判定必须偏保守。
- **核对与收回分成只读、破坏两个入口**:[`niceeval sandbox list --orphans`](cli.md#sandbox-list---orphans) 只读列出,[`niceeval sandbox prune`](cli.md#sandbox-prune) 销毁已核实孤儿;`unverified` 只有显式 `--force` 才销毁。两个入口与 sandbox 命令组其余成员同一契约:不读 config、不执行用户代码,销毁走各 provider 的 detached 通道。
- 实验级 `setup` 起过的外部资源(隧道、共享服务、license 席位)是同一强杀路径的另一半泄漏面,兜底在实验面,机制见 [Experiments · 强杀后的收尾兜底](../experiments/architecture.md#强杀后的收尾兜底收尾登记与启动自愈)。

## Docker provider(本地,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **非 root 用户(默认)** —— 默认以 `1000:1000`(node)跑命令;全局 npm 装到用户目录并入 `PATH`,避免权限问题。命令传 `{ root: true }` 时改以 root 跑(见 [Library · 用户与 root](library.md#用户与-root))。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧解析。
- **超时** —— 命令级超时,到点销毁流并报错。

```typescript
const sandbox = await createSandbox({ provider: "docker", runtime: "node24", timeout });
await sandbox.uploadFiles(workspaceFiles);        // targetDir 省略 → workdir
await sandbox.runCommand("npm", ["install"]);     // cwd 省略 → workdir
```

## Vercel Sandbox provider(云,可弹性扩并发)

需要 Vercel Sandbox 凭据;显式环境变量路径是 `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的 session 生命周期,必要时 snapshot + rotate,避免长命令被 session 上限截断。
- 批量 `writeFiles` 上传。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种 provider 间切换。

## E2B provider(云,微 VM)

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;省略 `template` 用 e2b 默认 `base`(自带 node20)。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`{ root: true }` → `{ user: "root" }`。
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

**性质**:瞬时失败的本质是"再等等就好"——限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)与传输层瞬时错误;确定性失败是"配置就是错的"——模板不存在、凭据缺失、权限不足,重试没有意义,识别出即第一次抛出。两个方向的误判代价不对称:把瞬时误判成确定性,一个本可自愈的 attempt 被白白判死;把确定性误判成瞬时,只多花封顶的退避时间,最后仍如实抛出原始错误——只慢不错。分类器因此偏向宽认瞬时,并接受有界的误判代价(存在把确定性错误包装成 5xx 文案的 SDK,反例台账见 memory 的 sandbox-provision-ratelimit-retry 条目)。

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
- **E2B** —— create 经 `metadata` 打 provision token,对账走 SDK 实例列表的 metadata 过滤,查到即 kill(实例已不存在视作对账完成)。创建成功后的工作区准备命令失败由 kill-on-failure 先 kill 再抛。真实跑分中两类都出现过:`Sandbox.create` 阶段的 `fetch failed · other side closed`(歧义类),与创建成功之后初始化请求撞 429 被归入拒绝类(反例台账见 memory 的 e2b-provision-429-duplicate-sandbox 条目)——都由重试前对账兜住。
- **Vercel Sandbox** —— create 是单个 SDK 调用、没有初始化尾巴;SDK 对 429 已内建多次退避重试(读 `Retry-After`),外层对拒绝类的封顶次数相应收窄,避免「外层次数 × 内层次数」在请求量和退避时长两个维度同时放大;SDK 没有按元数据检索实例的通道,歧义类第一次抛出。

重试循环本身在 `resolve.ts` 的 `createProvider()`:

- 退避睡眠期间临时归还并发槽位(`retry.ts` 的 `ProvisionSlot`),睡醒后再排队要回来——在退避的 attempt 只是在等,不该攥着 `sandboxSem` 的名额陪跑 `setTimeout`,不然一批 429 会把整批实际并发拖成远低于 `--max-concurrency` 声明值的个位数。
- 重试全部耗尽后仍按原语义走:`verdict: "errored"`(基建问题,不是 agent 表现);对账中销毁的实例不额外报错,只留 diagnostic。

Provisioning 的分类只覆盖"创建沙箱"这一步。沙箱创建成功后被 provider 终止属于 lifecycle failure,不能当成同一个实例里的普通 IO 失败继续重试;应保留明确终止原因,由 attempt 层决定是否允许重新创建整个环境。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 已创建 Sandbox 的文件 IO 重试

所有 provider(含 `defineSandbox`)返回的 Sandbox 都经过同一个包装层。包装层只对固定目标的幂等文件操作做默认重试:`readFile`、`fileExists`、`downloadFile`、`writeFiles`、`uploadFiles`、`uploadDirectory`、`uploadFile`、`downloadDirectory`。一次批量写或批量取回即使只完成一部分,重跑仍覆盖同一组目标路径。

默认最多 3 次,指数退避并带抖动。只有传输层的瞬时错误进入重试:429、5xx、`fetch failed`、连接重置、临时 DNS / 网络不可达。文件不存在、权限错误、路径错误、取消、Sandbox terminated 都第一次抛出。E2B 的 `fileExists` 必须把瞬时传输错误继续抛出,不能伪装成 `false`。

`runCommand`、`runShell`、`appendLog`、`stop` 永远不隐式重试:框架不知道命令在失败前产生了哪些副作用。需要重试命令时由调用者把幂等性写成显式业务策略。IO 重试全部耗尽后抛回原始 error,让 attempt 保存错误链与 partial evidence。

## 再接一个 provider

两条路,取决于新 provider 是不是打算贡献回 niceeval:

- **贡献进 niceeval**(像 docker/vercel/e2b 那样内置):实现 `Sandbox` 接口的一个类(`create()` + `workdir` + run/read/write/stop/up-down-load;路径解析直接用 `src/sandbox/paths.ts`,不要自己再写一份),在 `sandbox/resolve.ts` 的 `resolveSandbox` / `createBackend` 加一个 `case`,需要带参数就在 `types.ts` 加一个 `XxxSandboxSpec` 并在 `define.ts` 加工厂。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](library.md#自定义-provider-definesandbox)。

**核心定义接口, provider 各自实现**,两条路都不改核心其余部分。niceeval 的沙箱抽象刻意保持小(只需 run/read/write/stop),让接一个新 provider 的成本最低。

内置 provider 除接口外还要交付两个故事:预制环境(spec 的消费字段、构建归原生工具、共享/过期语义如实文档化,义务清单见 [Library · 新 provider 的预制环境义务](library/prebuilt-environments.md#新-provider-的预制环境义务))与留存(detached 销毁能力,见[留存与注册表](#留存keep与注册表))。

## 实现纪律

路径解析规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置 provider 共用;不允许每个 provider 各自复制一遍 `startsWith("/")` 判断——规则有多份实现,就会有 provider 悄悄不一致。`defineSandbox` 自定义 provider 只需声明自己的 `workdir` 字符串即可获得同一套行为。

不要硬编码 `/workspace`——它不是任何 provider 的真实 workdir,按它写的文件会落在 agent cwd 和变更分类账之外(agent 看不见、diff 采不到)。写法是省略 `targetDir` / `cwd`,需要绝对路径时用 `sandbox.workdir`。

## 性能:预制环境、复用与预热

沙箱冷启动和重复安装是关键路径上的大头。优先级如下:

1. 把稳定重依赖做进 Docker image、E2B template 或 Vercel snapshot;每次 attempt 只从这个起点创建。
2. `sandbox.setup` 只做按 experiment 变化的小配置、状态恢复与预检。
3. 仍有必要时再考虑预热池或串行复用。

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **串行复用** —— `--reuse-sandbox` 让整批同基线 eval 共用一个热沙箱串行跑,不随 eval 变的层只装一次、落成温基线,题间只把 workdir 重置回温基线。显式 flag 才进入,默认仍是每 attempt 全新;完整契约见[串行复用](serial-reuse.md)。

预制环境的构建与发布归项目和 provider 原生工具;NiceEval 的 typed spec 负责消费(工作流见 [Library · 预制环境](library/prebuilt-environments.md))。预热池与复用是 [Runner](../../runner.md) 的调度职责。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 使用侧 API:路径、root、生命周期钩子、自定义 provider。
- [Runner](../../runner.md) —— 预热与复用的调度职责。
