# 报错必带下一步:内嵌 message 收尾,不单列必填 fix 字段

## 裁决(2026-07-15)

「niceeval 发出的每条操作性错误/警告必须自带下一步」定为跨切面契约,落 `docs/error-feedback.md`:消息三段式(现象 / 依据 / 下一步),下一步三形态(可执行命令 / 定位动作 / 忽略条件);结构化面(`SelectionWarning`、`DiagnosticRecord`)加可选 `command?: string` 承载复制即跑的命令。被测对象的失败事实(断言差异、`AttemptError`、verdict)划在契约边界外——那是 eval 结果,不是 niceeval 在报错。

## 起因

compare 组分次重跑后,`stale-snapshot` 警告只报「早于最新落盘 2 小时」,不说要不要管、怎么消——用户要靠人肉推理「没改东西可忽略 / 改过就重跑对齐」。用户裁决:所有报错都应带解决方案。

## 曾选方案与否决理由

- **必填独立 `fix: string` 字段(message 只剩现象+依据)**:否决。拆走下一步会破坏 Results Library 已定的「message 要展示就原样打」承诺——只打 message 的消费方(text 面、日志、第三方 renderer)静默丢失下一步;而保留内嵌后再加必填 fix 字段,两处重复同一句话,漂移税。定案 = message 自含三段 + 可选 `command` 单列给 web 复制动作和程序消费方,没有单命令形态的反馈不硬造。
- **给 `AttemptError` 也加 fix**:否决。它是被测对象失败的事实记录,「下一步」是排查路径不是修复指令,归 show/view 呈现契约与 Debug 手册,不归报错契约。

## 落点

契约页 `docs/error-feedback.md`;受影响小节重写于 `docs/feature/results/library.md`(警告 kind 全集加「下一步」列、`command` 字段)、`docs/feature/results/architecture.md`(`DiagnosticRecord.command`)、`docs/feature/reports/library.md`(宿主渲染义务);场景行登记于 results / reports / experiments-runner 三份 cases.md;实现 PLAN 在 `plan/error-feedback-remediation.md`。
