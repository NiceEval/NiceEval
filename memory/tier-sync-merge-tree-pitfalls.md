# tier-sync:同 base 三方合并的三个坑(重报冲突 / 链式脏树 / lockfile 参与合并)

## 现象

1. `tiers:sync` 报冲突,人解完 `<<<<<<<` 标记、提交后重跑,**同一处冲突原样再报一遍**,
   还把带标记的文件重新检出覆盖工作树——文档原本写的"解完标记后重跑收尾"是死循环。
2. 链式 pair(origin→tier1→tier2)一条命令跑不通:第一对同步把 tier1 写进工作树(未提交),
   第二对的 clean 检查直接报"有未提交改动",且它读 `HEAD:tier1` 拿到的是旧树。
3. lockfile 参与合并时,tier 侧 `pnpm install` 重新生成的 `pnpm-lock.yaml` 永远和记录的
   上游 tree 对不上,链式 baseTree 永不收敛;lockfile 还会产生假冲突。

## 根因

1. 同 base 的三方合并是纯函数:base 不动、两侧输入不动,结果(含冲突)就不动。人工解决
   产生的第三种文本(≠上游、≠base)在下次合并里仍是"两边都改了同一区域"。git rebase 不踩
   这个坑是因为 `--continue` 把裁决记成了新提交、base 随之前进——目录级方案没有这个动作。
2. 设计要求"合并输入取自提交过的 tree",但链式下游的上游恰恰是上一对刚产出、还没提交的
   结果——两个要求打架。
3. lockfile 是机器产物,内容由 `pnpm install` 决定,不满足"tier 侧不动就能快进"的前提。

## 修法

都已落在 `scripts/sync-tiers.mjs`(设计见 docs/tier-sync.md):

1. 冲突时把"要合到的上游 tree"写进 pair 的 `pending`;重跑时看到 pending 且标记已清,
   直接推进 baseTree 收尾,**不重新合并**。
2. 链式同步把上一对的合并结果 tree(已在 git 对象库里)直接作为下一对的上游输入,
   clean 检查对"本次自己弄脏的上游"放行;冲突的 pair 阻断其整条下游。
3. 三棵输入树先剥掉 `pnpm-lock.yaml`(ls-tree 过滤 + mktree)再合并,baseTree 记剥后的
   tree;代价是"上游只动 lockfile 不动 package.json"的变更不传播,可接受并已写进文档。

适用场景:任何"同一棵树里两个目录做 rebase 式同步"的方案都会撞到 1 和 2;
有机器生成文件参与的都会撞到 3。
