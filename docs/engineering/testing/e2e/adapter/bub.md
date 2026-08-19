# bub 仓库

## adapter-bub-live-compatibility

Repo ID 是 `adapter/bub`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker、Python 与 external network。
被测对象是 `bubAgent()` 在 Docker Sandbox 里的完整生命周期：安装（含 `pythonPlugins`）、真实 coding 任务、tape JSONL 行为轨与会话（契约见 [Bub 契约页](../../../../feature/adapters/sdk/bub/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | 真实任务下 Bub tape JSONL 归一出工具事件并完成配对；缺少显式 call ID 的事件只能按位配对，因此 Eval 保持串行工具场景，不断言并发配对 |
| Skills | 挂载的 Skill 在事件流中留下使用证据（引用只存在于 SKILL.md 里的魔法词 + 工具入参含 skill 路径） |
| pythonPlugins 与 postSetup | 安装的 Python 插件行为可观察；`postSetup` 生命周期 Hook 按序执行并在输出中留下证据 |
| 会话 | session 由 Adapter 管理，第二轮能引用首轮事实 |
| 当前版 usage | `ci` 严格断言可配置 OpenAI-compatible 网关返回的 token / request usage；provider observed `Usage.costUSD` 只在上游实际提供时存在，不做估算 |

## 两条版本线

仓库跑两个实验，包含两代 Bub：

| 实验 | 装的 Bub | OTel 插件 | 跑哪些 Eval |
| --- | --- | --- | --- |
| `ci` | NiceEval 当前默认 pin | 默认 pin | 上表协议闭环，含 token / request usage 断言 |
| `legacy` | 显式 `version: "0.3.9"` | 同代 commit（`bub-contrib` #50 之前） | 只跑 coding 任务一条；证明 token / request usage、工具轨与旧版组合仍可安装运行 |

`legacy` 证明的是声明的旧版组合仍可安装，并完成同一条公开工具与 usage 闭环。当前没有 mapper-specific OTel 的公开归因 seam，因此本 owner 不声称旧插件 span 已被独立验收。
它不是第二遍协议巡礼——版本线是新增的证明维度，不是新增的协议行为，所以按[仓库 Eval 预算](README.md#仓库-eval-预算)只留一条 Eval。

`ci` 与 `legacy` 的 `flags.requireObservedCost` 都明确为 `false`：`BUB_API_BASE` 可以指向任意 OpenAI-compatible 网关，
它们都不能把缺席的 provider cost 当作零或自行估算。当前两条线保留 token / request usage 与归一后的工具轨；
`usage.cost` 存在时仍由 adapter 按 [Bub 成本契约](../../../../feature/adapters/sdk/bub/cost.md) 原样落入 `Usage.costUSD`。

两代必须成对钉：Bub 0.3.10 起 vendor 了 `bub.tape`，之后的插件从那里取类型；配 0.3.9 直接 import 失败。
反过来旧插件按 republic 的类型校验，配新 Bub 是 span 全被拒、时间轨静默为空（契约见 [Bub 契约页 · 装哪一版 Bub](../../../../feature/adapters/sdk/bub/README.md#装哪一版-bub)）。

`legacy` 放在验收顺序最后跑：结果目录一旦有两个实验，`show` 默认报告就折叠成实验汇总表，前面按 Eval id 断言它的步骤必须在只有 `ci` 结果时完成。

## 仓库验收

- 工具名是 tape JSONL 归一后的 `file_write` / `file_edit` / `shell`。
- coding Eval 的提示词复用本仓库 `evals/shared.ts` 的 `SKIP_BUILD_NOTE` / `REPLY_DIRECTIVE` 免责声明。bub 的系统提示自带 Next.js build 指引与 channel 应答策略，不声明这两条会污染协议断言。
- `ci` Experiment 选中本仓库的 coding、Skill、plugin / postSetup、会话和 usage Eval；原生验收脚本列全协议 Eval ID，防止少发现/少运行后假绿。
- **Eval 结果**：原生验收分别核对当前版与 legacy 版的通过数、未通过数；工具、Skill 与 plugin 细节由 Eval 判分。
- **Evidence Page**：独立 `show @locator --report <fixture-module> --page <execution-route>` test 只读回 coding Eval 的代表性工具证据。
- **Timing / OTel 边界**：通用 Runner timing 由 [`runner-history-dedup`](../runner.md#runner-history-dedup) 唯一读回。当前公开读面不能归因 Bub 的 mapper-specific OTel，本 Repo 不用通用 timing 或日志冒充该证据。
