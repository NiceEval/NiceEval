# Compose caseIdentity 含本地镜像 digest,并行 docker 活动导致指纹抖动

**现象**(2026-08-04,terminal-bench 迁移后 accept 流程):对 12 个 Compose 题 `niceeval accept` 重锚后立即 `--dry`,同一批题反复回到 `stale passed`,原因恒为 `plan:physical changed`;单独 accept 后立刻 dry 有时稳定有时又抖。期间宿主机上另有 agent 在做 docker 构建/拉取。

**已复核(2026-08-04)**:沿这条现象排查 `collectComposeBuilds` → `imageRefs` → `composeCollectionIdentity` / `computeCaseKey` 全链路,并追溯到 `26a53cbd`(2026-08-03,更早于本次现象)之前的历史,确认代码从未把 `docker inspect` 等本地 daemon 解析出的实际 digest 写进身份——`imageRefs[svc.name] = svc.image` 一直只存字面声明值(`src/sandbox/compose.ts`),Dockerfile `FROM` 的 `fromDigest` 也只是纯文本解析声明(`dockerfileBaseIdentity`,不问 daemon)。也就是说,本条目最初怀疑的机制(本地解析 digest 直接进 caseIdentity)在当前代码里找不到对应实现,原「根因」判断有误。

真正的缺陷是**命名与文档口径与实际行为脱钩**:`CaseKeyInput` 的字段叫 `serviceImageDigests`(`src/sandbox/identity.ts`),`docs/feature/sandbox/case.md`「BuildKey 与 CaseKey」一节的 CaseKey 公式也写着「+ service image digest」——两处都在暗示这里收的是解析出的 digest,但实际值恒为声明 ref(已 pin 时含 digest,未 pin 时是原始 tag)。这与同一份文档往下几行「记录其声明的 image ref；可取得的实际 digest 另作为运行事实」的正确描述自相矛盾,很可能就是本条目最初误诊的来源——命名先把读者引向了错误的机制假设。

**已修**(2026-08-04):

- 字段更名 `serviceImageDigests` → `serviceImageRefs`(`src/sandbox/identity.ts`、`src/sandbox/layer.ts`),并在类型上补一句「只收声明值,不得填入本地解析出的实际 digest」的约束说明,防止未来有人「顺手」把名字和行为对齐,反而引入真正的 digest 回填。
- `docs/feature/sandbox/case.md`:CaseKey 公式改「+ service image digest」为「+ 无 build 的 service 的声明 image ref(已 pin 时含 digest,未 pin 时是原始 tag 文本;不是本地 daemon 解析出的实际 digest)」,消除与下文的自相矛盾;并在「身份解析发生在携带决策之前」一段补两句显式契约:身份只收声明,`docker inspect` 等查询只产出运行事实,永不回填进 BuildKey / CaseKey,因此同一份声明在两次独立规划之间(如 accept 后立即 `--dry`)必须算出相同身份。
- 回归测试:`src/sandbox/compose.test.ts`「未钉 digest 的 image ref 只收声明值,重复规划两次身份不漂移」——同一份未钉 digest 的 Compose 声明连续两次独立调用 `collectComposeBuilds()`,断言 `imageRefs` 恒为声明字符串(非 `sha256:` 形态)且两次 `composeCollectionIdentity` 摘要完全相同;覆盖类别先补进 `docs/engineering/testing/unit/sandbox.md`「sandbox case 五类」。
- 字段改名会改变 `computeCaseKey` 的哈希 payload 形状,**存量携带 docker compose provider 结果的指纹会一次性翻 stale**——这是预期内的迁移,翻案后 accept 一次即可重新稳定,不做兼容双字段名。

**遗留(未解决,留给下次真机复现时排查)**:本次审计没能在当前代码里重现「12 题批量抖动」的具体触发路径,已修部分只是消灭了一个真实存在但描述有误的缺陷(命名/文档矛盾),不能确定它就是当日现象的全部成因。代码里唯一还会在两次独立 physical planning 之间读取"实时宿主/文件系统状态"的输入是 `contextDigest`(build context 文件内容哈希,`buildContextIdentityContribution`)与 `bindMountDigests` / `configContents`(bind mount 与 config/secret/env_file 内容哈希,`pathContentDigest`)——这些是有意的声明内容信号,如果并发 docker 构建确实写到了重叠路径,应归为「构建 context / 卷路径与其它进程重叠」这一类问题,不是 digest 解析问题。若该现象复现,建议直接比对两次 `manifests.json` 里 `plan` 字段的具体差异定位是哪个子键变了,而不是先假设是 image digest。
