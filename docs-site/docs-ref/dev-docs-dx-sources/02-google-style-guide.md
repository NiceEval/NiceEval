# 来源提取：Google Developer Documentation Style Guide

来源：

- [About this guide](https://developers.google.com/style)
- [Highlights](https://developers.google.com/style/highlights)
- [Philosophy of this style guide](https://developers.google.com/style/philosophy)
- [Procedures](https://developers.google.com/style/procedures)
- [Code samples](https://developers.google.com/style/code-samples)

## 读取到的核心主张

Google 的 style guide 首先是“house style”，不是行业标准。它明确要求先遵循项目自己的风格，如果项目没有规定，再用 Google 的指南；如果为了清晰和一致需要偏离指南，也可以偏离，但要在文档内保持一致。

这对团队文档很重要：风格指南不是为了压倒领域语言，而是减少重复争论，让读者看到稳定一致的表达。

## 风格重点

Google 的重点可以归纳为：

- 面向开发者和技术实践者写清晰、一致的技术文档。
- 使用对话式但不过分轻浮的语气。
- 用第二人称，让文档直接对读者说话。
- 用主动语态，让动作主体明确。
- 为可访问性和全球读者写作。
- 链接文字要有描述性，不要写“点击这里”。
- 标题、列表、代码、UI 元素、日期、图片 alt text 都要一致。

## 步骤写作

Procedures 页面给出的核心规则很实用：

- 步骤是为了完成任务，通常用编号列表。
- 引导句要提供上下文，不要只重复标题。
- 单步骤任务不要硬写成编号流程。
- 一步一动作；复杂步骤按“动作、命令、占位符说明、必要解释、输出、结果说明”的顺序组织。
- 多种做法并存时，优先选择最短、最简单、对读者最可访问的方式；必要时用不同页面、标题或 tab 分开。
- 可选步骤用 `Optional:` 明确标注。
- 先说明在哪里操作，再说明做什么。

## 对代码示例的启发

Google 对代码示例的可迁移要求：

- 代码相关文本用代码格式。
- 示例要服务读者任务，而不是只展示语法。
- 占位符要解释清楚。
- 命令输出如果影响判断，应展示或说明。
- 示例需要随着 API 更新维护。

## 对 NiceEval 的直接映射

- 所有命令、包名、文件名、API 名都用反引号。
- How-to 页步骤应按“动作 -> 命令 -> 参数/占位符 -> 期望输出 -> 下一步”组织。
- 避免“下面我们将会”这类预告式废话，直接告诉用户要完成什么。
- 中文页也应保持短句和主动语态。
- 当 NiceEval 有推荐默认路径时，先写默认路径；再用独立小节写变体。
- 如果某个功能还没实现，不要写成“将自动完成”，而应放在 Roadmap 或 Future work。

## 可直接采用的检查问题

- 这页是否用了读者会搜索和理解的词？
- 每个步骤是否只有一个主要动作？
- 命令里的占位符是否解释清楚？
- 是否把条件放在动作前面？
- 代码示例是否跟当前 API 一致？
- 是否为了“完整”而塞入了不必要解释？

