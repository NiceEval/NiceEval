# 设计裁决：E2E 以独立 repo 为边界，废除共享 suite 与中央领域 verifier

**裁决**（2026-07-13，用户拍板）：niceeval E2E 的执行与所有权单元改为独立测试 repo。每个 repo 自己拥有被测应用、adapter、Eval、Experiment、依赖锁定、服务生命周期和验收脚本；repo 之间不共享 Eval / Experiment factory、profile、应用进程或 Results 读取代码。根仓只构建候选 npm 包、发现 repo、隔离执行、注入最小 secrets、收集 artifact 和汇总退出码。

**触发问题**：旧 `e2e/scripts/verify.mjs` 同时保存所有项目的端口、Experiment、Eval 数、verdict 期望和 `summary.json` 布局。Results 改成快照制后，中央脚本仍扫描旧文件名，导致所有项目一起红。`.niceeval/` 已被 ignore，失败与 ignore 无关；问题是中央 verifier 越过公开读取面，复制了 Results 格式知识和每个 SDK 的领域契约。

**曾选方案与否决理由**：

- *共享 factory + 每项目 profile + 三行 stub*：一处修改能覆盖矩阵，但也把所有 repo 绑在同一运行时源码上；协议差异被压成条件分支，单 repo 离开父目录不能执行，无法作为 crabbox 的独立执行单元。
- *只把中央 verifier 改成 `openResults()`*：能修当前 `summary.json` 漂移，却继续保留中央 Eval 数、端口和 verdict 期望；Results 耦合减轻了，repo 所有权问题仍在。
- *中央 apps + 薄 projects*：复用服务省代码，但单项目运行需要先恢复隐藏的跨目录拓扑，端口、启动顺序和日志归属继续由 workflow 手工维护。
- *复制相同 Eval 到各 repo 后再做 drift sync*：形式独立、语义仍被中央同步机制绑住。相似 Eval 的重复是各协议各自验收的证据，应允许独立变化。

**接受的代价**：不同 repo 会重复基础 Eval 和少量启动/验收骨架；新增跨协议覆盖需要逐 repo 明确实现。用统一的书面执行协议、`e2e.json` 元数据和创建时模板控制机械重复，但不引入运行时 shared。确定性的 Results/cache 机制放进专门 contract repo，避免每个真实模型 repo 重复格式断言。

**crabbox 边界**：repo 暴露唯一的 `pnpm e2e` 命令。crabbox 只同步 checkout、转发 allowlist 环境、执行该命令、收集 JUnit/artifact 并传播退出码，不理解 niceeval 的 Eval、Results 或服务拓扑。

定稿契约：`docs/engineering/testing/e2e/README.md`。

## 2026-08-08 部分翻案：Adapter collection 共享 Assertion Eval 源码

用户进一步定案：上述“repo 之间不共享 Eval”对 `e2e/adapter` 的公开 Assertion 兼容矩阵过度隔离。
每个 Adapter 原先各写一份普通对话、工具匹配与 scope 断言，会让同一份公开 Assertion API 在多处漂移，也很难确认
参数形状和反向断言没有漏项。

新的边界是：

- 根仓拥有一份协议中立的 `e2e/adapter/shared/assertion-contract.eval.ts`；runner 只在单个 Adapter Repo 的隔离副本中
  将它物化为普通 Eval 源码。
- 每个叶子 Repo 仍拥有自己的 Agent、Experiment、lockfile、secret、Sandbox、结果与验收脚本，只用本地
  `evals/assertion-profile.ts` 提供该协议的真实提示词、工具名和 marker。
- 一次 Adapter 运行同时验证 Assertion 契约与 Adapter 归一兼容性；不新增脱离 Adapter 的 suite、lane 或中央结果 verifier。
- MCP、HITL、Skill、Plugin、Subagent 等协议特有能力仍由叶子 Repo 的本地 Eval 拥有，根 runner 不理解这些领域 expected。

所以 2026-07-13 对“中央 verifier 越过公开读面”“共享应用/进程/结果读取”“根仓理解领域 expected”的否决继续有效；
只推翻“任何 Eval 源码都不得在 Adapter Repo 间共享”这一条。当前定稿契约见
`docs/engineering/testing/e2e/adapter/README.md#共享断言契约`。
