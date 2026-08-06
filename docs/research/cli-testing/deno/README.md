# Deno

## 证据范围

本页固定到 Deno 官方仓库提交 [`8af9351772ab207caef0ff2bdec209a1178a9eb2`](https://github.com/denoland/deno/tree/8af9351772ab207caef0ff2bdec209a1178a9eb2)。

主要源文件与目录：

- [`tests/util/src/test_context.rs`](https://github.com/denoland/deno/blob/8af9351772ab207caef0ff2bdec209a1178a9eb2/tests/util/src/test_context.rs)：候选 binary、测试上下文与 command builder。
- [`tests/util/src/test_command.rs`](https://github.com/denoland/deno/blob/8af9351772ab207caef0ff2bdec209a1178a9eb2/tests/util/src/test_command.rs)：stdout、stderr、exit、signal 与 assertion guard。
- [`tests/util/src/temp_dir.rs`](https://github.com/denoland/deno/blob/8af9351772ab207caef0ff2bdec209a1178a9eb2/tests/util/src/temp_dir.rs)：临时目录与 fixture copy。
- [`tests/util/server`](https://github.com/denoland/deno/tree/8af9351772ab207caef0ff2bdec209a1178a9eb2/tests/util/server)：本地 HTTP、npm 与协议测试服务。
- [`cli/lsp/testing`](https://github.com/denoland/deno/tree/8af9351772ab207caef0ff2bdec209a1178a9eb2/cli/lsp/testing)：真实 `deno lsp` 子进程和 JSON-RPC 测试。
- [`.github/workflows/ci.yml`](https://github.com/denoland/deno/blob/8af9351772ab207caef0ff2bdec209a1178a9eb2/.github/workflows/ci.yml)：构建输出与 CI test jobs。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** Test context 通过 `deno_exe_path` 查找当前构建的 Deno executable，也允许由显式子进程变量替换路径。
CI 先产生 binary，再让 integration tests 复用它，避免每个测试重新编译 CLI。

**推断。** 候选路径应属于 suite input。测试正文不应从 PATH 猜测，也不应在 case 内触发隐式 rebuild。

## 2. 临时真实 project fixture 怎样创建和隔离

**事实。** Test context 创建 TempDir，把 testdata 复制到真实磁盘目录，并为命令分配隔离的 `DENO_DIR`。
需要网络语义时，tests 连接仓库内的 HTTP、npm、WebSocket 等本地 servers，而不是访问任意公网 endpoint。

**推断。** Deno 的隔离点同时包含 project 与 global cache。NiceEval 也必须隔离 HOME、cache、record root 和 adapter state，不能只复制 repo。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** Command result 能分别或合并捕获 stdout/stderr，并检查 exit code 或 signal。
测试既使用稳定文本 fixture，也使用 wildcard 和 JSON 子集匹配。`TestCommandOutput` 在 Drop 时检查关键输出或非零退出是否被消费。

**推断。** Assertion guard 是最值得直接采用的机制。Wildcard 应只吸收路径、时间或端口等已声明不稳定字段，不能替代 schema 断言。

## 4. plugin 或外部进程协议怎样分层

**事实。** LSP integration 启动真实 `deno lsp`，按 `Content-Length` framing 发送和读取 JSON-RPC。
npm、Node compatibility 与 permissions tests 也通过真实子进程和本地 server 观察跨进程行为。

**推断。** 协议测试应同时拥有 wire oracle 和用户结果 oracle。对 NiceEval 来说，这对应 adapter request/response framing 与最终 Attempt evidence。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** 本地和 CI 复用 Rust integration harness。CI 构建一次 candidate，再按平台和 suite 切分。
ecosystem 与 Node compatibility 有定时或独立 lane，可使用 canary 观察更大依赖面。

**事实边界。** 本次证据没有证明核心 Deno suite 以 Docker 作为统一入口。Canary ecosystem 也不等同于精确 release candidate 验收。

## 6. 长流程 journey 与资源 cleanup 怎样验证

**事实。** Integration tests 可以连续启动 CLI、server 或 LSP，等待 readiness，交换多轮消息，再执行 shutdown。
TempDir、server 与 child handles 由 test context 持有，离开作用域时回收。

**推断。** Guard 仍需要显式等待退出。NiceEval 应额外保存 cleanup receipt，并验证端口或 run-owned resource 消失。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** Deno 把 CLI spec、integration、LSP/npm protocol 和 ecosystem compatibility 分开。各层共享命令执行、上下文与 server 管理代码，而不是为每类宿主条件复制产品断言。

**推断。** NiceEval 可复制这种“共用机制、分开风险 owner”的结构。不要复制广泛 flaky retry；retry 只能属于分类后的基础设施错误。

## 对 NiceEval 的直接启示

- 为 ProcessResult 加 assertion ledger，未消费的非空 stream 或失败状态使测试失败。
- Fixture root 与 global cache 必须同时隔离。
- 协议必须用真实进程和真实 framing 验证。
- Ecosystem/canary lane 不能替代精确候选 tarball 的 release lane。
