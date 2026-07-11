# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。它把隔离环境的全部特殊性关进一个统一接口,让 [Adapter](adapters/README.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 一套干净环境,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,环境随后销毁。

## provider 统一接口

```typescript
interface Sandbox {
  /** agent 的默认工作目录;所有沙箱侧相对路径的解析基准。见下「路径与 workdir」。 */
  readonly workdir: string;

  runCommand(cmd: string, args?: string[], opts?: {
    env?: Record<string, string>;
    cwd?: string;     // 省略 → workdir;相对路径 → 解析到 workdir 下
    root?: boolean;   // 以 root 跑(默认 false → 非 root);见下「用户与 root」
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  runShell(script: string, opts?): Promise<CommandResult>;   // 整段 shell

  readFile(path: string): Promise<string>;                 // 相对路径 → workdir 下
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;  // targetDir 省略 → workdir
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>; // 批量(可含二进制);同上
  uploadDirectory(localDir: string, targetDir?: string, opts?): Promise<void>;   // 同上

  stop(): Promise<void>;
}
```

这是 provider 实现和 runner 使用的底层接口,所以包含 `stop()`。eval 作者在 `test(t)` 里拿到的是 author-facing 的 `t.sandbox`:只暴露文件 IO、命令执行和结果断言 / diff,不暴露 `stop()`。沙箱生命周期由 runner 统一管理。

### 为什么 `runCommand` 和 `runShell` 不合并成一个

`runCommand` 按 argv 数组传参,不经过 shell 解析——参数原样传给进程,天然不怕参数里带引号、`$`、`;`、反引号等特殊字符,也没有 shell 注入风险。`runShell` 接受一整段脚本交给 shell 解释,专门给需要管道、`&&`、通配符这类 shell 语义的场景用。

这不是两个方法碰巧长得像,是故意保留的两种不同意图:eval 里的命令参数经常来自数据集字段或 agent 生成的输出,内容不可控——比如 `runCommand("./verify.sh", [row.filename])`,`row.filename` 就算是 `"a; rm -rf /workspace"` 这种字符串,argv 形式下也只是一个普通参数值,不会被解释成两条命令。如果合并成一个走 shell 的 `run(cmd: string)`,调用者就必须自己把每个动态值转义成安全的 shell 字符串才能拼进去,一旦漏转义就是真实的命令注入。

参考过 eve.dev 的 `sandbox.run({ command })`(它下面所有 provider 都固定走 `bash -lc`,靠调用者自己用 `shellQuote()` 转义)——那套设计合理,是因为 eve 的调用方几乎都是 AI agent 自己的 bash 工具或内部工具核心,生成一整段 shell 命令本来就是它们的原生表达方式,shell 语义是刚需。niceeval 的调用方是写 eval 的人,大多数调用(`runCommand("npm", ["test"])`)根本不需要 shell 语义,不该为了少数需要管道/`&&`的场景让所有调用都背上手动转义的心智负担。

## 路径与 workdir:一个坐标系

每个 provider 的 agent 默认工作目录不同——这是**provider 的知识,不是 eval 作者的负担**:

| provider | workdir |
| --- | --- |
| docker | `/home/sandbox/workspace` |
| E2B | `/home/user/workspace` |
| Vercel Sandbox | `/vercel/sandbox` |

契约一句话:**API 里任何沙箱侧相对路径,一律解析到 `workdir`;省略的 `targetDir` / `cwd` 默认就是 `workdir`;绝对路径原样使用。** 本地侧(宿主机)的相对路径则解析到 eval 定义文件所在目录。两侧各只有一个锚点,学一次就够。

