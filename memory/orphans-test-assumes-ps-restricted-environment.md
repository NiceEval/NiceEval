# orphans-test-assumes-ps-restricted-environment

## 现象

发现(2026-07-23):`pnpm test` 在本机(macOS,`ps` 可用)稳定红一条——`src/sandbox/orphans.test.ts` 的「docker:排除留存注册表已登记条目」用例,`expect(candidates).toHaveLength(2)` 实得 1。与工作树改动无关,HEAD 上即失败。

## 根因

用例注释自陈「受限测试容器禁止 ps,真实运行时的进程启动时间探测会保守降为 unverified」——它期待属主活着的容器(label 里是当前 `process.pid`)因 `ps` 被禁而降级成 `unverified` 出现在候选里。本机 `ps` 可用,判活探测成功,属主活着的容器被如实排除,候选只剩 1 个。断言把「探测失败的降级路径」写成了对所有环境的期待,环境敏感。

## 修法

已修(commit `328b35bc`,修在 `src/sandbox/orphans.ts` + `src/sandbox/orphans.test.ts`;bug 由 `791ec6e` 引入)。`listOrphanCandidates` / `dockerOrphanCandidates` / `e2bOrphanCandidates` 增开 `OrphanClassifier` 注入缝(`(identity) => "alive" | OrphanState`),默认仍是真实系统探测 `classifyRunIdentity`。用例注入按 pid 直接裁决三态的窄判据(ORPHAN_PID / ALIVE_PID / UNVERIFIED_PID),于是「alive 完全不进列表」「unverified 进列表但状态不是 orphan」「留存注册表条目连判据都不调用」三条各自被显式构造,不再赌宿主 `ps` 是否可用;`classifyRunIdentity` 自身的 host/pid/启动时刻裁决语义由独立的用例组覆盖(启动时刻探测同样走注入)。

教训:降级路径要成为**被显式注入的条件**,不能写成对运行环境的期待——「受限容器禁 ps」这类前提在开发机上天然不成立,断言等于在赌环境。
