---
format: concord.document/v1
id: adapter-usage-unsealed-zero
title: 未封存的应用用量被误报为完整零费用
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history:
  - at: 2026-09-30T12:39:36.568Z
    action: resolve
    reason: Explicit producer seal preserves incomplete application ledgers; installed public red and complete reliability takeover pass, including the default parallel Inspection suite.
    resolution:
      kind: fixed
      reason: Explicit producer seal preserves incomplete application ledgers; installed public red and complete reliability takeover pass, including the default parallel Inspection suite.
      at: 2026-09-30T12:39:36.568Z
      epoch: 0
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/adapter-usage-unsealed-zero.md
        epoch: 0
        validatedAt: 2026-09-30T12:39:32.999Z
        cases:
          - selector: e2e/inspection/test/usage-unsealed.test.ts#neref_7529882a80ec6968852a31ac799bcc9f
            caseId: neref_7529882a80ec6968852a31ac799bcc9f
            binding:
              kind: direct-contract
              contractRef: docs/feature/inspection/README.md
              contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
            sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
            candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
            sourceIdentityDigest: 36ffb4fe4370b5dc55c344df3f7e34c4065b6801e1abda2633db557e516cdc96
            red:
              path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/red.json
              digest: sha256:cb5913b474308e3a479983cfbefb5686a556bdf17e64a67e4a463f663c0c0760
            green:
              path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/green.json
              digest: sha256:bfb58e677918e371c9f7ca18a1f8bb78a6e1280257e520c6280de61fb2120562
            certificate:
              path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/certificate.json
              digest: sha256:2e14ddc32f8591f5f495aec758a6794de14a13ff3fa9437ae824457740c6b58d
            inventory:
              path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/inventory.json
              digest: sha256:e087b74997fa16c67315d6aba5a2d34c11c18adf44cafc146296597089f47aed
            reliability:
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-1.json
                digest: sha256:284d2ce606684218a1ebc36f36e25acd233d4a599477123d7a8cb50e03e0e23e
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-2.json
                digest: sha256:9261f0b09764ab1691687b260b38c80b8bffb6c1ac6938a4d668524dc3062baa
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-3.json
                digest: sha256:b8e4442dd387ba05dc3f4e76ae1d69eee4897ec81eb99c58191d449ce66bfce2
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-4.json
                digest: sha256:d6f436d69b0274d8ebcbcd600be31b698c4bbe895d0bb65594aeb4ed19ad3036
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-5.json
                digest: sha256:ba7a1ba23218deb6d53a4e83af9f542964fc0bbc140dc3fcc42d74356154ba4e
              - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-6.json
                digest: sha256:37ecc86c4d79ac859a91cf771a61000857d86e0ce0c6bce7ce48212b7fdb800d
            invocationIds:
              - e256c46b-e747-4a4b-b4f2-e1b7ae22bac4
              - 8382fac6-938c-4d8a-a201-e55f747370f7
              - 3094ad26-38b0-48b9-8572-ad2ff557c244
              - 32159e84-6369-4dfc-a63b-e41f544fefa8
              - 1bc21da9-261c-4910-b88c-42d79c585526
              - caf0dab6-1105-4f4e-bb69-0bf8239cbb99
              - a9f8b9d1-5df9-44b9-97f6-1679a58f5fd7
              - 4697ef2f-239b-49f7-a15f-f9e6a5012c65
    commit: 52a0334e21602684f23601b75010e186f70e6e28
