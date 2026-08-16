# Cases

| ID | 输入 | 必须观察到的结果 |
|---|---|---|
| O1 | 同一次 send 同时产生 Agent event 与 OTel timing input | 唯一 timing collector 只形成 canonical interval；无法绑定 owner、clock、phase 或 anchor 的输入进入 limitation |
| O2 | OTel bridge 初始化失败，但 Assertions 已完整保存 | Assertions 仍可读取；timing 写 partial `capture-failed`，不能伪装成 complete-empty |
| O3 | 旧 Run 只有七个 family，新 writer 使用新 layout | reader 按明确 representation 选择一条路径，不自动 union 两套 facts |
| O4 | OTel package closure 很大，但 Report 只要 usage view | 如实读取完整 closure 或返回 limit；不得宣称 view 选择等于 range read |
