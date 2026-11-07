# 已修:复用池不摘除淘汰实例,容量被死实例占满后 acquire 永久挂起

- **现象**:sandbox 复用池里被淘汰(寿命确认失败 / reset 失败)的实例仍留在 `entries`,
  池容量被死实例占满后,后续 `acquire` 无实例可租也不再创建新实例,派发永久挂起。
- **根因**:淘汰只标记不摘除,容量判断按 `entries.length` 计,死实例占位。
- **修法**(2026-07-29,实现 ensureLifetime 契约时顺手修):淘汰实例从池 `entries` 中 splice
  移除;实例编号改为单调计数器,不复用已淘汰实例的编号。落点 `src/runner/sandbox-pool.ts`,
  配套测试 `src/runner/sandbox-pool.test.ts`(更换与不反复重建场景)。
