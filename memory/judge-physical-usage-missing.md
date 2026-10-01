---
format: concord.document/v1
id: judge-physical-usage-missing
title: Judge 已发送请求未进入官方用量与费用读面
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history:
  - at: 2026-09-30T12:40:55.859Z
    action: resolve
    reason: 实际 Judge HTTP 传输用量进入独立账本；公开红灯与完整可靠性接管通过，保留未知费用、失败重试及应用独立口径。
    resolution:
      kind: fixed
      reason: 实际 Judge HTTP 传输用量进入独立账本；公开红灯与完整可靠性接管通过，保留未知费用、失败重试及应用独立口径。
      at: 2026-09-30T12:40:55.859Z
      epoch: 0
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/judge-physical-usage-missing.md
        epoch: 0
        validatedAt: 2026-09-30T12:40:52.234Z
        cases:
          - selector: e2e/inspection/test/judge-usage-tokens.test.ts#neref_7af09f6473d7323200cfa3d004ac1938
            caseId: neref_7af09f6473d7323200cfa3d004ac1938
            binding:
              kind: direct-contract
              contractRef: docs/feature/inspection/README.md
              contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
            sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
            candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
            sourceIdentityDigest: f0281a10be0c853bf3a9e3c42304b99296e7a8170c4547304677583c426a176b
            red:
              path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/red.json
              digest: sha256:26f16242b7b21297af2946ca79c1012343aecc5abf603b15c94790b3bffc6cf9
            green:
              path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/green.json
              digest: sha256:ea4a2db357c4ae32e66b9974e677b52f9e62cc063d60f6bf737e73bb83dc50db
            certificate:
              path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/certificate.json
              digest: sha256:8284469a6ed37a4e71cee454c433367ab4e2fd22a0aef410fc41ade3873a11ad
            inventory:
              path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/inventory.json
              digest: sha256:e087b74997fa16c67315d6aba5a2d34c11c18adf44cafc146296597089f47aed
            reliability:
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-1.json
                digest: sha256:7fcea2c1751517c887773427c6047897a83dfec6192fc541b88a2eb603b53666
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-2.json
                digest: sha256:66666851b9098a1a170b34146a28a150bd139c430335e48fec856a4b01af0fd6
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-3.json
                digest: sha256:0f2938142cb2aa1e69f331de3ed14fa3f4d2aa1337ed9cbd588450be658a0195
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-4.json
                digest: sha256:89765797ea96c5722cc093870b44eb738a773a524db8d90864f569c27b5e1c6d
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-5.json
                digest: sha256:d6d1e8ce0169663f76c02acb4d59ef112185232045f197ef9415ce4b0d4871a9
              - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-6.json
                digest: sha256:2ce1dc1b26fe2bdbf3806dfa6adbdc7d67e8363438f05d064d35275ac1f721b7
            invocationIds:
              - c339125a-467f-4776-9bef-d4b321ae1137
              - ea972ae9-aafd-40c2-a432-32c5af5b360d
              - 8961913d-57be-4dec-b94a-63de4e514d88
              - 019bddc6-cc24-40ed-892f-460a61b2283f
              - 9fbe4e27-4193-4fcc-b78b-bf748c490db4
              - 0fd4c8ff-0c61-4c59-824a-a7ca39511c73
              - 9060061f-7a49-4f7e-aaa0-fe7dd7317850
              - 279eb8bb-4886-471d-8776-b006867fe0d1
    commit: 52a0334e21602684f23601b75010e186f70e6e28
