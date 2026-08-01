# Use Cases:现行断言 → 候选写法对照

用真实验收脚本里的断言逐场景演示 [Library 词表](../library.md)的用法。
每篇的结构固定:**场景**(验收什么契约)→ **现行断言**(摘自 e2e 脚本的真实代码)→ **候选写法** → **回归剧本**(真实踩坑在新写法下会怎么红)→ **边界**(这样写断言了什么、刻意不断言什么)。

对照的取材有两个来源:

- **现行脚本里的脆断言。**
  优先选已经出过问题或明显脆的那类(化妆性变更打红的),同时保留一组「现行写法本来就对」的场景证明词表不强迫升级——不是所有断言都要上结构读面。
- **memory 台账里的真实缺陷。**
  每篇挑一到两条已记录的踩坑,把它当回放输入:新写法在哪一步红、红在哪句话上、定位要跳几次。
  抓不到的也照实写——[render-structure](render-structure.md) 记了一条结构断言按设计抓不到的公式漂移,它归单元层的数据语义。

七个场景:

- [render-structure](render-structure.md) —— report 域渲染结构:散点图标题、表格与区块顺序;整句文案正则与 80 列 padding 的替换
- [readback](readback.md) —— show 读面:history 行、stats 计数、`·` 分隔文案与字形耦合的替换
- [machine-exports](machine-exports.md) —— `--json` 摘要与 JUnit:parse 后的结构比较,与 golden 收窄到哪里
- [html-export](html-export.md) —— 导出 HTML:领域词加可访问性树替换原始 HTML 字符串刮取;哪些留给浏览器读面
- [browser-interaction](browser-interaction.md) —— 浏览器交互:指名步骤与领域词;探测循环、机制断言与 sleep 的替换
- [adapter-readback](adapter-readback.md) —— 适配器仓库读回:停在事实级,不升级结构断言
- [package-consumer](package-consumer.md) —— 发布包消费边界:触发本设计的案例完整重写,含 world 生命周期与 Behavior 文件形态
</content>
