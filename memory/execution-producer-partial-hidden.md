---
format: concord.document/v1
id: execution-producer-partial-hidden
title: Execution 展示遗漏生产者不完整状态
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: resolved
epoch: 1
evidenceRequirement: concord.native-reliability/v1
promotions: []
history:
  - at: 2026-09-30T08:48:24.192Z
    action: resolve
    reason: Installed public CLI regression reproduces the hidden producer state on 9498d7ee6; candidate 1ff09947 preserves partial limitations independently of capture and pagination, with complete managed reliability and cleanup evidence.
    resolution:
      reason: Installed public CLI regression reproduces the hidden producer state on 9498d7ee6; candidate 1ff09947 preserves partial limitations independently of capture and pagination, with complete managed reliability and cleanup evidence.
      at: 2026-09-30T08:48:24.192Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/execution-producer-partial-hidden.md
        epoch: 0
        validatedAt: 2026-09-30T08:48:19.889Z
        cases:
          - selector: e2e/inspection/test/execution-trace-portable.test.ts#neref_3f72bc690bb378720f29dbb3dc36e6c6
            caseId: neref_3f72bc690bb378720f29dbb3dc36e6c6
            binding:
              kind: direct-contract
              contractRef: docs/feature/inspection/README.md
              contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
            sourceDigest: sha256:53a56a965a19fec2d7a05b4400994def794f7aaacc7a007e227aaffeb4b899d8
            candidateSha256: 1ff09947744bffe3d5e99be243809acbc8c32a5df22ac295a13f71851883d9ae
            sourceIdentityDigest: fb5f551f6883bc06085cf7ae4199c1864b0d5ebd8d57ca1faddb1255069a6758
            red:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/red.json
              digest: sha256:c38f7b601c5d0f748639b1aa79606776a232298faa99af1a49b83817a5e134b0
            green:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/green.json
              digest: sha256:428aed0a8d4e579b5f741f1abd778c29defb53b0a12da0477943362d21dc596d
            certificate:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/certificate.json
              digest: sha256:47093e40f6d58b3a8e1da88b729044f7424c142628b0b72da308681bf1b248f7
            inventory:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/inventory.json
              digest: sha256:84812cffb13b224a83bb63855bed2abdad380ec81d6cbb588e21bd0ee1940207
            reliability:
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-1.json
                digest: sha256:0de106d75b20c62d1b634294ae70a762fe142f7b09928ecf351cf8b0fe298d8a
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-2.json
                digest: sha256:feb7760ac27b1c07dec0eb38ff55407ecc475448d3970a614c64a463a30d8129
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-3.json
                digest: sha256:3ca45163335a6c68e84df659a01ac3aa458202e4607bef4fa657863d2cf02156
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-4.json
                digest: sha256:ddb95386c31640e37ba4bbcba5dd059660509b15869d93c4c4e00f775a2a3a66
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-5.json
                digest: sha256:9399877c67a3abbb61bd7eed77f9129be18dccb4f10c8976a3d3b6e3e02bb516
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-6.json
                digest: sha256:3a2cb95e37a254dc25cda0c5933e6dfa66037b8b4d31d00db7ccdb4d0703f004
            invocationIds:
              - 55eb23f2-3266-4d51-ba4d-a2aa5080ac77
              - 7cb05508-b2c2-41f5-95d0-ef42d11d645a
              - 60d499e7-629a-4262-aa2c-0878024ad70a
              - 00e203af-5ab6-45cc-b392-db2aec8911f0
              - 326598e7-a45a-49d9-b14e-a06bb1cb0c93
              - 114a66a0-3ecb-443b-9f01-b043421ea96b
              - 5f08e2ff-1c53-4df0-b1d0-30dbc7fb9b7b
              - 79ebf7f9-59c3-4123-a3bb-edec59594e58
    commit: 7ad457dcd4867bf3fe3c38715d7a2d13507bb05b
  - at: 2026-09-30T12:48:23.163Z
    action: reopen
    reason: reopen
    resolution:
      reason: Installed public CLI regression reproduces the hidden producer state on 9498d7ee6; candidate 1ff09947 preserves partial limitations independently of capture and pagination, with complete managed reliability and cleanup evidence.
      at: 2026-09-30T08:48:24.192Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/execution-producer-partial-hidden.md
        epoch: 0
        validatedAt: 2026-09-30T08:48:19.889Z
        cases:
          - selector: e2e/inspection/test/execution-trace-portable.test.ts#neref_3f72bc690bb378720f29dbb3dc36e6c6
            caseId: neref_3f72bc690bb378720f29dbb3dc36e6c6
            binding:
              kind: direct-contract
              contractRef: docs/feature/inspection/README.md
              contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
            sourceDigest: sha256:53a56a965a19fec2d7a05b4400994def794f7aaacc7a007e227aaffeb4b899d8
            candidateSha256: 1ff09947744bffe3d5e99be243809acbc8c32a5df22ac295a13f71851883d9ae
            sourceIdentityDigest: fb5f551f6883bc06085cf7ae4199c1864b0d5ebd8d57ca1faddb1255069a6758
            red:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/red.json
              digest: sha256:c38f7b601c5d0f748639b1aa79606776a232298faa99af1a49b83817a5e134b0
            green:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/green.json
              digest: sha256:428aed0a8d4e579b5f741f1abd778c29defb53b0a12da0477943362d21dc596d
            certificate:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/certificate.json
              digest: sha256:47093e40f6d58b3a8e1da88b729044f7424c142628b0b72da308681bf1b248f7
            inventory:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/inventory.json
              digest: sha256:84812cffb13b224a83bb63855bed2abdad380ec81d6cbb588e21bd0ee1940207
            reliability:
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-1.json
                digest: sha256:0de106d75b20c62d1b634294ae70a762fe142f7b09928ecf351cf8b0fe298d8a
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-2.json
                digest: sha256:feb7760ac27b1c07dec0eb38ff55407ecc475448d3970a614c64a463a30d8129
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-3.json
                digest: sha256:3ca45163335a6c68e84df659a01ac3aa458202e4607bef4fa657863d2cf02156
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-4.json
                digest: sha256:ddb95386c31640e37ba4bbcba5dd059660509b15869d93c4c4e00f775a2a3a66
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-5.json
                digest: sha256:9399877c67a3abbb61bd7eed77f9129be18dccb4f10c8976a3d3b6e3e02bb516
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_S9JWTY8BXJ687TX7-netake_EYNXG2TJTEZR9Q2M/reliability-6.json
                digest: sha256:3a2cb95e37a254dc25cda0c5933e6dfa66037b8b4d31d00db7ccdb4d0703f004
            invocationIds:
              - 55eb23f2-3266-4d51-ba4d-a2aa5080ac77
              - 7cb05508-b2c2-41f5-95d0-ef42d11d645a
              - 60d499e7-629a-4262-aa2c-0878024ad70a
              - 00e203af-5ab6-45cc-b392-db2aec8911f0
              - 326598e7-a45a-49d9-b14e-a06bb1cb0c93
              - 114a66a0-3ecb-443b-9f01-b043421ea96b
              - 5f08e2ff-1c53-4df0-b1d0-30dbc7fb9b7b
              - 79ebf7f9-59c3-4123-a3bb-edec59594e58
    commit: 8bfe13e5d6fbbdacab5abefdae2b76045c457de9
  - at: 2026-09-30T13:09:23.380Z
    action: resolve
    reason: Current epoch public red and final candidate reliability takeover prove producer partial coverage remains visible independently of pagination completeness.
    resolution:
      kind: fixed
      reason: Current epoch public red and final candidate reliability takeover prove producer partial coverage remains visible independently of pagination completeness.
      at: 2026-09-30T13:09:23.380Z
      epoch: 1
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/execution-producer-partial-hidden.md
        epoch: 1
        validatedAt: 2026-09-30T13:09:19.823Z
        cases:
          - selector: e2e/inspection/test/execution-trace-portable.test.ts#neref_3f72bc690bb378720f29dbb3dc36e6c6
            caseId: neref_3f72bc690bb378720f29dbb3dc36e6c6
            binding:
              kind: direct-contract
              contractRef: docs/feature/inspection/README.md
              contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
            sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
            candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
            sourceIdentityDigest: 14b8345037278cb26935d0a9329d49e9903fd636e975da758d0c112756370722
            red:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/red.json
              digest: sha256:53f1d3124053faeaa7b75d585f936f3358201f0437515713270190c2a5f1d661
            green:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/green.json
              digest: sha256:74677ff6ea379dad251c728abddcfbc67e4f41f06acd7b2b6b27989e11e01839
            certificate:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/certificate.json
              digest: sha256:9035e481457c1b291af210229e615e566632c65849cef24893db0cbcd9d541bd
            inventory:
              path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/inventory.json
              digest: sha256:7004bcaf1a75b2a89ecc6d1c9a66565e634812a5bc7ff2fd1888dd19ca8ad84e
            reliability:
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-1.json
                digest: sha256:486f4fd30c83da8a6782fc67ba9106a4ffc052675ade02ce5b6d88a82b048de6
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-2.json
                digest: sha256:ef2b4600b2072a0829b2815df619107881ea6a65364150a5e6a771b7bc8d0f62
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-3.json
                digest: sha256:a8017f5ccde25543b04aa40030163b77faef1a1e8e51718b06039994b68b91fb
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-4.json
                digest: sha256:d569f099b9fced4209cf59f8b52a22e5583936025a598ddcce5b5416841af758
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-5.json
                digest: sha256:d9a278e9d0c0a751782c2c624f1920c96279bd875503fe14fa4935b8be59c81a
              - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-6.json
                digest: sha256:577b94c28b4bef8830f2bf23611c61cedf3d7de53fdb41c951883c7f4c670a93
            invocationIds:
              - 3f9d43bc-d059-41d9-8809-57f853682451
              - 42c34c37-14c9-4f3d-aeb2-3a25e5fc10d5
              - 2e6e66ad-5f21-4863-bbbd-31e69dc458b8
              - ad6d387b-683c-481c-9131-74068ccd8d96
              - bfc3f276-965f-4dae-a745-1001d4f1c36f
              - 95b46b3b-489a-4564-861b-c43aff78a8e8
              - f7c74d83-adf9-48ec-922f-718da902cb20
              - 26dbe37c-0655-4233-9617-07562d20f2e2
    commit: 0bde4166f53bb3d2b7a3a0e3b8be1530a75ca4fa
