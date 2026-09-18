---
format: concord.document/v1
id: moved-record-write-replaces-sealed-identity
title: 移动项目后的新写入重算 Record 身份并破坏历史 Seal
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
            - nered_C8XEDHFV486C4WY4
            - netake_X4K538C7VH630B4N
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-migration.test.ts#necase_W26XFXH8K05QA8C5"]}
    proof:
      - nered_C8XEDHFV486C4WY4
      - netake_X4K538C7VH630B4N
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-migration.test.ts#necase_W26XFXH8K05QA8C5"]}
    source:
      path: memory/moved-record-write-replaces-sealed-identity.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:49096f620887beffb7e1e1d6beb1f68ba4d22b295d7705355babd4f6cf0db3eb
---
## 现象

将真实 0.15/0.16 producer 的数据库复制到新项目后，自动迁移成功，普通 Run 列表与详情可读；执行一次新实验，再通过公开 Query 读历史 Run，得到 inspection-source-invalid。

## 根因

Host 每次按 storage path 重算 Record 身份。新项目路径不同，新 Run 发布覆盖共享 record_payload/record_digest，历史 Run 的 Seal 随即与 Record 根身份不一致。只在迁移事务内验证 Seal，无法发现后续写入造成的破坏。

## 修法与边界

Host 读取并严格解码已有 Record core，仅在没有既有身份时创建身份；SQLite 发布事务拒绝覆盖不同的已存 Record core。迁移保存原身份，路径不成为重写历史事实的理由。外部 Record 仍保持只读。

## 验收经验

迁移验收必须覆盖真实旧 producer → 正常项目动作迁移 → 新写入 → 历史 Query/断言材料读回 → 接受旧 Attempt 引用 → 再次打开。源码 codec 或迁移函数单独成功不能代替公开链路。旧候选红灯 nered_C8XEDHFV486C4WY4；修复候选完整接管 netake_X4K538C7VH630B4N。