resolution:
  kind: fixed
  reason: Explicit producer seal preserves incomplete application ledgers; installed public red and complete reliability takeover pass, including the default parallel Inspection suite.
  at: 2026-09-30T12:39:36.568Z
  epoch: 0
  evidenceLevel: repository
  repositoryEvidence:
    policy: concord.native-reliability/v1
    memory: memory/adapter-usage-unsealed-zero.md
    epoch: 0
    validatedAt: 2026-09-30T12:39:32.999Z
    cases:
      - selector: e2e/inspection/test/usage-unsealed.test.ts#neref_7529882a80ec6968852a31ac799bcc9f
        caseId: neref_7529882a80ec6968852a31ac799bcc9f
        binding:
          kind: direct-contract
          contractRef: docs/feature/inspection/README.md
          contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
        sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
        candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
        sourceIdentityDigest: 36ffb4fe4370b5dc55c344df3f7e34c4065b6801e1abda2633db557e516cdc96
        red:
          path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/red.json
          digest: sha256:cb5913b474308e3a479983cfbefb5686a556bdf17e64a67e4a463f663c0c0760
        green:
          path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/green.json
          digest: sha256:bfb58e677918e371c9f7ca18a1f8bb78a6e1280257e520c6280de61fb2120562
        certificate:
          path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/certificate.json
          digest: sha256:2e14ddc32f8591f5f495aec758a6794de14a13ff3fa9437ae824457740c6b58d
        inventory:
          path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/inventory.json
          digest: sha256:e087b74997fa16c67315d6aba5a2d34c11c18adf44cafc146296597089f47aed
        reliability:
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-1.json
            digest: sha256:284d2ce606684218a1ebc36f36e25acd233d4a599477123d7a8cb50e03e0e23e
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-2.json
            digest: sha256:9261f0b09764ab1691687b260b38c80b8bffb6c1ac6938a4d668524dc3062baa
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-3.json
            digest: sha256:b8e4442dd387ba05dc3f4e76ae1d69eee4897ec81eb99c58191d449ce66bfce2
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-4.json
            digest: sha256:d6f436d69b0274d8ebcbcd600be31b698c4bbe895d0bb65594aeb4ed19ad3036
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-5.json
            digest: sha256:ba7a1ba23218deb6d53a4e83af9f542964fc0bbc140dc3fcc42d74356154ba4e
          - path: e2e/inspection/test/usage-unsealed.test.ts.case-evidence/neref_7529882a80ec6968852a31ac799bcc9f/memory_adapter-usage-unsealed-zero.md/nered_S3GF6N9H2WTKSNZT-netake_1MTT8T5CAJXP3GW7/reliability-6.json
            digest: sha256:37ecc86c4d79ac859a91cf771a61000857d86e0ce0c6bce7ce48212b7fdb800d
        invocationIds:
          - e256c46b-e747-4a4b-b4f2-e1b7ae22bac4
          - 8382fac6-938c-4d8a-a201-e55f747370f7
          - 3094ad26-38b0-48b9-8572-ad2ff557c244
          - 32159e84-6369-4dfc-a63b-e41f544fefa8
          - 1bc21da9-261c-4910-b88c-42d79c585526
          - caf0dab6-1105-4f4e-bb69-0bf8239cbb99
          - a9f8b9d1-5df9-44b9-97f6-1679a58f5fd7
          - 4697ef2f-239b-49f7-a15f-f9e6a5012c65
---
Adapter 创建成功但未能读取应用账本，没有上报调用时，当前 collector 自动封存 complete 空集合。独立 Judge 完整空账本加入后，Attempt totalCosts 被误报为 complete 且没有缺口。

消费者在 eafa10b4307fd1bcf67c9ba4f178f0edf73b586eef541ee162d47a0441c90488 通过正式 exp、query、show 复现。Eval 抛 JOURNAL_NOT_SEALED，@12RPWRTHJASH5 的 totalCosts 仍为 complete、values=[]、missingSources=[]。这不是从 errored 推断费用：根因是 Adapter 无法声明账本完整性，零个已登记调用被当作全量零调用。

修复目标是官方完整性封存能力，保存已知物理调用与费用，明确未封存、partial 与显式完整空账本。普通和实验费用读取同一声明，不读取业务 journal 或诊断字符串猜测。

设计见 docs/design/judge-physical-usage/plans/plan-1/library.md。正式回归 usage-unsealed 已取得旧候选红灯及当前候选完整可靠性证明，包含隔离副本、同副本重复、默认并行和资源清理。sealUsage 将账本完整性与业务 Verdict 分开；历史 v1/v2/v3 金额保留，但新总费用不把旧自动完整声明视为生产者封存。
