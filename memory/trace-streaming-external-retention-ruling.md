---
relations:
  - role: supports
    target: docs/feature/adapters/library/README.md#流式提交事件
---

# 裁决：长局轨迹先做流式接纳与 Record 内保存，外部存档只留出处

**裁决**（2026-11-27，GitHub #308）。长时间运行的应用无法把几十万条事件装进 `recordTrace` 的数组。
采用的形状是流工厂 `events: { stream: (signal) => AsyncIterable<item> }`，事件仍保存进 Record；
外部原始存档只以纯展示的 `archive` 出处记录。在 NiceEval 中按需读取外部存档登记为 Roadmap，不在本期交付。

**被否决的弯路**。

- 每条 trace 声明 `retention: "sealed" | "external"`，`external` 时 Record 只存 manifest 与轻量索引，
  `show execution` 用当前 Adapter 注册的 source reader 取回外部块。否决原因：同一个历史请求在有无项目配置的机器上结果不同，
  破坏 Inspection 只读已发布事实与离线审计的承诺；导入的 Record 决定读取参数，Adapter 注册不能证明本机获准读取；
  仅凭 manifest 无法把未取得的外部内容当成已验证的 closure 成员；以同一 Run 身份把 external 复制成 sealed 会触发 `run-id-collision`。
- “只封存 Assertion 实际用到的事件”。框架看不到事件消费边界：Adapter 可把聚合值交给 `t.check`，
  “没有匹配事件”的断言依赖穷尽扫描，丢掉未命中事件会削弱审计。
- 迭代器正常结束即 complete、抛错或取消即 partial。已知缺口的 producer 可以正常结束，取消后排空的 producer 可以完整；
  已接纳前缀里指向未到达事件的 `targetKey` 会让直接封存的图不闭合。因此完整性只由显式 `end` 声明，截断只发布引用全部已出现的最长前缀。
- 直接接受 `AsyncIterable`。不协作的 `next()` 或 `return()` 可以永不完成，裸迭代器没有取消入口；
  改为与附件 body 相同的受管 signal 工厂，接纳时段关闭时先停拉取与写入，再通知 producer。

**依据**。逐条证据见设计挑战报告（`~/WorkNote/Prompts/NiceEval/reports/challenge-external-evidence.md`），
其中 Node 反例确认 async generator 在第二次 `next()` 挂起后 `return()` 无法在清理期限内返回。
