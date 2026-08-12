# PLAN-5 分层子设计

**相关文档**：[PLAN-5](../README.md) · [Library](../library.md) ·
[Architecture](../architecture.md)

这些文档不是五个互斥候选，而是 PLAN-5 内部五个可独立评审、实现和替换的责任
子设计。Record 已是固定起点，因此不再为它建立子设计。

```text
Sample → Projection → Relations → [Derivation] → Report
```

每层只能依赖左侧已封闭的结果，不能越过相邻边界取得 Record path、reader 或另一个
owner 的 bytes。上层可以用 facade 隐藏下层对象，但不能吞掉它们的状态、lineage 或失败
边界。

| 子设计 | 独立拥有 | 可独立替换的部分 |
|---|---|---|
| [Sample](sample.md) | selection、logical slots、denominator 与 exact owner resolution | selection DX 与 population 索引 |
| [Projection](projection.md) | 单包解码、local views 与 representation branch | package projector 与有限分支 planner |
| [Relations](relations.md) | 跨包 anchor join、cardinality 与 relation states | relation vocabulary 与 builder DX |
| [Derivation](derivation.md) | 可选的公式依赖、coverage、去重与局部失败 | 纯函数或 managed runtime |
| [Report](report.md) | consumer identity、closed output 与 delivery | Page/Download 作者 DX 与 renderer |

精确 TypeScript 形状的唯一单源仍是 [Library](../library.md)。各子设计只固定责任、交界和
验收条件，不复制一套容易漂移的 API 定义。
