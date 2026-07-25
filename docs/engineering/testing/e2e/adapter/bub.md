# bub 仓库

仓库 ID `bub`，group `sandbox`，`e2e.json.requires` 声明 Docker 与 Python 运行时。被测对象是
`bubAgent()` 在 Docker Sandbox 里的完整生命周期：安装（含 `pythonPlugins`）、真实 coding 任务、tape
JSONL 行为轨与会话（契约见 [Bub 契约页](../../../../feature/adapters/sdk/bub/README.md)）。

## Eval 闭环

| 协议行为                   | Eval 断言（只读事件流）                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| coding 任务工具轨          | 真实任务下 Bub tape JSONL 归一出工具事件并完成配对；缺少显式 call ID 的事件只能按位配对，因此 Eval 保持串行工具场景，不断言并发配对 |
| Skills                     | 挂载的 Skill 在事件流中留下使用证据                                                                                                 |
| pythonPlugins 与 postSetup | 安装的 Python 插件行为可观察；`postSetup` 生命周期 Hook 按序执行并在产物中留下证据                                                  |
| 会话                       | session 由 Adapter 管理，第二轮能引用首轮事实                                                                                       |
| usage 与 cost              | usage 和 cost 从 run 事件读取，逐轮非空                                                                                             |

## 两条版本线

仓库跑两个实验，覆盖两代 Bub：

| 实验 | 装的 Bub | OTel 插件 | 跑哪些 Eval |
| --- | --- | --- | --- |
| `ci` | NiceEval 当前默认 pin | 默认 pin | 上表四条闭环 |
| `legacy` | 显式 `version: "0.3.9"` | 同代 commit（`bub-contrib` #50 之前） | 只跑 coding 任务一条 |

`legacy` 证明的是**版本旋钮真的落地**：`version` / `otelPlugin` 把 Adapter 装到旧协议代上，且旧插件在旧 Bub 上仍产出 span（执行树有时间注释）。它不是第二遍协议巡礼——版本线是新增的覆盖维度，不是新增的协议行为，所以按[仓库 Eval 预算](README.md#仓库-eval-预算)只留一条 Eval。

两代必须成对钉：Bub 0.3.10 起 vendor 了 `bub.tape`，之后的插件从那里取类型；配 0.3.9 直接 import 失败。反过来旧插件按 republic 的类型校验，配新 Bub 是 span 全被拒、时间轨静默为空（契约见 [Bub 契约页 · 装哪一版 Bub](../../../../feature/adapters/sdk/bub/README.md#装哪一版-bub)）。

`legacy` 放在验收顺序最后跑：结果目录一旦有两个实验，`show` 榜单就折叠成实验汇总表，前面按 Eval id 断言榜单的步骤必须在只有 `ci` 结果时完成。

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution`
  执行树出现工具调用节点，节点带 span 时间注释。
- **OTel**：adapter 的 `tracing.env` 注入标准 `OTEL_*`
  环境变量（OTLP/protobuf），执行树的时间注释就是记录成立的展示证明；`show --timing`
  的 OTel 子树挂出经 mapper 归一的 model / tool span。span
  mapper 只影响瀑布图——判分断言仍只读 tape 归一的事件流。
