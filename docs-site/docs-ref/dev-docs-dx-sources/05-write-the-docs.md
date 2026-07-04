# 来源提取：Write the Docs

来源：

- [Software documentation guide](https://www.writethedocs.org/guide/)
- [How to write software documentation](https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/)
- [Documentation principles](https://www.writethedocs.org/guide/writing/docs-principles/)

## 读取到的核心主张

Write the Docs 是社区型资料集合，重点不是给出唯一方法，而是沉淀软件文档和技术写作实践。

它特别强调：文档不只是给别人看，也帮助作者和团队理解自己的代码、降低支持成本、增加贡献、改善设计。

## 为什么写文档

读取到的主要理由：

- 六个月后，自己的代码也会变陌生。
- 用户需要知道项目为什么存在、如何安装、如何使用。
- 贡献者需要知道如何参与。
- 写文档会迫使团队把 API 和设计决策想清楚。
- 文档质量会影响项目采用、维护、贡献和可访问性。

## 初始 README 应包含什么

Write the Docs 的初学者指南建议先从简单 README 开始。核心内容包括：

- 项目解决什么问题。
- 一个小代码示例。
- 安装方式。
- 源码和 issue tracker。
- 支持渠道。
- 贡献方式。
- License。

它也提醒不要过度依赖 FAQ。FAQ 容易过时、内容混杂、难搜索，而且常常不是来自真实高频问题。

## 文档原则

Documentation principles 页面提出一组文档原则，几个对 NiceEval 很有用：

- Precursory：在开发前或开发中就写文档，文档可以作为需求和设计的早期草稿。
- Participatory：文档应纳入开发者和用户的反馈，而不是只由少数人维护。
- ARID：文档不必像代码一样极端 DRY；适度重复有助于读者在当前上下文里理解。
- Skimmable：标题、链接、段落开头都要帮助读者快速判断相关性。
- Exemplary：示例能节省读者时间，但太多示例会损害可扫描性。
- Consistent：多人维护时，风格指南能维持一致性。
- Current：错误文档比缺文档更糟。
- Nearby：文档源尽量靠近代码，方便随代码一起修改。
- Unique：不同来源之间要有清晰边界，避免同一信息重复维护。
- Discoverable：用户可能寻找文档的地方都应有入口。
- Addressable：内容应能被精确链接，方便分享、反馈和引用。
- Cumulative：先讲前置概念，再讲依赖它的内容。
- Complete：一旦选择覆盖某类信息，就应覆盖完整；部分覆盖要提前说明。

## 对 NiceEval 的直接映射

- `docs-site/`、README、示例和 CLI help 要有边界，避免同一能力多处不一致。
- 示例可以适度重复关键上下文，不要为了 DRY 迫使读者跨三页拼信息。
- 错误或过时文档应优先删除、标注或修正。
- 文档和代码尽量在同一 PR 里更新。
- FAQ 不应成为主要信息架构；真实高频问题应沉淀为 guide、reference 或 troubleshooting。

## 可直接采用的检查问题

- 文档是否靠近会改变它的代码？
- 是否存在同一事实在多处重复且容易漂移？
- 读者能否直接链接到具体段落？
- 文档是否只部分覆盖某类信息却没有说明？
- 是否有过期示例比没有示例更危险？

