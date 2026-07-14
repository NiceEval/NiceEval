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
  → sandbox.stop()                         # 销毁
```

环境层钩子排在最前、也收在最后,不是任意选择:它准备的是**环境**(装二进制、预热模型、写 hook 文件),不是这条 eval 的任务材料,必须先于 git 基线跑——像镜像构建先于代码挂载——否则它写下的文件会被 `git diff` 误记成"agent 生成的改动",污染这条 eval 的 diff 归因。teardown 顺序对称颠倒:agent 级收尾先跑(它可能还要用沙箱做收尾动作,比如导出 transcript),环境层收尾最后跑、销毁前一刻——这个位置正好用来把状态回存到沙箱外部。

这条链上每个实际执行的环节都被计时并落进 `result.json` 的 `phases`——排队与创建分列、`setup` / `teardown` 钩子链逐钩子形成时间树、收尾段(agent 收尾 / 环境层收尾 / `stop`)在判定口径之外单独记录。Sandbox 创建成功后,core 只包装一次返回的中性 `Sandbox`:所有经 `runCommand()` / `runShell()` 发出的公开调用自动挂到当时的 phase/hook/turn 下,所以 `eval.setup` 的依赖安装、`agent.setup` 的 CLI 安装与配置、adapter 启动 Agent CLI、workspace baseline/diff 以及 teardown 回存命令都能继续展开到真实 shell。provider 内部用 `runCommand` 转调 `runShell` 只算最外层公开调用一次,不重复计时。

`sandbox.create` 是特殊边界:此时 Sandbox 对象尚不存在,不能靠同一个包装器看到内部步骤。内置 provider 可把真实 SDK 请求、宿主命令或创建子步骤作为 `provider` 节点写入;第三方 provider 没提供细分时只记录 `sandbox.create` 合计,不能为了树好看把 API 调用伪装成 shell 命令。Agent CLI 内部自行执行的工具命令也不经过 Sandbox 包装,它们由标准事件流记录,有 OTel 且 correlation 唯一时才在 turn 下显示耗时。

时间树的父级归属使用随 async 调用链传播的显式 timing context,不能用一个可变的“当前 phase/hook”全局值——并行 hook 或并行命令会串错父级。runner duration 使用单调时钟,节点同时保存 attempt 内 `startOffsetMs`,从而恢复 sibling 的重叠关系。命令只落有界脱敏摘要:env value、stdout/stderr 与可能含 secret 的完整长脚本不进入 timing 记录。这样「沙箱起了多久、setup 哪个 hook/命令慢、Agent CLI 启动多久、超时死在哪一层、收尾卡没卡」都有数据可查。阶段与时间树口径见 [Phase Timings](../../engineering/benchmark/README.md),终端与网页入口是 [`niceeval show --timing`](../reports/show.md#--timing整个-attempt-的统一时间树) 与 `niceeval view` 的 Attempt 详情。

核心固定的是这条调用链本身(创建后先环境层钩子、再打一次空 git 基线、再 eval 夹具、再 agent 预置;销毁前先 agent 收尾、再环境层收尾、最后采 diff 已经完成)。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval Authoring · 沙箱型](../eval/library.md#沙箱型手工把文件放进沙箱)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。provider 保证 `workdir` 存在且对非 root 用户可写;命令工作目录用 `runCommand` / `runShell` 的 `cwd` option 表达,默认 `workdir`,不提供可变的 `setWorkingDirectory`。

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
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作记录。要 node24 / 烘焙好 agent CLI,用预制模板 `e2bSandbox({ template: "niceeval-agents" })`——参数的典型用途正是把 agent CLI 烘焙进模板,让后续 eval 跳过安装直接开跑(见 [Library · Sandbox 作为数据结构](library.md#sandbox-作为数据结构带参数))。

## Provisioning 失败与重试

`createSandbox()` 创建沙箱时可能撞上 provider 侧的限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)——这类失败的本质是"再等等就好",与模板不存在、凭据缺失这类"配置就是错的"失败不同,框架在 provisioning 阶段对两者分别处理:

- 各内置 provider 把自己 SDK 原生的限流错误(e2b 的 `RateLimitError`、vercel 的 `APIError{ response.status: 429 }`、docker 拉镜像时 message 里的 `toomanyrequests`)归类成一个中性的 kind(目前只有 `"rate_limit"`);这层分类留在各 provider 自己的文件里,不外泄到 Adapter / Runner。
- `resolve.ts` 的 `createProvider()` 对被归为可重试的错误做指数退避重试(封顶次数 + 抖动);其它错误第一次就抛出——重试对着"配置就是错的"没有意义,只会拖慢失败反馈。
- 退避睡眠期间临时归还并发槽位(`retry.ts` 的 `ProvisionSlot`),睡醒后再排队要回来——被限流的 attempt 只是在等,不该攥着 `sandboxSem` 的名额陪跑 `setTimeout`,不然一批 429 会把整批实际并发拖成远低于 `--max-concurrency` 声明值的个位数。
- 重试全部耗尽后仍按原语义走:`verdict: "errored"`(基建问题,不是 agent 表现)。

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

预制环境的构建与发布归项目和 provider 原生工具;NiceEval 的 typed spec 负责消费。预热池与复用是 [Runner](../../runner.md) 的调度职责。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 使用侧 API:路径、root、生命周期钩子、自定义 provider。
- [Runner](../../runner.md) —— 预热与复用的调度职责。
