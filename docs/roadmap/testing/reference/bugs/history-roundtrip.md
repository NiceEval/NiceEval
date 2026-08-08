# Bug 组：历史选择必须在多次公开 action 后闭合

这一组用部分补跑遮蔽 carry 参照结果作正例，用历史 locator 无法读回作同形反证。
它们都要求观察至少两个时点；单份结果的内部一致性不足以证明历史语义。

## 正例：部分 run 清空后续 carry 参照结果

fix commit `85cafd7d` 前，carry 只读取最新 run。
完整 run 后只补跑一个 eval，这份部分 run 成为最新；下一次运行整组时，较早 run 中其它已完成 eval 全部消失，导致 36 个 attempt 被错误重跑。

`latestPerExperiment` 的测试正确展示最新快照，runner 测试也正确消费给它的 prior results。
漏测的是 full → partial → full 三个 action 之间的选择关系。
fix 新增 `loadLatestResultsPerEval` 单元，证明每个 experiment / eval 从含它的最新 run 整批取 attempts。

```ts
recordBehavior(partialRunDoesNotEraseCarryBaseline, async () => {
  const final = w.action("full-after-partial").ndjson();
  expectObserved(final.startedEvalIds()).toShowExactRows(["suite/broken"]);
  expectObserved(final.reusedEvalIds()).toShowExactRows(["suite/a", "suite/b"]);
});
```

三次命令由 prepare 按名字执行并登记 argv、输入根 digest 与输出根 digest。
Behavior 只读最终 world，不靠测试执行顺序或共享临时目录猜历史。

## 同形反证：公开 history 产出的 locator 不能消费

fix commit `578597b6` 前，record 的 `resolveLocator()` 已能索引整个数据根；`show` 成功读取后又用 current sample 二次过滤。
同一 eval 的旧 Run locator 因而被排除，`show --history` 印出的身份自己打不开。

fix 新增的 `src/show/json.test.ts` 已构造同一 eval 的新旧 Run，直接调用 show 证明旧 locator 可达。
用户侧 proof 再向外走一步：从真实 history stdout 读取 locator，然后把这个实际 observed value 交给下一条真实 CLI。

```ts
reportBehavior(historyLocatorsAreReadable, async () => {
  const history = reportView((await cli("pnpm exec niceeval show --history")).stdout);
  const locator = history.run("older").attempt("suite/a").locator();
  const locatorArg = shellArg(locator);
  const attempt = reportView((await cli(`pnpm exec niceeval show ${locatorArg}`)).stdout);
  expectObserved(attempt.attempt(locatorArg).locator()).toEqualObserved(locator);
});
```

这里没有 `toBeAValidLocator()` 特例 matcher。
最强、最少的证明就是 producer 给出的身份能被对应 consumer 使用；格式合法但查不到的 locator 会自然在第二条命令失败。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | action 只比较身份集合和往返结果，不锁目录名、locator 字节长度或历史排版 |
| 不能改断言放行 | carry 的 started / reused 集合来自签入场景；locator 往返没有可替换的期望字面量 |
| 观察失败显式报错 | action 缺 evidence、NDJSON 缺身份、history 找不到行、consumer 不接受 locator 分阶段失败 |
| 用户侧直接定位 | 消息同时指向产生 locator 的 stdout 行与消费它的命令；carry 失败列出三个 action |
| 设施不造假 | prepare 的可变阶段结束后原子发布只读 world；Behavior 不追加结果或改历史 |
| 用户已有用法不改 | 完整运行、局部运行、续跑与复制 locator 都是原有用户动作 |

## 仍未关闭的产品问题

`85cafd7d` 修复的是后续 carry 参照结果。
「部分 run 是否能作为 latest sample 发布并遮蔽全量结果」在当时仍是待议契约，不应由 DSL 私自判定。
验收题库只证明已经定稿的 carry 行为，未定稿部分继续留在账本。
