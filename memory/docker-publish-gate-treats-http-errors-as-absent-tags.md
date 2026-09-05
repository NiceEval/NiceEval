---
format: niceeval.memory/v1
id: docker-publish-gate-treats-http-errors-as-absent-tags
title: Docker 发布 gate 将 HTTP 错误误判为版本 tag 不存在
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# Docker 发布 gate 将 HTTP 错误误判为版本 tag 不存在

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`.github/workflows/docker-image.yml:90`。

Docker Hub tag 查询返回 401、429 或 5xx 时，workflow 会设置 publish=true。即使版本 tag 已存在且没有 overwrite 授权，后续 build-push step 也可能覆盖同名 tag，破坏已发布环境身份。

workflow gate 只把 HTTP 200 分成跳过，其余状态都当不存在。父 agent 从实际 YAML 提取该 shell 段，仅替换 curl 的外部返回状态，在临时目录执行：200 → publish=false；404 → publish=true；401、429、503 → publish=true，全部 exit 0。没有发出网络请求、构建镜像或 push。

修复应仅允许确定的 404 进入首次发布，200 跳过，其他状态具名失败；显式 overwrite 仍遵守已有授权语义。验收覆盖状态矩阵和传输失败，并保留 [预制实例的版本规则](../docs/feature/sandbox/library/prebuilt-environments.md)。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。

## 2026-09-05 修复验收

父 agent 抽取最终 workflow gate 并通过实际 curl 外部边界 fixture 独立执行七种情况：200 跳过，404 发布，401/429/503 与传输失败返回非零；显式 overwrite 跳过查询并发布。所有结果符合预期，未调用外部发布。

实现与上述仓库入口验收已完成；当前结构化 fixed 门只接受产品 E2E 凭据，尚无仓库 DX 凭据类型，因此保留 open，不借用无关产品 case 宣称 resolved(fixed)。
