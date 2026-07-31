# 共享构建做成了全局 barrier,不按 BuildKey 放行

**现象**:13 题批跑里 10 个镜像已 ready,仍显示 `0 running · 13 queued`,全体等最慢那个构建约 7 分钟才开始派发(2026-07-31 MemoryBench 真机)。

**根因**:实现把 Run 级构建协调做成了「全部 BuildKey 完成才放行」的单一 barrier;`docs/feature/sandbox/case.md` 的契约是「成功后以 BuildKey 登记 locator,再放行依赖它的 attempt」——逐 key 放行,互不等待。

**修法**:已修(2026-07-31)。协调器新增 `startSandboxBuilds()`(`src/sandbox/build-coordinator.ts`):启动后立即返回句柄,逐 key 的结算 promise 一 settle 就放行,`prepareSandboxBuilds()` 保留为「等全部 key」的薄封装。`src/runner/run.ts` 不再 await 整批构建,改在每条 attempt 的许可链最前面等 `awaitBuildsFor(evalId)`——只等本 eval 的 key,等待期间不占全局并发位;locators 在自己的 key 结算后才灌进 attempt,provenance 在调度收尾时从 `running.done` 取齐。

同批新增的瞬时构建失败退避重试也落在 `prepareOne()`:`isTransientBuildError()` 先过 provisioning 的保守分类器,再补 builder CLI 的文案形态(`toomanyrequests` / `unexpected EOF` / `i/o timeout`),默认 3 次封顶、指数退避带全抖动,abort 立即收束。

区分力测试:`src/sandbox/build-coordinator.test.ts` 的「逐 BuildKey 放行」与两条重试用例;`src/runner/run.test.ts`「逐 BuildKey 放行」让构建阻塞直到不依赖它的 eval 真的开跑——全局 barrier 在那一格会死等到超时。
