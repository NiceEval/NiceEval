# OpenTofu

## 证据范围

本页固定到 OpenTofu 官方仓库提交 [`93f9c466bde0a4843096b0da5d346b14bbcc20bb`](https://github.com/opentofu/opentofu/tree/93f9c466bde0a4843096b0da5d346b14bbcc20bb)。

主要源文件与目录：

- [`internal/command/e2etest/main_test.go`](https://github.com/opentofu/opentofu/blob/93f9c466bde0a4843096b0da5d346b14bbcc20bb/internal/command/e2etest/main_test.go)：候选 `tofu` 的构建、预置 release binary 与 suite 生命周期。
- [`internal/command/e2etest`](https://github.com/opentofu/opentofu/tree/93f9c466bde0a4843096b0da5d346b14bbcc20bb/internal/command/e2etest)：command E2E、testdata、provider 与 provisioner 测试进程。
- [`internal/cloud/e2e`](https://github.com/opentofu/opentofu/tree/93f9c466bde0a4843096b0da5d346b14bbcc20bb/internal/cloud/e2e)：需要真实 cloud 凭据的工作流与远端资源回收。
- [`.github/workflows`](https://github.com/opentofu/opentofu/tree/93f9c466bde0a4843096b0da5d346b14bbcc20bb/.github/workflows)：PR、合并后跨平台与验收测试入口。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** `internal/command/e2etest/main_test.go` 的 `TestMain` 在 suite 开始时构建真实 `tofu` 可执行文件，并把路径交给测试。测试也允许外部预先提供 release archive 中的 binary，避免重新构建主 CLI。

**事实。** 某些用例还需要 provider 或 provisioner 测试进程。源码构建模式可以在 suite 中生成它们；release binary 模式无法这样做时，相关用例会因 `canRunGoBuild` 条件而跳过，源码中保留了 FIXME。

**推断。** 主 CLI 与协议进程必须被视为一个候选 artifact set。NiceEval 不应在测试运行中临时拼出 adapter，也不应把 release artifact 缺协议进程后的 skip 当作 release 验证通过。

## 2. 临时真实 project fixture 怎样创建和隔离

**事实。** Command E2E 把仓库中的 `testdata` 复制进 `t.TempDir()`，再从复制后的真实配置目录运行 init、plan、apply、show、state 与 destroy。原始 fixture 保持只读，状态文件和下载内容落在每例临时目录。

**推断。** “复制模板后执行”比在共享 fixture 上运行安全，也让失败现场可以按目录保存。NiceEval 的 scenario repo 应采用同一所有权模型，并把 HOME、cache、`.niceeval` RecordStore 与 adapter state 一起迁入该目录。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** Command harness 分别取得命令输出和错误，并检查成功或失败。用例不只匹配人类文本，还会解码 plan、state、show 的结构化结果；JSON 比较前会规范化不可稳定字段。稳定的诊断或 UI 文本则使用子串或 golden 风格比较。

**推断。** 结构化状态应由字段级 oracle 拥有，golden 只拥有稳定的人类界面。NiceEval 的 record、report JSON 和 adapter 回执不应由整段 snapshot 代替。

## 4. provider、plugin 或外部进程协议怎样分层

**事实。** E2E suite 构建并安装真实 provider protocol v5、v6 进程与 provisioner executable。`tofu` 通过正常的发现与进程协议调用它们，测试因此验证 executable wiring、协议版本与数据交换，而不只是内部函数调用。

**推断。** NiceEval adapter 的协议单测可以验证 codec，但 local-protocol E2E 必须启动真实 adapter 进程。Secret-backed live lane 再独占远端服务语义，三层不应重复同一场景。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** 开发者与 CI 都运行 Go test suite；PR lane 以 Linux 为主，合并后工作流增加 OS/architecture 组合。标记为 `TF_ACC` 的验收测试允许真实网络访问。`internal/cloud/e2e` 还定义需要 TFE token 的 cloud suite。

**事实边界。** 本次固定提交中的 workflow 没有证明每个 cloud E2E 都已成为持续执行的必跑 job，也没有看到“所有 E2E 外包给 Docker”的统一 lane。

**推断。** 同构应来自相同 runner、fixture 与断言，不是来自所有宿主都套一层容器。Live lane 必须先做 capability preflight，并把“未运行”与“通过”分开。

## 6. 长流程 user journey 与资源 cleanup 怎样验证

**事实。** Command E2E 验证 init → plan → apply → state/show → destroy 的完整主流程，并从生成的 state 与输出验证中间结果。Cloud E2E 使用 `t.Cleanup` 注册组织等远端资源的回收。

**推断。** 调用 destroy 不是 cleanup 的最终证据。NiceEval 应继续等待进程退出、端口释放或远端资源查询为空，并把这些结果写进 `CleanupReceipt`。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** OpenTofu 把算法和数据解码留在 package unit tests，把主命令 wiring 与核心工作流放进 `internal/command/e2etest`，把凭据和远端控制面行为放进 `internal/cloud/e2e` 或 acceptance tests。

**推断。** 这三层分别拥有 codec/算法、真实本地进程 wiring、真实服务行为。NiceEval 应沿风险所有权去重，而不是让每一层重复“成功跑一次 eval”。

## 对 NiceEval 的直接启示

- 候选 CLI、adapter 与所有协议进程必须在 lane 开始前形成完整、可校验的 artifact set。
- 真实项目从只读模板复制到每例临时目录，所有可变状态都归该例所有。
- Plan、state、record 与 report 使用结构化 oracle；golden 只验证稳定的人类文本。
- 不照搬 release binary 模式下因无法构建协议进程而跳过测试的缺口。
