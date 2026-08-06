# Bug 组：公开示例必须作为消费方执行

这一组用 docs-site 仍教 `runs` 作正例，用已经不存在的 `--reuse-sandbox` 作同形反证。
两条都在 `8068d6d6` 修正文档，但 fix 没有增加自动守护；它们应由同一 consumer world 捕获，而不是维护旧词黑名单。

## 正例：`runs: 3` 静默只跑一次

公开站、33 个 example 实验和两份 help 曾继续使用 `runs`，真实字段已经是 `attempts`。
CLI 的未知 `--runs` 会被严格参数解析拒绝；对象字段却由 `defineExperiment` 原样返回，examples 又不进 typecheck，所以 `runs: 3` 静默按默认一次执行。

用户可见症状不是文案里出现旧词，而是复制可运行示例后得到错误的 attempt 数。
普通 docs build、断链检查和核心类型检查都绿，因为它们没有把示例作为包消费方运行。

```ts
docsBehavior(publishedExperimentExampleRunsAsDocumented, async () => {
  const cwd = w.consumerDir("docs-experiment-example");
  const run = await cli("pnpm exec niceeval exp example --rerun all --json", { cwd });
  const attempts = ndjsonEvents(run.stdout).attemptIds({ experiment: "example" });

  expectObserved(attempts).toShowExactRows(["a0", "a1", "a2"]);
});
```

world recipe 直接从被发布 example 组装消费方，不在测试里重抄第二份代码。
运行使用确定性本地 agent；它证明包入口、示例字段和最终用户行为三者闭合。

## 同形反证：不存在的复用 flag

`--reuse-sandbox` 已被定稿为 `sandboxReuse: true`，公开站却仍教用户在 CLI 传 flag，并描述一套从未存在的分组报错。
同一 consumer proof 在 invoke 阶段就会因未知 flag 失败。

这证明“扫描正文反引号并与字段白名单比较”不是首选：它很难区分字段、值、命令片段和历史说明。
把可运行代码块 / examples 真正交给候选包，未知 flag、类型错误、运行语义错误会在各自最早阶段失败。

静态守护仍有一项职责：确认所有标记为 runnable 的公开示例都进入 consumer matrix；未标记代码块不猜。

## 仍存机制缺口：未知对象键

当前 `defineExperiment` 会校验若干字段的值，却仍不拒绝未知顶层键。
TypeScript 的超额属性检查能保护直接对象字面量，但 JavaScript、类型断言和未纳入 typecheck 的生成示例仍可静默失效。

consumer E2E 能防官方示例回归，不能替所有用户配置提供运行时诊断。
框架若要满足“错误公开事实最早失败”，应在 `defineExperiment` 解析阶段拒绝未知键并列出允许字段；这属于机制缺口，不在 DSL 里增加 `attemptCountIsNotDefaultByAccident()`。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 只执行标记为 runnable 的示例；叙述性片段不参与 |
| 不能改断言放行 | attempt 数来自示例声明；不能把 3 改成实际默认 1 |
| 观察失败显式报错 | 安装、类型、invoke、NDJSON 解析和 outcome 分阶段报告 |
| 用户侧直接定位 | 列页面 / example 路径、消费方 cwd、命令、字段与实际 attempt 身份 |
| 设施不造假 | 使用候选 tarball 与真实包入口，不从仓库源码相对 import |
| 用户已有用法不改 | 示例本身就是用户入口；测试只自动执行它 |
