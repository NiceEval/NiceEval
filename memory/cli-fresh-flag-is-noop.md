# CLI `--fresh` 不是真 flag,会被静默吞掉——要跳过缓存结果用 `--force`

**现象**：曾有离线跑 CLI 的脚本(`test/view-harness/run.mjs`,后已删除)用 `fasteval exp --fresh` 起跑,注释也写"--fresh,每次重新生成工件",但 `src/cli.ts` 的 `parseArgs` 根本没有 `fresh` 这个 flag 名。

**根因**：`parseArgs` 对未识别的 `--xxx` flag 是 `default: break`(静默忽略),不会报错提醒。真正控制"是否复用 `.fasteval/` 里上次的缓存结果(按 fingerprint 跳过重跑)"的 flag 是 `--force`(`flags.force` → 跳过 `loadMostRecentResults`)。那个脚本之所以看起来"有效",是因为它自己在 spawn 子进程前先 `rm -rf .fasteval`,跟 `--fresh` 这个 flag 本身没关系。

**修法**：新写离线/e2e 测试 harness、要确保每次都是干净重跑时,显式用 `--force`(需要跳过 fingerprint 缓存)而不是拍脑袋传一个"听起来像"的 flag 名;不确定某个 flag 是否存在,先查 `src/cli.ts` 的 `BOOL_FLAGS`/`parseArgs` switch,未知 flag 不会报错、只会被默默吃掉。见 `test/e2e-image-refusal.test.ts` 里用的是 `--force`。
