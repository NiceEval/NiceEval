# link 工作树上 `niceeval show @<locator>` 直接崩

**现象**:pnpm link 的开发工作树作为消费端时,`niceeval show @<locator>` 直接崩溃,`--json` 面可用(2026-07-31 MemoryBench 真机)。

**根因**:未查。CLI 的 show/view 读预编译 `dist/report/**`(见 [linked-dev-tree-producer-version-placeholder](linked-dev-tree-producer-version-placeholder.md) 一带的 link 消费系列条目),link 树上 dist 陈旧或缺失是首要嫌疑。

**修法**:未修。复现时先 `pnpm run build:report` 排除陈旧 dist,再看崩溃是否仍在;临时绕行用 `--json`。
