# show 的 `@<locator>` 曾被现刻水位收窄，历史 attempt 打不开

## 现象

`niceeval show --history` 印出历史 Run 的 attempt locator，用户复制其中一条执行
`niceeval show @<locator>`，得到 not-found 类报错，文案是
`Locator @xxxx… is outside the selected record scope.`。同一个记录根里，只有落在「现刻水位」
（最新一次执行那批）里的 attempt 能被打开；同一个 eval 在更早 Run 里的那条恒不可达。
下钻链因此断在 `--history` 这一步：它印出的东西自己打不开。

## 根因

`src/show/index.ts` 的 locator 分支在 `resolveLocator()` 成功之后又做了一次二次筛：拿
`currentSample(results, { experiments, fresh }).attempts` 当「有效范围」，命中不到就报第四种
失败。`currentSample` 是现刻水位口径——同一个 evalId 只留最新那条，旧 Run 的同题 attempt 被
去重掉，于是历史 locator 恒落在集合外。

这违反 `docs/feature/record/architecture.md`「locator 的唯一性」：locator 的寻址作用域是
**一个记录根**扫到的全部 attempt，「不是一个 Run，也不是全局」；读取侧只有
`MalformedLocatorError` / `LocatorNotFoundError` / `AmbiguousLocatorError` 三种失败。
`resolveLocator()` 自己（`src/record/open.ts` 的 `buildAttemptLocatorIndex`）本来就按整个记录根
建索引，行为是对的——错的是消费方在它之上加了一层范围。

反直觉的地方：那层筛的注释写着「历史 attempt 仍在有效根的 attempts 集中，因此可达」，读代码
时看上去是安全的，但 `Sample.attempts` 的口径恰恰是去重后的现刻水位，注释与实现口径相反。

## 修法

删掉 `src/show/index.ts` locator 分支里的 `effectiveAttempts` 二次筛，`resolveLocator()` 的结果
直接用；三种失败保持不变，不新增第四种。行为测试在 `src/show/json.test.ts`「@<locator> 指向
历史 Run 的 attempt 时照样打开」——区分力靠同一个 evalId 在新旧两个 Run 里各有一条：现刻水位
只留新的那条，旧的那条曾被判「不在选中范围内」。

一般教训：身份直达（locator）与范围选择（`--exp` / `--fresh` / 前缀）是两套正交语义，直达路径
不要拿范围口径复核一遍。要复核也不能借用带去重语义的 `Sample.attempts`。
