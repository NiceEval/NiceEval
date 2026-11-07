# Ledger 裸 pathspec 漏掉嵌套缓存，nested repo 静默变 gitlink

**现象（2026-07-16，真实 terminal SWE-bench 迁移）**：Astropy checkout 放在 workdir 子目录时，私有 ledger 的外层 `git add` 把它记录为 mode `160000` gitlink，agent 在 repo 内改源码却不出现在 `diff.json`；改为 checkout 直接占据 workdir 根后证据恢复。另一次 run 的 328 个 diff 文件里大半是嵌套 `__pycache__/*.pyc`，默认 `__pycache__` 没排掉。

**根因**：`src/runner/ledger.ts` 把默认排除和 `EvalDef.diff` pattern 原样拼成 `:(exclude)<pattern>`。无 `/` 的 Git pathspec 在这个调用形态只覆盖 workdir 根，不等于文档承诺的 gitignore「任意深度同名项」；而嵌套已提交 repo 对外层 Git 是合法 gitlink，`git add` 只写 warning、exit 0，runner 只检查退出码所以完全看不见证据降级。

**裁决与修法**：默认项和 `diff.ignore/include` 先从 workdir 根的 gitignore 子集编译成显式 glob pathspec；无 `/` pattern 补 `**/`，目录同时覆盖自身与后代。每次 add（含 include 打洞）后检查 index mode `160000`，未被 ignore 的 gitlink fail fast，错误提示把 checkout 放 workdir 根，或整体 ignore 确实不评分的 nested repo。不能把 Git warning 升成普通 warning 后继续：内部修改已经不可见，这是判定证据完整性错误。
