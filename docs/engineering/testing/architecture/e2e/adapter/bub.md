# bub 仓库

## adapter-bub-live-compatibility

Repo ID 是 `adapter/bub`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker、Python 与 external network。
被测对象是 `bubAgent()` 在 Docker Sandbox 里的完整生命周期：安装（含 `pythonPlugins`）、真实 coding 任务、tape JSONL 行为轨与会话（契约见 [Bub 契约页](../../../../../feature/adapters/library/sdk/bub/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | 真实任务下 Bub tape JSONL 归一出工具事件并完成配对；缺少显式 call ID 的事件只能按位配对，因此 Eval 保持串行工具场景，不断言并发配对 |
| Skills | 挂载的 Skill 在事件流中留下使用证据（引用只存在于 SKILL.md 里的魔法词 + 工具入参含 skill 路径） |
| pythonPlugins 与 before | 安装的 Python 插件行为可观察；`before` 生命周期 Hook 按序执行并在输出中留下证据 |
| 会话 | session 由 Adapter 管理，第二轮能引用首轮事实 |
| 当前版 usage | `ci` 严格断言可配置 OpenAI-compatible 网关返回的 token / request usage；token 值须有限、非负且合计大于零，不以固定 token 上限判定协议兼容性；provider observed `Usage.costUSD` 只在上游实际提供时存在，不做估算 |

## 固定版本与确定性回放

`ci` 只运行固定 Bub `0.5.1` 与默认 OTel 插件，不保留旧版本实验。
`flags.requireObservedCost` 为 `false`：兼容网关缺少 provider cost 时不估算、不当成零；token 与 request usage 仍须可观察。

`test/protocol.test.ts` 通过安装后公开 `bubAgent` 回放 `fixtures/bub-0.5.1.tape.jsonl`，只替换外部 Sandbox 命令与文件边界。
它验证文本和 usage、旧版本定义期拒绝、未知事件排除，以及多轮累计 tape 的 warning 去重和公开 `show` 读回。
该回放不证明真实 CLI 的安装或工具调用兼容性；这些仍由 live Journey 验收。

## 仓库验收

- 工具名是 tape JSONL 归一后的 `file_write` / `file_edit` / `shell`。
- coding 的顺序断言定位 `cat notes.txt` 读回调用；Skill 发现的前置 shell 不参与写入与读回的顺序判断。
- coding Eval 的提示词复用本仓库 `evals/shared.ts` 的 `SKIP_BUILD_NOTE` / `REPLY_DIRECTIVE` 免责声明。bub 的系统提示自带 Next.js build 指引与 channel 应答策略，不声明这两条会污染协议断言。
- `ci` Experiment 选中本仓库的 coding、Skill、plugin / before、会话和 usage Eval；原生验收脚本列全协议 Eval ID，防止少发现/少运行后假绿。
- **Eval 结果**：原生验收核对固定版本的通过数、未通过数；工具、Skill 与 plugin 细节由 Eval 判分。
- **Inspection readback**：独立 `show @<locator> --json` test 只读回 coding Eval 的代表性工具证据。
- **Timing / OTel 边界**：通用 Runner timing 由 [`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回。当前公开读面不能归因 Bub 的 mapper-specific OTel，本 Repo 不用通用 timing 或日志冒充该证据。
