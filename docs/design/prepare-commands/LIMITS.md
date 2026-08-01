**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

---

## 环境模型的裁决是前提

[环境模型 DECISION](../environment-model/DECISION.md) 固定了单一频次与顺序:每条 Attempt reset 后重放两层 prepare,昂贵动作靠真实检查命中。
窗口级 scope 与 reset anchor 已被否决,本主题的候选不得以任何形式恢复它们。

## workdir reset 是唯一恢复原语

复用的题间重置只恢复 workdir。
因此成本分摊面是结构性的:workdir 内的产出每题重付,workdir 外的产出存续、由探测命中。
Provider 没有通用的「窗口内快照再恢复」原语,候选不能假设它存在。

## command 的身份与检查是两件事

`command()` / `shell()` 由纯数据参数生成稳定 identity,但不携带检查语义;一条 `shell("git clone …")` 在复用下每题重新执行完整命令。
`defineSandboxCommand()` 提供显式 identity 登记,检查逻辑仍由作者手写。
直接传入的 callback 一律 opaque,禁跨 Run carry。

## 旧裁决:不配官方 fixture 装载 API

memory 条目 [no-official-fixture-loading-api](../../../memory/no-official-fixture-loading-api.md)(2026-07-29)否决过官方 `cloneRepo`,判据是「先拆自己造的地雷,不配官方绕行 API」;该地雷(沙箱内框架文件)已经拆除。
如今提出 checkout 命令 的动机是复用缓存与稳定身份,属于当时未评估的新事实。
候选若采纳官方 checkout,必须显式记录这次翻案与新旧理由的差异。

## 泄漏检查边界不变

本地内容进入 Sandbox 仍走 `registerSandboxContent()` 的 digest 登记与 transfer manifest;远端 checkout 的可见性由命令执行时点决定。
内置命令不能为了缓存把测试材料的物理隔离边界打穿。
