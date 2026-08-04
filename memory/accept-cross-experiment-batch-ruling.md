# 裁决:`accept` 多 locator 放开跨 experiment,原「必须同一 experiment」是实现事故

**裁决**(2026-08-04)。`niceeval accept @<locator>...` 的多 locator 输入不再要求全部属于同一
experiment。命令按每条 locator 解析出的 experiment 分组,为每个 experiment 各自封口一个原子
snapshot;预检仍是全批原子(任一 locator 不合格,整批零写入);同一 experiment 内两个 locator
解析到同一个当前 (eval, attempt) 目标仍判重复拒绝,跨 experiment 的同名 eval 不算重复。

**起因**。旧限制来自 `writeAcceptedAttempts` 的一条实现细节——「批量 commit 只建一个
snapshot」的 writer 侧约束,被误当成「批量 accept 本身只能对着一个 experiment」的产品规则去校验
和文档化(`docs/feature/experiments/cache.md` 曾写「多个 locator 必须属于同一 experiment……
跨 experiment 时按 experiment 分开调用」)。真实下游(toggl-cli)一次要接受 137 条 locator,天然
跨多个 experiment,被这条限制逼着按 experiment 拆成多次 CLI 调用。而 `createWriter` 本来就支持
一个 writer 内按 experimentId 记忆化建多个 `RunWriter`(`src/record/writer.ts` 的
`pending`/`created`),批量 commit 天然可以按 experiment 分组各开一个 snapshot,不需要强收窄成
单 experiment。

**修法**。`writeAcceptedAttempts` 改为按 `prepared.pair.run.experimentId` 分组,组内维护
`(eval, attempt)` 去重集、组间互不影响;快照级字段(agent/model/configHash/currentExperiment/
manifests/knownEvalIds/name)全部按组内的 `group[0]` 取,不再从全批 first 拿——manifests 尤其
要每组独立一个对象,否则跨 experiment 同名 eval 会把两边的指纹输入清单互相覆盖。返回值按调用方
传入的 `preparedAttempts` 顺序,用一个 `Map<PreparedAcceptedAttempt, locator>` 还原(分组会打乱
内部处理顺序)。落点 `src/runner/accept.ts`;契约见 `docs/feature/experiments/cache.md`
「`niceeval accept @<locator>...`」。回归测试见 `src/runner/accept.test.ts`
「writeAcceptedAttempts · 跨 experiment 分组提交」「acceptLocators · 跨 experiment 批量」。

与性能修法同批完成,见 [[accept-batch-per-locator-planning-oom]]——放开跨 experiment 后单批
locator 数量会明显变大,若不同批修好 OOM,这条裁决在真实规模下不可用。
