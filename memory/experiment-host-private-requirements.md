---
format: concord.document/v1
id: experiment-host-private-requirements
title: 公开 Experiment Host 依赖消费者无法构造的私有服务
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: resolved
epoch: 1
evidenceRequirement: concord.native-reliability/v1
promotions: []
history:
  - at: 2026-09-30T10:23:10.209Z
    action: resolve
    reason: 公开 Host 取消入口在安装候选通过七次可靠性验收，包含默认并行 33/33；正式 red、takeover 与回归关系已登记并核对。
    resolution:
      reason: 公开 Host 取消入口在安装候选通过七次可靠性验收，包含默认并行 33/33；正式 red、takeover 与回归关系已登记并核对。
      at: 2026-09-30T10:23:10.209Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/experiment-host-private-requirements.md
        epoch: 0
        validatedAt: 2026-09-30T10:23:06.609Z
        cases:
          - selector: e2e/eval/test/custom-application-lifecycle.test.ts#neref_bd91bca95959879d5b24b9f41a9de275
            caseId: neref_bd91bca95959879d5b24b9f41a9de275
            binding:
              kind: direct-contract
              contractRef: docs/feature/eval/use-case/eval-native-operations.md
              contractSha256: c8933e80c4afeda309e3454bf3e8fe85c80e95e272dc398ccd5c53957187c6f9
            sourceDigest: sha256:f20581e6a2bd2af9d52e4a4e35f3d2e15b43f1c470fd40c43450e743b10d608f
            candidateSha256: b65a4ebeaa9eaa014c219a2783f9effd8f17e5d733592d67a9492a79ad859c08
            sourceIdentityDigest: a1b73f99e1088ec0cf1c4c6cbc4f1a5c752604ff11bbf8a652af7be83e35ec05
            red:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/red.json
              digest: sha256:fdeaf4c728dc3c1dc1d16b723cb44068a64c20d8ee9dd6836ebb7e9360e1410a
            green:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/green.json
              digest: sha256:4e6276984d92fb2a99471af6996f7cccc8484dbd49e1bb8e45fb449f200f4317
            certificate:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/certificate.json
              digest: sha256:976353c36c2fe6d41d5a4fd5c7edbfd027aa8abed0b22d1ee1ca0f9386ec5517
            inventory:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/inventory.json
              digest: sha256:12282b76e8599ff7b9f5a1b41dc1f353f83c2450474f132cd107d0c8b0b135df
            reliability:
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-1.json
                digest: sha256:87c4add1a43623413b74b5c28ba497b7d0129f52d0b9809faf9a85391a9d8524
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-2.json
                digest: sha256:3359cf69598a930646c4418c5388790b2a224c33eb72760cba28799ed2229b94
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-3.json
                digest: sha256:18c3dc0675a88105cf8bf66802e3fe804d915da57b694417871b7f70f9e3ec77
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-4.json
                digest: sha256:4f4431a525c7bbf3733114c27a7386ca2767d5197b95684563c7e93dcbc21531
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-5.json
                digest: sha256:006ac6395eaaa67b48726bd52c6362d0372923fae492f749efb9d22191752565
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-6.json
                digest: sha256:eb9b7a5f4dd0cda39d426f340ffa6d5c93565bbe3aaa4e8ec744e0d4400df998
            invocationIds:
              - 1ae1a7b2-248a-4bba-a8c4-3245a8ae3613
              - c793cdcf-c43f-49a6-86eb-8e2cf190a518
              - 98f2a0ac-4aa6-4a48-8604-c1aaea9a767a
              - 4ae54d96-364b-4d75-b9c3-c6992398d1eb
              - e989355d-93e7-4dda-9cec-fccb778e428b
              - 7a121421-590d-454d-8ae7-37f8a4700d0a
              - 93698861-ccdc-4025-b141-9b92f921d636
              - 3a934173-c6fb-40c7-857a-b48d02aca09b
    commit: 7ad457dcd4867bf3fe3c38715d7a2d13507bb05b
  - at: 2026-09-30T12:48:40.340Z
    action: reopen
    reason: reopen
    resolution:
      reason: 公开 Host 取消入口在安装候选通过七次可靠性验收，包含默认并行 33/33；正式 red、takeover 与回归关系已登记并核对。
      at: 2026-09-30T10:23:10.209Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/experiment-host-private-requirements.md
        epoch: 0
        validatedAt: 2026-09-30T10:23:06.609Z
        cases:
          - selector: e2e/eval/test/custom-application-lifecycle.test.ts#neref_bd91bca95959879d5b24b9f41a9de275
            caseId: neref_bd91bca95959879d5b24b9f41a9de275
            binding:
              kind: direct-contract
              contractRef: docs/feature/eval/use-case/eval-native-operations.md
              contractSha256: c8933e80c4afeda309e3454bf3e8fe85c80e95e272dc398ccd5c53957187c6f9
            sourceDigest: sha256:f20581e6a2bd2af9d52e4a4e35f3d2e15b43f1c470fd40c43450e743b10d608f
            candidateSha256: b65a4ebeaa9eaa014c219a2783f9effd8f17e5d733592d67a9492a79ad859c08
            sourceIdentityDigest: a1b73f99e1088ec0cf1c4c6cbc4f1a5c752604ff11bbf8a652af7be83e35ec05
            red:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/red.json
              digest: sha256:fdeaf4c728dc3c1dc1d16b723cb44068a64c20d8ee9dd6836ebb7e9360e1410a
            green:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/green.json
              digest: sha256:4e6276984d92fb2a99471af6996f7cccc8484dbd49e1bb8e45fb449f200f4317
            certificate:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/certificate.json
              digest: sha256:976353c36c2fe6d41d5a4fd5c7edbfd027aa8abed0b22d1ee1ca0f9386ec5517
            inventory:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/inventory.json
              digest: sha256:12282b76e8599ff7b9f5a1b41dc1f353f83c2450474f132cd107d0c8b0b135df
            reliability:
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-1.json
                digest: sha256:87c4add1a43623413b74b5c28ba497b7d0129f52d0b9809faf9a85391a9d8524
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-2.json
                digest: sha256:3359cf69598a930646c4418c5388790b2a224c33eb72760cba28799ed2229b94
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-3.json
                digest: sha256:18c3dc0675a88105cf8bf66802e3fe804d915da57b694417871b7f70f9e3ec77
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-4.json
                digest: sha256:4f4431a525c7bbf3733114c27a7386ca2767d5197b95684563c7e93dcbc21531
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-5.json
                digest: sha256:006ac6395eaaa67b48726bd52c6362d0372923fae492f749efb9d22191752565
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_31N7XKERFRZ5X3P9-netake_58MATZJ9SEJXHACS/reliability-6.json
                digest: sha256:eb9b7a5f4dd0cda39d426f340ffa6d5c93565bbe3aaa4e8ec744e0d4400df998
            invocationIds:
              - 1ae1a7b2-248a-4bba-a8c4-3245a8ae3613
              - c793cdcf-c43f-49a6-86eb-8e2cf190a518
              - 98f2a0ac-4aa6-4a48-8604-c1aaea9a767a
              - 4ae54d96-364b-4d75-b9c3-c6992398d1eb
              - e989355d-93e7-4dda-9cec-fccb778e428b
              - 7a121421-590d-454d-8ae7-37f8a4700d0a
              - 93698861-ccdc-4025-b141-9b92f921d636
              - 3a934173-c6fb-40c7-857a-b48d02aca09b
    commit: 8bfe13e5d6fbbdacab5abefdae2b76045c457de9
  - at: 2026-09-30T13:27:18.364Z
    action: resolve
    reason: Current epoch public Host red and final candidate reliability takeover pass, including creation failure, cancellation, late assertion rejection and eval 34/34.
    resolution:
      kind: fixed
      reason: Current epoch public Host red and final candidate reliability takeover pass, including creation failure, cancellation, late assertion rejection and eval 34/34.
      at: 2026-09-30T13:27:18.364Z
      epoch: 1
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/experiment-host-private-requirements.md
        epoch: 1
        validatedAt: 2026-09-30T13:27:14.895Z
        cases:
          - selector: e2e/eval/test/custom-application-lifecycle.test.ts#neref_bd91bca95959879d5b24b9f41a9de275
            caseId: neref_bd91bca95959879d5b24b9f41a9de275
            binding:
              kind: direct-contract
              contractRef: docs/feature/eval/use-case/eval-native-operations.md
              contractSha256: c8933e80c4afeda309e3454bf3e8fe85c80e95e272dc398ccd5c53957187c6f9
            sourceDigest: sha256:ac30cf2cc1d0493fb671a63b3a740190220d5d1f95b8410f83a488672875366b
            candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
            sourceIdentityDigest: 2e79f90001eefcbd99a4e60a343fb45f55c0f02116057567d08b3f5d9532a52e
            red:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/red.json
              digest: sha256:7e2c4cc8f3163f8be89c62b537117f2f9088d2dc8764ba82a449a886cc7a3b82
            green:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/green.json
              digest: sha256:313e4792ddcc1598ed2c57ed2f397e4be0a6b4828b08b1064b107cc83e2784a8
            certificate:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/certificate.json
              digest: sha256:17f019183e3d9c8268d0420927b07dfe011fb0ef1e9c49a8db253606301d1e33
            inventory:
              path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/inventory.json
              digest: sha256:33567e750406f49d6828b0b05dcebfef3f5f4667d54937d448f4939b9e0bc21d
            reliability:
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-1.json
                digest: sha256:731a527296bf20d6d4a71dc90b48ddb3c8580812c335f407479ec18572500b9c
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-2.json
                digest: sha256:092a2bdfe31004c80fbe73eef4f3bbcb123794acf4931d0a58047831290f2330
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-3.json
                digest: sha256:db5a0a56207bfcb62d7649df34eb07b2eeeb16ca9f1f8e1e5541d2c913dccd8c
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-4.json
                digest: sha256:9aff864c2bd73b5eba54954c47e5d93353cfd386fc070a73ae209d8e45252605
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-5.json
                digest: sha256:e0a6600dd77faf58458aca46ef937bf63f0c5cd4fdacd6b8b76cb803ae4ad5b4
              - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-6.json
                digest: sha256:f5efc2f1c7a596f96d68f8115a1bad936f7d9436f62236f6e97b58e415e71091
            invocationIds:
              - c82d240b-7cfc-495b-85df-bb2452a15346
              - 6281decf-5554-4c0b-a3d2-427a8bb45136
              - 699beced-b3b1-4994-9eb0-0ae09dfb44d2
              - faea54f9-3ca4-49ac-9c02-0edc764777fd
              - 0c80b337-2a43-4481-a6a1-df876bd827a7
              - 78428a01-3ee6-4567-9c1a-302adf5ec419
              - 1ddaffcf-bd8a-462a-9df5-f6b2f07ee48d
              - b3ba595c-d00b-4875-a050-3149dcedbb81
    commit: 0bde4166f53bb3d2b7a3a0e3b8be1530a75ca4fa
