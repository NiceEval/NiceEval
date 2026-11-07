# examples/zh/eval/<name> 的 niceeval file:/link: 深度容易写错一层

**现象**：`examples/zh/eval/ai-sdk-v7`（restructure 后新路径,4 层深:
`examples/zh/eval/<name>`)的 `package.json` devDependency 和
`pnpm-workspace.yaml` 的 `overrides` 都写的是 `niceeval: file:../../..`
/ `link:../../..`(3 个 `..`)。`pnpm install` 不报错,但装出来的
`node_modules/niceeval` 实际指向 `examples/`(没有 `package.json`),不是仓库根 ——
`pnpm run typecheck` 会报一整屏 `Cannot find module 'niceeval'`。

**根因**：这个相对路径是相对 `package.json` 自身所在目录写的。旧布局是
`examples/zh/<name>`(3 层深),`../../..`(3 个 `..`)正好到根。后来把这类
niceeval 集成示例都挪进了 `examples/zh/eval/<name>`(多了一层 `eval/`),
但改路径时只搬了目录、没同步这两处的 `..` 层数,导致该示例已经在装了错误依赖
的状态下运行(typecheck 全灭,只是没人跑过 typecheck 没发现)。

**验证方法**:不要只看 `pnpm install` 是否报错(它不会),要么跑
`pnpm run typecheck`,要么直接
`python3 -c "import os; print(os.path.realpath('node_modules/niceeval'))"`
确认落地目录里有 `package.json` 且 `name` 是 `niceeval`。

**修法**：`examples/zh/eval/<name>/package.json` 和 `pnpm-workspace.yaml`
里的 niceeval 路径都要写 4 个 `..`(`file:../../../..` /
`link:../../../..`)。已确认修复:`examples/zh/eval/ai-sdk-v7`
(2026-07-02,连带发现并修的)、`examples/zh/eval/codex-sdk`(新建时按 4 层写对)。
`examples/zh/eval/custom-genai` 当时就是对的,可以拿它当参照。
`examples/zh/eval/openllmetry`(2026-07-02,新建时踩到过一次 3 层,typecheck
报错后改成 4 层验证通过)也已确认正确,可继续当参照。
