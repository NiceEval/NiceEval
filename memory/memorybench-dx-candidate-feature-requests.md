# MemoryBench dogfooding 批次:候选 feature request 与逐条处置

2026-07-30 MemoryBench(terminal-bench 移植,niceeval 0.11.3)dogfooding 一批 DX 反馈的
处置台账。共同形状:**上层配置压过下层声明时不给任何提示**——已升格为契约规则
「解析的赢家要在反馈里留痕」(docs/feature/experiments/architecture.md 配置解析链一节)。

## 待裁决的候选(未立项,立项后进 docs/roadmap/)

- **发布物带 `.d.ts`**:包 exports 指 `.ts` 源码,消费方 tsc 把 niceeval 源码整体纳入
  程序,`skipLibCheck`(只跳 `.d.ts`)救不了,niceeval 自己的类型缺口淹掉下游报错面。
  要不要出 `.d.ts` 是打包契约的独立设计题(现契约见 CLAUDE.md Release 段)。

## 已裁决不立项

- **派发前的 declarative 预检 skip**(两票,2026-07-30 结案):能在派发前判定的条件必然
  不依赖沙箱,在发现/选择期就能判——`evals:` 谓词、测试集扇出行过滤、模块顶层代码都够用,
  「哪个条件跑不了哪题」本就是实验作者的知识;剩余的「分母可见」记账诉求配不上新 API 面
  与「判定输入进不进指纹」的连带成本。答复下游:筛选写 `evals:` 谓词,要「跳过可见」就付
  一次沙箱成本用 `t.skip`。

## 同批已各归其位

- config.timeoutMs 压掉 eval 声明、超时报错无来源 →
  [multi-source-field-resolution-order](multi-source-field-resolution-order.md)(契约已定,代码未修);
- 实验闸压住 `--max-concurrency` 无提示 → 已设计落 docs:PLAN 行带全局并发来源标注
  并逐个点名实验闸(docs/feature/experiments/cli.md live 面板一节);
- 默认 diff 排除表不收 `.tbench-testing` → 按现契约答复:benchmark 专属目录走项目级
  `diff.ignore`,默认表只收通用基础设施目录(core 中立);
- `show --json` 管道截断 → [show-json-pipe-truncated-at-128k](show-json-pipe-truncated-at-128k.md);
- 单题重跑挤掉 view 榜单 →
  [view-latest-run-displaces-batch-in-leaderboard](view-latest-run-displaces-batch-in-leaderboard.md)。

## 2026-07-30 第二批:工作树消费与判据树

上一轮提的三条(`--force` → `--rerun all`、`show --stats`、并发教程措辞)下游确认已解。
本批处置:

- 判据树进指纹(728 文件 40MB 只能逐个 loadText)→ 已定稿 `loadCriteria`(登记不读入),
  契约落 docs/feature/experiments/cache.md 数据面与 eval/use-case/criteria-files.md;
- telemetry 配置失败把无关题打成 errored →
  维持 errored,裁决记 [telemetry-configure-failure-stays-errored](telemetry-configure-failure-stays-errored.md);
- 80MB fixture 上传超时报错无上下文 → 契约落 docs/error-feedback.md「超时报错的三要素」;
- commandSucceeded 摘录给输出中段 → 契约本要尾部,实现违约,
  记 [commandsucceeded-received-excerpt-not-tail](commandsucceeded-received-excerpt-not-tail.md);
  同批裁决 `commands.json` 落盘不截(record/architecture.md 证据 registry);
- 包根 INDEX.md 过期、`--version` 报旧号 →
  记 [worktree-consumption-stale-index-and-version](worktree-consumption-stale-index-and-version.md);
- `--help` 的 timeout Resolution 行漏 eval 层 → 并入
  [multi-source-field-resolution-order](multi-source-field-resolution-order.md) 修法清单;
- setup 预检 skip 第二票(下游点名 SandboxHookContext 有 `fact()` 无 `skip()`),仍待裁决;
- `pnpm exec` 往 stdout 打 `Already up to date` 污染 `--json` → 非 niceeval 缺陷,
  候选:docs-site troubleshooting 推荐 `pnpm niceeval` script 或 `./node_modules/.bin/niceeval`。

## 2026-07-30 第三批:台账(下游报告,本仓未复现)

- 5 条 errored 只有 2 条在输出流露过面,其余静默到 `show --history` 才可见——
  scrollback 完成行对 errored 的遗漏,疑似 human 反馈面 bug;
- `workspace.diff` 超 64MB(agent 真实编译产物,`diff.ignore` 排不掉)把可判分 attempt
  打成 errored——已裁决:预算口径改「只数真正传输的字节」+ 超限文本逐文件 elided,见
  [diff-export-budget-counts-transferred-bytes](diff-export-budget-counts-transferred-bytes.md);
- `eval.run` 中段 E2B API 往返超时(undici TimeoutError)直接 errored 无重试——按
  provision-retry 裁决族「歧义类不盲重试」维持 errored+重跑,消息按三要素点名层次;
- `show --exp` 终端排版:列宽把 id 与表头折行、单点散点图仍画轴、x 轴方向反了;
- `Cost available for 37/47 attempts` 不说明剩余 10 条缺数据的原因——观测契约要求列出
  未映射模型(docs/observability.md 用量与成本节),实现缺口。
