---
name: e2b-deadline-lifetime-default
description: Bounded E2B attempts without an explicit lifetimeMs inherited the E2B SDK default lifetime, so a longer attempt could lose its sandbox before diff and cleanup.
metadata:
  type: project
---

## 现象

MemoryBench 的非复用 E2B 实验声明的 Attempt timeout 超过五分钟；两条 Attempt 约五分钟后在导出 workspace diff 时收到 `Sandbox is probably not running anymore`。

## 根因与裁决

`materializeE2BProviderPlan()` 只在作者声明 `lifetimeMs` 时才把 `timeoutMs` 传给 E2B SDK。未声明时落回 SDK 的五分钟默认，成为 attempt deadline 之外的第二条时限。

对 bounded Attempt，runtime 一律请求 `timeoutMs + 30s` 收尾预留。作者显式声明 `lifetimeMs` 时它是不可静默改写的承诺：不足该最低值在创建远端实例前失败；足够时按原值请求。没有 Attempt deadline 时不存在可推导的有限 TTL，需要这种保证的作者必须显式声明 `lifetimeMs`。E2B 创建的强类型请求以 `ProviderDefault | Requested` 区分这两种路径，复用池首次创建和非复用 materialization 共用同一解析入口。
