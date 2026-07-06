# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。它把隔离环境的全部特殊性关进一个统一接口,让 [Adapter](adapters/README.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 一套干净环境,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,环境随后销毁。

## 后端统一接口

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

这是后端实现和 runner 使用的底层接口,所以包含 `stop()`。eval 作者在 `test(t)` 里拿到的是 author-facing 的 `t.sandbox`:只暴露文件 IO、命令执行和结果断言 / diff,不暴露 `stop()`。沙箱生命周期由 runner 统一管理。

### 为什么 `runCommand` 和 `runShell` 不合并成一个

`runCommand` 按 argv 数组传参,不经过 shell 解析——参数原样传给进程,天然不怕参数里带引号、`$`、`;`、反引号等特殊字符,也没有 shell 注入风险。`runShell` 接受一整段脚本交给 shell 解释,专门给需要管道、`&&`、通配符这类 shell 语义的场景用。

这不是两个方法碰巧长得像,是故意保留的两种不同意图:eval 里的命令参数经常来自数据集字段或 agent 生成的输出,内容不可控——比如 `runCommand("./verify.sh", [row.filename])`,`row.filename` 就算是 `"a; rm -rf /workspace"` 这种字符串,argv 形式下也只是一个普通参数值,不会被解释成两条命令。如果合并成一个走 shell 的 `run(cmd: string)`,调用者就必须自己把每个动态值转义成安全的 shell 字符串才能拼进去,一旦漏转义就是真实的命令注入。

参考过 eve.dev 的 `sandbox.run({ command })`(它下面所有后端都固定走 `bash -lc`,靠调用者自己用 `shellQuote()` 转义)——那套设计合理,是因为 eve 的调用方几乎都是 AI agent 自己的 bash 工具或内部工具核心,生成一整段 shell 命令本来就是它们的原生表达方式,shell 语义是刚需。niceeval 的调用方是写 eval 的人,大多数调用(`runCommand("npm", ["test"])`)根本不需要 shell 语义,不该为了少数需要管道/`&&`的场景让所有调用都背上手动转义的心智负担。

## 路径与 workdir:一个坐标系

每个后端的 agent 默认工作目录不同——这是**后端的知识,不是 eval 作者的负担**:

| 后端 | workdir |
| --- | --- |
| docker | `/home/sandbox/workspace` |
| E2B | `/home/user/workspace` |
| Vercel Sandbox | `/vercel/sandbox` |

契约一句话:**API 里任何沙箱侧相对路径,一律解析到 `workdir`;省略的 `targetDir` / `cwd` 默认就是 `workdir`;绝对路径原样使用。** 本地侧(宿主机)的相对路径则解析到 eval 定义文件所在目录。两侧各只有一个锚点,学一次就够。

为什么 workdir 是唯一正确的默认值:整条流水线都锚定在它上面——git 基线打在那里、agent 的 cwd 在那里、跑完 `git diff HEAD` 采改动在那里、`t.sandbox.fileChanged(...)` 的路径也是对着那里解析的。把起始文件传到任何**别的**目录,agent 看不见它,diff 也采不到它,整条 eval 静默失效。所以对上传起始 workspace 这个最高频调用来说,workdir 不是"常见选择",是唯一能让系统其余部分正常工作的选择——一个参数如果 99% 的调用只有一个正确值,而调用者又不掌握这个值(它随后端变),强制填写就不是"显式更安全",是逼人抄错答案。

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

消掉的东西:`import.meta.url` 拼路径的咒语、两处 hardcode 的后端专属绝对路径,以及"切换后端文件落到 agent 视野之外"这个静默 bug 的整个物种。用户对"文件在哪"的心智模型收敛成一句话:**一切相对路径都在 workspace 里**——和 git 的 repo 相对路径同构,不需要关心物理位置。

### 逃生舱:`sandbox.workdir`

