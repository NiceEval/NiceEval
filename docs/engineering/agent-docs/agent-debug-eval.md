# Agent Debug Eval：诊断效果评估

[agent-install-eval.md](agent-install-eval.md) 评估 agent 能否把 niceeval 接入项目；接入只是起点，日常高频动作发生在接入之后——**在一个已经跑出结果的项目里替用户查信息**：哪个 experiment 落后了要重跑、某条 eval 为什么失败、失败那次 attempt 里 agent 实际做了什么。这条诊断链路依赖 CLI 的钻取视图（`show` → `show --exp <path>` → `show @<attempt> --execution` / `--page traces`）与随包文档的配合，效果同样需要证据。

要回答的三个问题：

1. **查得到吗**——给一个有标准答案的查询问题，agent 能否给出正确答案；数据里不存在的信息，能否如实回答「查不到」而不是编造。
2. **走的路对吗**——诊断是否沿 CLI 钻取链完成，还是绕开 CLI 徒手翻 `.niceeval` 原始 JSON。
3. **文档起作用了吗**——agent 是否以随包 `INDEX.md` 为路由入口、读到与查询任务匹配的页面（CLI 参考、结果与报告），而不是凭训练记忆猜命令。

## Fixture：结果数据直接签入

fixture 是一个已接入 niceeval 且跑出过结果的用户项目切片：最小宿主配置（`niceeval.config.ts`、experiment 与 eval 声明）加上**整目录签入的 `.niceeval` 结果数据**。结果数据从真实评估项目导出，不手造样例——真实数据自带的复杂度正是被评对象。一份合格的 fixture 必须同时具备以下特征，它们也是出题的素材面：

| 特征 | 支撑的题面 |
|---|---|
| 多 experiment group | 组间隔离与「先选对 scope」 |
| 视图由多 Run 组成、含 stale-verdict 警告（flagged experiments） | 警告语义与重跑建议 |
| failed 与 errored 并存 | 断言失败与 sandbox / 运行错误是两类不同诊断 |
| 成本、时长、通过率跨度大 | 横向对比题的区分度 |
| attempt execution 有实质内容（thinking、工具调用、失败线索在 transcript 里） | 深挖题的答案落点 |

第一份 fixture 从 coding-agent-memory-evals（多 coding agent × 多 memory 方案的对比评估项目）导出。导出裁剪规则：只收组成当前 `show` 视图的 Run 及其 attempt 产物（`events.json`、`trace.json`），历史 Run 不进 fixture；裁剪后的数据必须仍能让 `niceeval show` 完整复现出题时的视图。

每次运行把 fixture 复制进隔离 workspace 并注入候选 niceeval tarball（注入模型同 [E2E 的候选包注入](../testing/e2e/README.md)），agent 对结果数据只读探查。数据永不重跑，题库的标准答案在出题时由人工从这份数据核对并随 fixture 签入——数据不变，答案就不腐烂。

## 一条 eval 的形状

- **输入**：fixture 项目 + 一个自然语言查询问题（例：「memory/agent-037-updatetag-cache 在 claude-dp-v4--nowledge 里为什么失败？agent 当时实际采用了什么方案？」）。
- **执行**：agent 在 sandbox 内自主决定运行什么命令、读哪些页面，中途不注入人工提示。
- **断言**：对 agent 的最终回答与 transcript 两个面做断言，按下面三层评分。

## 题库维度

题目按钻取深度分层，每层对应 CLI 链路的一段：

| 题型 | 例 | 考察的链路 |
|---|---|---|
| 总览题 | 「哪些 experiment 落后需要重跑？给出重跑命令」 | `show` 首屏与警告文案的可执行性 |
| 横向对比题 | 「compare 组里哪个方案在成本与通过率上综合最优」 | `show --exp` 的对比视图 |
| 多跳定位题 | 「某 eval 在某 experiment 下失败的直接断言是什么」 | `show` → `--exp` → attempt 行 |
| 深挖题 | 「失败那次 attempt 里 agent 实际用了什么 API、中途改过几次方案」 | `show @<attempt> --execution` transcript |
| 边界题 | 问数据里不存在的信息，标准答案是「查不到」 | 幻觉抵抗 |

重跑类问题的标准答案是给出正确的命令文本，不实际执行——fixture 只读。

## 评分维度

1. **答案层（精确断言 + judge）**：ground truth 的关键事实点（attempt id、断言名、退出码、数字、API 名、命令文本）齐全且正确；边界题回答「查不到」而非编造。
2. **路径层（transcript 断言）**：钻取链是否经由 CLI 完成。徒手读 `.niceeval` 原始 JSON 不判失败，但单独计量——它是「CLI 视图信息不足或不可发现」的直接信号。
3. **路由层（transcript 断言）**：同 install eval——是否以 `node_modules/niceeval/INDEX.md` 为入口，读的页面与查询任务是否匹配。

## Experiment 维度

- **coding agent × 模型档**：同一题库在不同 agent 与模型档位上的正确率，区分「CLI / 文档问题」与「模型能力问题」。
- **有无随包文档的对照组**：一组给完整文档链，一组只允许 `--help` 裸查。差值是随包文档对诊断链路的增量。
- **CLI 输出改版回归**：`show` 视图、警告文案、命令末尾「下一步」提示改版前后各跑一轮——终端视图的信息设计从「看着清楚」变成有分数的回归。

## 结果如何反哺

失败按「答案层 × 路径层」的组合归因：

- **路径走对了、答案仍错** → 对应 `show` 视图信息不足或有歧义，反哺 [`docs/feature/reports/`](../../feature/reports/README.md) 的视图设计。
- **路径没走对**（不知道有 `--exp`、`@<attempt> --execution` 这层钻取）→ 反哺命令输出末尾的下一步提示（[error-feedback](../../error-feedback.md) 原则）与 docs-site 的 CLI 参考页。
- **徒手翻 JSON 占比高** → CLI 钻取链的可发现性问题，作为 reports 设计的证据输入。
- **路由层失败** → 同 install eval，按 [agent-docs README](README.md) 的边界裁决处理 `INDEX.template.md` 导语或页面 `description`。

## 边界

- **只评「查信息」，不评修复**。问题的终点是一条可核对的答案；修复失败的 eval、真的重跑 experiment 都不在任务内。
- **fixture 只读、不依赖在线运行**。所有答案在签入数据里可静态核对，评估过程除被测模型外不依赖任何外部服务。
- **不评 niceeval 功能正确性**。`show` 输出自身的 bug 由单元测试与 E2E 守护；本评估测的是「这套输出加文档能否支撑 agent 的诊断」。
- **与 install eval 共仓库**。sandbox、候选包注入与运行机制共用，fixture 类型与题库独立；从零接入归 install eval，接入后的信息检索归本篇。
