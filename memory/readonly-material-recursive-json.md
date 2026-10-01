---
format: concord.document/v1
id: readonly-material-recursive-json
title: ReadonlyMaterial 递归 JSON 在公开声明上触发 TS2589
createdAt: 2026-09-30
kind: memory
memoryKind: problem
state: resolved
epoch: 1
evidenceRequirement: concord.native-reliability/v1
promotions: []
history:
  - at: 2026-09-30T10:52:02.962Z
    action: resolve
    reason: Installed TS 5.9.3 recursive Json, array overloads and precise tuples pass after deferred readonly array mapping; managed public red and complete reliability takeover are bound to this Problem.
    resolution:
      reason: Installed TS 5.9.3 recursive Json, array overloads and precise tuples pass after deferred readonly array mapping; managed public red and complete reliability takeover are bound to this Problem.
      at: 2026-09-30T10:52:02.962Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/readonly-material-recursive-json.md
        epoch: 0
        validatedAt: 2026-09-30T10:51:59.128Z
        cases:
          - selector: e2e/eval/test/recursive-material-types.test.ts#neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            caseId: neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            binding:
              kind: direct-contract
              contractRef: docs/feature/assertions/README.md
              contractSha256: 303e4e67be5ae02acefbabcc86a5a4cc39e2d73382d07c7198e0edeb6f7af35c
            sourceDigest: sha256:d7ce5f99cfb28dd128f1dcc66b41f4e7ac5af5380ba025034aae0222df06f611
            candidateSha256: c4cec1e6ec63d0072a56445e47b5a33cd33cbe51dc04ebaa612174afa249bc4e
            sourceIdentityDigest: 9edc72877b36102ee56f650b1f85b1e3270a2ee5a5d9abd26b34d5b21ea4ffe4
            red:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/red.json
              digest: sha256:a30f73d82983a1404b660cd207eb5f557819581cf0f5e3b91445496f1fd3d8c2
            green:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/green.json
              digest: sha256:b0b2ccbefcf4505e612dd3a9d1040609c04324bf1cfbe83d0b9efdca061eaad9
            certificate:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/certificate.json
              digest: sha256:eac8b318e30c706f0174a7dd787b924dc9a18891ca5df7d0763c264ed9eec30e
            inventory:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/inventory.json
              digest: sha256:4142e21826956ca193fa7f55d7b7875d1fbd14f269953e6015101849901cc37a
            reliability:
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-1.json
                digest: sha256:5699c830f6c89674f1754aed3ea138c4949ddfe132648909b680a40f21d4accb
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-2.json
                digest: sha256:0911831bfd535a8f9f9c972dbf08dcc49b6015a54702f21cb90693c0f3bbaac2
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-3.json
                digest: sha256:7cccdca091c0ba625a4179ff73cd2bcd3709c287764e1550502f5d1e48ad7308
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-4.json
                digest: sha256:a12b45607de60405154422ac9994eca41369bf148a419251b987ae78a0a09447
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-5.json
                digest: sha256:0415f6c428d7435867add1b5c5a96ac586b3d6080374972229997381dbc68780
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-6.json
                digest: sha256:98a9d2501ea44237eca6e49d208517a4448dd3a387123b1ca773c1573671bb62
            invocationIds:
              - 1703236c-0aa0-44be-9bed-dda8245cb806
              - 1ec91624-798d-4b67-88e1-4ff4250c4189
              - da4381df-a7aa-4a5a-a04c-7ac89d9c5670
              - ba2c0856-6409-4b4c-a89e-c85cd948edc1
              - 0e0980c6-0762-4dec-ace8-1cdc903f907b
              - 73329b0c-dfe4-4518-ae6a-aeef19aed413
              - 7a7ecdbd-1eb0-41ad-be07-01479f7dfe46
              - c0243339-89a0-4e99-91cc-fbc4ee2fd302
    commit: 7ad457dcd4867bf3fe3c38715d7a2d13507bb05b
  - at: 2026-09-30T12:53:27.309Z
    action: reopen
    reason: reopen
    resolution:
      reason: Installed TS 5.9.3 recursive Json, array overloads and precise tuples pass after deferred readonly array mapping; managed public red and complete reliability takeover are bound to this Problem.
      at: 2026-09-30T10:52:02.962Z
      epoch: 0
      kind: fixed
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/readonly-material-recursive-json.md
        epoch: 0
        validatedAt: 2026-09-30T10:51:59.128Z
        cases:
          - selector: e2e/eval/test/recursive-material-types.test.ts#neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            caseId: neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            binding:
              kind: direct-contract
              contractRef: docs/feature/assertions/README.md
              contractSha256: 303e4e67be5ae02acefbabcc86a5a4cc39e2d73382d07c7198e0edeb6f7af35c
            sourceDigest: sha256:d7ce5f99cfb28dd128f1dcc66b41f4e7ac5af5380ba025034aae0222df06f611
            candidateSha256: c4cec1e6ec63d0072a56445e47b5a33cd33cbe51dc04ebaa612174afa249bc4e
            sourceIdentityDigest: 9edc72877b36102ee56f650b1f85b1e3270a2ee5a5d9abd26b34d5b21ea4ffe4
            red:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/red.json
              digest: sha256:a30f73d82983a1404b660cd207eb5f557819581cf0f5e3b91445496f1fd3d8c2
            green:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/green.json
              digest: sha256:b0b2ccbefcf4505e612dd3a9d1040609c04324bf1cfbe83d0b9efdca061eaad9
            certificate:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/certificate.json
              digest: sha256:eac8b318e30c706f0174a7dd787b924dc9a18891ca5df7d0763c264ed9eec30e
            inventory:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/inventory.json
              digest: sha256:4142e21826956ca193fa7f55d7b7875d1fbd14f269953e6015101849901cc37a
            reliability:
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-1.json
                digest: sha256:5699c830f6c89674f1754aed3ea138c4949ddfe132648909b680a40f21d4accb
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-2.json
                digest: sha256:0911831bfd535a8f9f9c972dbf08dcc49b6015a54702f21cb90693c0f3bbaac2
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-3.json
                digest: sha256:7cccdca091c0ba625a4179ff73cd2bcd3709c287764e1550502f5d1e48ad7308
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-4.json
                digest: sha256:a12b45607de60405154422ac9994eca41369bf148a419251b987ae78a0a09447
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-5.json
                digest: sha256:0415f6c428d7435867add1b5c5a96ac586b3d6080374972229997381dbc68780
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_BP8C0G7JNVAC4FES-netake_886Z0GS22RGYS7Q7/reliability-6.json
                digest: sha256:98a9d2501ea44237eca6e49d208517a4448dd3a387123b1ca773c1573671bb62
            invocationIds:
              - 1703236c-0aa0-44be-9bed-dda8245cb806
              - 1ec91624-798d-4b67-88e1-4ff4250c4189
              - da4381df-a7aa-4a5a-a04c-7ac89d9c5670
              - ba2c0856-6409-4b4c-a89e-c85cd948edc1
              - 0e0980c6-0762-4dec-ace8-1cdc903f907b
              - 73329b0c-dfe4-4518-ae6a-aeef19aed413
              - 7a7ecdbd-1eb0-41ad-be07-01479f7dfe46
              - c0243339-89a0-4e99-91cc-fbc4ee2fd302
    commit: 0bde4166f53bb3d2b7a3a0e3b8be1530a75ca4fa
  - at: 2026-09-30T13:19:43.175Z
    action: resolve
    reason: Current epoch installed public TypeScript red and final candidate takeover pass for recursive JSON, deep readonly arrays and tuples; eval default suite 34/34.
    resolution:
      kind: fixed
      reason: Current epoch installed public TypeScript red and final candidate takeover pass for recursive JSON, deep readonly arrays and tuples; eval default suite 34/34.
      at: 2026-09-30T13:19:43.175Z
      epoch: 1
      evidenceLevel: repository
      repositoryEvidence:
        policy: concord.native-reliability/v1
        memory: memory/readonly-material-recursive-json.md
        epoch: 1
        validatedAt: 2026-09-30T13:19:39.246Z
        cases:
          - selector: e2e/eval/test/recursive-material-types.test.ts#neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            caseId: neref_1ad0a3aad9346b8947d5aa7d2c9ba212
            binding:
              kind: direct-contract
              contractRef: docs/feature/assertions/README.md
              contractSha256: 303e4e67be5ae02acefbabcc86a5a4cc39e2d73382d07c7198e0edeb6f7af35c
            sourceDigest: sha256:ac30cf2cc1d0493fb671a63b3a740190220d5d1f95b8410f83a488672875366b
            candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
            sourceIdentityDigest: d205e810d8870d0f2c163ad8eee295a2cbb9194c7ede92c222c2533abf415855
            red:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/red.json
              digest: sha256:c17bd8ed9befb0002f5eda3d18bd459b8f3732cd4e5f75a4eaaec73b20cb6f3a
            green:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/green.json
              digest: sha256:7a10425f5f7b5097adabf510c5137e4ab337d6a5d2c7ba90e39e7419a8d04793
            certificate:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/certificate.json
              digest: sha256:ef0352cdd68cb660aef413998b5be33dd3715da4aa262e71631089e48cbdf1bf
            inventory:
              path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/inventory.json
              digest: sha256:33567e750406f49d6828b0b05dcebfef3f5f4667d54937d448f4939b9e0bc21d
            reliability:
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-1.json
                digest: sha256:71c73c8362c453ba16c8aeb140f00ccae2aafd7a066b9e78fa99dd4159920619
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-2.json
                digest: sha256:a18b22568c81dd2b384810fd2426224bc780cbb60da371d48fa787dd8491f8e2
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-3.json
                digest: sha256:f069ad9065803691704a44ec1dad937bb489886a4e3b7e4537eb77cc5b6473ac
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-4.json
                digest: sha256:2108c66c0fd686fc687c2b8536b5fd2ed410cc1c8563109b47294914669f05f0
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-5.json
                digest: sha256:0a0f2d0f5740dd834e17655ca7bd43334941a911ccebf7b683e4fa58077a7ec0
              - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-6.json
                digest: sha256:fc406ae2bcfe907c590e4969ef896b79d30df99ac1cd43e999b3bff51d3e8d9d
            invocationIds:
              - 9deb4f9e-2958-4190-a549-74b01bbf3ff8
              - 6ce502c6-71c9-42b5-aaff-4a20b80050a4
              - c2b0b6bd-50b4-4cda-aac9-e4c61c9d35a1
              - ba009873-af57-4a90-9a05-83bdd6d93879
              - cb40de12-8237-48b8-b06c-be5540d2e2a3
              - c8d85d83-8b9a-4d11-bad4-7cb1183c89c2
              - 041f0a7d-0d2d-4a0f-a09d-74415ae18ccc
              - 7c4c24cf-ca4b-43f7-b214-4f95636511ec
    commit: 0bde4166f53bb3d2b7a3a0e3b8be1530a75ca4fa