resolution:
  kind: fixed
  reason: Current epoch public red and final candidate reliability takeover prove producer partial coverage remains visible independently of pagination completeness.
  at: 2026-09-30T13:09:23.380Z
  epoch: 1
  evidenceLevel: repository
  repositoryEvidence:
    policy: concord.native-reliability/v1
    memory: memory/execution-producer-partial-hidden.md
    epoch: 1
    validatedAt: 2026-09-30T13:09:19.823Z
    cases:
      - selector: e2e/inspection/test/execution-trace-portable.test.ts#neref_3f72bc690bb378720f29dbb3dc36e6c6
        caseId: neref_3f72bc690bb378720f29dbb3dc36e6c6
        binding:
          kind: direct-contract
          contractRef: docs/feature/inspection/README.md
          contractSha256: 162064d5282f0f2a7197aeffd1c68c359a7d54de762768c73adb7fc0f89c4a09
        sourceDigest: sha256:7bea066142cfbecfe9d2fc4a67645ea3c235016130a8333a5a6517d8da0511ab
        candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
        sourceIdentityDigest: 14b8345037278cb26935d0a9329d49e9903fd636e975da758d0c112756370722
        red:
          path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/red.json
          digest: sha256:53f1d3124053faeaa7b75d585f936f3358201f0437515713270190c2a5f1d661
        green:
          path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/green.json
          digest: sha256:74677ff6ea379dad251c728abddcfbc67e4f41f06acd7b2b6b27989e11e01839
        certificate:
          path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/certificate.json
          digest: sha256:9035e481457c1b291af210229e615e566632c65849cef24893db0cbcd9d541bd
        inventory:
          path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/inventory.json
          digest: sha256:7004bcaf1a75b2a89ecc6d1c9a66565e634812a5bc7ff2fd1888dd19ca8ad84e
        reliability:
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-1.json
            digest: sha256:486f4fd30c83da8a6782fc67ba9106a4ffc052675ade02ce5b6d88a82b048de6
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-2.json
            digest: sha256:ef2b4600b2072a0829b2815df619107881ea6a65364150a5e6a771b7bc8d0f62
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-3.json
            digest: sha256:a8017f5ccde25543b04aa40030163b77faef1a1e8e51718b06039994b68b91fb
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-4.json
            digest: sha256:d569f099b9fced4209cf59f8b52a22e5583936025a598ddcce5b5416841af758
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-5.json
            digest: sha256:d9a278e9d0c0a751782c2c624f1920c96279bd875503fe14fa4935b8be59c81a
          - path: e2e/inspection/test/execution-trace-portable.test.ts.case-evidence/neref_3f72bc690bb378720f29dbb3dc36e6c6/memory_execution-producer-partial-hidden.md/nered_2CKC9BFA0XCYPJMN-netake_WPFZT1R9HP7RT7NT/reliability-6.json
            digest: sha256:577b94c28b4bef8830f2bf23611c61cedf3d7de53fdb41c951883c7f4c670a93
        invocationIds:
          - 3f9d43bc-d059-41d9-8809-57f853682451
          - 42c34c37-14c9-4f3d-aeb2-3a25e5fc10d5
          - 2e6e66ad-5f21-4863-bbbd-31e69dc458b8
          - ad6d387b-683c-481c-9131-74068ccd8d96
          - bfc3f276-965f-4dae-a745-1001d4f1c36f
          - 95b46b3b-489a-4564-861b-c43aff78a8e8
          - f7c74d83-adf9-48ec-922f-718da902cb20
          - 26dbe37c-0655-4233-9617-07562d20f2e2
---
# 现象

Adapter 通过 recordTrace 上报 collection.state=partial、限制说明和空事件集。show --execution 却只显示外层 Generic execution traces complete、complete preview 与 Continuation complete，未解释生产者声明的缺失。

# 边界

外层捕获成功、生产者证据完整性、列表分页是否结束是三个不同事实。空索引不能证明应用没有事件。保留每条 trace 的完整性与限制，摘要与稳定详情引用共用正式投影，不加入具体应用概念。

# 验收

安装候选经公开 Adapter 记录 partial 空集与非空事件后，Query、show 与 Insight 必须保留限制。完整列表不升级证据完整性，分页仍可继续至末页。不依赖付费模型。
