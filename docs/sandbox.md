# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。它把隔离环境的全部特殊性关进一个统一接口,让 [Adapter](agents-and-adapters.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 一套干净环境,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,环境随后销毁。

## 后端统一接口

```typescript
interface Sandbox {
  runCommand(cmd: string, args?: string[], opts?: {
    env?: Record<string, string>;
    cwd?: string;
    root?: boolean;   // 以 root 跑(默认 false → 非 root);见下「用户与 root」
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  runShell(script: string, opts?): Promise<CommandResult>;   // 整段 shell

  readFile(path: string): Promise<string>;
  writeFiles(files: Record<string, string>): Promise<void>;
  uploadFiles(files: SandboxFile[]): Promise<void>;          // 批量(可含二进制)

  getWorkingDirectory(): string;
  setWorkingDirectory(path: string): void;

  stop(): Promise<void>;
}
```

这是后端实现和 runner 使用的底层接口,所以包含 `stop()`。eval 作者在 `test(t)` 里拿到的是 author-facing 的 `t.sandbox`:只暴露文件 IO、命令执行和结果断言 / diff,不暴露 `stop()`。沙箱生命周期由 runner 统一管理。

## 用户与 root

**默认非 root,按需提 root** —— 命令默认以沙箱的标准**非 root** 用户跑(agent 的自然环境:安全,且 Claude Code 等在 root 下会拒绝 `--dangerously-skip-permissions`)。需要 root 的命令(setup 装系统依赖:`apt-get install …`、`pip install --break-system-packages …`)给 `runCommand` 传 `{ root: true }`。

```typescript
// eval setup:只有装系统依赖这步提 root;其余(含 agent、验证)默认非 root。
await sandbox.runCommand("apt-get", ["install", "-y", "openjdk-17-jdk"], { root: true });
await sandbox.runCommand("npm", ["install"]);   // 默认非 root
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

## 后端选择

```typescript
type SandboxBackend = "docker" | "vercel" | "e2b" | "auto" | string;
```

`auto` 按环境探测:有 `VERCEL_TOKEN` → vercel;否则有 `E2B_API_KEY` → e2b;否则 → docker。也可显式 `--sandbox docker`。解析逻辑收在 `sandbox/resolve.ts`,**核心不按后端名分支**,只调 `createSandbox(opts)` 拿回一个 `Sandbox`。

```typescript
// sandbox/resolve.ts
export function resolveBackend(opts): SandboxBackend {
  if (opts.backend && opts.backend !== "auto") return opts.backend;
  if (process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN) return "vercel";
  if (process.env.E2B_API_KEY) return "e2b";
  return "docker";
}
```

## Sandbox 作为数据结构(带参数)

后端名只是个字符串,带不了参数。和 [agent](agents-and-adapters.md) 一样,sandbox 也能用**数据结构**定义,于是每个后端可带自己的参数。工厂函数(从 `fasteval` 导出)产出 spec,放进 `config.sandbox` 或 `experiment.sandbox`;字符串后端名仍然兼容。

```typescript
import { dockerSandbox, vercelSandbox, e2bSandbox } from "fasteval";

dockerSandbox({ image: "fasteval-agents:node24" })  // docker:指定镜像
vercelSandbox({ snapshotId: "snap_xxx" })            // vercel:从快照起
e2bSandbox({ template: "fasteval-agents" })          // e2b:指定模板

