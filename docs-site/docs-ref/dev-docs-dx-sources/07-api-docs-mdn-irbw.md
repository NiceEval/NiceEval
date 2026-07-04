# 来源提取：MDN API reference 与 I’d Rather Be Writing API 文档课程

来源：

- [MDN：如何撰写 API 参考文档](https://developer.mozilla.org/zh-CN/docs/MDN/Writing_guidelines/Howto/Write_an_api_reference)
- [I’d Rather Be Writing: Documenting APIs](https://idratherbewriting.com/learnapidoc/)

## 读取到的核心主张

MDN 和 I’d Rather Be Writing 都强调：写 API 文档前要先真实体验 API，而不是只从规格或代码里抄字段。

I’d Rather Be Writing 的课程设计更偏“像开发者一样使用 API，再转向技术写作者视角”。它通过真实 API 场景学习 endpoint、parameters、data types、authentication、curl、JSON、command line 等，而不是孤立讲概念。

MDN 则更偏 API reference 的结构化写作，要求先熟悉 API、确认演示是否过时、列出要创建或更新的页面清单。

## API 文档不只是 endpoint 字典

MDN 认为 API reference 通常包括：

- 概述页。
- 接口页。
- 构造函数页。
- 方法页。
- 属性页。
- 事件页。
- 概念或使用指南。
- 示例。

I’d Rather Be Writing 对 REST API reference 的基础组成包括：

- resource descriptions。
- endpoints and methods。
- parameters。
- request example。
- response example。

同时它也强调 API 文档还需要 getting started、product overview、status and error codes、request authorization 等概念和指南内容。

## 写 API reference 前的准备

MDN 的可迁移规则：

- 先花时间体验 API。
- 了解主要接口、属性、方法、用例。
- 用 API 写一个简单功能。
- 当 API 变化时，检查演示和旧示例是否过时。
- 如果新旧写法都仍然有效，应明确记录差异。
- 开始前列出要创建或更新的页面清单。

## 对 NiceEval 的直接映射

NiceEval 的 API 文档也不应只列 `defineEval` 类型。至少要组合：

- Overview：为什么需要 eval、experiment、adapter。
- Reference：`defineEval`、`defineAgent`、配置、CLI。
- Guide：如何写一个 eval、如何连接 agent、如何运行实验。
- Examples：真实 `.eval.ts` 和真实 `examples/zh/*`。
- Error / status：结果状态、失败分类、artifact 位置。

对 `defineEval` 这样的 reference 页面：

- 字段、类型、默认值、是否必填要完整。
- 示例要展示真实导入路径。
- 与旧 API 或设计稿不同的地方要明确。
- 不要把尚未实现的字段写进 reference。

## 可直接采用的检查问题

- 写 reference 前是否实际跑过 API 或示例？
- 是否知道这个 API 的最常见使用路径？
- 是否有 request / input 示例和 response / output 示例？
- 是否说明认证、错误、状态和限制？
- 是否有概述页和使用指南配合 reference？
- 示例是否跟最新 API 一致？

