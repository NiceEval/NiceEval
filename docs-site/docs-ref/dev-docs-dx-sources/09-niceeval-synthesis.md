# NiceEval 文档改造综合规则

本文件不是单一来源提取，而是把前面来源笔记映射到 NiceEval 的写作规则。

相关来源：

- [01-diataxis-divio.md](./01-diataxis-divio.md)
- [02-google-style-guide.md](./02-google-style-guide.md)
- [03-github-docs.md](./03-github-docs.md)
- [04-microsoft-style-guide.md](./04-microsoft-style-guide.md)
- [05-write-the-docs.md](./05-write-the-docs.md)
- [06-good-docs-project.md](./06-good-docs-project.md)
- [07-api-docs-mdn-irbw.md](./07-api-docs-mdn-irbw.md)
- [08-dx-sources.md](./08-dx-sources.md)

## 1. 先判定页面类型

每个页面开始前先写一句内部判断：

- Tutorial：帮助用户第一次成功。
- How-to：帮助用户完成一个具体任务。
- Reference：查字段、命令、类型、默认值。
- Explanation：解释概念、边界、为什么。
- Troubleshooting：根据症状定位原因并修复。

如果一个页面承担多个主要目标，优先拆页。

## 2. NiceEval 的推荐目录职责

- `quickstart`：Tutorial，只追求最短成功路径。
- `guides/*`：How-to，一个页面解决一个任务。
- `concepts/*`：Explanation，解释核心心智模型。
- `reference/*`：Reference，列准确事实。
- 未来 `troubleshooting/*`：排错，按症状组织。
- `examples/*`：真实可运行例子，不承担完整解释。

## 3. 页面开头模板

每页开头应回答：

- 这页适合谁。
- 读完能完成什么。
- 需要什么前置条件。
- 成功信号是什么。

避免开头先讲内部架构历史。

## 4. Quickstart 规则

Quickstart 只做：

- 安装。
- 创建最小 eval。
- 运行。
- 查看结果。
- 下一步链接。

Quickstart 不做：

- 完整 `defineEval` reference。
- 所有 adapter 类型。
- 所有 sandbox backend。
- 所有 reporter。
- 长篇概念解释。

## 5. How-to 规则

How-to 页面结构：

```md
# 如何完成某任务

适用场景和前置条件。

## 步骤

## 验证结果

## 常见失败

## 相关参考
```

步骤要按：

1. 动作。
2. 命令或代码。
3. 占位符解释。
4. 期望输出。
5. 失败时下一步。

## 6. Reference 规则

Reference 页面必须：

- 只写当前实现支持的字段、命令、类型。
- 列默认值和必填性。
- 说明返回值或输出。
- 说明限制和错误。
- 给短示例。
- 链接到对应 guide。

Reference 不应写 roadmap。未实现能力单独放 Roadmap 或设计文档。

## 7. Concept 规则

Concept 页面要解释边界：

- `Eval`：被发现和运行的评估用例。
- `Experiment`：运行配置。
- `Adapter`：连接被测对象。
- `Agent`：被评估对象或连接目标。
- `Sandbox`：隔离运行环境。
- `Turn`：一次交互结果。
- `Judge`：LLM-as-judge 能力。
- `StreamEvent`：断言和报告的事实来源。

每个概念页要写“它不是什么”，避免用户把层次混在一起。

## 8. Receiver 语义规则

`t`、`session`、`turn` 必须直接讲清楚：

- `t` 是默认 eval/session 上下文。
- `session` 是独立会话。
- `turn` 是某次发送后的结果对象。
- `t.reply` 是便捷字段，不是所有断言的事实源。
- 绑定某轮结果时，用 `const turn = await t.send(...)` 后对 `turn` 断言。

不要把所有断言都写成“检查最新回复”。

## 9. DX 规则

文档应覆盖成功路径和失败路径：

- setup 失败。
- adapter 连接失败。
- sandbox/runtime 失败。
- eval assertion 失败。
- judge 失败。
- report/view 失败。

每类失败都应告诉用户：

- 现象。
- 看哪个 artifact。
- 运行哪个命令。
- 常见原因。
- 下一步。

## 10. 发布前检查

改 `docs-site/` 后：

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

如果只新增 `docs-ref/` 内部参考，不进入导航，至少检查：

- 文件路径。
- 链接格式。
- 尾随空白。
- 是否误写成正式产品承诺。

