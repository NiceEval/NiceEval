# 单跑一题后 view 榜单只剩 1/48:最新 Run 挤掉整批且无覆盖提示

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

## 处置(未定位)

先复现分辨走的哪条分叉再修。不论哪条,「榜单行覆盖远小于该实验历史覆盖」都必须可见,
呈现契约在 `docs/feature/sample/library.md` 与 `docs/feature/reports/`。
