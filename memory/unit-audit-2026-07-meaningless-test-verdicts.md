---
format: concord.document/v1
id: unit-audit-2026-07-meaningless-test-verdicts
title: 单元测试全量审查裁决:21k 行里直接删除级仅 5 条,病因分四类
createdAt: 2026-07-23T16:46:08+08:00
createdAtSource:
  kind: first-recorded
  path: memory/unit-audit-2026-07-meaningless-test-verdicts.md
  commit: 2c473122456b4472c361ddfa2890918c3c88f1b1
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 单元测试全量审查裁决:21k 行里直接删除级仅 5 条,病因分四类

2026-07-23 按 `docs/engineering/testing/unit/README.md` 的「核心判据」与九条反模式对全部 src 测试(四家族并行审查)做存废裁决,作为后续同类审查的基线台账。

## 裁决:直接删除(已执行)

1. `eval-selection.test.ts` EvalDescriptor 类型占位断言——恒真,类型可导入性由 `pnpm typecheck` 全量守护。病因:**把类型检查当运行时证明**。
2. `execution-tree.test.ts` 真实 claude-code parser 端到端——协议归一明令没有单元层维度(README「Adapters 不在此表」),wire fixture 是会漂移的二手复制;执行树侧断言与同文件既有用例重复。病因:**越进协议归一禁区**。
3. `session.test.ts` `state` 起始 `{}` 可读写——替语言证明对象可赋值;「框架从不写入」是全程不变量,单次快照证明不了。病因:**替第三方(语言)证明基本能力**。
4. `compute.test.ts` 现刻水位「先 failed 后 passed 只用最新」——与 results 家族 `host-equivalence.test.ts` 磁盘 fixture 纯重复,且 reports.md 明文该语义归 Results 家族。病因:**跨家族重复,写不出不同错误类别**。
5. `metric-views/validate.test.ts` 旧形状 dimension 报错——同一 validator 同一错误类别在 `dual-render.test.tsx` 有更完整断言(含版本漂移文案)。病因:**同类别双测**。

## 裁决:看似该删但删了放走真实错误(搬家/迁移,已执行)

- `compute.test.ts` 两条可比性测试(model 不一致收窄、编排字段不参与比较)是**全仓唯一覆盖**,直接删会放走「旧配置快照冒充新水位」——迁入 `host-equivalence.test.ts` 磁盘 fixture(`writeSnapshot` 增加 `experiment` 编排字段覆盖参数);`Scope.filter` 不吞 coverage 的断言迁 `results.test.ts`(fresh 清空全部 attempt 的磁盘场景)。
- 两处「类型检查包进 vitest 空转 it」(`results.test.ts` ScopeWarning 联合穷尽、`scoped.test.ts` SubagentMatch 无 rejected)——编译期守护有效、运行时断言恒真;迁为模块级编译 fixture(src 全量进 typecheck,不需要新文件),删掉 it()。

## 未执行、留给后续的

- 改写级(命中反模式但断言面有价值):`human.test.ts` 40%/20% 封顶复刻生产算式;`run.test.ts` exclusive 串行两条用 sleep 猜调度(同文件 teardown-barrier 是正确范式);`cli-commands.test.ts` `--orphans` 表格锁列宽空格;`session.test.ts` 三条隔离不变量合并为一;`context.test.ts` workdir mock 复读并入邻例;`report.test.ts` 未实现回调不包装(先补声明或删)。
- 登记缺口(测试有效、覆盖规范未声明,按 registry「先声明后写测」补 docs):judgeProbeTargets、Json/JUnit 原子替换(fs mock 还需要一条「不 mock fs」例外裁决)、reporter 作用域、`loadLatestResultsPerEval`、collector `includePoints`、attempt-dialog(`cases:` 行号引用已 stale)。

## 复盘结论

跟改率高 ≠ 该删:头部跟改文件(run.test.ts、compute.test.ts)恰是质量最好的,跟改多因契约真在动。真正的无意义测试不是成片的,而是四类零星个体:恒真占位、越层(协议/渲染)、语言能力、跨家族重复——审查时按「删掉放走什么错误」逐条问即可,不需要按覆盖率或跟改量连坐。
