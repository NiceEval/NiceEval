---
format: concord.document/v1
id: inspection-transient-source-invalid
title: 正常只读查询间歇被归类为 Record 源损坏
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: open
epoch: 0
promotions: []
history: []
evidenceRequirement: concord.native-reliability/v1
---
# 消费者证据

同一已发布 Run 的 run.summary 首次返回 inspection-source-invalid/fix-record-source，稍后相同请求成功；无付费运行期间的 assertion.detail 批读也出现相同错误。未观察到迁移或历史记录改变，不能据此宣称 Record 损坏。消费者候选为 6509776a。

# 调查边界

sourceError 将多数打开来源失败统一映射为 inspection-source-invalid。项目读模式只检查一次 sidecar；静态捕获与新写者可能竞争，importer 还有资源与时间限制。以上原因尚未由消费者底层错误或公开复现确认。

# 验收

正常历史查询与新 Invocation 并发，以及只读批量查询，应在明确预算内读取封存事实。暂态资源问题不能建议迁移损坏记录，真实来源校验不能放松。仅通过安装候选与公开接口验收，不重跑付费模型。
