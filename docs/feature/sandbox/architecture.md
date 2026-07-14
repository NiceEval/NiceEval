# Sandbox —— 架构

内置 provider 的实现要点、沙箱在 attempt 生命周期里的确切位置,以及给贡献者的扩展路径。使用侧的 API 见 [Library](library.md)。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心固定住各个钩子**的调用顺序**,每个钩子**内部做什么**交给 sandbox spec / eval / agent 各自的作者:

```text
 createSandbox(provider, timeout)
  → sandbox.setup?.(sandbox, ctx)          # 环境层:experiment.sandbox 链上的 .setup() 钩子(可能多个,按追加顺序);没挂就跳过
  → git init && git commit                 # 打一次空基线,供之后 diff——不管 test() 里写了什么
  → EvalDef.setup?.(sandbox, ctx)          # 这条 eval 的任务夹具(如果定义了);ctx 绑定 eval.setup feedback
  → SandboxAgent.setup?.(sandbox, ctx)     # agent 自己的一次性预置(装 CLI / 写主配置)
  → test(t)                                # ← 交给 eval 作者,顺序由它自己决定:
  │    t.sandbox.writeFiles(...) / uploadFiles(...) / uploadDirectory(...)  # 默认落到 workdir
  │    t.send()                              #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events)
  │    t.sandbox.runCommand(...)             #   手工跑校验命令,cwd 默认 workdir(可以晚于 t.send(),agent 天然看不到)
  │    断言…                                 #   t.sandbox.fileChanged / t.sandbox.diff / t.check(commandSucceeded)
  → collectGeneratedFiles()                # git diff HEAD
  → SandboxAgent.teardown?.(sandbox, ctx)   # finally:agent 级收尾先跑
  → sandbox.teardown?.(sandbox, ctx)        # finally:环境层收尾最后跑,销毁前——回存跨 attempt 状态用这个时机
   → commitKeepOrStop()                     # verdict 命中时原子登记后留存;否则 sandbox.stop()(见下)
```

环境层钩子排在最前、也收在最后,不是任意选择:它准备的是**环境**(装二进制、预热模型、写 hook 文件),不是这条 eval 的任务材料,必须先于 git 基线跑——像镜像构建先于代码挂载——否则它写下的文件会被 `git diff` 误记成"agent 生成的改动",污染这条 eval 的 diff 归因。teardown 顺序对称颠倒:agent 级收尾先跑(它可能还要用沙箱做收尾动作,比如导出 transcript),环境层收尾最后跑、销毁前一刻——这个位置正好用来把状态回存到沙箱外部。

这条链上每个实际执行的环节都被计时并落进 `result.json` 的 `phases`——排队与创建分列、`setup` / `teardown` 钩子链逐钩子形成时间树、收尾段(agent 收尾 / 环境层收尾 / `stop`)在判定口径之外单独记录。Sandbox 创建成功后,core 只包装一次返回的中性 `Sandbox`:所有经 `runCommand()` / `runShell()` 发出的公开调用自动挂到当时的 phase/hook/turn 下,所以 `eval.setup` 的依赖安装、`agent.setup` 的 CLI 安装与配置、adapter 启动 Agent CLI、workspace baseline/diff 以及 teardown 回存命令都能继续展开到真实 shell。provider 内部用 `runCommand` 转调 `runShell` 只算最外层公开调用一次,不重复计时。

`sandbox.create` 是特殊边界:此时 Sandbox 对象尚不存在,不能靠同一个包装器看到内部步骤。内置 provider 可把真实 SDK 请求、宿主命令或创建子步骤作为 `provider` 节点写入;第三方 provider 没提供细分时只记录 `sandbox.create` 合计,不能为了树好看把 API 调用伪装成 shell 命令。Agent CLI 内部自行执行的工具命令也不经过 Sandbox 包装,它们由标准事件流记录,有 OTel 且 correlation 唯一时才在 turn 下显示耗时。

