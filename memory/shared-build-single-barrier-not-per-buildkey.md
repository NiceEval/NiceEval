# 共享构建做成了全局 barrier,不按 BuildKey 放行

**现象**:13 题批跑里 10 个镜像已 ready,仍显示 `0 running · 13 queued`,全体等最慢那个构建约 7 分钟才开始派发(2026-07-31 MemoryBench 真机)。

**根因**:实现把 Run 级构建协调做成了「全部 BuildKey 完成才放行」的单一 barrier;`docs/feature/sandbox/case.md` 的契约是「成功后以 BuildKey 登记 locator,再放行依赖它的 attempt」——逐 key 放行,互不等待。

**修法**:未修。按契约改成逐 BuildKey 放行;覆盖类别在 `docs/engineering/testing/unit/sandbox.md`「BuildKey single-flight、失败扇出和预算」已有对应条目。
