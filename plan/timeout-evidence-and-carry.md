# 超时证据保全 + timeoutMs 携带判据 + 耗时删失:实现 TODO

契约已定稿,一律以 docs 为准,本 plan 只列落点:

- 证据保全与删失线纪律:`docs/runner.md#超时双层保护`
- timeoutMs 退出指纹哈希、携带资格判据:`docs/runner.md#缓存指纹去重`、`docs/feature/experiments/architecture.md`(调度接口)
- durationMs 删失口径:`docs/feature/reports/library/metrics.md#内置指标`
- 裁决与起因:`memory/timeout-evidence-carry-censoring-ruling.md`

## TODO

- [ ] **A. 证据保全**(src/runner/attempt.ts + 相关 receiver)
  - [ ] A1. 事件接收器 / usage 累计移到 attempt 外层 Scope 持有(timing recorder 已是),onTimeout 不再从 base 空壳重建——中断后由 Scope 外层用已收证据组装 `AttemptRecord`(error.code="timeout"、error.phase=中断时阶段)
  - [ ] A2. 超时路径在 teardown 链前补一次 workspace.diff 折叠(计时入收尾段,不入 durationMs;沙箱不可用时如实缺失,不阻塞收尾)
  - [ ] A3. `artifacts` 列表如实声明实际写出文件(依赖 Results v9 的 artifacts 字段,I2 实现中)
- [x] **B. 指纹与携带**(src/runner/fingerprint.ts + planCarry)
  - [x] B1. fingerprint 哈希输入移除 timeoutMs(src/runner/fingerprint.ts:47 附近)
  - [x] B2. planCarry 追加资格判据:`durationMs ≤ 当前 resolved timeoutMs`(未设=无穷);逐 attempt 判定,与 [[carry-must-be-per-attempt-not-whole-eval-key]] 的既有纪律一致
- [ ] **C. 删失指标**(src/report/components/model 指标层)
  - [ ] C1. durationMs 指标对 error.code="timeout" 返回 null;确认 samples/total 覆盖呈现在耗时列生效
- [ ] **D. 测试**(只为已声明类别写测;覆盖类别声明见 docs/engineering/testing/unit/experiments-runner.md「超时证据保全与携带判据」、reports.md 耗时删失判据)
- [ ] **E. 同步义务**:typecheck → pnpm test;真机(MemoryBench)复演:人为设一个必超时的短 timeoutMs,`show @<locator> --execution` 能看到被打断前的事件而非 "(no events recorded)";提高 timeoutMs 后旧 passed 全部携带不重跑

## 验收

1. 超时 attempt 的 events.json 非空(含中断前事件),usage 为部分累计值,diff 存在(沙箱存活场景)。
2. `timeoutMs` 20m→40m:已完成 66 结果全部携带,零重跑;40m→10m:耗时 >10m 的旧结果重跑。
3. 耗时聚合含 timeout attempt 时,均值不含线值、格子覆盖率 samples<total 可见。
