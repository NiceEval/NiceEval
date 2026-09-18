---
format: concord.document/v1
id: historical-record-read-bypasses-migration
title: 历史 Record 读取绕过自动迁移或误用项目 writer
createdAt: 2026-09-12
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: >-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - nered_9EZ5TZX8V9PS4MW5
            - netake_DT2VZW5T5MEM00V9
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-migration.test.ts#necase_W26XFXH8K05QA8C5"]}
    proof:
      - nered_9EZ5TZX8V9PS4MW5
      - netake_DT2VZW5T5MEM00V9
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-migration.test.ts#necase_W26XFXH8K05QA8C5"]}
    source:
      path: memory/historical-record-read-bypasses-migration.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:58dac142197790ea2ee42b6f1ef4a4ee34f04c899aeb52a4b673ab05fc12c7d2
---
## 现象与根因

历史 0.15/0.16 portable Record 已有字段与封口迁移器，但只在正常写入口调用。Inspection 与 Preview 导入先拒绝旧格式；Run Host 的 list/show 却绑定项目 writer，导致读取改写原件。只证明写入口升级成功，不能证明只读入口可用。

## 裁决

按 [Run 自动迁移](../docs/feature/run/architecture.md#自动迁移) 区分外部 portable 输入与项目 operational 输入。外部文件只经文件系统捕获，不由 SQLite 打开原件；在权限受控的私有副本内先验证精确 schema、完整性、portable 状态与旧封口，再执行既有迁移器。项目有 sidecar 时保留当前格式的实时 SQLite 读取；无 sidecar 时使用私有捕获，捕获期间状态改变则拒绝。

Preview 的 cutoff、摘要和打包 Record 必须来自同一已验证 generation，不能在导入 Scope 结束后重新复制旧文件。私有迁移完成后还要确认 ready 标记已经进入主文件，不能遗漏 WAL。

## 回归证据

唯一 owner 为 e2e/record/test/record-migration.test.ts#necase_W26XFXH8K05QA8C5。旧安装候选 dc17f0f7ce34ab03e759ebc1402f9ed4c796b56fb674bca20edd76767edbcd02 首次 run list 就改变原文件字节，正式红灯为 nered_9EZ5TZX8V9PS4MW5。相同用例先读取历史结果和外部只读文件，再验证当前写入与引用保留；通过正式 takeover 后才关闭此 Problem。