resolution:
  kind: fixed
  reason: 实际 Judge HTTP 传输用量进入独立账本；公开红灯与完整可靠性接管通过，保留未知费用、失败重试及应用独立口径。
  at: 2026-09-30T12:40:55.859Z
  epoch: 0
  evidenceLevel: repository
  repositoryEvidence:
    policy: concord.native-reliability/v1
    memory: memory/judge-physical-usage-missing.md
    epoch: 0
    validatedAt: 2026-09-30T12:40:52.234Z
    cases:
      - selector: e2e/inspection/test/judge-usage-tokens.test.ts#neref_7af09f6473d7323200cfa3d004ac1938
        caseId: neref_7af09f6473d7323200cfa3d004ac1938
        binding:
          kind: direct-contract
          contractRef: docs/feature/inspection/README.md
          contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
        sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
        candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
        sourceIdentityDigest: f0281a10be0c853bf3a9e3c42304b99296e7a8170c4547304677583c426a176b
        red:
          path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/red.json
          digest: sha256:26f16242b7b21297af2946ca79c1012343aecc5abf603b15c94790b3bffc6cf9
        green:
          path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/green.json
          digest: sha256:ea4a2db357c4ae32e66b9974e677b52f9e62cc063d60f6bf737e73bb83dc50db
        certificate:
          path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/certificate.json
          digest: sha256:8284469a6ed37a4e71cee454c433367ab4e2fd22a0aef410fc41ade3873a11ad
        inventory:
          path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/inventory.json
          digest: sha256:e087b74997fa16c67315d6aba5a2d34c11c18adf44cafc146296597089f47aed
        reliability:
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-1.json
            digest: sha256:7fcea2c1751517c887773427c6047897a83dfec6192fc541b88a2eb603b53666
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-2.json
            digest: sha256:66666851b9098a1a170b34146a28a150bd139c430335e48fec856a4b01af0fd6
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-3.json
            digest: sha256:0f2938142cb2aa1e69f331de3ed14fa3f4d2aa1337ed9cbd588450be658a0195
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-4.json
            digest: sha256:89765797ea96c5722cc093870b44eb738a773a524db8d90864f569c27b5e1c6d
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-5.json
            digest: sha256:d6d1e8ce0169663f76c02acb4d59ef112185232045f197ef9415ce4b0d4871a9
          - path: e2e/inspection/test/judge-usage-tokens.test.ts.case-evidence/neref_7af09f6473d7323200cfa3d004ac1938/memory_judge-physical-usage-missing.md/nered_9RXEYTEWV4F08M3D-netake_509XW4XHT3RZTJ8B/reliability-6.json
            digest: sha256:2ce1dc1b26fe2bdbf3806dfa6adbdc7d67e8363438f05d064d35275ac1f721b7
        invocationIds:
          - c339125a-467f-4776-9bef-d4b321ae1137
          - ea972ae9-aafd-40c2-a432-32c5af5b360d
          - 8961913d-57be-4dec-b94a-63de4e514d88
          - 019bddc6-cc24-40ed-892f-460a61b2283f
          - 9fbe4e27-4193-4fcc-b78b-bf748c490db4
          - 0fd4c8ff-0c61-4c59-824a-a7ca39511c73
          - 9060061f-7a49-4f7e-aaa0-fe7dd7317850
          - 279eb8bb-4886-471d-8776-b006867fe0d1
---
RPG 消费者使用候选 b65a4ebe，通过公开 exp、closeQA 和本地 VercelProvider HTTP fixture 发出一次 chat/completions 请求。响应包含 prompt 120、output 30、total 150，QA passed；attempt.usage 仍返回 judge-usage-not-recorded。消费者保留原 SQLite、HTTP 和 Show 输出，未使用付费模型。

源码根因是受管 Judge 仅记录评分审计，缺少 Attempt 所属物理用量账本；Inspection 固定返回 Judge unavailable。非成功 HTTP 正文也未进入账本，无法从成功审计补全失败和重试费用。

设计候选见 [Judge 物理调用与费用](../docs/design/judge-physical-usage/README.md)。修复须在安装候选的公开 HTTP/CLI 路径验证无调用、成功/失败/重试、已知零、未知、显式估价、取消和历史缺源。应用费用口径保持独立。

当前实现用独立 Judge family 记录实际 HTTP 传输，在判分解码前接纳用量回执；失败与重试不由业务 Verdict 推断。正式回归 judge-usage-tokens 取得缺失持久连接的最小逆补丁红灯与完整可靠性证明。无调用、失败重试、显式估价及已知零另由公开 CLI 场景验收，Vercel Chat 未证明的费用和 cache-write 保持未知。
