# 来源提取：GitHub Docs 写作与内容模型

来源：

- [Best practices for GitHub Docs](https://docs.github.com/en/contributing/writing-for-github-docs/best-practices-for-github-docs)
- [Content design principles](https://docs.github.com/en/contributing/writing-for-github-docs/content-design-principles)
- [Making content findable in search](https://docs.github.com/en/contributing/writing-for-github-docs/making-content-findable-in-search)
- [Style guide](https://docs.github.com/en/contributing/style-guide-and-content-model/style-guide)
- [Annotating code examples](https://docs.github.com/en/contributing/writing-for-github-docs/annotating-code-examples)

## 读取到的核心主张

GitHub Docs 的核心是“按用户需求组织内容”。写作前先定义：

- 谁会读？
- 他们要完成什么？
- 读完后应该能做什么或理解什么？
- 这篇内容属于哪种内容类型？

它强调文档必须准确、有价值、包容、可访问、易用。决策标准不是语法上绝对正确，而是是否最有利于用户。

## 内容设计原则

GitHub 的内容设计原则有几个特别值得借鉴：

- 文档应帮助用户达成目标，而不是覆盖所有可能内容。
- “刚好足够”的文档比无限扩张更好，因为更多内容会让所有内容更难找。
- 优先记录高影响、高价值场景，不追求穷举所有边缘情况。
- 清晰、意义、正确、一致优先。
- 当 style guide 没覆盖某个问题时，用用户目标和信息流来判断。

## 可读性与可扫描性

GitHub 明确说多数读者不会完整阅读文章，而是在扫描或略读。可扫描性来自：

- 清晰离散的主题。
- 重要信息靠前。
- 每段一个想法。
- 每句一个主要信息。
- 有意义的小标题。
- 列表、表格、代码块、提示块、视觉元素合理分隔。
- 强调只用于真正重要的信息，不滥用。

## 搜索与可发现性

Making content findable 页面把 SEO 直接联系到用户体验：

- 搜索通常是用户进入文档的主要入口。
- 页面要围绕搜索意图写，而不是围绕内部功能名写。
- 标题、intro、metadata、alt text 要和用户使用的词一致。
- 每篇文章要有清晰、离散的主题。
- 重定向要维护，避免旧链接失效。
- 定期清理事实错误、样式错误、坏链接和不再需要的内容。

## 代码示例注释

GitHub 对 code annotations 的观点是：长代码示例需要解释“它做什么”和“为什么这样写”，但注释本身会增加复杂度，所以只在确有必要时使用。

可迁移规则：

- 代码块前先说明整体目的。
- 注释解释关键行的作用和原因。
- 不假设读者知道为什么示例要这样写。
- 示例改动后，注释也必须同步检查。
- 如果一页有多个相似示例，考虑合并，避免增加读者负担。

## 对 NiceEval 的直接映射

- 每个页面开头要说明读者任务，不要先列内部模块。
- 页面标题应匹配搜索意图，例如“连接远程 Agent”比“Adapter primitives”更适合作为任务页标题。
- `docs-site` 页面应避免“为了完整”堆叠低频分支；高频路径优先。
- 代码示例要先说目的，再给代码，再给关键行解释和预期结果。
- 改 API 或示例时，必须同步检查注释、描述、链接和重定向。

## 可直接采用的检查问题

- 读者从搜索进入这一页，第一屏能否判断是否相关？
- 页面是否只回答一个主要任务或概念？
- 标题、description、正文是否使用用户会搜索的词？
- 重要信息是否在前 1/3？
- 是否有旧链接需要 redirect？
- 是否存在“看似完整但实际让用户更难找”的内容？

