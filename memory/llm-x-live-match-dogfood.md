---
format: concord.document/v1
id: llm-x-live-match-dogfood
title: LLM X 实测：功能通过、语义评分与视觉证据必须分开
createdAt: 2026-09-12
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---
# LLM X 实测：功能通过、语义评分与视觉证据必须分开

## 场景与证据

在 `examples/zh/llm-x` 经已安装的 `niceeval` CLI、真实 Next HTTP 后端和 SQLite 运行社交内容评估。基线 checkout 为 `ac367ec792b23de8653b531b5185eb1789c553fb`，消费本地 `packages/niceeval` 的 `0.0.0-development` 构建。fixture 只能验证关系、持久化和生图附着，不能验证模型内容质量。

真实实验首轮 `75fc2bfc-4ed3-4250-8138-8dfe345d34d2` 的 Judge 预检成功，但 Adapter 创建世界的请求在 60 秒超时。公开 `attempt.get` 对 `@1YC5MCAE3MAFH` 返回 errored、零条 Assertions；这不是内容不合格，更不能记为零分或通过。真实世界包含并发头像生成和后续首批配图，运行预算必须覆盖整个 HTTP 操作，而不只是一轮文字生成。

## Match 写法的边界

`check(value, match)` 可直接消费领域对象。语义 Match 显式接收 `{ input, output }`，`.score(points)`、`.label(...)` 留在 Assertion，分工清楚。Score Eval 的 passed 只说明评分执行完成；读者必须同时看分数、完整度和理由。普通结构检查在 Score Eval 不充当质量 gate，必要的前置检查应显式停止后续动作。

内建 Judge 的公开 `JudgeMaterial` 只有字符串 input/output。URL、alt 或图片附着成功不是视觉证据。公开 `defineScoreMatch<T>` 的 score 回调只返回有限 `[0,1]` 数字；其签名没有独立 rationale/evidence 返回字段。把视觉模型包在回调里能得到数字，不等于拥有受管的图像材料、裁判理由和可离线复核的图片。

后续视觉评估应围绕实际图像输入、图文一致性、可见缺陷、证据闭包和裁判失败语义设计，不能用文本 Judge 阅读 URL 的方式冒充看图。这是本次使用结论，不是已经采用或实现的多模态 API 契约。

## 可复用验收方式

用独立 live Experiment 明确 provider、模型、Judge 和超时，保留免费 fixture 默认入口。最小文本 rubric 分别评价发现页、发帖意图、AI 回应上下文与 AI 人物一致性；不要把图片存在计入文本质量分。单次 live 与同模型自评都不证明稳定质量，未采集 usage 不代表零成本。运行结果从公开 Query/View 读取，取消后检查子进程与临时数据库释放。

## 防止把用户原文当作模型输出评分

第二轮真实运行 `d0e7511c-324e-473b-bcde-ab28d0e0463a` 完成并获得 100 分，公开 assertion detail 保存了模型文本和裁判理由。但读回材料发现用户回复与输入逐字相同：应用 `XGame.reply()` 直接保存用户原文，真正的模型调用在后端 `continueThread()`。原 rubric 为用户原文分配了 25 分，不能据此声称模型回复质量达标。最终用例将用户原文改为不计分的保存检查，将该分值分配给 AI 后续回应的上下文相关性。这个错误要靠追踪材料来源发现，不会被类型检查或一次绿色结果自动识别。
