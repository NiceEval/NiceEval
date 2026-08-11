# run.json 的 Run 级 configHash 曾把逐 eval judge 分叉当 bug 报错(已修)

## 现象

MemoryBench 的 `compare/codex-gpt-5.6-luna--remem`(与同批 `--obelisk`)在规划期(`niceeval exp ... --rerun all`,还没派发第一个 attempt、只做完 judge 预检)直接抛错:

```
Planned config hash differs across evals within experiment "compare/codex-gpt-5.6-luna--remem"
("9c9d77…" vs "06da92…" for eval "toggl-cli/04-billing-doc").
configHash is a Run-level value and must be identical for every eval scheduled under the same experiment.
```

36 条 eval 里只有 `toggl-cli/04-billing-doc` 报的哈希不一样,其余 35 条互相一致。

## 排查弯路

最初怀疑是同日刚落地的 `pathPrepend`(commit `226303f2`,给全部 sandbox provider 加了这个可选字段并序列化进 sandboxLayer/物理计划身份)在不同 eval 的 plan 构造点序列化不一致——04-billing-doc 确实是这条链里唯一不声明 `sandbox` 字段的题(工作区故意留空,纯靠记忆回答,见 `experiments/shared/remem.ts` 文件头)。实测证伪:`sandboxLayerIdentityFor(plan.pair, "experiment")` 只投影 `owner.kind === "experiment"` 的贡献,04-billing-doc 与其余 5 条 toggl-cli 题的 Eval 层贡献虽然形状不同(有没有声明 `sandbox: sandboxLayer().prepare(...)`),但 Experiment 层的 `dockerSandbox({...})` 模板对全部 36 条 eval 是同一个模块级常量,过滤后的身份逐字节相同。

## 根因

`toggl-cli/04-billing-doc` 是这条链里唯一自己声明 `judge: {...}` 的 eval(其余 35 条都不声明,项目级 `niceeval.config.ts` 与实验文件也都不声明 judge)。`src/runner/fingerprint.ts` 的 `planCarryPrepared` 按 `resolveJudge(run.judge, evalDef.judge, configJudge)` 逐字段解析出**该 eval 实际生效**的 judge,喂进 `configIdentityForRun(...)` 算出 `plannedConfigHashes`——这是刻意行为,判分 judge 变化必须让依赖它的 eval 重跑(`docs/feature/experiments/cache.md`「指纹:两个哈希嵌套」,以及 [accept-drops-eval-level-judge-from-fingerprint](accept-drops-eval-level-judge-from-fingerprint.md) 记录的前一次相关修复)。

昨天(2026-08-04)的 commit `775816b3` 新增了 run.json 的 Run 级 `configHash` 落盘,校验逻辑却直接拿 `plannedConfigHashes`(逐 eval、含完整 judge 解析链的那份)按 experimentId 汇总并断言"同一 experiment 下每条 eval 的值必须相等,不等就抛错,不能硬写"——这条校验的假设(configHash 是纯 Run 级,不受任何单个 eval 的声明影响)与「一条 eval 自己声明 judge 会让它的 configHash 单独变化」这个更早就存在的既有行为直接矛盾。矛盾此前一直不可见,是因为 exp 写入面在这条修法之前从不写 run 级 configHash(见 [exp-runjson-missing-confighash-breaks-current-sample](exp-runjson-missing-confighash-breaks-current-sample.md)),没有任何地方真正比较过"同一 experiment 下逐 eval 的 configHash 是否相等"。

## 修法(已落地)

`run.json` 每个 experiment 只有一槽 `configHash`,必须是真正的 Run 级值——不能是携带判据里那份逐 eval、含完整 judge 解析链的值。`src/runner/run.ts` 汇总 `configHashesByExperiment` 时改用 `computeConfigHash(prepared)`(`src/runner/fingerprint.ts` 已有但此前未被消费的函数,等价 `configIdentityForRun(run, plan)` 默认单层 `run.judge`,不叠加 eval/config 覆盖)重算,校验的是这份真正应当逐 eval 恒等的值;逐 attempt 落盘的 `result.configHash`(`plannedConfigHashes`)不变,仍然按完整链解析,携带正确性不受影响——两个数字对同一条声明了 judge 的 eval 可以合法不同,不能混为一个断言。

顺带落地一条已裁决的通用规则:可选配置字段的缺省值不进身份序列化(absent ≡ default)。`pathPrepend` 空数组此前会被序列化成 `pathPrepend: []` 写进 sandboxLayer/物理计划身份/configHash;改为省略该字段(`src/sandbox/layer.ts` 的 `pathPrependIdentityField`),省略声明与显式传空数组现在产出同一份 digest。这次归一改变了已落盘结果的身份摘要(`pathPrepend` 引入以来的所有结果都会变 stale),需要保留的用 `niceeval accept` 重锚。

## 测试

- `src/runner/run.test.ts`「run.json 的 Run 级 configHash 不因单条 eval 自带 judge 分叉」:同一 experiment 下一条 eval 声明自己的 judge、其余不声明,规划期不再抛错;该 eval 自己的 `result.configHash` 与其余 eval 不同(携带正确性),但 `run.json` 落盘的值与不声明 judge 的 eval 一致(真正的 Run 级值)。临时改回旧逻辑复现过原始报错,确认非重言式。
- `src/sandbox/layer.test.ts`「pathPrepend 省略与显式空数组产出同一份 template identity;非空时才改变它」。

修法落点:`src/runner/run.ts`、`src/sandbox/layer.ts`。文档同步:`docs/feature/experiments/cache.md`(未改,既有契约本就正确)、`docs/feature/sandbox/library.md`「PATH:受管变量与 pathPrepend」补 absent ≡ default 通用规则、`docs/engineering/testing/unit/{experiments-runner,sandbox}.md` 补覆盖规范。
