# 现象与根因

CLI 把所有 InspectionSourceError 改写成同一句旧版本迁移提示，丢失底层错误分类与原因。损坏输入、资源上限、忙碌读取因此无法区分；消费者无法从公开 JSON 继续诊断偶发失败。

## 契约与范围

读取错误保留具名的 Record 错误分类、操作与原因。只有明确的 schema migration required 才给迁移建议。资源限额和 busy 属于未完成读取，不宣称 Record 损坏；已确认的完整性失败仍保持原分类。此修正不证明 RPG 偶发读取失败的根因，后者继续由 inspection-transient-source-invalid 跟进。

## 验收

安装候选公开 query 对无效 Record 和输入尺寸限制给出可区分诊断，原文件不改写，不调用模型。正式回归证据完成前保持开放。
