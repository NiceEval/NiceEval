---
title: 'Adapter E2E 索引把确定性协议端列成官方适配器且保留无 Repo 验收页'
severity: 'minor'
---

## Expected Behavior
`docs/engineering/testing/e2e/adapter/README.md` 应把确定性协议 E2E 与完整官方 Agent 工厂的 live 兼容性矩阵分开，并只索引实际存在的 E2E Repo。

## Current Behavior
验收表把 `adapter/local-protocol` 作为“适配器”与七个完整官方工厂并列，容易被理解为第八个官方 Adapter；同目录还保留 `langgraph.md` 与 `pi-agent-core.md`，但没有对应 `e2e/adapter/*` Repo，且 README 明确声明只有转换器的对象不保留验收页。

## Possible Solution
将 `local-protocol.md` 改名为具体公开边界 `ui-message-stream.md`，在 Adapter 索引中拆分“确定性协议 E2E”和“live Adapter 兼容性”两表；删除无实际 Repo 的 LangGraph 与 pi-agent-core 验收页。

## Minimal Reproducible Example
```sh
sed -n "1,100p" docs/engineering/testing/e2e/adapter/README.md
find e2e/adapter -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort
find docs/engineering/testing/e2e/adapter -maxdepth 1 -type f -printf "%f\n" | sort
```

## Context
用户盘点官方 Adapter 与 E2E 覆盖时，现有表格会把确定性故障端误报成独立官方 Adapter，并让两篇尚无实现的转换器验收说明看起来像已存在测试。
