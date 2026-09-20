---
format: concord.document/v1
id: legacy-record-recovery-guidance
title: 旧项目状态拒绝写入后缺少可执行恢复指引
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
            - netake_259BAEE8AGKT46VX
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/legacy-record-recovery.test.ts#necase_CQYTFVY7A9TQCDFZ"]}
    proof:
      - netake_259BAEE8AGKT46VX
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/legacy-record-recovery.test.ts#necase_CQYTFVY7A9TQCDFZ"]}
    source:
      path: memory/legacy-record-recovery-guidance.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:6a920029c93e602655a9ad8bd2e307858aa1b413d58680e18c5d28d729c1bf94
---
# 旧项目状态拒绝写入后缺少可执行恢复指引

## 问题与根因

旧 locks 等状态阻塞 ProjectDatabase 写入时，错误只有拒绝原因。随包教程和参考生成器仍列出已未注册的项目迁移命令，用户按指引无法继续。

## 修复边界

Run 契约不支持旧 Record 转换。拒绝条件和原始数据保持不变；错误与排障文档说明停止旧进程、保留原项目和完整数据、使用原 NiceEval 版本查看历史，在排除 .niceeval 的独立项目副本重新运行。用户级 state migrate 不能转换项目 Record。

参考生成器只描述实际注册的命令，移除旧 Record maintenance contribution 的选项映射。回归场景以受控的未知旧锁作为输入，从安装后 exp 观察拒绝和恢复文本，同时检查随包文档及原输入未被改写。

## 红灯

旧候选源为 `fc6f749556e81ab4a2c68e6edc36e30c2b2743d4`，SHA-256 为 `535194ac72b8350c135125463ebbdab8189ab70b45155c8a199cc1ef1fb2ae04`。最早公开失败为 stderr 没有迁移不受支持与保留数据的说明；正式证据为 `nered_FNA00SV0EG60XRMC`。