时间树的父级归属使用随 async 调用链传播的显式 timing context,不能用一个可变的“当前 phase/hook”全局值——并行 hook 或并行命令会串错父级。runner duration 使用单调时钟,节点同时保存 attempt 内 `startOffsetMs`,从而恢复 sibling 的重叠关系。命令只落有界脱敏摘要:env value、stdout/stderr 与可能含 secret 的完整长脚本不进入 timing 记录。这样「沙箱起了多久、setup 哪个 hook/命令慢、Agent CLI 启动多久、超时死在哪一层、收尾卡没卡」都有数据可查。阶段与时间树口径见 [Phase Timings](../../engineering/benchmark/README.md),终端与网页入口是 [`niceeval show --timing`](../reports/show.md#--timing整个-attempt-的统一时间树) 与 `niceeval view` 的 Attempt 详情。

核心固定的是这条调用链本身(创建后先环境层钩子、再打一次空 git 基线、再 eval 夹具、再 agent 预置;销毁前先 agent 收尾、再环境层收尾、最后采 diff 已经完成)。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval Authoring · 沙箱型](../eval/library.md#沙箱型手工把文件放进沙箱)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。provider 保证 `workdir` 存在且对非 root 用户可写;命令工作目录用 `runCommand` / `runShell` 的 `cwd` option 表达,默认 `workdir`,不提供可变的 `setWorkingDirectory`。

## 留存(keep)与注册表

[`--keep-sandbox`](cli.md) 的留存决策发生在 attempt 收尾链的最后一步:verdict 定稿后,只有 `failed` / `errored`(含硬超时打断的 `errored`)才提交留存,其余收尾(agent teardown、环境层 teardown、diff 采集)已经照常完成。attempt 的最终 `locator` 在调度前已经由 invocation 的 `snapshotStartedAt` 与 attempt 身份算好,因此登记项、run 收尾反馈与 `result.json` 从第一次写入起就使用同一个 locator,没有事后补写窗口。

沙箱的 Effect Scope 持有一个只在本 attempt 内可变的 release disposition,初始为 `stop`。attempt deadline 只中断 Scope **里面的 verdict-producing 工作 fiber**,把超时转换成 `errored` draft;它不关闭外层 Scope。runner 随后仍在同一个 Scope 内执行有界 teardown、定稿 verdict,再调用 `commitKeepOrStop()`。这样硬超时现场尚未被 finalizer 销毁,而 Ctrl+C 中断外层 Scope 时 disposition 仍是 `stop`,照常清理。Scope release 最后按 disposition 执行:只有留存提交成功才跳过 `sandbox.stop()`。

留存提交严格按以下顺序,不能调换:

1. 把完整登记项原子写入持久注册表。一条 = `{ sandboxId, provider, evalId, attempt, experimentId?, locator, verdict, keptAt, workdir, enter?, expiresAt? }`。
2. 写入成功后,才把 disposition 改成 `keep` 并从本次 run 的内存清理集合移除。
3. 写入失败时保持 `stop`,记录 diagnostic,让 Scope finalizer 正常销毁;该 attempt 的 `sandbox.kept` 不得写成 `true`。

持久注册表是 `.niceeval/sandboxes/` 下的**逐条目文件**,不是多个 attempt 竞争改写的一份 JSON。entry id 由 `provider + sandboxId` 做稳定散列;每条先写同目录临时文件、`fsync` 文件后 `rename` 成 `<entry-id>.json`,再 `fsync` 目录;不同 attempt 与不同 niceeval 进程不会覆盖彼此。`sandbox stop` 先完成 detached 销毁(实例已不存在也算完成),再删除对应条目并同步目录;销毁失败则保留条目并退出 1,不能为了让列表变干净而制造无主资源。受支持的正常返回、异常、超时和 Ctrl+C 路径因此保持:沙箱要么仍在内存清理集合,要么已有可被 `list` / `stop` 发现的持久条目。无法拦截的进程 `SIGKILL` / 宿主断电不承诺分布式原子性;Docker 的 candidate label 与云 provider TTL 用于事后核对这类外部中断。

`enter` 是 provider 给出的进入命令(docker 的 `docker exec -it … bash`、e2b 的 `e2b sandbox connect …`);`expiresAt` 是云 provider 的自然过期时刻。

`sandbox list` / `stop` 按注册表条目的 `provider` 名路由到各 provider 的 **detached 销毁**能力——不需要原来的 run 进程或 `Sandbox` 实例还活着(docker:`rm -f`;e2b / vercel:SDK 按 id kill)。这层按名字路由发生在 CLI / 注册表边界,符合[核心中立](../../architecture.md)的分界:运行器与评分路径仍不感知 provider 名。

各 provider 的留存语义:

- **Docker** —— 留存的容器不会自己消失,是唯一需要用户主动清理的 provider。`--keep-sandbox` 的 run 在创建容器时就不带 `AutoRemove`(留存意图必须在创建期传入),`stop()` 改为显式 stop + remove,行为等价;容器带 `niceeval.keep-candidate=true` 标签。正常 run 结束后该标签下只剩已登记的 kept 容器;异常硬退时可用它核对未完成提交的候选。
- **E2B / Vercel Sandbox** —— 留存 = 不调 kill,微 VM 活到自身 session / 模板 timeout 自然过期,成本天然有界;`expiresAt` 写进注册表,`list` 据此报 `expired`。Vercel session 只有数分钟量级,留存窗口相应短,`list` 如实展示而不掩盖。
- **`defineSandbox` 自定义 provider** —— 不参与留存。`niceeval sandbox` 刻意不加载 config / eval 模块,新进程只有序列化登记项,无法安全找回用户对象上的任意 `stopDetached` 函数;只删登记项又会违反「stop = 销毁」。因此 `--keep-sandbox` 与自定义 provider 组合在创建前报清晰错误。需要统一留存生命周期的 provider 应贡献为内置 provider;未来若引入可序列化、可审计的 detached cleanup 协议,再扩这条边界。

`Sandbox` 接口不因留存扩大:没有 pause / detach / keep 方法——「留下」不是沙箱的能力,是 runner 的一次调度决定。留存的 attempt 在 `result.json` 落 `sandbox: { provider, sandboxId, kept: true }`(字段契约见 [Results](../results/architecture.md#resultjson)),`phases` 无 `sandbox.stop` 条目。

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

## Provisioning 失败与重试

`createSandbox()` 跨网络调用 provider 控制面,失败按两个维度分类:**性质**(瞬时还是确定性)决定要不要重试,**后果**(远端是否可能已经创建了实例)决定能不能直接重试。

**性质**:瞬时失败的本质是"再等等就好"——限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)与传输层瞬时错误;确定性失败是"配置就是错的"——模板不存在、凭据缺失、权限不足,重试没有意义,识别出即第一次抛出。两个方向的误判代价不对称:把瞬时误判成确定性,一个本可自愈的 attempt 被白白判死;把确定性误判成瞬时,只多花封顶的退避时间,最后仍如实抛出原始错误——只慢不错。分类器因此偏向宽认瞬时,并接受有界的误判代价(存在把确定性错误包装成 5xx 文案的 SDK,反例台账见 memory 的 sandbox-provision-ratelimit-retry 条目)。

**后果**:同为瞬时,重试的安全性完全不同——

- **拒绝类**(请求确定没被受理,远端没有实例):限流响应、连接建立失败(DNS 解析失败、连接被拒、TLS 握手失败)。直接指数退避重试(封顶次数 + 抖动)。
- **歧义类**(请求可能已被受理、只是响应丢了,远端可能有一台正在计费的实例):响应中途的连接重置(`fetch failed`、`other side closed`)、请求超时、5xx。盲目重试会在远端积累没有任何一方持有 id 的实例——泄漏计费资源,也打破[「不留无主沙箱」](#留存keep与注册表)的不变量。歧义类重试前必须**对账**:每次 create 请求把一次性 provision token 写进 provider 原生元数据,重试前按 token 检索远端,查到的实例先销毁再重建——不做断线收养,重建比重连语义干净,冷启动成本本来就要付。provider 没有按元数据检索实例的通道时,歧义类不重试、第一次抛出:宁可判死一个 attempt,不留一台计费的无主实例。

分类分两层,都留在 sandbox/ 内、不外泄到 Adapter / Runner:各内置 provider 先把自己 SDK 原生的限流错误(e2b 的 `RateLimitError`、vercel 的 `APIError{ response.status: 429 }`、docker 拉镜像时 message 里的 `toomanyrequests`)归入拒绝类;provider 没认出的错误再过一遍与文件 IO 重试共用的保守瞬时分类器(见下节),由错误形态落进拒绝类或歧义类。

各内置 provider 的对账通道与重试面:

- **Docker** —— create 是对本地 daemon 的调用,歧义窗口极小;容器创建时即带 niceeval label(与留存候选的 `niceeval.keep-candidate` 标签同一机制),对账 = 按 label 查询本地容器。拒绝类主要是拉镜像限流。
- **E2B** —— create 经 `metadata` 打 provision token,对账走 SDK 实例列表的 metadata 过滤,查到即 kill 后重建。真实跑分中出现过的 `Sandbox.create` 阶段 `fetch failed · other side closed` 由此可安全重试。
- **Vercel Sandbox** —— SDK 对 429 已内建多次退避重试(读 `Retry-After`),外层对拒绝类的封顶次数相应收窄,避免「外层次数 × 内层次数」在请求量和退避时长两个维度同时放大;SDK 没有按元数据检索实例的通道,歧义类第一次抛出。

重试循环本身在 `resolve.ts` 的 `createProvider()`:

- 退避睡眠期间临时归还并发槽位(`retry.ts` 的 `ProvisionSlot`),睡醒后再排队要回来——在退避的 attempt 只是在等,不该攥着 `sandboxSem` 的名额陪跑 `setTimeout`,不然一批 429 会把整批实际并发拖成远低于 `--max-concurrency` 声明值的个位数。
- 重试全部耗尽后仍按原语义走:`verdict: "errored"`(基建问题,不是 agent 表现);对账中销毁的实例不额外报错,只留 diagnostic。

Provisioning 的分类只覆盖"创建沙箱"这一步。沙箱创建成功后被 provider 终止属于 lifecycle failure,不能当成同一个实例里的普通 IO 失败继续重试;应保留明确终止原因,由 attempt 层决定是否允许重新创建整个环境。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 已创建 Sandbox 的文件 IO 重试

所有 provider(含 `defineSandbox`)返回的 Sandbox 都经过同一个包装层。包装层只对固定目标的幂等文件操作做默认重试:`readFile`、`fileExists`、`readSourceFiles`、`downloadFile`、`writeFiles`、`uploadFiles`、`uploadDirectory`、`uploadFile`。一次批量写即使只完成一部分,重跑仍覆盖同一组目标路径。

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

不要硬编码 `/workspace`——它不是任何 provider 的真实 workdir,按它写的文件会落在 agent cwd 和 git 基线之外(agent 看不见、diff 采不到)。写法是省略 `targetDir` / `cwd`,需要绝对路径时用 `sandbox.workdir`。

## 性能:预制环境、复用与预热

沙箱冷启动和重复安装是关键路径上的大头。优先级如下:

1. 把稳定重依赖做进 Docker image、E2B template 或 Vercel snapshot;每次 attempt 只从这个起点创建。
2. `sandbox.setup` 只做按 experiment 变化的小配置、状态恢复与预检。
3. 仍有必要时再考虑预热池或跨 case 复用。

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **跨 case 复用** —— 同 runtime 的沙箱在一个 case 跑完后重置(`git clean` 回基线)而非销毁,给下一个 case 用。需权衡"复用省时" vs "全新更干净",默认全新,可开复用。

预制环境的构建与发布归项目和 provider 原生工具;NiceEval 的 typed spec 负责消费(工作流见 [Library · 预制环境](library/prebuilt-environments.md))。预热池与复用是 [Runner](../../runner.md) 的调度职责。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 使用侧 API:路径、root、生命周期钩子、自定义 provider。
- [Runner](../../runner.md) —— 预热与复用的调度职责。
