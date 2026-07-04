# 来源提取：Microsoft Writing Style Guide

来源：

- [Welcome](https://learn.microsoft.com/en-us/style-guide/welcome/)
- [Developer content](https://learn.microsoft.com/en-us/style-guide/developer-content/)
- [Procedures and instructions](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/)

## 读取到的核心主张

Microsoft Writing Style Guide 面向所有写技术内容的人，强调“简单、直接、清晰”。它的语气方向是温和、放松、利落、清楚，并在合适的上下文里提供帮助。

对开发者内容，它明确说可以假设开发者具备基本编程概念，不需要解释基础常识；应该聚焦具体技术或产品信息，帮助他们达成目标。

## 开发者内容的基础

Microsoft 把开发者文档的基础分成两类：

- Reference documentation：像百科一样描述类、方法、属性等编程元素。
- Code examples：展示如何使用这些元素。

这对 API 文档很关键：只列 reference 不够，只给代码示例也不够。reference 提供事实，示例提供使用方式。

## 步骤与说明

Procedures and instructions 页面有一个很直接的观点：最好的步骤是用户不需要读的步骤。如果 UI 或工具已经清楚地引导用户完成任务，就不需要额外流程文档。

当必须写步骤时，选择最清楚的表达方式：

- 一句话说明。
- 图片或示意图。
- 视频。
- 编号步骤。
- 带链接或按钮的流程。

也就是说，步骤文档不是越多越好；如果产品或 CLI 能自解释，应优先让产品本身降低文档负担。

## 对 NiceEval 的直接映射

- 不要在文档里解释一般 TypeScript、Node.js、CLI 的基础知识，除非 NiceEval 的使用确实依赖某个不明显细节。
- Reference 页和示例页要互相补足：reference 讲字段和类型，示例讲具体用法。
- 如果某个流程可以通过 CLI 输出或错误信息自解释，优先改善 CLI 输出或错误信息，再补文档。
- 文档语气应直接帮助用户完成任务，不需要营销式铺垫。

## 可直接采用的检查问题

- 是否在解释开发者已经知道的基础知识？
- 是否缺少能说明 reference 如何使用的代码示例？
- 是否用文档弥补了本可以由 CLI、错误信息或产品交互解决的问题？
- 步骤是否选择了最简单的呈现方式？

