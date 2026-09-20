---
format: concord.document/v1
id: init-inspection-guidance-drift
title: init 托管指引与查看命令漂移
createdAt: 2026-09-07
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - netake_NMAQ3YBXZ4ARFFA1
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/init-inspection-guidance.test.ts#necase_3HDDG0091KDYCM47"]}
    proof:
      - netake_NMAQ3YBXZ4ARFFA1
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/init-inspection-guidance.test.ts#necase_3HDDG0091KDYCM47"]}
    source:
      path: memory/init-inspection-guidance-drift.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:3cb5cb831ec238240320943b2fee21e9486752aa470446ebd7a4a344a3676181
---
# init 托管指引与查看命令漂移

## 问题与根因

安装后运行 `niceeval init`，新生成的托管规则仍把 `@<locator>` 推荐给只接受 option 的 `view`。模板独立于 CLI contribution，先前更新查看入口时没有同步这个用户实际读取的产物。

## 修复

模板明确推荐 `niceeval view --run <run-id>`、`niceeval show @<locator>` 和固定 `query` request。回归场景运行安装后的 init，读取实际生成的 AGENTS.md，并核对同一版本的查看帮助和重复初始化结果。

## 红灯

旧候选源为 `fc6f749556e81ab4a2c68e6edc36e30c2b2743d4`，SHA-256 为 `535194ac72b8350c135125463ebbdab8189ab70b45155c8a199cc1ef1fb2ae04`。公开入口最早在生成的文本缺少正确 view 命令处失败；正式证据为 `nered_CXDRY06A8WW2A08Y`。该断言读取用户收到的文件，不读取模板源码。
