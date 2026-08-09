# 源码调用树

源码 target 以调用路径组织一份 Attempt 的判定痕迹。
它从 entry、已捕获源码、声明位置和调用路径构成 `SourceProjection`，不把辅助文件平铺，也不让 renderer 重新读取源码。

```text
Captured source evidence
  → SourceProjection
  → text / web display density
```

第一项是 Record 中带 provenance 的事实。
第二项的 raw tree 由 `defineAttemptProjector()` author function 返回，再由 runtime 根据 tracked
read 包装成 EvidenceValue；author 不构造 available/unavailable。
第三项只决定折叠、上下文和布局，不能改变事实或追加读取。

## 显示规则

- entry 文件形成主干；调用片段挂在发起调用的行下。
- 有位置但没有正文的帧保留为不可展开节点，并显示完整 unavailable causes。
- 没有位置的断言、得分或 Turn 进入 unmapped，不伪造源码行。
- 第三方帧只显示已建立的 package 边界，不捕获或猜测包内源码。

## 边界

- 一个 SourceProjection 只描述一个完整 AttemptRef。
- 调用次数没有可信 identity 时不作无法证明的计数。
- `--source`、Attempt details 与 `SourceView` 共用同一 Projection，不各自组装树。
- exporter 只复制 Plan 中使用的 source evidence closure；源事实已存在却不能复制时导出失败。

## 相关阅读

- [Architecture](architecture.md) —— snapshot、Projector 与 SourceProjection。
- [Display](display.md) —— 面相关的裁行和折叠。
- [`show --source`](../show/eval-source.md) —— 命令和 target 参数。
- [`SourceView`](../components/primitives/source-view.md) —— web 面组件。
