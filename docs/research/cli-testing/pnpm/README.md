# pnpm

## 证据范围

本页固定到 pnpm 官方仓库提交 [`25437e2b8b416b1a016f9fdf4dcc5a51265f7497`](https://github.com/pnpm/pnpm/tree/25437e2b8b416b1a016f9fdf4dcc5a51265f7497)。

主要源文件与目录：

- [`crates/pnpm/tests`](https://github.com/pnpm/pnpm/tree/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/crates/pnpm/tests)：Rust CLI process tests。
- [`pnpm/test`](https://github.com/pnpm/pnpm/tree/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/pnpm/test)：TypeScript CLI tests。
- [`test/utils`](https://github.com/pnpm/pnpm/tree/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/test/utils)：project、store、registry 与 process support。
- [`pkg-manager/core/test`](https://github.com/pnpm/pnpm/tree/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/pkg-manager/core/test)：安装、hook、依赖求值与 fetcher 行为。
- [`pnpm/test/pnpmfile.ts`](https://github.com/pnpm/pnpm/blob/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/pnpm/test/pnpmfile.ts)：`.pnpmfile.cjs` 外部 hook 行为。
- [`.github/workflows/ci.yml`](https://github.com/pnpm/pnpm/blob/25437e2b8b416b1a016f9fdf4dcc5a51265f7497/.github/workflows/ci.yml)：OS、Node 与 suite 分片。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** Rust tests 通过 `cargo_bin("pnpm")` 一类查找并启动 candidate binary。
TypeScript tests 启动 workspace 构建出的 `bin/pnpm.mjs`，而不是依赖机器上任意全局 pnpm。

**推断。** 双入口是迁移现实，不是应追求的最终架构。NiceEval 应只保留一个 artifact 入口查找函数，并让所有 suite 消费同一 receipt。

## 2. 临时真实 project fixture 怎样创建和隔离

**事实。** Tests 创建临时 package project、store、cache 和本地 registry。Fixture 会写真实 `package.json`、lockfile、workspace 与 `node_modules`。
需要模拟可变 registry storage 时，会复制一份私有 storage，避免 case 间共享修改。

**推断。** package-manager 测试说明“project 临时目录”不够。所有用户级全局状态和服务端可变状态都必须有独立 owner。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** Rust 侧使用 process assertion 工具检查 exit、stdout 与 stderr。TypeScript 侧还检查 NDJSON reporter、lockfile、目录结构和 snapshot。
命令文本只是证据之一，安装结果必须由文件系统和 lockfile oracle 补足。

**推断。** NiceEval 的 CLI 输出、record tree 和 JSON schema 应组成三角验证。Snapshot 只拥有稳定文本，不能拥有语义数据结构。

## 4. plugin 或外部进程协议怎样分层

**事实。** `.pnpmfile.cjs` tests 让真实 pnpm 加载 hook，并验证自定义依赖求值与 fetcher 行为。
Registry 和某些辅助服务以独立 process 启动，测试等待 readiness 后再运行 CLI。

**推断。** Extension fixture 要住在普通 consumer project 中。直接 import hook module 只能证明函数，不能证明发现、加载和进程 wiring。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** CI 按 OS、Node、suite chunk 和 affected/full 选择测试，但复用 workspace scripts 和同一 test support。
仓库中的 Docker workflow 主要服务 release image 验证，不是所有行为测试的统一上层。带 secret 的存储服务属于专门基础设施。

**推断。** Docker 应是特定宿主风险的 owner，不能成为默认“真实性等级”。本地和 CI 必须先共享 repo runner 与 product assertion。

## 6. 长流程 journey 与资源 cleanup 怎样验证

**事实。** 独立 server process 有 readiness、tree-kill 和 wait。Teardown 会同时处理 process shutdown 与临时 storage 删除。
teardown 阶段可以聚合多个错误，避免第一个 cleanup failure 隐藏其它遗留资源。

**推断。** 这是 NiceEval 应直接采用的模式。主产品失败也必须与 cleanup failures 聚合，不能被 `finally` 中的第一个异常遮蔽。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** 共用 fixture 提供 project、store、registry 和 command 能力。模块 unit tests 与 CLI tests 各自验证算法和 wiring。
Rust/TypeScript 双测试栈仍存在行为重叠，这是实现迁移带来的维护成本。

**推断。** NiceEval 不应为了 runner 技术不同而复制 scenario。一个风险只分配给一个 owner，跨 runner 只共享框架中立 repo support。

## 对 NiceEval 的直接启示

- 把 repo、cache、`.niceeval` RecordStore、adapter state 和本地 server storage 都纳入隔离。
- Teardown 聚合所有失败，并等待整个 process tree 退出。
- Extension 要在真实 consumer repo 被发现和加载。
- 不长期维护两套等价 E2E harness。