为什么 workdir 是唯一正确的默认值:整条流水线都锚定在它上面——git 基线打在那里、agent 的 cwd 在那里、跑完 `git diff HEAD` 采改动在那里、`t.sandbox.fileChanged(...)` 的路径也是对着那里解析的。把起始文件传到任何**别的**目录,agent 看不见它,diff 也采不到它,整条 eval 静默失效。所以对上传起始 workspace 这个最高频调用来说,workdir 不是"常见选择",是唯一能让系统其余部分正常工作的选择——一个参数如果 99% 的调用只有一个正确值,而调用者又不掌握这个值(它随 provider 变),强制填写就不是"显式更安全",是逼人抄错答案。

### 用户会怎么写:before / after

没有这个坐标系时,用户被迫自己拼两侧的绝对路径:

```typescript
// ❌ before:用户要背下 docker 的路径,还要用 import.meta.url 拼本地绝对路径
const WORKSPACE = new URL("../workspaces/ts-starter/", import.meta.url).pathname;

export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.uploadDirectory(WORKSPACE, "/home/sandbox/workspace"); // ← docker 专属,切 e2b 即坏
    await t.send("在 src/components/Button.tsx 实现 Button,接受 label 和 onClick。");
    const test = await t.sandbox.runCommand("npm", ["test"], { cwd: "/home/sandbox/workspace" });
    t.check(test, commandSucceeded());
    t.sandbox.fileChanged("src/components/Button.tsx");
  },
});
```

有坐标系后,同一条 eval:

```typescript
// ✅ after:全程零绝对路径,换 dockerSandbox() / e2bSandbox() / vercelSandbox() 零改动切换
export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.uploadDirectory("../workspaces/ts-starter"); // 本地相对 eval 文件;远端默认 workdir
    await t.send("在 src/components/Button.tsx 实现 Button,接受 label 和 onClick。");
    const test = await t.sandbox.runCommand("npm", ["test"]);    // cwd 默认 workdir
    t.check(test, commandSucceeded());
    t.sandbox.fileChanged("src/components/Button.tsx");          // diff 路径本来就是 workdir 相对
  },
});
```

消掉的东西:`import.meta.url` 拼路径的咒语、两处 hardcode 的 provider 专属绝对路径,以及"切换 provider 文件落到 agent 视野之外"这个静默 bug 的整个物种。用户对"文件在哪"的心智模型收敛成一句话:**一切相对路径都在 workspace 里**——和 git 的 repo 相对路径同构,不需要关心物理位置。

### 逃生舱:`sandbox.workdir`

绝对路径不会彻底消失,三种场景会穿透坐标系:往 prompt 里告诉 agent 一个路径、对照 agent 日志/工具输出里出现的绝对路径、`docker exec` 进容器手动调试。这时用 `workdir` 属性,不要背表:

```typescript
await t.send(`参考 ${t.sandbox.workdir}/docs/CONVENTIONS.md 里的约定实现组件。`);
```

注意 `$HOME` 这类环境变量不是替代品:`targetDir` 是宿主侧 JS 里拼的字符串,shell 变量根本不展开——`uploadDirectory(dir, "$HOME/workspace")` 会真的创建一个叫 `$HOME` 的目录。运行时 `runShell("pwd")` 探测也不必要:workdir 是 provider 构造时就确定的静态字符串,声明就能解决的问题不用运行时手段。

### 为什么不伪造一个统一的 `/workspace`

另一条路是让所有 provider 都真的提供 `/workspace`(mkdir + symlink 到真实 workdir)。不走这条:`/workspace` 不是 agent 实际的 cwd,agent 的日志、工具输出、报错里出现的全是真实路径,伪造的统一路径会让用户在对照时更糊涂;云 provider(vercel/e2b)对用户目录之外的文件系统权限也未必允许。这与「用户与 root」一节是同一处理哲学:**语义跨 provider 一致(相对路径→workdir),物理值诚实暴露差异(`workdir` 属性)**,不假装统一。

### 实现纪律

路径解析规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置 provider 共用;不允许每个 provider 各自复制一遍 `startsWith("/")` 判断——规则有多份实现,就会有 provider 悄悄不一致。`defineSandbox` 自定义 provider 只需声明自己的 `workdir` 字符串即可获得同一套行为。

