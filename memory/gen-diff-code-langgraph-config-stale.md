# `scripts/gen-diff-code.ts` 里 langgraph 的 before/after 配置已经和 origin 对不上语言

**现象**：`scripts/gen-diff-code.ts` 的 `DIFF_CONFIGS` 有一条 `source: examples/zh/origin/langgraph`
→ `target: examples/zh/eval/langgraph`，`order` 里列的是 `package.json` / `tsconfig.json` /
`pnpm-workspace.yaml` 这类 TS 项目文件。跑 `pnpm run gen:diff-code` 生成
`docs-site/zh/example/langgraph-before-after.mdx` 时,这条配置默认假设两边是同一个 TS 项目
接入 niceeval 前后的样子。

**根因**：`examples/zh/origin/langgraph` 已经两次偏离这个假设——先是改成 Python 后端 +
TS(Agent Server/`useStream`)前端的混合项目，2026-07 又整个重写成纯 Python 项目（手搭
`langgraph.graph.StateGraph`，标准库 `http.server`，`public/index.html` 单文件前端，
没有一个 TS 文件）。而 `examples/zh/eval/langgraph` 仍然是早年的 TS 快照（`createReactAgent`
+ `node:http`，见该目录 README 里"早期快照"的说明），两边现在没有任何同名文件可比——按
`order`/`sections` 逐文件 diff 会产出没有意义的结果（Python 文件在 target 侧根本不存在）。

**修法**：`docs-site/zh/example/langgraph-before-after.mdx` 目前既没生成也没进
`docs-site/docs.json` 导航，`examples/README.md` 里也明确写了"等 `langgraph` 那批做完后
再回来重做"——这条 DIFF_CONFIGS 是预留位，还没到该跑的时候，不用现在修。真要重做时两个选择：
(a) 把 `examples/zh/eval/langgraph` 也重写成基于新 `origin/langgraph`（纯 Python）的 niceeval
接入示例，diff 才能对上；(b) 语言不同就不适合用这套逐文件 diff 工具，改成手写的 before/after
说明文档。跑 `pnpm run gen:diff-code` 前先确认选了哪条路，否则会生成一份文不对题的 mdx。
