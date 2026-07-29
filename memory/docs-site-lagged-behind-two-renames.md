# docs-site 落后两次改名:`runs` 与 `--reuse-sandbox`

## 现象

2026-07-29 扫 `docs-site/zh` 时发现两处公开文档教的东西不存在:

- **`runs`**：`defineExperiment` 的字段叫 `attempts`，CLI flag 叫 `--attempts`。
  但 9 个 zh 页面、33 处 `examples/**/experiments/*.ts` 和两份 `--help` 速查
  （`src/i18n/en.ts` / `src/i18n/zh-CN.ts`）都还写 `runs` / `--runs`。
  照 `--help` 敲 `--runs 5` 会撞 `parseArgs` 的 `strict: true` 直接报未知 flag；
  照文档写 `runs: 3` 不报错——`defineExperiment` 不校验未知字段，
  TS 的超额属性检查只在源码被 typecheck 时才拦，而 `examples/` 不在 `pnpm run typecheck` 范围内，
  所以它静默按默认 `attempts: 1` 跑，作者以为自己在测通过率分布。
- **`--reuse-sandbox`**：Sandbox 复用早已定稿成实验字段 `sandboxReuse: true`
  （`docs/feature/sandbox/reuse.md`：「这是可签入的实验语义，不是 CLI 运行模式」），
  但 `zh/tutorials/local-iteration.mdx` 整页、以及 `zh/tutorials/sandbox-providers.mdx`
  的一节仍按那个 flag 写，连带发明了一条实际不存在的报错
  （「一批里混了不同环境就在创建前报错」——真实行为是按 environment profile 分组，各组各复用）。

## 根因

两条都是**改名/翻案时同步义务只走到了 `docs/`**。CLAUDE.md 的同步表要求可观察行为变了就
grep `docs-site/` 同步，但没有机器守护：`pnpm test:docs-site` 只查参考页生成区块的漂移、
随包索引和 mint 的构建/断链，手写正文里出现一个不存在的字段名或 flag 名一律绿灯。

`--reuse-sandbox` 这条还多一层:它在 memory 里留下的是**上一版**裁决
（[reuse-once-setup-supersedes-idempotent-hooks](reuse-once-setup-supersedes-idempotent-hooks.md)
写的就是 `--reuse-sandbox`），后来改成实验字段时只重写了 `docs/`。
按「先读 memory 再动手」的流程进来的人会读到已经作废的形态。

## 修法

一次性改正(2026-07-29):

- `docs-site/zh` 手写正文与 `examples/**` 的 `runs` 全部改 `attempts`，
  跑 `pnpm run gen:diff-code` 重生成五张 examples diff 页；
  `src/i18n/` 两份 `--help`、`src/cli.ts` 与 `src/runner/types.ts` 的 JSDoc 一并改，
  跑 `pnpm docs:reference` 重生成 CLI flag 表。
- `local-iteration.mdx` 删除（整页的机制不存在），内容并进
  `zh/tutorials/sandbox-reuse.mdx`，`docs.json` 加 redirect；
  `sandbox-providers.mdx` 那一节改写成 `sandboxReuse: true`。

想让这类漂移下次红灯，守护要能回答「正文里出现的 flag 名在 `FLAG_OPTIONS` 里有没有」
和「正文里出现的 `defineExperiment` 字段在 `ExperimentDef` 上有没有」。
这属于 `test/docs-site/` 的范围（vitest，不新增脚本），但要先解决取值面:
从源码提取标识符集合是可行的，判断正文里哪个反引号片段该被当成标识符则需要一份白名单，
否则误报会把守护逼成噪音。现在没做，先记在这里。
