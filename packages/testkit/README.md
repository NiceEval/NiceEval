# @niceeval/testkit

NiceEval 场景 Repo 共用的机械测试设施。它只负责进程收据、严格解码、等待、临时资源、artifact staging、真实 PTY 和资源终结，
不包含 NiceEval 领域动作或 expected。

`createE2EContext()` 把调用方提供的具名命令前缀绑定到每个 case 的私有项目副本，
回收该 case 启动的进程，然后暂存调用方声明的路径。产品 argv 和 expected 仍留在测试正文。

`ProcessReceipt.expReceipt()` 严格读取 `niceeval exp --json` 的 `start → 中间事件 → receipt`
边界，并返回最后唯一一条 `InvocationReceipt`。它不折叠 Verdict 或 Attempt，也不替测试决定 expected；
这些业务事实必须从中间 `eval` 事件或 receipt 的 Record Runs 读取。

根 E2E runner 会对当前 checkout clean-build 此 private package，并仅在隔离的场景副本中以本地
directory dependency 安装它。Testkit 不会被打包、上传或作为发布产物消费，也不会写共享的
`packages/testkit/dist`。

## runPty — 真实 PTY

`runPty(argv, options)` 把产品 argv 跑在一个**真实 Linux PTY** 上（子进程的 `stdout.isTTY === true`），
并把收据作为 `ProcessReceipt` 返回：

```ts
const receipt = await runPty(["node", "script.mjs"], { columns: 120, rows: 40, timeoutMs: 30_000 });
```

### 能力

- **传输**：util-linux `script`（`-q -f -e`，typescript 日志写 `/dev/null`）；每个 argv 元素按 POSIX
  单引号转义后在会话内重建，产品保留原始 argv。
- **真实窗口尺寸**：`columns`/`rows` 通过会话内 `stty cols N rows M` 设置 PTY 的内核 winsize——
  子进程的 `process.stdout.columns/rows` 反映真实尺寸（仅设 `COLUMNS`/`LINES` 环境变量对 PTY 无效）。
  传入时也会导出 `COLUMNS`/`LINES` 作为读环境变量的应用的兼容值，但验收以 winsize 为准。
- **色彩**：不设置 `NO_COLOR`，不剥离 ANSI——子进程自己的颜色策略完整保留。
- **行尾**：PTY 行规则把 `\n` 变成 `\r\n`，收据统一规范化为 `\n`；除此之外输出逐字节保留，不吞普通输出。
- **退出码**：`script -e` 返回子进程自身退出码；`timeoutMs` 超时先 SIGTERM 后 SIGKILL 并在收据标记 `timedOut`。
- 收据的 `transport: "pty"` 与 `diagnostic()` 一起保留传输诊断。

### 边界

- **仅 Linux**：需要 util-linux `script` 与 coreutils `stty`。缺 `script` 时抛出
  `PtyUnavailableError`，消息给出安装提示；窗口尺寸非正整数在启动前抛 `TypeError`。
- **单输出流**：PTY 只有一个输出通道——子进程的 stdout 与 stderr 都汇入收据的 `stdout`（`stderr` 通常为空）。
- `cwd`/`env`/`timeoutMs` 显式传入；`env` 与进程环境合并（传入时覆盖同名变量）。
