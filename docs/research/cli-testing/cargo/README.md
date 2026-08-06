# Cargo

## 证据范围

本页固定到 Cargo 官方仓库提交 [`0e07a155371a6ce88ae53a2c00df940280c09a67`](https://github.com/rust-lang/cargo/tree/0e07a155371a6ce88ae53a2c00df940280c09a67)。

主要源文件与官方文档：

- [Cargo Contributor Guide: Tests](https://doc.crates.io/contrib/tests/)：测试类别、运行方式和 fixture 约定。
- [`crates/cargo-test-support/src/paths.rs`](https://github.com/rust-lang/cargo/blob/0e07a155371a6ce88ae53a2c00df940280c09a67/crates/cargo-test-support/src/paths.rs)：测试根、HOME 与 Cargo home。
- [`crates/cargo-test-support/src/project.rs`](https://github.com/rust-lang/cargo/blob/0e07a155371a6ce88ae53a2c00df940280c09a67/crates/cargo-test-support/src/project.rs)：真实 project fixture builder。
- [`crates/cargo-test-support/src/process.rs`](https://github.com/rust-lang/cargo/blob/0e07a155371a6ce88ae53a2c00df940280c09a67/crates/cargo-test-support/src/process.rs)：命令、status、stdout 与 stderr 断言。
- [`crates/cargo-test-support/src/registry.rs`](https://github.com/rust-lang/cargo/blob/0e07a155371a6ce88ae53a2c00df940280c09a67/crates/cargo-test-support/src/registry.rs)：本地 registry fixture。
- [`tests/testsuite/credential_process.rs`](https://github.com/rust-lang/cargo/blob/0e07a155371a6ce88ae53a2c00df940280c09a67/tests/testsuite/credential_process.rs)：真实 credential 子进程与协议行为。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** Functional tests 通过 test support 的 Cargo command builder 启动当前构建输出。
底层使用 Cargo 提供的 binary path，而不是从宿主 PATH 猜测一个已安装版本。测试可单独运行，也可由 `cargo test` 统一调度。

**推断。** Cargo 是 NiceEval 最直接的参照：candidate 路径由 suite setup 查找一次，scenario test 只描述用户命令和期望。

## 2. 临时真实 project fixture 怎样创建和隔离

**事实。** `project.rs` 生成真实 `Cargo.toml`、source tree 和文件内容。`paths.rs` 为每例提供隔离 root，并重定向 HOME、`CARGO_HOME` 与 target 相关位置。
registry support 可以建立本地 index、crate archive 与 HTTP registry。Git/path dependency 也使用真实 repository 和文件系统。

**推断。** Fixture 不是 mock project object，而是 CLI 真正读取的磁盘项目。NiceEval 的 scenario repo 应保持同样边界。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** `process.rs` 的 fluent builder 分别声明预期 status、stdout 和 stderr。
它支持规范化不稳定路径与平台差异，也支持按行检查机器输出。UI tests 用受控 fixture 保存稳定诊断文本。

**推断。** NiceEval 应把 JSON 先严格 parse，再断言 schema 和关键字段。路径、耗时或随机 ID 可以规范化，但不能用通配符抹掉协议字段。

## 4. plugin 或外部进程协议怎样分层

**事实。** `credential_process.rs` 构建真实 credential binary，准备本地 registry，再让真实 Cargo 通过 credential process protocol 与它交互。
测试同时观察子进程的输入输出和 Cargo 的用户可见结果，而不是把进程边界替换成 Rust function mock。

**推断。** Adapter protocol 需要两层 oracle：一层验证 framing/argv/env，另一层验证 CLI 最终结果。二者不应合并成一次“调用成功”。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** 本地和 CI 运行相同 Rust test targets。`#[cargo_test(...)]` 一类测试属性声明 nightly、network、container 或平台 capability。
CI 用 OS 与 toolchain matrix 选择同一 suite 的适用部分，替代 backend 只运行它拥有的相关行为。

**事实边界。** 本次证据没有把 Docker 识别为所有 Cargo functional tests 的必经层。container 是显式 capability，不是“更真实”的默认升级。

## 6. 长流程 journey 与资源 cleanup 怎样验证

**事实。** Functional tests 可连续执行 publish、fetch、build、install 和 credential flow，并检查 registry、cache、lockfile 与生成文件状态。
TempDir、registry 和 container 生命周期由 guard 或 test teardown 管理，减少失败路径遗留资源。

**推断。** 长 journey 仍应在每一步保留独立证据。最终 exit 0 不能替代 lockfile、cache、artifact 与外部协议交互的断言。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** Contributor Guide 区分 unit、functional、UI 等类别。共用 test support 集中处理 project、registry、process 和路径规范化。
Capability 属性决定测试在哪里可运行，避免维护按 CI lane 复制的测试正文。

**推断。** NiceEval 应让风险而不是目录名拥有测试。纯 parser 错误由 unit 拥有，真实 CLI wiring 由 local E2E 拥有，secret provider 只拥有远端独有行为。

## 对 NiceEval 的直接启示

- 把 candidate binary、HOME、cache 与 registry 作为 TestContext 的固定组成。
- 让 scenario repo builder 只创建用户可见文件，不暴露内部 module shortcut。
- 对外部协议进程同时验证协议和最终用户结果。
- 用 capability preflight 解释 lane 缺失，不能用普通 skip 隐藏 candidate 不完整。
