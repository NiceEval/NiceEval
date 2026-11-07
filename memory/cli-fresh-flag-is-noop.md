# CLI `--fresh` 不是真 flag,会被静默吞掉——要跳过缓存结果用 `--force`

**现象**：曾有离线跑 CLI 的脚本(`test/view-harness/run.mjs`,后已删除)用 `niceeval exp --fresh` 起跑,注释也写"--fresh,每次重新生成工件",但 `src/cli.ts` 的 `parseArgs` 根本没有 `fresh` 这个 flag 名。

**根因**：`parseArgs` 对未识别的 `--xxx` flag 是 `default: break`(静默忽略),不会报错提醒。真正控制"是否复用 `.niceeval/` 里上次的缓存结果(按 fingerprint 跳过重跑)"的 flag 是 `--force`(`flags.force` → 跳过 `loadMostRecentResults`)。那个脚本之所以看起来"有效",是因为它自己在 spawn 子进程前先 `rm -rf .niceeval`,跟 `--fresh` 这个 flag 本身没关系。

**修法**：新写离线/e2e 测试 harness、要确保每次都是干净重跑时,显式用 `--force`(需要跳过 fingerprint 缓存)而不是拍脑袋传一个"听起来像"的 flag 名;不确定某个 flag 是否存在,先查 `src/cli.ts` 的 `BOOL_FLAGS`/`parseArgs` switch,未知 flag 不会报错、只会被默默吃掉。见 `test/e2e-image-refusal.test.ts` 里用的是 `--force`。

## 已失效(2026-07-24 复核):两个前提都不成立了

标题里的现象和根因**都已消失**,但不是被当成 bug 修的,是两次不相干的改动各拆掉一个前提:

1. **未知 flag 不再被静默吞掉。** `ac60840d`(parseArgs 表驱动重写)把解析改成
   `nodeParseArgs({ args, options: FLAG_OPTIONS, allowPositionals: true, strict: true })`
   (`src/cli.ts:290`),源码紧邻注释写明「未知 flag 由 strict 模式报清晰错误,不再静默吞掉后面的
   位置参数」。今天传一个不存在的 `--xxx` 会当场报用法错误。
2. **`--fresh` 成了真 flag,但语义完全不同。** `0de7444a` 引入 `fresh: { type: "boolean" }`
   (`src/cli.ts:209`),含义是「只统计新执行的 attempt,排除携带条目与跨快照拼入的历史执行」
   (见 [staleness-demoted-from-warning-to-provenance](staleness-demoted-from-warning-to-provenance.md)),
   **不是**「跳过缓存重跑」。

**仍然有效的那半句**:要强制重跑、不复用 `.niceeval/` 上次结果,用的仍然是 `--force`;
`--fresh` 现在会被接受但做的是另一件事,拿它当 `--force` 用是新形态的踩坑——比原来更隐蔽,
因为不再有任何报错。
