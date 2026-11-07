# 单跑一题后 view 榜单只剩 1/48:最新 Run 挤掉整批且无覆盖提示(根因已修)

## 现象

2026-07-30 MemoryBench dogfooding(niceeval 0.11.3):48 题整批跑完(02:42)后单独重跑一题
sqlite-with-gcov(11:11),`niceeval view` 榜单里该实验(codex-e2b)变成 1/48、0%、$0.11,
看起来像整批结果丢了。数据没丢:`show --history` 里 48 题的 attempt、verdict、耗时、成本俱在。
榜单没有任何「本行只覆盖 1/48」的提示。

## 契约对照

`docs/feature/sample/library.md`「时效」定的是:currentSample 从旧 Run 拼入 attempt
(configHash 前提保护),拼不进的按覆盖占位行呈现、带时效标注,「不静默消失」。观察与契约
不符,分叉有两种可能,待复现定位:

- 两轮之间配置改过(MemoryBench 当时正在绕 config.timeoutMs 压 eval 的
  bug,见 [multi-source-field-resolution-order](multi-source-field-resolution-order.md)),
  configHash 变了 → 按契约排除旧 Run,但榜单没给覆盖占位行——呈现面实现缺口;
- configHash 没变仍只剩 1 题 → 跨 Run 拼接本身没实现或有 bug。

## 处置(根因已定位并修复)

根因见 [exp-runjson-missing-confighash-breaks-current-sample](exp-runjson-missing-confighash-breaks-current-sample.md):
走的是第二条分叉,configHash 没变、跨 Run 拼接本身没生效——exp 写入面从不写 run 级
configHash,`currentSample` 的缝合前提因此从未成立,选择器直接把该实验塌成当次执行的 1 题,
不落 `coverage.missingEvalIds`,所以榜单也没有覆盖占位行可呈现(呈现面本身没有缺口,是选择器
的输入已经错了)。修法:exp 写入面把规划期 configHash 写进 `run.json`,存量记录另有读取面
回退推导;两者一起让 `currentSample` 的跨 Run 拼接对 exp 产物真正生效,该题外的 47 题回到
`coverage`,不再需要专门检查呈现面。