绝对路径不会彻底消失,三种场景会穿透坐标系:往 prompt 里告诉 agent 一个路径、对照 agent 日志/工具输出里出现的绝对路径、`docker exec` 进容器手动调试。这时用 `workdir` 属性,不要背表:

```typescript
await t.send(`参考 ${t.sandbox.workdir}/docs/CONVENTIONS.md 里的约定实现组件。`);
```

注意 `$HOME` 这类环境变量不是替代品:`targetDir` 是宿主侧 JS 里拼的字符串,shell 变量根本不展开——`uploadDirectory(dir, "$HOME/workspace")` 会真的创建一个叫 `$HOME` 的目录。运行时 `runShell("pwd")` 探测也不必要:workdir 是后端构造时就确定的静态字符串,声明就能解决的问题不用运行时手段。

### 为什么不伪造一个统一的 `/workspace`

另一条路是让所有后端都真的提供 `/workspace`(mkdir + symlink 到真实 workdir)。不走这条:`/workspace` 不是 agent 实际的 cwd,agent 的日志、工具输出、报错里出现的全是真实路径,伪造的统一路径会让用户在对照时更糊涂;云后端(vercel/e2b)对用户目录之外的文件系统权限也未必允许。这与「用户与 root」一节是同一处理哲学:**语义跨后端一致(相对路径→workdir),物理值诚实暴露差异(`workdir` 属性)**,不假装统一。

### 实现纪律

路径解析规则只允许一份实现:收敛在 `src/sandbox/paths.ts`(如 `resolveSandboxPath(workdir, path)`),三个内置后端共用;不允许每个后端各自复制一遍 `startsWith("/")` 判断——规则有多份实现,就会有后端悄悄不一致。`defineSandbox` 自定义后端只需声明自己的 `workdir` 字符串即可获得同一套行为。

旧文档曾推荐显式传 `"/workspace"`——它与任何后端的真实 workdir 都不一致,按它写的文件会落在 agent cwd 和 git 基线之外(agent 看不见、diff 采不到)。新代码和新示例都应写成"省略 `targetDir` / `cwd`",必要时通过 `sandbox.workdir` 取真实绝对路径。

## 用户与 root

**默认非 root,按需提 root** —— 命令默认以沙箱的标准**非 root** 用户跑(agent 的自然环境:安全,且 Claude Code 等在 root 下会拒绝 `--dangerously-skip-permissions`)。需要 root 的命令(setup 装系统依赖:`apt-get install …`、`pip install --break-system-packages …`)给 `runCommand` 传 `{ root: true }`。

```typescript
// eval setup:只有装系统依赖这步提 root;其余(含 agent、验证)默认非 root。
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { root: true });
await sandbox.runCommand("npm", ["install"]);   // 默认非 root,cwd 默认 workdir
```

**这套语义跨后端一致**,且与主流沙箱服务同构 —— 各后端把 `{ root: true }` 映射到自己的原生机制:

| 后端 | 默认用户 | `{ root: true }` 映射 |
| --- | --- | --- |
| docker | `node`(UID 1000) | `exec --user root` |
| E2B | 非 root(`user`) | `commands.run(cmd, { user: "root" })` |
| Vercel Sandbox | 非 root(`vercel-sandbox`) | `runCommand(cmd, { sudo: true })` |
| Daytona | create 时 `os_user` | per-command `user`(规划中) |
| Modal | root | 已是 root → no-op |

约定:**默认值(非 root)与 `root` 的语义在所有后端保持一致**,不因后端而变。本就全程 root 的后端把提 root 视作 no-op;完全无法提 root 的后端可不支持(抛错)—— 但这是"不支持",不是"语义不同"。eval 因此不必感知底下是哪个后端。

## 后端选择:没有默认值,没有按名字选

