# 可读测试样例首轮验收暴露的伪绿模式

2026-08-06 对 DeepSeek V4 Flash 首轮样例草稿做独立验收。
目的不是按“写了多少 test”评分，而是把假绿、无法运行或归属错误的写法反推成测试方案硬规则。
稳定结论已经写回测试体系 Roadmap；本页只保留形成结论的过程证据。

## 首轮草稿暴露的问题

| 草稿写法 | 为什么不成立 | 最终处理 | 规则落点 |
|---|---|---|---|
| `adapter/` 平铺 Codex、分页与本地 5xx 三条 test | 一个结果根和一份 package 不能证明多个真实 adapter consumer | 拆成 `repos/adapter/ai-sdk`、`codex-cli`、`local-protocol` 三个叶子，后续同形扩展 Claude Code、OpenCode、Bub | [场景 Repo · Adapter](../docs/roadmap/testing/e2e/scenario-repos.md#adapter-repo) |
| 自造两页 HTTP cursor，并标 `regression: 0cef7946 / 285990d7` | 历史 bug 是 E2B SDK `SandboxPaginator` 形状；HTTP cursor 杀不死该旧实现 | paginator 放到使用真实 SDK `ReturnType` 的 Mechanism unit；本地协议不挂该 commit | [Portfolio · 历史 Bug](../docs/roadmap/testing/portfolio.md#历史-bug-回归) |
| CommonJS test 在 `/tmp` 只写 package，再执行 `pnpm exec niceeval` | 没有安装候选包，实际 binary 来源不成立；还把 `list` 错当 Experiment 列表 | Package 叶子 Repo 本身就是 CJS consumer，由 runner 注入并核对 tarball；`list` 断言 Eval 列表 | [候选包信任链](../docs/roadmap/testing/e2e/scenario-repos.md#候选包信任链) |
| 导出 Report 根据 locator 拼 `site/attempt/...html` | 测试证明的是自己猜的路径，不是用户页面交付的链接闭包 | 从页面实际 anchor 读取 `href`，先查 HTTP，再打开并核对实体 | [Architecture · 浏览器](../docs/roadmap/testing/architecture.md#结构化输出与浏览器) |
| 用当前 DOM 不存在的 `aria-label` 和 `role="tooltip"` 写成绿测 | 精确 selector 仍然可以是虚构契约；样例无法在当前产品运行 | 缺稳定可访问身份时标明 target contract / 产品 gap，不把未来能力冒充现状 | [Architecture · 浏览器](../docs/roadmap/testing/architecture.md#结构化输出与浏览器) |
| Runner test 修改共享 `niceeval.config.ts`，`finally` 写回 | 崩溃、并行或 watcher 会观察到中间态，重现历史顺序依赖 | 两个签入版本在私有 Repo 副本中切换，或为 mutation 再建副本 | [Architecture · 隔离](../docs/roadmap/testing/architecture.md#隔离与证据复用) |
| SIGINT 后只对父 PID 做 `ESRCH`，标题写“无 orphan” | 子进程、container、sandbox lease 或远端 session 仍可泄漏 | 等 owned resource ready 后发信号，查资源本身消失，再由下一消费者闭环 | [E2E · Lifecycle](../docs/roadmap/testing/e2e/README.md#lifecycle) |
| locator 往返、5xx 等相似 case 都挂历史 fix commit | 相似风险不是因果回归；无法解释哪个旧断言会红 | 只有 fix parent / 最小逆补丁 kill 通过才写 `regression:`，否则写 `risk:` 或契约链接 | [Portfolio · 历史 Bug](../docs/roadmap/testing/portfolio.md#历史-bug-回归) |
| helper 用场景名隐藏 `niceeval view` argv | 读 test 看不到用户实际做了什么，失败收据也不完整 | helper 只保留 spawn、parse、server cleanup；完整命令留在调用点 | [Architecture · Helper 预算](../docs/roadmap/testing/architecture.md#helper-预算) |
| 大 JSON 尾部按 assertion `name === actual-4999` 查找 | `name` 是 matcher 身份，不是 actual；测试会在正确产品上失败 | fixture 给末条 expected 独立 sentinel，再从公开 assertion 结构精确读回 expected / received | [Architecture · Oracle](../docs/roadmap/testing/architecture.md#oracle-独立性) |
| Journey 只核对最终失败 attempt | 前面的 passing eval 可以根本没执行，最终仍可能“看起来合理” | dry matrix、每个 result event、history identity、execution 与 browser 在各接缝分别核对 | [E2E · Journey](../docs/roadmap/testing/e2e/README.md#journey长用户流程) |

## 对目标契约的影响

- 真实场景 Repo 增加 adapter collection、二级 consumer 候选包安装、local 与 live 结果根分离。
- Architecture 增加真实 `href`、可访问身份不得臆造、mutation 私有副本与 owned resource cleanup。
- Portfolio 明确“类比历史 bug”不等于 regression，必须留下旧实现 kill 与最早失败阶段。
- 旧问题对账增加“数量增加但 Repo 仍可能只是布景”的反例与验收门槛。
- PLAN-4 Use Cases 修正 CommonJS `init → list` 的错误 expected，并移除未安装 consumer 与非空断言。

## 父 Agent 的验收要求

worker 的 `done`、文件数量与 TypeScript syntax 都不代表方案通过。每套样例还必须由父 agent 独立完成：

1. 对照公开 CLI / JSON / DOM / adapter API，而不是相信草稿里的 interface；
2. 检查叶子 Repo package、candidate 注入、fixture 与结果根是否真的闭合；
3. 对每个 `regression:` 找到旧实现 kill 证据；
4. 运行文档链接、格式、类型或最小单项验证；
5. 删除被判错的草稿，不把错误代码留成“另一种方案”。
