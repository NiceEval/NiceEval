**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Decision](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | 同一个 repository 的多道题使用不同 base commit | 六道 Eval、六个完整 commit OID、fresh Sandbox | origin 只补齐缺失对象；每题得到自己的完整祖先历史 |
| C2 | 较早题目不能读取未来修复 | Agent 已知较新 commit 与 blob OID | `cat-file`、ref、reflog、alternate、promisor 与 Sandbox 其它路径都不能取得未来对象 |
| C3 | 上一题故意污染 `.git` | Agent 写 hook、config、remote、ref 与 object；下一题复用 Sandbox | 下一题开始前丢弃全部旧 Git metadata，不执行上一题 hook，也不信任旧 object |
| C4 | 多个并行 Attempt 请求同一 commit | 同一 Invocation 内并发派发 | 宿主只执行一份 acquisition/projection 工作，其余等待同一发布结果 |
| C5 | projection 已有，SourcePool 已回收 | 完整、已发布的不可变投影 | Attempt 零 origin 请求并成功建立 repository；投影不依赖 SourcePool 存活 |
| C6 | 获取、传输或验证中途失败 | 中断、磁盘不足、digest 不符或 Provider 写入失败 | 不发布半成品；已接触不安全材料的 Sandbox 退休，后续 Attempt 使用替代实例 |
| C7 | 用户需要观察与回收占用 | 多个冷 SourcePool 与 SourceProjection | status/inventory 解释需求和容量；GC 尊重 lease，并能独立回收 pool 与 projection |
| C8 | 作者输入不在 V1 支持面 | branch、tag、短 SHA、SSH、private、local、SHA-256、submodule 或 LFS | 在网络与 Sandbox 创建前给出具名配置错误，不静默降级到完整 mirror |