// 仍可用字符串:sandbox: "docker" / "vercel" / "e2b"
```

`sandbox: SandboxBackend | SandboxSpec`。`sandbox/resolve.ts` 把两种形式都归一化成 `{ backend, image?, snapshotId?, template?, runtime? }`,再按 `backend` 派发到各后端的 `create()` —— **核心仍不按后端名分支**,参数只在对应后端的 `create()` 里消费。

参数的典型用途是**预制模板**:把 agent CLI 烘焙进镜像/模板,让后续 eval 跳过安装直接开跑(见 [`sandbox/`](../sandbox/README.md))。

## Docker 后端(默认,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 `sleep infinity` 容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **非 root 用户(默认)** —— 默认以 `1000:1000`(node)跑命令;全局 npm 装到用户目录并入 `PATH`,避免权限问题。命令传 `{ root: true }` 时改以 root 跑(见「用户与 root」)。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧解析。
- **超时** —— 命令级超时,到点销毁流并报错。

```typescript
const sandbox = await createSandbox({ backend: "docker", runtime: "node24", timeout });
await sandbox.uploadFiles(workspaceFiles);
await sandbox.runCommand("npm", ["install"]);
```

## Vercel Sandbox 后端(云,可弹性扩并发)

需要 `VERCEL_TOKEN` / `VERCEL_OIDC_TOKEN`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的流式命令超时(detached + 重连),长命令不被中途掐断。
- 批量 `writeFiles` 上传。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种后端间切换。

## E2B 后端(云,微 VM)

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;省略 `template` 用 e2b 默认 `base`(自带 node20)。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`{ root: true }` → `{ user: "root" }`。
- 文件用 `files.read` / `files.write`(文本 + 二进制)。
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作记录。要 node24 / 烘焙好 agent CLI,用[预制模板](../sandbox/README.md) `e2bSandbox({ template: "fasteval-agents" })`。

## 再接一个后端

新后端只需:实现 `Sandbox` 接口的一个类(`create()` + run/read/write/cwd/stop/up-down-load),在 `sandbox/resolve.ts` 的 `resolveSandbox` / `createBackend` 加一个 `case`,需要带参数就在 `types.ts` 加一个 `XxxSandboxSpec` 并在 `define.ts` 加工厂。

**核心定义接口,后端各自实现**,新后端不改核心其余部分。fasteval 的沙箱抽象刻意保持小(只需 run/read/write/cwd/stop),让接一个新后端的成本最低。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心只固定两头,中间全部交给这条 eval 的 `test(t)`:

```text
createSandbox(backend, timeout)
  → git init && git commit               # 打一次空基线,供之后 diff——不管 test() 里写了什么
  → hooks.sandbox.setup?.(sandbox, ctx)  # 用户预置钩子,可返回 cleanup 闭包
  → test(t)                              # ← 交给 eval 作者,顺序由它自己决定:
  │    t.sandbox.writeFiles/uploadFiles    #   手工写入起始文件,放哪个路径你说了算
  │    t.send()                            #   驱动 agent(Adapter 在沙箱里跑 CLI,解析成 events)
  │    t.sandbox.runCommand()              #   手工跑校验命令(可以晚于 t.send(),agent 天然看不到)
  │    断言…                               #   t.sandbox.fileChanged / t.sandbox.diff / t.check(commandSucceeded)
  → collectGeneratedFiles()              # git diff HEAD
  → hooks.sandbox.teardown?.() / cleanup()  # 用户清理钩子(finally,失败也跑)
  → sandbox.stop()                       # 销毁
```

核心只固定两件事:**沙箱创建时打一次空 git 基线**,和**销毁前采一次 diff**——这两件事跟"里面放了什么文件"无关,核心不需要知道也不需要预设目录约定。中间"传什么文件、传到哪、什么时候调 agent、什么时候手工跑测试"全部是 `test(t)` 里的普通代码决定,不是核心的固定编排,详见 [Eval Authoring · 沙箱型](eval-authoring.md#沙箱型手工把文件放进沙箱)——Adapter 也只管 `t.send()` 触发的那一次"在沙箱里把 agent 跑起来"。author-facing 的 `t.sandbox` 同时承载立即 IO / 命令执行和最终 diff / 文件变化视图,但不暴露 `stop()`。`hooks.sandbox.setup` / `teardown` 是留给用户在"创建"和"销毁"这两头插自己环境逻辑的缝,成对出现、`teardown` 必在 `finally` 跑,完整模型见 [Lifecycle](lifecycle.md)。

## 性能:复用与预热

沙箱冷启动是关键路径上的大头。两个杠杆:

- **预热池** —— 提前起若干沙箱挂在池里,case 来了直接领,把冷启动移出关键路径。
- **跨 case 复用** —— 同 runtime 的沙箱在一个 case 跑完后重置(`git clean` 回基线)而非销毁,给下一个 case 用。需权衡"复用省时" vs "全新更干净",默认全新,可开复用。

这些是 [Runner](runner.md) 的调度职责,沙箱后端只需支持 reset / 快速 create。

## 相关阅读

- [Agents 与 Adapters](agents-and-adapters.md) —— Adapter 如何通过 `Sandbox` 接口驱动 agent。
- [Lifecycle](lifecycle.md) —— `setup` / `teardown` 与复用 / 预热的嵌套关系。
- [Runner](runner.md) —— 并发、预热、复用的调度。
- [Vision](vision.md) —— 后端名只用于路由,不进核心行为。