旧文档曾推荐显式传 `"/workspace"`——它与任何 provider 的真实 workdir 都不一致,按它写的文件会落在 agent cwd 和 git 基线之外(agent 看不见、diff 采不到)。新代码和新示例都应写成"省略 `targetDir` / `cwd`",必要时通过 `sandbox.workdir` 取真实绝对路径。

## 用户与 root

**默认非 root,按需提 root** —— 命令默认以沙箱的标准**非 root** 用户跑(agent 的自然环境:安全,且 Claude Code 等在 root 下会拒绝 `--dangerously-skip-permissions`)。需要 root 的命令(setup 装系统依赖:`apt-get install …`、`pip install --break-system-packages …`)给 `runCommand` 传 `{ root: true }`。

```typescript
// eval setup:只有装系统依赖这步提 root;其余(含 agent、验证)默认非 root。
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { root: true });
await sandbox.runCommand("npm", ["install"]);   // 默认非 root,cwd 默认 workdir
```

**这套语义跨 provider 一致**,且与主流沙箱服务同构 —— 各 provider 把 `{ root: true }` 映射到自己的原生机制:

| provider | 默认用户 | `{ root: true }` 映射 |
| --- | --- | --- |
| docker | `node`(UID 1000) | `exec --user root` |
| E2B | 非 root(`user`) | `commands.run(cmd, { user: "root" })` |
| Vercel Sandbox | 非 root(`vercel-sandbox`) | `runCommand(cmd, { sudo: true })` |
| Daytona | create 时 `os_user` | per-command `user`(规划中) |
| Modal | root | 已是 root → no-op |

约定:**默认值(非 root)与 `root` 的语义在所有 provider 保持一致**,不因 provider 而变。本就全程 root 的 provider 把提 root 视作 no-op;完全无法提 root 的 provider 可不支持(抛错)—— 但这是"不支持",不是"语义不同"。eval 因此不必感知底下是哪个 provider。

## provider 选择:没有默认值,没有按名字选

`sandbox` 字段的类型是 `SandboxOption`(= `SandboxSpec`,一个按 `provider` 区分的数据结构),**不接受裸字符串,也不会自动探测环境替你选一个**。沙箱型 agent 必须显式给 `sandbox` 一个工厂函数产出的 spec——写在 experiment 的 `sandbox` 字段,或写在 `niceeval.config.ts` 的 `sandbox` 字段做全项目兜底(`config.sandbox`,experiment 没设时用它)。两处都没设、又用了沙箱型 agent 时,`resolveSandbox()` 直接抛错,不会替你猜环境、不会静默兜底到某个 provider。也没有 `--sandbox <name>` 这种 CLI 覆盖——provider 选择是 experiment/config 的书面配置,不是运行时临时参数。

```typescript
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { claudeCodeAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox(),   // 必填,沙箱型 agent 没有它就报错
});
```

## Sandbox 作为数据结构(带参数)

provider 名只是个字符串,带不了参数,也没法表达"哪个是镜像、哪个是沙箱快照 ID"。和 [agent](adapters/README.md) 一样,sandbox 用**数据结构**定义:工厂函数(从 `niceeval/sandbox` 导出)产出 spec,放进 `experiment.sandbox`。

```typescript
import { dockerSandbox, vercelSandbox, e2bSandbox } from "niceeval/sandbox";

dockerSandbox()                                     // docker:用默认镜像
dockerSandbox({ image: "niceeval-agents:node24" })  // docker:指定镜像
vercelSandbox({ snapshotId: "snap_xxx" })            // vercel:从沙箱快照起
e2bSandbox({ template: "niceeval-agents" })          // e2b:指定模板
```

`sandbox/resolve.ts` 把 spec 归一化成 `{ provider, image?, snapshotId?, template?, runtime? }`,再按 `provider` 派发到各 provider 的 `create()` —— **核心仍不按 provider 名分支**,参数只在对应 provider 的 `create()` 里消费。