`sandbox` 字段的类型是 `SandboxOption`(= `SandboxSpec`,一个按 `backend` 区分的数据结构),**不接受裸字符串,也不会自动探测环境替你选一个**。沙箱型 agent 必须显式给 `sandbox` 一个工厂函数产出的 spec——写在 experiment 的 `sandbox` 字段,或写在 `niceeval.config.ts` 的 `sandbox` 字段做全项目兜底(`config.sandbox`,experiment 没设时用它)。两处都没设、又用了沙箱型 agent 时,`resolveSandbox()` 直接抛错,不会替你猜环境、不会静默兜底到某个后端。也没有 `--sandbox <name>` 这种 CLI 覆盖——后端选择是 experiment/config 的书面配置,不是运行时临时参数。

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

后端名只是个字符串,带不了参数,也没法表达"哪个是镜像、哪个是快照 ID"。和 [agent](adapters/README.md) 一样,sandbox 用**数据结构**定义:工厂函数(从 `niceeval/sandbox` 导出)产出 spec,放进 `experiment.sandbox`。

```typescript
import { dockerSandbox, vercelSandbox, e2bSandbox } from "niceeval/sandbox";

dockerSandbox()                                     // docker:用默认镜像
dockerSandbox({ image: "niceeval-agents:node24" })  // docker:指定镜像
vercelSandbox({ snapshotId: "snap_xxx" })            // vercel:从快照起
e2bSandbox({ template: "niceeval-agents" })          // e2b:指定模板
```

`sandbox/resolve.ts` 把 spec 归一化成 `{ backend, image?, snapshotId?, template?, runtime? }`,再按 `backend` 派发到各后端的 `create()` —— **核心仍不按后端名分支**,参数只在对应后端的 `create()` 里消费。

参数的典型用途是**预制模板**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑(见 [`sandbox/`](../sandbox/README.md))。

## Docker 后端(本地,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **非 root 用户(默认)** —— 默认以 `1000:1000`(node)跑命令;全局 npm 装到用户目录并入 `PATH`,避免权限问题。命令传 `{ root: true }` 时改以 root 跑(见「用户与 root」)。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧解析。
- **超时** —— 命令级超时,到点销毁流并报错。

```typescript
const sandbox = await createSandbox({ backend: "docker", runtime: "node24", timeout });
await sandbox.uploadFiles(workspaceFiles);        // targetDir 省略 → workdir
await sandbox.runCommand("npm", ["install"]);     // cwd 省略 → workdir
```

## Vercel Sandbox 后端(云,可弹性扩并发)

需要 Vercel Sandbox 凭据;显式环境变量路径是 `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的 session 生命周期,必要时 snapshot + rotate,避免长命令被 session 上限截断。
- 批量 `writeFiles` 上传。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种后端间切换。

## E2B 后端(云,微 VM)

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;省略 `template` 用 e2b 默认 `base`(自带 node20)。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`{ root: true }` → `{ user: "root" }`。
- 文件用 `files.read` / `files.write`(文本 + 二进制)。
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作记录。要 node24 / 烘焙好 agent CLI,用[预制模板](../sandbox/README.md) `e2bSandbox({ template: "niceeval-agents" })`。

## 再接一个后端

两条路,取决于新后端是不是打算贡献回 niceeval:

- **贡献进 niceeval**(像 docker/vercel/e2b 那样内置):实现 `Sandbox` 接口的一个类(`create()` + `workdir` + run/read/write/stop/up-down-load;路径解析直接用 `src/sandbox/paths.ts`,不要自己再写一份),在 `sandbox/resolve.ts` 的 `resolveSandbox` / `createBackend` 加一个 `case`,需要带参数就在 `types.ts` 加一个 `XxxSandboxSpec` 并在 `define.ts` 加工厂。
- **只在自己项目里用,不改 niceeval**:用 [`defineSandbox`](adapters/README.md)(`niceeval/sandbox` 导出)——传 `create()` 直接产出一个实现 `Sandbox` 接口的实例,`resolve.ts` 认到 `create` 就直接调用,跳过内置 backend switch,不需要 niceeval 认识这个后端的名字:

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

**核心定义接口,后端各自实现**,两条路都不改核心其余部分。niceeval 的沙箱抽象刻意保持小(只需 run/read/write/stop),让接一个新后端的成本最低。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心只固定两头,中间全部交给这条 eval 的 `test(t)`:

```text
 createSandbox(backend, timeout)
  → git init && git commit               # 打一次空基线,供之后 diff——不管 test() 里写了什么
  → SandboxAgent.setup?.(sandbox, ctx)   # agent 自己的一次性预置(装 CLI / 写主配置)
  → test(t)                              # ← 交给 eval 作者,顺序由它自己决定:
  │    t.sandbox.writeFiles(...) / uploadFiles(...) / uploadDirectory(...)  # 默认落到 workdir
  │    t.send()                            #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events)
  │    t.sandbox.runCommand(...)           #   手工跑校验命令,cwd 默认 workdir(可以晚于 t.send(),agent 天然看不到)
  │    断言…                               #   t.sandbox.fileChanged / t.sandbox.diff / t.check(commandSucceeded)
  → collectGeneratedFiles()              # git diff HEAD
  → sandbox.stop()                       # 销毁
