---
name: accept-drops-eval-level-judge-from-fingerprint
description: niceeval accept 对带 eval/config 级 judge 的 eval 重算指纹时用了残缺的 judge 口径，接受后立刻又被判 stale，形成死循环
metadata:
  type: project
---

# `accept` 重算指纹丢失 eval/config 级 judge → accept 后立刻再次 stale

## 现象

`niceeval accept @<locator>` 对带 eval 级(或 config 级)judge 配置的 eval 执行成功、产出新 locator,但下一次 `exp` / `exp --dry` 把这条刚接受的新结果重新判为 stale,delta 恒为 `config:judge.baseUrl added` / `config:judge.model added`,并再次建议 accept 新 locator——形成 accept → stale 死循环,人工反复接受也不收敛。真实案例:下游 toggl-cli/04-billing-doc,eval 上配了 `judge.baseUrl` 与 `judge.model`(experiment 与 config 都未声明 judge)。

## 根因

两条路径对「当前配置身份」的 judge 口径不同源:

- `planCarry`(`src/runner/fingerprint.ts`,`exp` 与 `exp --dry` 都走它)在算指纹前先 `resolveJudge(run.judge, evalDef.judge, options.configJudge)` 拿到三层合并后的 judge,再喂给 `configIdentityForRun`。
- `prepareAcceptLocator`(`src/runner/accept.ts`)此前直接调用 `fingerprintWithManifest(pair)` 与 `computeConfigHash(pair)`,两者都用默认投影——`configIdentityForRun` 的第三参缺省为 `run.judge`(experiment 级),eval 级与 config 级 judge 被丢掉。

于是 accept 落盘的 `fingerprint` / `configHash` / `manifest.config` 里 judge 恒为 `Unconfigured`(只要 experiment 自己没配 judge),而同一条结果落盘的 `experiment.judge`(走 `experimentRunInfo` → 完整 `resolveJudge` 链)却含 eval 的 judge。下一轮 `exp` 用完整链重算指纹,与 accept 写下的永远不相等,所以 delta 恒为 `judge.* added`。

## 修法

`prepareAcceptLocator` 改成先按 planCarry 同一口径重建身份:`resolveJudge(run.judge, targetEval.judge, config.judge)` → `configIdentityForRun(pair.run, pair.plan, resolvedJudge)`,再用这份 identity 的 `Current` 投影调 `fingerprintWithManifest(pair, undefined, projection)`,`configHash` 改用 `hashConfigIdentity(identity)`(两者都已导出,没有新增公开面)。修在 `src/runner/accept.ts`;回归测试 `src/runner/accept.test.ts`「`prepareAcceptLocator` · 与 planCarry 同口径的 Judge 解析链」——只声明 eval 级 judge,断言 accept 算出的指纹与独立调用 `planCarry` 算出的完全相同,且 accept 后的新结果确实被下一轮 `planCarry` 携带(不是又立刻 stale)。

## 适用场景

任何「本次配置身份」需要跨多个入口重算的字段都适用同一条纪律:**多处独立重算同一份配置身份时,必须共用同一个身份构造函数(这里是 `configIdentityForRun` + 完整 `resolveJudge`),不能一处走默认参数、另一处走完整解析链**。与 [multi-source-field-resolution-order](multi-source-field-resolution-order.md) 是同一类坑(多来源字段解析链只有一处会短路),但这里短路发生在「两个调用点用了不同的默认值」而不是「`??` 链少写一层」。
