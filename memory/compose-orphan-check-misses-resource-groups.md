# compose 资源组逃过孤儿核对与 prune

**现象**:MemoryBench 批跑被 SIGINT 后残留 4 个 `ne-tb-*` 容器与 5 个网络;`niceeval sandbox list --orphans` 报 `No orphan sandboxes.`、`sandbox prune` 无可收、`sandbox list` 报 `No kept sandboxes.`,只能手工 `docker rm -f` 收场(2026-07-31 真机)。prune 正是文档给用户的「跑崩之后收容器」官方手段,却对 compose case 全盲。

**根因**:孤儿核对与 prune 的实现只按单实例的运行标识词表核对,Compose case 的资源组(project label 下的伴随容器与网络)没进核对面。`docs/feature/sandbox/case.md` 本来就声明「清理和留存针对 case 返回的资源组」,是实现漏了这一半。2026-07-30 的多容器设计评审([multi-container-design-review-ledger](multi-container-design-review-ledger.md))明确警告过「新资源种类逐一进回收词表」,警告没有转化成守护,这次原样命中。

**修法**:未修。契约已补齐(2026-07-31):`docs/feature/sandbox/architecture.md` 孤儿核对新增「核对与收回以 case 的资源组为单位」,`cli.md` 的 `list --orphans` / `prune` 同步声明整组列出与整组销毁,覆盖类别登记在 `docs/engineering/testing/unit/sandbox.md`「孤儿核对与 prune」。实现方向:核对与销毁按 project label 整组进行,含「主实例已消失、只剩网络残留」的场景。
