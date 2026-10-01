---
format: concord.document/v1
id: orphans-test-assumes-ps-restricted-environment
title: orphans-test-assumes-ps-restricted-environment
createdAt: 2026-07-23T12:33:51+08:00
createdAtSource:
  kind: first-recorded
  path: memory/orphans-test-assumes-ps-restricted-environment.md
  commit: 4d739a0ed39552083604da7b1355955d6b7b6698
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: 已修(commit `328b35bc`,修在 `src/sandbox/orphans.ts` + `src/sandbox/orphans.test.ts`;bug 由 `791ec6e` 引入)。`listOrphanCandidates` / `dockerOrphanCandidates` / `e2bOrphanCandidates` 增开 `OrphanClassifier` 注入缝(`(identity) => "alive" | OrphanState`),默认仍是真实系统探测 `classifyRunIdentity`。用例注入按 pid 直接裁决三态的窄判据(ORPHAN_PID / ALIVE_PID / UNVERIFIED_PID),于是「alive 完全不进列表」「unverified 进列表但状态不是 orphan」「留存注册表条目连判据都不调用」三条各自被显式构造,不再赌宿主 `ps` 是否可用;`classifyRunIdentity` 自身的 host/pid/启动时刻裁决语义由独立的用例组覆盖(启动时刻探测同样走注入)。
    proof: []
    source:
      path: memory/orphans-test-assumes-ps-restricted-environment.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:d42c49e21c61bd241e31c2597e12192cd461949f09d5df69ebe3c2eccbe63f59
---
# orphans-test-assumes-ps-restricted-environment

## 现象

发现(2026-07-23):`pnpm test` 在本机(macOS,`ps` 可用)稳定红一条——`src/sandbox/orphans.test.ts` 的「docker:排除留存注册表已登记条目」用例,`expect(candidates).toHaveLength(2)` 实得 1。与工作树改动无关,HEAD 上即失败。

## 根因

用例注释自陈「受限测试容器禁止 ps,真实运行时的进程启动时间探测会保守降为 unverified」——它期待属主活着的容器(label 里是当前 `process.pid`)因 `ps` 被禁而降级成 `unverified` 出现在候选里。本机 `ps` 可用,判活探测成功,属主活着的容器被如实排除,候选只剩 1 个。断言把「探测失败的降级路径」写成了对所有环境的期待,环境敏感。

## 修法

已修(commit `328b35bc`,修在 `src/sandbox/orphans.ts` + `src/sandbox/orphans.test.ts`;bug 由 `791ec6e` 引入)。`listOrphanCandidates` / `dockerOrphanCandidates` / `e2bOrphanCandidates` 增开 `OrphanClassifier` 注入缝(`(identity) => "alive" | OrphanState`),默认仍是真实系统探测 `classifyRunIdentity`。用例注入按 pid 直接裁决三态的窄判据(ORPHAN_PID / ALIVE_PID / UNVERIFIED_PID),于是「alive 完全不进列表」「unverified 进列表但状态不是 orphan」「留存注册表条目连判据都不调用」三条各自被显式构造,不再赌宿主 `ps` 是否可用;`classifyRunIdentity` 自身的 host/pid/启动时刻裁决语义由独立的用例组覆盖(启动时刻探测同样走注入)。

教训:降级路径要成为**被显式注入的条件**,不能写成对运行环境的期待——「受限容器禁 ps」这类前提在开发机上天然不成立,断言等于在赌环境。
