# Sandbox —— 在哪里跑

沙箱回答"在哪里、如何隔离地运行 agent 命令"。
它把沙箱侧的全部特殊性关进一个统一接口,让 [Adapter](../adapters/README.md) 和核心都不必知道底下是 Docker 还是某个三方服务。

## 为什么需要沙箱

评一个 coding agent 意味着让一个 LLM 在真实文件系统上**执行任意命令**(装包、改文件、跑构建)。
这必须隔离:

- **安全** —— agent 可能跑出危险命令,不能碰你的机器。
- **可复现** —— 每个 case 从干净状态起步,互不污染。
- **可并发** —— 几十个 case 同时跑,各自独立。
- **可采集** —— 跑完用 `git diff` 取改动、读 transcript,Sandbox 随后销毁;要进活现场 debug 时用 [`--keep-sandbox`](cli.md) 显式留存,事后 `niceeval sandbox stop` 停止。

这些约束由容器 / 微 VM provider 兑现。`defineSandbox` 接入的自定义 provider 也必须由作者负责提供与其用途相符的隔离边界；NiceEval 不会替自定义实现补上文件系统、进程、网络或凭据隔离。

## 已封口事实的归属

Sandbox 负责创建、准备、复用和留存隔离实例，但它不拥有独立的可携带 Record family。一次 Attempt 封口时，Sandbox
相关事实与相邻运行事实按 capture authority 进入 Record 的九项 fixed catalog。family 名是稳定 identity；每份
Attachment envelope 的 `schemaVersion` 由对应 family 契约拥有：

| 事实 | family 与 owner |
|---|---|
| Adapter 解释、脱敏后的 terminal Turn 与 provider usage observation | origin Attempt 的 `niceeval.agent-turns` |
| 每个物理 `t.send` 当时已知的 source context | origin Attempt 的 `niceeval.turn-contexts` |
| Sandbox 受管命令的 manifest、唯一终态与安全 stream | origin Attempt 的 `niceeval.sandbox-commands` |
| 创建、prepare、命令与 Attempt / Run 阶段的 owner-local activity | origin Attempt 或 Run 的 `niceeval.runner-activities` |
| advisory 与 execution error | origin Attempt 或 Run 的 `niceeval.runner-diagnostics` |
| agent 归因的 workdir 文件变化轨迹、归因策略与采集状态 | origin Attempt 的 `niceeval.file-changes` |
| source frame 与可复现输入所需的源码闭包 | origin Run 的 `niceeval.sources` |
| diff Assertion 的 result、coverage 与 Evidence refs | origin Attempt 的 `niceeval.assertions` |
| 需要保留的大型、具类型对象 | Attempt 或 Run 的 `niceeval.artifacts` |

provider 的实例 id、池内承接序号、live / dormant 状态与 detached cleanup locator 只服务本次运行或留存注册表。
它们不成为可携带 Record 事实。销毁现场不会影响已经封口的九项 fixed catalog closure；恢复现场也不会把新的事实补写回旧 Attempt。

conversation、usage、commands、timing 与 diagnostics 只在 reader side 从上述 source 投影。source navigation
由 Turn Contexts、Runner Activities 与 origin Run Sources 形成 relation，不是 durable family。Adapter 不向
Record 交付 raw tape、frame、provider payload 或 secret。

持久事实不由 Sandbox API 直接读取。Analysis 以 `query()` 闭合发布的 `DomainView`，例如命令历史使用
`sandboxHistoryView`，文件变化使用 `fileChangesView`。这使 Sandbox 的运行能力与 Record 的读取能力保持分界。

## provider 统一接口

```typescript
interface Sandbox extends SandboxOperations, SandboxTransferOperations {
  /** agent 的默认工作目录;所有沙箱侧相对路径的解析基准。见 Library「路径与 workdir」。 */
  readonly workdir: string;
  /** provider 原生的实例 id(如 Docker 容器 ID 前缀);用于关联日志、排查问题。 */
  readonly sandboxId: string;
  /**
   * OTLP receiver 的放置能力:string 表示 provider 承诺该 hostname 可访问宿主 receiver;
   * null 表示不承诺宿主回连,runner 会尝试在 Sandbox 内启动 attempt-scope receiver。
   * null 不等于跳过 tracing,也不保证镜像具备 receiver 所需运行时。
   */
  readonly otlpHost: string | null;

  // 生命周期
  stop(): Promise<void>;

  /** 可选:写一行进沙箱的原生日志流(于是 `docker logs` 能实时看到 agent 活动)。 */
  appendLog?(line: string): Promise<void>;
}

```