参数的典型用途是**预制模板**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑(见 [`sandbox/`](../sandbox/README.md))。

## Docker provider(本地,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **非 root 用户(默认)** —— 默认以 `1000:1000`(node)跑命令;全局 npm 装到用户目录并入 `PATH`,避免权限问题。命令传 `{ root: true }` 时改以 root 跑(见「用户与 root」)。
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
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作记录。要 node24 / 烘焙好 agent CLI,用[预制模板](../sandbox/README.md) `e2bSandbox({ template: "niceeval-agents" })`。

## Provisioning 失败与重试

`createSandbox()` 创建沙箱时可能撞上 provider 侧的限流(E2B/Vercel 云配额、Docker Hub 镜像拉取限流)——这类失败的本质是"再等等就好",与模板不存在、凭据缺失这类"配置就是错的"失败不同,框架在 provisioning 阶段对两者分别处理:

- 各内置 provider 把自己 SDK 原生的限流错误(e2b 的 `RateLimitError`、vercel 的 `APIError{ response.status: 429 }`、docker 拉镜像时 message 里的 `toomanyrequests`)归类成一个中性的 kind(目前只有 `"rate_limit"`);这层分类留在各 provider 自己的文件里,不外泄到 Adapter / Runner。
- `resolve.ts` 的 `createProvider()` 对被归为可重试的错误做指数退避重试(封顶次数 + 抖动);其它错误第一次就抛出——重试对着"配置就是错的"没有意义,只会拖慢失败反馈。
- 重试全部耗尽后仍按原语义走:`verdict: "errored"`(基建问题,不是 agent 表现)。

这套分类 + 重试只覆盖"创建沙箱"这一步,provider 无关——Runner / Adapter 不需要知道具体是哪个 provider 抛的错误。沙箱创建成功后、运行期间被限流终止(如并发过高导致的沙箱被杀)不在这个机制内,应优先靠控制并发(见 [Runner](runner.md))避免,而不是靠重试掩盖。

`defineSandbox` 的自定义 provider 不套用这层重试——它的 `create()` 是用户自己的函数,错误语义由用户自己决定。

## 再接一个 provider

两条路,取决于新 provider 是不是打算贡献回 niceeval:

- **贡献进 niceeval**(像 docker/vercel/e2b 那样内置):实现 `Sandbox` 接口的一个类(`create()` + `workdir` + run/read/write/stop/up-down-load;路径解析直接用 `src/sandbox/paths.ts`,不要自己再写一份),在 `sandbox/resolve.ts` 的 `resolveSandbox` / `createBackend` 加一个 `case`,需要带参数就在 `types.ts` 加一个 `XxxSandboxSpec` 并在 `define.ts` 加工厂。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](adapters/README.md)(`niceeval/sandbox` 导出)——传 `create()` 直接产出一个实现 `Sandbox` 接口的实例,`resolve.ts` 认到 `create` 就直接调用,跳过内置 provider switch,不需要 niceeval 认识这个 provider 的名字:

```typescript
import { defineSandbox } from "niceeval/sandbox";

export default defineSandbox({
  name: "modal",                          // 只用于展示 / 日志,不参与分发
  recommendedConcurrency: 8,               // 可选;省略默认 5
  create: async ({ timeout, runtime }) => {
    // 返回一个实现 Sandbox 接口(run/read/write/stop/...)的实例
    return new MyModalSandbox({ timeout, runtime });
  },
});
```

**核心定义接口, provider 各自实现**,两条路都不改核心其余部分。niceeval 的沙箱抽象刻意保持小(只需 run/read/write/stop),让接一个新 provider 的成本最低。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心固定住各个钩子**的调用顺序**,每个钩子**内部做什么**交给 sandbox spec / eval / agent 各自的作者:

```text
 createSandbox(provider, timeout)
  → sandbox.setup?.(sandbox, ctx)          # 环境层:experiment.sandbox 链上的 .setup() 钩子(可能多个,按追加顺序);没挂就跳过
  → git init && git commit                 # 打一次空基线,供之后 diff——不管 test() 里写了什么
  → EvalDef.setup?.(sandbox)               # 这条 eval 的任务夹具(如果定义了)
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

环境层钩子排在最前、也收在最后,不是任意选择:它准备的是**环境**(装二进制、预热模型、写 hook 文件),不是这条 eval 的任务材料,必须先于 git 基线跑——像镜像构建先于代码挂载——否则它写下的文件会被 `git diff` 误记成"agent 生成的改动",污染这条 eval 的 diff 归因。teardown 顺序对称颠倒:agent 级收尾先跑(它可能还要用沙箱做收尾动作,比如导出 transcript),环境层收尾最后跑、销毁前一刻——这个位置正好用来把状态回存到沙箱外部,见下节例子。

核心固定的是这条调用链本身(创建后先环境层钩子、再打一次空 git 基线、再 eval 夹具、再 agent 预置;销毁前先 agent 收尾、再环境层收尾、最后采 diff 已经完成)。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval Authoring · 沙箱型](eval-authoring.md#沙箱型手工把文件放进沙箱)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。provider 保证 `workdir` 存在且对非 root 用户可写;命令工作目录用 `runCommand` / `runShell` 的 `cwd` option 表达,默认 `workdir`,不提供可变的 `setWorkingDirectory`。钩子怎么挂、预置放哪见下两节。

## 沙箱生命周期钩子:`.setup()` / `.teardown()`

`dockerSandbox()` / `e2bSandbox()` / `vercelSandbox()` 这些工厂产出的 `SandboxSpec` 带两个链式方法:

```typescript
interface SandboxSpec {
  setup(fn: AgentSetup): SandboxSpec;       // 返回新 spec(不可变),可多次链式追加
  teardown(fn: AgentTeardown): SandboxSpec; // 同上
}
```

`fn` 复用 agent 的 `AgentSetup` / `AgentTeardown` 签名——`(sandbox, ctx) => void | Cleanup | Promise<void | Cleanup>`,`setup` 可以返回一个 cleanup 闭包。多次 `.setup()` 按追加顺序跑,多次 `.teardown()` 按追加的逆序跑(和上面「先进后出」的 agent/环境层顺序是同一条纪律,只是发生在环境层内部)。

这一层解决的是一类特定问题:**你本想把它烘进 Docker image / E2B template,但它要按实验变化。** 装个二进制、预热一次模型、写一份 hook 文件、在多个 attempt 之间载入/回存状态——这些事静态镜像做不到(不同实验要装不同东西),写进 `EvalDef.setup` 又不对(那是每条 eval 的任务夹具,不是"这次实验用什么环境"),写进 `SandboxAgent.setup` 也不对(那是 agent 自己连自己的私事,不该知道某个实验想多装什么)。可以把沙箱生命周期钩子理解成**动态的镜像层**——运行时按 spec 拼出来的那部分 image。

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: "fasteval-agents" })
    .setup(mempalSetup("codex"))       // 装二进制、预热、写 hook、载入状态
    .teardown(mempalTeardown("codex")), // 回存状态
  maxConcurrency: 1,                    // [载入…回存] 是临界区,声明式串行
});
```

