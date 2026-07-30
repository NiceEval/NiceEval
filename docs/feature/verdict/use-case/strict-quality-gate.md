# `--strict`：质量分毕业成门禁

## 解决什么问题

一条新写的质量断言(相似度、judge 评分)还没养熟:阈值定多少合适没有数据,直接写成 gate 会让整批 eval 因为一条没校准的断言天天红。
但只记录不判定又没有牙齿——质量退化悄悄发生,没人看见。
需要一条从「观察」到「执法」的渐进路径,而不是在 gate / 不断言之间二选一。

## 全流程

1. 断言先写成带阈值的 soft(契约见 [Severity 与 Verdict](../architecture.md)):

   ```ts
   t.check(reply, similarity("按月份分组统计营收").atLeast(0.7));
   ```

2. 日常按默认模式跑,soft 低于阈值**只记录不改判**——run 保持绿,分数落进结果:

   ```bash
   niceeval exp compare
   ```

3. 观察期用 `niceeval show` / `view` 看各 attempt 的 soft 分数分布,校准阈值:0.7 是太松还是太紧,数据说话。
4. 阈值稳定后,在要收紧的场合(每周质量巡检、发版前检查)加 `--strict`,soft 低于阈值按 failed 判:

   ```bash
   npx niceeval exp compare --strict
   ```

5. `--strict` 下红掉的题就是质量退化清单,照常拿 locator 下钻;确认阈值和断言都可信后,把该断言改成 `.gate(x)`,从此不依赖 flag、任何模式都执法。

## 边界

- Gate 断言不受 `--strict` 影响,任何模式下不通过都 failed——`--strict` 只对带通过线的 soft 生效:打分断言的 `.atLeast(0.7)` 与 0/1 断言的 `.atLeast(1)` 都在此列。
- 无参 `.soft()` 的纯记录断言在 `--strict` 下也只记录:没有线就没有「低于线」。
- 断言评不了(judge 缺 key、证据通道不完整)是 `unavailable` 走 errored,不是 failed——`--strict` 不改变这条(见 [CLI](../cli.md))。

## 相关阅读

- [CLI](../cli.md) —— `--strict` 用法与退出/展示规则。
- [Severity 与 Verdict](../architecture.md) —— gate / soft / optional 的判定规则单源。
