# `--source`：按源码阅读已建立的证据

`--source` 选择 Attempt detail 的源码 target。
plan 声明源码 Projector 与展示参数，executor 生成完整的 SourceProjection，text 和 web 再从同一份值树显示它。

```sh
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --source
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --source=full
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --source=evals/security/check.ts
```

`full` 与路径模式都是已规范化的 target 参数。
它们必须在 plan 中明确出现；不能因为读者点击展开或输入路径才临时读取源码、断言或调用链。

## 显示

源码树从 eval entry 开始，显示已建立的断言、得分、Turn 与调用路径标注。
有 declaration location 却缺少源码时，显示带 EvidenceValue 的不可展开节点；没有 location 的内容进入 unmapped 区块。

所有 provenance、行号、捕获限制和 basedOn 由 SourceProjection 提供；available tree 另带
verification，unavailable tree 另带非空 causes。
renderer 不用文件名、堆栈文本或 UI 字段推测缺失位置。

## 边界

- `--source` 不扫描工作目录，也不读取源 Store 的 raw object。
- text 截断与 web 折叠只改变已生成树的显示密度。
- 导出必要源码 evidence 失败时 artifact 导出失败，不能显示为「源码不在源 Record」。

## 相关阅读

- [源码调用树](../eval-source/README.md) —— SourceProjection 的心智模型。
- [`SourceView`](../components/primitives/source-view.md) —— web 面组件。
- [show](../show.md) —— target 与完整 AttemptRef。