```

核心只固定两件事:**沙箱创建时打一次空 git 基线**,和**销毁前采一次 diff**——这两件事跟"里面放了什么文件"无关,核心不需要知道也不需要预设目录约定。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval Authoring · 沙箱型](eval-authoring.md#沙箱型手工把文件放进沙箱)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。后端保证 `workdir` 存在且对非 root 用户可写;命令工作目录用 `runCommand` / `runShell` 的 `cwd` option 表达,默认 `workdir`,不提供可变的 `setWorkingDirectory`。预置放哪见下节。

## 环境预置放哪

要在跑 agent 前准备环境,按职责分摊到三处已有的地方——**每一处都是普通代码,不是框架编排**:

| 要准备的东西 | 放哪 | 怎么清理 |
|---|---|---|
| 连 agent、装 CLI、写 agent 自己的主配置(每 attempt 一次) | [`SandboxAgent.setup`](adapters/contract.md#agent-契约) | 随沙箱销毁,无需手工清 |
| **这条 eval** 的沙箱预置(写 `.env`、装依赖、按 `t.flags` 注入 skill) | `test(t)` 里的普通代码(`t.sandbox.writeFiles` / `runCommand`) | 随沙箱销毁;要清沙箱外的东西用 `try/finally` |
| **整轮共享**的外部服务(mock API、共享 DB、license) | 外部编排:`docker compose up -d && niceeval exp … && docker compose down`,或 CI 脚本 | 外部编排负责,URL 经 env 传入 agent / eval |

为什么这样够用:沙箱内的东西随沙箱销毁自动没了,不需要 teardown;整轮共享的外部资源用 `docker compose` / CI 脚本起停是业界通行做法,比一个 niceeval 专属钩子更少要维护、也不把资源起停逻辑锁进框架。这与"没有隐式 fixture 发现、起始文件手工写进 `test()`"是同一条纪律:**能用更基础的机制表达的,就不在框架里再造一层。**

## 性能:复用与预热

沙箱冷启动是关键路径上的大头。两个杠杆:

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **跨 case 复用** —— 同 runtime 的沙箱在一个 case 跑完后重置(`git clean` 回基线)而非销毁,给下一个 case 用。需权衡"复用省时" vs "全新更干净",默认全新,可开复用。

这些是 [Runner](runner.md) 的调度职责,沙箱后端只需支持 reset / 快速 create。

## 相关阅读

- [Adapter 契约](adapters/contract.md) —— Adapter 如何通过 `Sandbox` 接口驱动 agent,以及 `setup` 的义务。
- [Runner](runner.md) —— 并发、预热、复用的调度。
- [Vision](vision.md) —— 后端名只用于路由,不进核心行为。
