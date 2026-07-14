# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。它把隔离环境的全部特殊性关进一个统一接口,让 [Adapter](../adapters/README.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 一套干净环境,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,环境随后销毁;要进活现场 debug 时用 [`--keep-sandbox`](cli.md) 显式留存,事后 `niceeval sandbox stop` 清理。

## provider 统一接口

```typescript
interface Sandbox {
  /** agent 的默认工作目录;所有沙箱侧相对路径的解析基准。见 Library「路径与 workdir」。 */
  readonly workdir: string;
  /** provider 原生的实例 id(如 Docker 容器 ID 前缀);用于关联日志、排查问题。 */
  readonly sandboxId: string;
  /**
   * 沙箱内回连宿主 OTLP 端口用的 hostname(docker 是 `host.docker.internal` 之类);
   * 远程云沙箱够不着宿主本地端口时为 `null` → 跳过 tracing。
   */
  readonly otlpHost: string | null;

  // 命令执行
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;  // argv,不经 shell
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;                  // 整段 shell

  // 文件 IO(相对路径 → workdir;targetDir 省略 → workdir)
  readFile(path: string): Promise<string>;                      // 文本;不存在直接抛
  fileExists(path: string): Promise<boolean>;
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;  // 一次往返读全部源码
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;  // 批量,可含二进制
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  downloadFile(path: string): Promise<Buffer>;                  // 二进制读
  uploadFile(path: string, content: Buffer): Promise<void>;     // 二进制写

  // 生命周期
  stop(): Promise<void>;

  /** 可选:写一行进沙箱的原生日志流(于是 `docker logs` 能实时看到 agent 活动)。 */
  appendLog?(line: string): Promise<void>;
}

interface CommandOptions {
  env?: Record<string, string>;   // 叠加在沙箱默认环境之上,不清空默认值
  cwd?: string;                   // 省略 → workdir;相对路径 → 解析到 workdir 下
  root?: boolean;                 // 以 root 跑(默认 false → 非 root);见 Library「用户与 root」
  stream?: boolean;               // 把本命令输出也送进沙箱原生日志流(不支持的 provider 忽略)
}
```

这是 provider 实现和 runner 使用的底层接口,所以包含 `stop()`。eval 作者在 `test(t)` 里拿到的是 author-facing 的 `t.sandbox`:只暴露文件 IO、命令执行和结果断言 / diff,不暴露 `stop()`。沙箱生命周期由 runner 统一管理。

`readSourceFiles` 返回的 `SourceFiles` 仍是一个 `SourceFile[]`(`.filter` / `.map` 照用),额外挂了 `text()` / `code()`(剥注释)/ `fileMatching(re)` / `fileMatchingAll(res)` / `hasPath(re)` 几个便利方法,省掉每个 eval 目录里手写的 source helper。`appendLog` 是可选方法:声明了意图的 adapter 照调,provider 没实现就是 no-op。

### 为什么 `runCommand` 和 `runShell` 不合并成一个

`runCommand` 按 argv 数组传参,不经过 shell 解析——参数原样传给进程,天然不怕参数里带引号、`$`、`;`、反引号等特殊字符,也没有 shell 注入风险。`runShell` 接受一整段脚本交给 shell 解释,专门给需要管道、`&&`、通配符这类 shell 语义的场景用。

这不是两个方法碰巧长得像,是故意保留的两种不同意图:eval 里的命令参数经常来自数据集字段或 agent 生成的输出,内容不可控——比如 `runCommand("./verify.sh", [row.filename])`,`row.filename` 就算是 `"a; rm -rf /workspace"` 这种字符串,argv 形式下也只是一个普通参数值,不会被解释成两条命令。如果合并成一个走 shell 的 `run(cmd: string)`,调用者就必须自己把每个动态值转义成安全的 shell 字符串才能拼进去,一旦漏转义就是真实的命令注入。

参考过 eve.dev 的 `sandbox.run({ command })`(它下面所有 provider 都固定走 `bash -lc`,靠调用者自己用 `shellQuote()` 转义)——那套设计合理,是因为 eve 的调用方几乎都是 AI agent 自己的 bash 工具或内部工具核心,生成一整段 shell 命令本来就是它们的原生表达方式,shell 语义是刚需。niceeval 的调用方是写 eval 的人,大多数调用(`runCommand("npm", ["test"])`)根本不需要 shell 语义,不该为了少数需要管道/`&&`的场景让所有调用都背上手动转义的心智负担。

## 相关阅读

- [Library](library.md) —— 路径与 workdir、用户与 root、provider 选择、生命周期钩子、自定义 provider。
- [预制环境](library/prebuilt-environments.md) —— 把稳定依赖做成 image / template / snapshot,attempt 直接从产物起。
- [CLI](cli.md) —— `--keep-sandbox` 留存失败现场与 `niceeval sandbox list` / `stop` 的完整生命周期。
- [操作 Sandbox](library/operations.md) —— eval 里怎样读写文件和运行命令。
- [断言 Sandbox 结果](library/asserting-results.md) —— 怎样判断 diff、文件和 shell 行为。
- [Architecture](architecture.md) —— provider 内部实现、生命周期在 attempt 里的位置、性能与重试。
- [Sandbox Agent](../adapters/library/sandbox-agent.md) —— Adapter 如何通过 `Sandbox` 接口驱动 agent。
- [Runner](../../runner.md) —— 并发、预热、复用的调度。
