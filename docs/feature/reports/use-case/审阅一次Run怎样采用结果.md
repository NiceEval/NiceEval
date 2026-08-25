---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 审阅一次 Run 的闭合结果

用户需要确认一条 sealed Run 的层级、判定、完整度、Evidence 与可继续查看的 exact Attempt。

```sh
niceeval view --run <run-id>
niceeval view @<attempt-locator>
```

第一个命令打开固定 Run overview，第二个直接打开 exact Attempt detail。View 只显示 operation 已关闭的 selection、denominator、partial、missing、issues 与 Evidence；它不能通过显示过滤把缺口伪装为完整。

自动化需要相同事实时使用 `niceeval query`，而不是从 View 获取机器数据。
