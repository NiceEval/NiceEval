# 断言详情错误套用持久化字符串限制

NiceEval-Eval 的 canary log-summary Attempt @19NMDTBRMSQXS 已完成，但公开 niceeval query 的 attempt.assertion.detail 对 ae_d85391749827cf900988 返回 inspection-operation-failed。最小安装后复现中，小工具输出正常，100000 字符工具输出令同一详情操作失败，Attempt 本身仍 passed。

根因是 Inspection 来源行 detail 复用持久化 AssertionFactValueSchema 的 8192 UTF-8 字节字符串限制。Agent Turns 的合法完整来源文本不受该断言保存预算约束，详情投影因而被解码器拒绝。

修正只分离 Inspection 来源行事实的字符串校验策略，保留持久化断言预算与响应总预算，不截断来源证据。验收强化现有 inspection-query machine consumer owner，通过安装候选的公开 CLI 检查长中文输入输出及尾标记，执行同 owner 红绿与 takeover。
