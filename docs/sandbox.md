# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。它把隔离环境的全部特殊性关进一个统一接口,让 [Adapter](agents-and-adapters.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 一套干净环境,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,环境随后销毁。

## 统一接口

```typescript
interface Sandbox {
  runCommand(cmd: string, args?: string[], opts?: {
    env?: Record<string, string>;
    cwd?: string;
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

接口刻意只暴露"跑命令 + 读写文件 + 工作目录 + 起停"这几样 —— 所有后端都能实现,且足够支撑 agent 评测的全流程。

## 后端选择

```typescript
type SandboxBackend = "docker" | "vercel" | "auto" | string;
```

`auto` 按环境探测:有云 token(如 `VERCEL_TOKEN`)→ 用云;否则 → 用 Docker。也可显式 `--sandbox docker`。解析逻辑收在 `sandbox/resolve.ts`,**核心不按后端名分支**,只调 `createSandbox(opts)` 拿回一个 `Sandbox`。

```typescript
// sandbox/resolve.ts
export function resolveBackend(opts): SandboxBackend {
  if (opts.backend && opts.backend !== "auto") return opts.backend;
  if (process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN) return "vercel";
  return "docker";
}

export async function createSandbox(opts): Promise<Sandbox> {
  switch (resolveBackend(opts)) {
    case "docker": return DockerSandbox.create(opts);
    case "vercel": return VercelSandbox.create(opts);
    default:       return loadThirdPartySandbox(opts);   // 插件式三方后端
  }
}
```

## Docker 后端(默认,零云依赖)

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 `sleep infinity` 容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时清理)。
- **非 root 用户** —— 以 `1000:1000` 跑命令;全局 npm 装到用户目录并入 `PATH`,避免权限问题。
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

## 三方后端(插件式)

`createSandbox` 的 `default` 分支留给三方沙箱服务(E2B、Modal、Daytona、Anthropic Sandbox Runtime 等)。约定:三方后端实现同一个 `Sandbox` 接口并以包名注册,`--sandbox e2b` 即用。

这与 crabbox 的 provider 模型同构:**核心定义接口,后端各自实现**,新后端不改核心。fastevals 的沙箱抽象刻意保持小(只需 run/read/write/cwd/stop),让接一个三方后端的成本最低。

## 沙箱在生命周期里的位置

一次 agent eval 中,核心(而非 Adapter)编排沙箱:

```text
createSandbox(backend, timeout)
  → uploadFiles(workspaceFiles)          # 只传 agent 可见的(藏起 EVAL.ts)
  → git init && git commit               # 打基线,供之后 diff
  → hooks.sandbox.setup?.(sandbox, ctx)  # 用户预置钩子,可返回 cleanup 闭包
  → npm install                          # 装 fixture 依赖
  → Adapter.run({ sandbox, ... })        # ← 唯一交给 Adapter 的一段
  → uploadFiles(testFiles)               # 现在才传 EVAL.ts
  → runValidation()                      # 跑测试 + scripts
  → collectGeneratedFiles()              # git diff HEAD
  → hooks.sandbox.teardown?.() / cleanup()  # 用户清理钩子(finally,失败也跑)
  → sandbox.stop()                       # 销毁
```

把沙箱编排放在核心(`adapters/shared.ts`)而非每个 Adapter 里,是为了让"传文件、打基线、采 diff、跑验证"对所有 agent 严格一致 —— Adapter 只管"在沙箱里把 agent 跑起来"这一段。`hooks.sandbox.setup` / `teardown` 是留给用户在这条固定编排里插自己环境逻辑的缝,成对出现、`teardown` 必在 `finally` 跑,完整模型见 [Lifecycle](lifecycle.md)。

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