这是一个真实的 downstream 场景:记忆条件测试里,MCP server(构造期配置,决定"有没有这个工具")走 `codexAgent({ mcpServers: [...] })`;环境层(这次实验要不要装某个二进制、预热、维护跨 attempt 的记忆状态)走 `.setup()` / `.teardown()`。两条职责线不混:MCP/skills/model 依旧只从 adapter factory 进,钩子不复制 factory 拥有的配置知识,见 [Adapter 契约 · 三类配置的归属](adapters/contract.md#三类配置的归属本地配--实验传入--ctx-透传)。

跨 attempt 状态本身没有框架原语——没有 `persistentState` 这类东西。载入 / 回存是用户在 `setup` / `teardown` 里自己写的普通代码(读写一个外部 KV、文件、数据库,用什么都行);要用哪个键隔离不同实验的状态,靠 `ctx.experimentId`——`AgentContext` 新增的只读字段,值是路径推导的实验 id(与结果里 `experimentId` 同源),不经 experiment 跑时是 `undefined`。[载入…回存] 这段读写外部状态的代码是临界区,想让同一实验的 attempt 不并发踩踏,在 experiment 上声明 `maxConcurrency: 1` 即可串行,不需要框架另设锁。

失败语义与 agent 的 `setup` / `teardown` 完全对称:`sandbox.setup` 抛错按执行错误计(`verdict: "errored"`,基建问题,不是 agent 做题失败);`sandbox.teardown` 报错只记日志、不抛(收尾阶段的错误不应该让一个已经跑完的 attempt 变成失败)。

remote 型 agent(`kind: "remote"`)没有真实沙箱,`experiment.sandbox` 对它不参与、直接被忽略——钩子天然不会跑,不需要为此写 fail-fast 分支或额外校验。

## 环境预置放哪

要在跑 agent 前准备环境,按职责分摊到四处已有的地方——**每一处都是普通代码,不是框架编排**:

| 要准备的东西 | 放哪 | 怎么清理 |
|---|---|---|
| **这次实验**要按配置变化的环境(装二进制、预热模型、写 hook 文件、跨 attempt 状态) | [沙箱生命周期钩子](#沙箱生命周期钩子setup--teardown):`sandbox.setup()` / `.teardown()` | `teardown` 显式回收(回存状态、清外部资源);沙箱内文件随销毁自动没了 |
| 连 agent、装 CLI、写 agent 自己的主配置(每 attempt 一次) | [`SandboxAgent.setup`](adapters/contract.md#agent-契约) | 随沙箱销毁,无需手工清 |
| **这条 eval** 的任务夹具、对跑到它的所有实验都生效的沙箱预置 | `EvalDef.setup` 或 `test(t)` 里的普通代码(`t.sandbox.writeFiles` / `runCommand`) | 随沙箱销毁;要清沙箱外的东西用 `try/finally` |
| **整个 run 共享**的外部服务(mock API、共享 DB、license) | 外部编排:`docker compose up -d && niceeval exp … && docker compose down`,或 CI 脚本 | 外部编排负责,URL 经 env 传入 agent / eval |

四行分工只看"这东西该不该随实验变化、该不该随 eval 变化":环境按实验变(装什么、开不开预热)进沙箱钩子;任务材料按 eval 变(这条题目需要哪些起始文件)进 `EvalDef.setup` / `test(t)`;agent 怎么连自己是 agent 的私事;真正跨进程共享、这次跑之前就该存在的资源交给外部编排。没有第五个"实验级整场钩子"——`ExperimentDef` 仍然是纯配置数据,不携带任何生命周期字段;需要生命周期行为的场景,答案永远是上面四行之一。

## 性能:复用与预热

沙箱冷启动是关键路径上的大头。两个杠杆:

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **跨 case 复用** —— 同 runtime 的沙箱在一个 case 跑完后重置(`git clean` 回基线)而非销毁,给下一个 case 用。需权衡"复用省时" vs "全新更干净",默认全新,可开复用。

这些是 [Runner](runner.md) 的调度职责,沙箱 provider 只需支持 reset / 快速 create。

## 相关阅读

- [Adapter 契约](adapters/contract.md) —— Adapter 如何通过 `Sandbox` 接口驱动 agent,以及 `setup` 的义务。
- [Runner](runner.md) —— 并发、预热、复用的调度。
- [Vision](vision.md) —— provider 名只用于路由,不进核心行为。
