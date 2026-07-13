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

这套分类 + 重试只覆盖"创建沙箱"这一步,provider 无关——Runner / Adapter 不需要知道具体是哪个 provider 抛的错误。沙箱创建成功后、运行期间被限流终止(如并发过高导致的沙箱被杀)不在这个机制内,应优先靠控制并发(见 [Runner](../../runner.md))避免,而不是靠重试掩盖。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 再接一个 provider

两条路,取决于新 provider 是不是打算贡献回 niceeval:

- **贡献进 niceeval**(像 docker/vercel/e2b 那样内置):实现 `Sandbox` 接口的一个类(`create()` + `workdir` + run/read/write/stop/up-down-load;路径解析直接用 `src/sandbox/paths.ts`,不要自己再写一份),在 `sandbox/resolve.ts` 的 `resolveSandbox` / `createBackend` 加一个 `case`,需要带参数就在 `types.ts` 加一个 `XxxSandboxSpec` 并在 `define.ts` 加工厂。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](library.md#自定义-provider-definesandbox)。

**核心定义接口, provider 各自实现**,两条路都不改核心其余部分。niceeval 的沙箱抽象刻意保持小(只需 run/read/write/stop),让接一个新 provider 的成本最低。

## 实现纪律

路径解析规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置 provider 共用;不允许每个 provider 各自复制一遍 `startsWith("/")` 判断——规则有多份实现,就会有 provider 悄悄不一致。`defineSandbox` 自定义 provider 只需声明自己的 `workdir` 字符串即可获得同一套行为。

旧文档曾推荐显式传 `"/workspace"`——它与任何 provider 的真实 workdir 都不一致,按它写的文件会落在 agent cwd 和 git 基线之外(agent 看不见、diff 采不到)。新代码和新示例都应写成"省略 `targetDir` / `cwd`",必要时通过 `sandbox.workdir` 取真实绝对路径。

## 性能:复用与预热

沙箱冷启动是关键路径上的大头。两个杠杆:

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **跨 case 复用** —— 同 runtime 的沙箱在一个 case 跑完后重置(`git clean` 回基线)而非销毁,给下一个 case 用。需权衡"复用省时" vs "全新更干净",默认全新,可开复用。

这些是 [Runner](../../runner.md) 的调度职责,沙箱 provider 只需支持 reset / 快速 create。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 使用侧 API:路径、root、生命周期钩子、自定义 provider。
- [Runner](../../runner.md) —— 预热与复用的调度职责。
