# Use Cases:现行断言 → 候选写法对照

用真实验收脚本里的断言逐场景演示 [Library 词表](../library.md)的用法。每篇的结构固定:**场景**(验收什么契约)→ **现行断言**(摘自 e2e 脚本的真实代码)→ **候选写法** → **边界**(这样写断言了什么、刻意不断言什么)。

对照的取材原则:优先选**现行写法已经出过问题或明显脆**的断言(化妆性变更打红的那类),同时保留一组「现行写法本来就对」的场景证明词表不强迫升级——不是所有断言都要上语义树。

- [render-structure](render-structure.md) —— report 域渲染结构:散点图标题、表格与区块顺序;整句文案正则与 80 列 padding 的替换
- [readback](readback.md) —— show 读面:history 行、stats 计数、`·` 分隔文案与字形耦合的替换
- [machine-exports](machine-exports.md) —— `--json` 摘要与 JUnit:容差 golden 的适用面
- [html-export](html-export.md) —— 导出 HTML:aria 快照替换裸 HTML 字符串刮取;哪些留给 Playwright
- [adapter-readback](adapter-readback.md) —— 适配器仓库读回:点查询维持子串级边界,不升级
- [package-consumer](package-consumer.md) —— 发布包消费边界:触发本设计的案例完整重写,含证据生命周期与 vitest 测试文件形态