`SandboxOperations` 与 `SandboxTransferOperations` 的完整签名、命令退出码、timeout / cancellation、文本/字节/传输分词都只在[操作 Sandbox](library/operations.md)定义。
这是 provider 实现和 runner 使用的底层接口,所以额外包含 `stop()`。
eval 作者在 `test(t)` 里拿到的是 author-facing `EvalSandbox`:复用同一操作词汇，只增加归因断言声明，不暴露 `stop()` 或 provider 元数据。
沙箱生命周期由 runner 统一管理。

文本读取只有一个 API:`readText(path)` 读一个文件。二进制读写使用 `readBytes` / `writeBytes`；`upload*` / `download*` 专指宿主机与 Sandbox 传输。

批量读、按扩展名过滤、拼接全文这类聚合是普通代码。已知路径直接循环 `readText`；未知路径可用 `runShell` 调 `find` / `cat`。

评「agent 改了什么」时用 `fileChanged` / `notInDiff` 等归因断言声明期望，不要重读整棵工作区；后者会混入起始 fixture。需要文件当前内容时用 `readText`。
不提供带过滤约定的批量读取器:过滤规则(哪些扩展名算源码、哪些目录该剪枝)因项目而异,收进 API 就成了约定式黑箱,违背「显式配置优先于约定」。
`appendLog` 是可选方法:声明了意图的 adapter 照调,provider 没实现就是 no-op。

### 为什么 `runCommand` 和 `runShell` 不合并成一个

`runCommand` 按 argv 数组传参,不经 shell 解释——参数原样传给进程,天然不怕参数里带引号、`$`、`;`、反引号等特殊字符,也没有 shell 注入风险。
`runShell` 接受一整段脚本交给 shell 解释,专门给需要管道、`&&`、通配符这类 shell 语义的场景用。

这不是两个方法碰巧长得像,是故意保留的两种不同意图。
eval 里的命令参数经常来自测试集字段或 agent 生成的输出,内容不可控。
比如 `runCommand("./verify.sh", [row.filename])`:`row.filename` 就算是 `"a; rm -rf /workspace"` 这种字符串,argv 形式下也只是一个普通参数值,不会被解释成两条命令。
如果合并成一个走 shell 的 `run(cmd: string)`,调用者就必须自己把每个动态值转义成安全的 shell 字符串才能拼进去,一旦漏转义就是真实的命令注入。

参考过 eve.dev 的 `sandbox.run({ command })`:它下面所有 provider 都固定走 `bash -lc`,靠调用者自己用 `shellQuote()` 转义。
那套设计合理,是因为 eve 的调用方几乎都是 AI agent 自己的 bash 工具或内部工具核心,生成一整段 shell 命令本来就是它们的原生表达方式,shell 语义是刚需。
niceeval 的调用方是写 eval 的人,大多数调用(`runCommand("npm", ["test"])`)根本不需要 shell 语义,不该为了少数需要管道/`&&`的场景让所有调用都背上手动转义的心智负担。

## 相关阅读

- [Sandbox Layer](layers.md) —— Eval / Experiment 的 `sandbox` 声明:template 配对、准备命令与顺序。
- [三方准备时序](lifecycle.md) —— link 规划、owner 顺序、fresh / reuse 次数与错误归属。
- [内置 prepare 命令](prepare-commands.md) —— `checkout()` / `installTool()` 官方写法与 `niceeval debug` 可证明边界。
- [Library](library.md) —— 路径与 workdir、执行身份、Provider 选择、准备命令、自定义 provider。
- [Case](case.md) —— 一份 Sandbox 声明的完整运行单位:五类 case、BuildKey / CaseKey、构建协调、Compose、能力矩阵。
- [预制实例](library/prebuilt-environments.md) —— 把稳定依赖做成 image / template / snapshot,attempt 直接从中启动。
- [Docker 执行配置](docker-profiles/README.md) —— raw与 managed DinD的 profile、私有 Docker data allocation、硬配额与故障回收。
- [CLI](cli.md) —— `--keep-sandbox` 留存失败现场与 `niceeval sandbox list` / `stop` 的完整生命周期。
- [Sandbox 复用](reuse.md) —— Experiment 用 `sandboxReuse: true` 声明多条 Attempt 可以共用 Sandbox；Provider 用 `lifetimeMs` 单独声明 Sandbox 存活时间。
- [CLI 用例](use-case/README.md) —— `--keep-sandbox` 的用户用例全流程。
- [操作 Sandbox](library/operations.md) —— eval 里怎样读写文件和运行命令。
- [断言 Sandbox 结果](library/asserting-results.md) —— 怎样判断 diff、文件和 shell 行为。
- [Architecture](architecture.md) —— provider 内部实现、生命周期在 attempt 里的位置、性能与重试。
- [Sandbox Agent](../adapters/library/sandbox-agent.md) —— Adapter 如何通过 `Sandbox` 接口驱动 agent。
- [Runner](../../runner.md) —— 并发、预热、复用的调度。
