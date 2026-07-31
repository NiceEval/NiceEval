# compose 资源组逃过孤儿核对与 prune

**现象**:MemoryBench 批跑被 SIGINT 后残留 4 个 `ne-tb-*` 容器与 5 个网络;`niceeval sandbox list --orphans` 报 `No orphan sandboxes.`、`sandbox prune` 无可收、`sandbox list` 报 `No kept sandboxes.`,只能手工 `docker rm -f` 收场(2026-07-31 真机)。prune 正是文档给用户的「跑崩之后收容器」官方手段,却对 compose case 全盲。

**根因**:孤儿核对与 prune 的实现只按单实例的运行标识词表核对,Compose case 的资源组(project label 下的伴随容器与网络)没进核对面。`docs/feature/sandbox/case.md` 本来就声明「清理和留存针对 case 返回的资源组」,是实现漏了这一半。2026-07-30 的多容器设计评审([multi-container-design-review-ledger](multi-container-design-review-ledger.md))明确警告过「新资源种类逐一进回收词表」,警告没有转化成守护,这次原样命中。

**修法**:已修(2026-07-31)。契约先补齐:`docs/feature/sandbox/architecture.md` 孤儿核对新增「核对与收回以 case 的资源组为单位」,`cli.md` 的 `list --orphans` / `prune` 同步声明整组列出与整组销毁,覆盖类别登记在 `docs/engineering/testing/unit/sandbox.md`「孤儿核对与 prune」。代码落点三处:

- `src/sandbox/compose.ts` —— 新增运行标识 overlay(`buildComposeIdentityOverlay`),把 `host`/`pid`/`startedAt` 打到组内每个服务与每个受管网络上;网络名由 `inspectComposeYaml` 的 `networkNames` 给出(服务未声明网络时是 `default`,`external` 网络不受管)。它与受管 overlay 分成两份文件:标识逐次运行都不同,混进受管 overlay 会让 caseKey 每次都变、携带与缓存全失效。
- `src/sandbox/orphans.ts` —— docker 核对同时查容器与网络,按 Compose 自己打的 `com.docker.compose.project` label 把一组资源拼回一条候选;主容器消失时主键退回 project 名,身份从组内任一成员(含只剩的网络)取。prune 对资源组走整组销毁:先删组内容器再删网络(顺序反了 daemon 会拒删仍被占用的网络),404 按幂等算已完成。
- `src/sandbox/cli-commands.ts` —— `list --orphans` 在候选行下补一行组成(`compose <project> · N containers · M networks`),`prune` 的销毁行同样带过。
