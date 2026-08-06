# Git

## 证据范围

本页固定到 Git 官方仓库提交 [`2c78326f810173a4f3aefd8021f1e07575412481`](https://github.com/git/git/tree/2c78326f810173a4f3aefd8021f1e07575412481)。

主要源文件：

- [`t/README`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/t/README)：测试入口、子进程变量、输出与选择器。
- [`t/test-lib.sh`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/t/test-lib.sh)：每脚本隔离现场、trash directory 与 TAP harness。
- [`t/test-lib-functions.sh`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/t/test-lib-functions.sh)：断言和 `test_when_finished`。
- [`t/lib-git-daemon.sh`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/t/lib-git-daemon.sh)：daemon readiness、PID、kill 与 wait。
- [`t/t0303-credential-external.sh`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/t/t0303-credential-external.sh)：外部 credential 子进程协议测试。
- [`ci/run-build-and-tests.sh`](https://github.com/git/git/blob/2c78326f810173a4f3aefd8021f1e07575412481/ci/run-build-and-tests.sh)：CI 对构建与测试入口的调用。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** 常规测试从 build tree 运行，`bin-wrappers/` 让脚本命中刚构建的 Git 及其子程序。
`t/README` 还定义 `GIT_TEST_INSTALLED`，用于把同一套 shell tests 指向已经安装的 Git。

**推断。** Git 的关键模式是“测试逻辑不决定 candidate 怎么产生”。build tree 和 installed tree 只改变 executable 查找入口，测试语义保持不变。

## 2. 临时真实 repo fixture 怎样创建和隔离

**事实。** `test-lib.sh` 为每个测试脚本建立独立的 `trash directory.tNNNN-*`，切换工作目录并初始化真实 Git repository。
它把 HOME 等用户状态重定向到测试目录，减少宿主配置影响。测试再在该目录中创建 bare repo、worktree 和 remote。

**推断。** 隔离单位是“测试脚本”，不是每个 `test_expect_success`。这适合 Git 的顺序式 journey，但不适合默认并行的 TypeScript test case。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** harness 输出 TAP。命令输出通常重定向到独立文件，再用 `test_cmp`、`test_must_be_empty`、`grep` 等比较函数检查。
预期失败使用 `test_must_fail`，避免仅依赖 shell 的真假值。Git 的核心协议主要是文本，不以通用 JSON matcher 为中心。

**推断。** 值得采用的是 stream 与 exit 分离，以及预期失败必须显式声明。大量 shell 文本拼接和命令级 `grep` 不适合作为 NiceEval 的结构化 oracle。

## 4. plugin 或外部进程协议怎样分层

**事实。** Credential tests 在 PATH 放入真实 credential 可执行文件，由 Git 按 credential protocol 通过 stdin/stdout 交互。
Remote protocol、filter 和 daemon tests 也从外部进程边界观察 argv、子进程变量、协议文本与退出状态。

**推断。** Git 没有把“调用了内部函数”当协议证明。NiceEval adapter 的 local-protocol lane 也应启动真实 leaf executable。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** 开发者用 `make test` 或直接运行 `tNNNN-*.sh`。CI 经 `ci/run-build-and-tests.sh` 回到同一 test suite，并通过子进程变量选择 sanitizer、平台和变体。
部分 CI job 使用容器或特殊宿主，但产品断言仍在 `t/` 中，而不是复制一套 Docker 专用测试。

**事实边界。** 本次证据没有显示 Git 把 secret-backed live service 建成统一核心 lane。网络相关测试大多由本地 daemon 或专用 CI 条件承担。

## 6. 长流程 journey 与资源 cleanup 怎样验证

**事实。** 一个脚本内可以按顺序建立 repository 历史，再运行 clone、fetch、push 等 journey。
`test_when_finished` 注册 LIFO cleanup。`lib-git-daemon.sh` 保存 PID，等待服务就绪，并在 cleanup 中 kill 后 wait。

**推断。** Git 证明 cleanup 不能只发送终止信号。等待子进程回收是协议的一部分；NiceEval 还应进一步验证端口和后端资源可重新取得。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** Git 把大量用户行为集中在 `t/` 的命令级 tests，共用 `test-lib`。同一脚本可用子进程变量或 prerequisite 验证不同 backend 和 feature 变体。
选择器允许按脚本或 case 精确重跑，避免为 CI 另写行为副本。

**推断。** 共用 harness 与变体选择值得采用。顺序式大脚本中的隐式状态不值得照搬，因为它让 case ownership 和并行边界更难审计。

## 对 NiceEval 的直接启示

- 保留 build artifact 与 installed artifact 共用同一 suite 的能力。
- 把预期非零退出建成显式断言，不能让 harness 把任意失败解释为成功。
- cleanup 要 kill、wait，再验证资源可重新取得。
- 不采用跨 case 的隐式 repository 状态；每个 scenario repo 应拥有自己的工作目录和生命周期。
