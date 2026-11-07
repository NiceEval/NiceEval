# `scripts/gen-diff-code.ts` 不排除 `.venv`/`__pycache__`,langgraph 配对能把 `mint validate` 撑爆内存

**现象**：`pnpm run gen:diff-code` 给 `examples/zh/origin/langgraph` ↔ `examples/zh/eval/langgraph`
这对生成的 `docs-site/zh/example/langgraph-before-after.mdx` 一度到 166MB(正常同类文件 ~400KB)。
`PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate` 跑到这份 mdx 时 V8 heap OOM 直接崩,
报 `FATAL ERROR: Reached heap limit Allocation failed`。

**根因**：`scripts/gen-diff-code.ts` 的 `EXCLUDES` 只排除了 JS 生态的 `node_modules`,没有排除 Python
的 `.venv`(`examples/zh/origin/langgraph/.venv` 91MB,里面全是二进制/`.so`)和 `__pycache__`。
`listFiles()` 把 `.venv` 下每个文件都当成普通文本去 diff、tokenize,内容当文本处理时体积和调用次数
直接炸穿 V8 默认 heap。这条配对本身也已知过时(见 [[gen-diff-code-langgraph-config-stale]]),但
`.venv` 未排除是一个独立于"两边语言对不上"的 bug——任何 Python 示例只要装了本地 venv 都会触发,不
限于 langgraph 这一对。

**修法**：`EXCLUDES` 加两条 `/(^|\/)\.venv(\/|$)/`、`/(^|\/)__pycache__(\/|$)/`,和 `node_modules` 同等对待。
加完后 langgraph-before-after.mdx 从 166MB 降到 ~400KB,`docs:validate`/`docs:links` 正常跑完。以后新增
Python 示例(或任何非 JS 生态、有本地虚拟环境/缓存目录的示例)接入 `gen-diff-code.ts` 的 `DIFF_CONFIGS`
前,先确认对应的环境目录(`.venv`、`__pycache__`、`.mypy_cache` 等)进了 `EXCLUDES`,不要等 OOM 才发现。