resolution:
  kind: fixed
  reason: Current epoch installed public TypeScript red and final candidate takeover pass for recursive JSON, deep readonly arrays and tuples; eval default suite 34/34.
  at: 2026-09-30T13:19:43.175Z
  epoch: 1
  evidenceLevel: repository
  repositoryEvidence:
    policy: concord.native-reliability/v1
    memory: memory/readonly-material-recursive-json.md
    epoch: 1
    validatedAt: 2026-09-30T13:19:39.246Z
    cases:
      - selector: e2e/eval/test/recursive-material-types.test.ts#neref_1ad0a3aad9346b8947d5aa7d2c9ba212
        caseId: neref_1ad0a3aad9346b8947d5aa7d2c9ba212
        binding:
          kind: direct-contract
          contractRef: docs/feature/assertions/README.md
          contractSha256: 303e4e67be5ae02acefbabcc86a5a4cc39e2d73382d07c7198e0edeb6f7af35c
        sourceDigest: sha256:ac30cf2cc1d0493fb671a63b3a740190220d5d1f95b8410f83a488672875366b
        candidateSha256: 312415f42909e28d557a6ed18e4e831f71e64f7d1be71b97591e95fd424075e3
        sourceIdentityDigest: d205e810d8870d0f2c163ad8eee295a2cbb9194c7ede92c222c2533abf415855
        red:
          path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/red.json
          digest: sha256:c17bd8ed9befb0002f5eda3d18bd459b8f3732cd4e5f75a4eaaec73b20cb6f3a
        green:
          path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/green.json
          digest: sha256:7a10425f5f7b5097adabf510c5137e4ab337d6a5d2c7ba90e39e7419a8d04793
        certificate:
          path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/certificate.json
          digest: sha256:ef0352cdd68cb660aef413998b5be33dd3715da4aa262e71631089e48cbdf1bf
        inventory:
          path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/inventory.json
          digest: sha256:33567e750406f49d6828b0b05dcebfef3f5f4667d54937d448f4939b9e0bc21d
        reliability:
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-1.json
            digest: sha256:71c73c8362c453ba16c8aeb140f00ccae2aafd7a066b9e78fa99dd4159920619
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-2.json
            digest: sha256:a18b22568c81dd2b384810fd2426224bc780cbb60da371d48fa787dd8491f8e2
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-3.json
            digest: sha256:f069ad9065803691704a44ec1dad937bb489886a4e3b7e4537eb77cc5b6473ac
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-4.json
            digest: sha256:2108c66c0fd686fc687c2b8536b5fd2ed410cc1c8563109b47294914669f05f0
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-5.json
            digest: sha256:0a0f2d0f5740dd834e17655ca7bd43334941a911ccebf7b683e4fa58077a7ec0
          - path: e2e/eval/test/recursive-material-types.test.ts.case-evidence/neref_1ad0a3aad9346b8947d5aa7d2c9ba212/memory_readonly-material-recursive-json.md/nered_2SJQ2XK9FF7CP788-netake_BDB0H7WXTSEVD2WM/reliability-6.json
            digest: sha256:fc406ae2bcfe907c590e4969ef896b79d30df99ac1cd43e999b3bff51d3e8d9d
        invocationIds:
          - 9deb4f9e-2958-4190-a549-74b01bbf3ff8
          - 6ce502c6-71c9-42b5-aaff-4a20b80050a4
          - c2b0b6bd-50b4-4cda-aac9-e4c61c9d35a1
          - ba009873-af57-4a90-9a05-83bdd6d93879
          - cb40de12-8237-48b8-b06c-be5540d2e2a3
          - c8d85d83-8b9a-4d11-bad4-7cb1183c89c2
          - 041f0a7d-0d2d-4a0f-a09d-74415ae18ccc
          - 7c4c24cf-ca4b-43f7-b214-4f95636511ec
---
RPG 消费 b65a4ebe 候选，用 TypeScript 5.9.3、strict、skipLibCheck、ES2024，仅声明 ReadonlyMaterial<Json> 即出现 TS2589。Json 为包含 null、primitive、readonly Json[] 和 readonly string index 的递归联合，不依赖大型应用泛型。

现有类型在深只读映射前对 ManagedToolCalls 与 ManagedEventOccurrences 做结构条件匹配；需以最小安装候选类型入口定位和修复递归展开。不得用 any、类型断言、材料截断或限制深度绕过，现有 managed 品牌、函数返回、Map/Set 及深只读负例必须保留。