resolution:
  kind: fixed
  reason: Current epoch public Host red and final candidate reliability takeover pass, including creation failure, cancellation, late assertion rejection and eval 34/34.
  at: 2026-09-30T13:27:18.364Z
  epoch: 1
  evidenceLevel: repository
  repositoryEvidence:
    policy: concord.native-reliability/v1
    memory: memory/experiment-host-private-requirements.md
    epoch: 1
    validatedAt: 2026-09-30T13:27:14.895Z
    cases:
      - selector: e2e/eval/test/custom-application-lifecycle.test.ts#neref_bd91bca95959879d5b24b9f41a9de275
        caseId: neref_bd91bca95959879d5b24b9f41a9de275
        binding:
          kind: direct-contract
          contractRef: docs/feature/eval/use-case/eval-native-operations.md
          contractSha256: c8933e80c4afeda309e3454bf3e8fe85c80e95e272dc398ccd5c53957187c6f9
        sourceDigest: sha256:ac30cf2cc1d0493fb671a63b3a740190220d5d1f95b8410f83a488672875366b
        candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
        sourceIdentityDigest: 2e79f90001eefcbd99a4e60a343fb45f55c0f02116057567d08b3f5d9532a52e
        red:
          path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/red.json
          digest: sha256:7e2c4cc8f3163f8be89c62b537117f2f9088d2dc8764ba82a449a886cc7a3b82
        green:
          path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/green.json
          digest: sha256:313e4792ddcc1598ed2c57ed2f397e4be0a6b4828b08b1064b107cc83e2784a8
        certificate:
          path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/certificate.json
          digest: sha256:17f019183e3d9c8268d0420927b07dfe011fb0ef1e9c49a8db253606301d1e33
        inventory:
          path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/inventory.json
          digest: sha256:33567e750406f49d6828b0b05dcebfef3f5f4667d54937d448f4939b9e0bc21d
        reliability:
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-1.json
            digest: sha256:731a527296bf20d6d4a71dc90b48ddb3c8580812c335f407479ec18572500b9c
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-2.json
            digest: sha256:092a2bdfe31004c80fbe73eef4f3bbcb123794acf4931d0a58047831290f2330
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-3.json
            digest: sha256:db5a0a56207bfcb62d7649df34eb07b2eeeb16ca9f1f8e1e5541d2c913dccd8c
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-4.json
            digest: sha256:9aff864c2bd73b5eba54954c47e5d93353cfd386fc070a73ae209d8e45252605
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-5.json
            digest: sha256:e0a6600dd77faf58458aca46ef937bf63f0c5cd4fdacd6b8b76cb803ae4ad5b4
          - path: e2e/eval/test/custom-application-lifecycle.test.ts.case-evidence/neref_bd91bca95959879d5b24b9f41a9de275/memory_experiment-host-private-requirements.md/nered_8J86YD7X8KK8DRW1-netake_HMC085SVMG15FGPT/reliability-6.json
            digest: sha256:f5efc2f1c7a596f96d68f8115a1bad936f7d9436f62236f6e97b58e415e71091
        invocationIds:
          - c82d240b-7cfc-495b-85df-bb2452a15346
          - 6281decf-5554-4c0b-a3d2-427a8bb45136
          - 699beced-b3b1-4994-9eb0-0ae09dfb44d2
          - faea54f9-3ca4-49ac-9c02-0edc764777fd
          - 0c80b337-2a43-4481-a6a1-df876bd827a7
          - 78428a01-3ee6-4567-9c1a-302adf5ec419
          - 1ddaffcf-bd8a-462a-9df5-f6b2f07ee48d
          - b3ba595c-d00b-4875-a050-3149dcedbb81
---
# 公共消费问题

从 niceeval/experiment/host 导入 experimentHost 后，invocation.plan/run 返回的 Effect 要求四个私有 Service。公开包没有相应 Layer 或 tag，正常消费者不能直接 runPromise/runFork，阻断了无父 AbortSignal 的 fiber 中断验收。

# 收敛方案

按 attempt-cleanup/PLAN-1 的 Host 组合边界提供具名 Node edge，内部 raw runtime 保留要求，CLI 继续由 bootstrap 组合。初始化期间的 worker 也必须由 Scope 终止；不能只等待 ready 才释放。

# 验收

安装候选只导入公共包和 Effect，检查 plan/run 类型及正常运行；直接中断无 signal 的 invocation fiber，观察取消原因、authoring 关闭、有界清理及原 Cause。静态类型或源码审查不替代公开运行证据。
