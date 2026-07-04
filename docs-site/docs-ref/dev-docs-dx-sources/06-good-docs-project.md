# 来源提取：The Good Docs Project Templates

来源：

- [The Good Docs Project Template Guides](https://www.thegooddocsproject.dev/template)

## 读取到的核心主张

The Good Docs Project 的价值在于把常见文档类型模板化。它不是在讲抽象原则，而是提供可复用的页面类型。

Core Pack 包含文档项目通常需要的基础类型：

- Concept
- How-to
- README
- Reference
- Release notes
- Troubleshooting
- Tutorial

此外还有 API getting started、API reference、Glossary、Installation guide、Quickstart、SDK overview、Style guide、Terminology system 等模板。

## 对内容类型的定义

读取到的几个关键定义：

- Concept：解释产品或特性的概念、上下文、背景。
- How-to：用简洁编号步骤完成一个任务。
- README：说明项目、如何参与、如何开始使用。
- Reference：描述应用的具体组件或特征。
- Troubleshooting：列出用户常见症状、原因和解决步骤。
- Tutorial：通过设置示例项目进行动手学习。
- Quickstart：首次介绍应用，聚焦主要能力，让用户尽快开始使用。
- API getting started：让读者用最容易的方式得到一个能展示服务能力的结果。
- API reference：技术手册，提供 API 规范和集成说明。
- Glossary：列出组织或项目中具有特定含义的术语。
- Terminology system：帮助团队一致使用和翻译术语。

## 对 NiceEval 的直接映射

可以把这些模板映射到 `docs-site`：

- `quickstart.mdx`：Quickstart / Tutorial。
- `guides/*`：How-to。
- `concepts/*`：Concept。
- `reference/*`：Reference。
- `zh/concepts/*`：Concept + terminology consistency。
- 未来可以补 `troubleshooting/*`：排查运行失败、sandbox 失败、adapter 失败、CI 失败、报告打不开等。
- 如果术语持续漂移，可以单独做 glossary 或 terminology page。

## 可直接采用的页面骨架

### How-to

```md
# 如何完成某任务

适用场景。

## 前置条件

## 步骤

## 验证结果

## 常见失败

## 相关参考
```

### Troubleshooting

```md
# 排查某类问题

## 症状

## 可能原因

## 检查步骤

## 解决办法

## 仍然失败时提供哪些信息
```

### Reference

```md
# API / CLI / 配置项

## 用途

## 语法或签名

## 参数

## 返回值或输出

## 默认值

## 示例

## 限制
```

## 可直接采用的检查问题

- 这个页面是否属于已有模板类型？
- 如果是 troubleshooting，是否同时写了症状、原因、解决步骤？
- 如果是 reference，是否完整列出字段和默认值？
- 如果是 quickstart，是否只聚焦首次成功，而不是覆盖全功能？

