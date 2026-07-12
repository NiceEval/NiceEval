# Tier Sync:examples 的 origin → tier1 → tier2 → tier3 同步维护方案

`scripts/sync-tiers.mjs`、`pnpm tiers:sync`、`pnpm tiers:check` 维护 `examples/zh/.tier-sync.json` 登记的全部目录对;CI 在 `pnpm run typecheck` 之后跑 `tiers:check`。链条是 origin → tier1 → tier2 → tier3(哪个应用有哪几层见 [examples/zh/README](../../examples/zh/origin/README.md) 与状态文件本身)。

## 问题

`examples/zh/` 里同一个应用按接入深度存多份:`origin/<name>` 是接入 niceeval 之前的原始应用,`tier1/<name>` 是它的完整副本加上无侵入接入产物,`tier2/<name>` 在 tier1 之上把 OTel 观测接进来,`tier3/<name>` 再往上做侵入改造暴露 experiment flags。存多份是刻意的——`gen:diff-code` diff 相邻两层生成 before/after 文档页,"每一档只加一层 delta"是产品叙事的骨架,所以 tier1 里被复制的文件必须和 origin 逐字节相同(只有 `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个脚手架文件加 `.env.example`——tier 侧要补 judge 独立凭证等 eval 变量——例外)。以 codex-sdk 为例,tier1 的跟踪文件里大半是 origin 的逐字节副本,其余是 tier 私有新增(`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`、`README.md`)。

麻烦在于 origin 改得很勤(修 bug、调演示场景、升依赖),而副本不会自己跟上。今天给 `origin/codex-sdk/src/backend/server.ts` 修个 bug,就得记得 cp 一份到 tier1 的同名路径——然后 tier2、tier3 还各有一份;要是动的是 `package.json`,连 cp 都不行——tier 那份多着 niceeval 的集成行,只能打开手工重放同一行,再进各层跑一遍 `pnpm install` 让 lockfile 跟上。这套动作对每个受影响的示例各来一遍,层数越多乘数越大,而且全程只靠改动者的记忆串着。

忘了会怎样?什么都不会发生——这正是最糟的部分。没有检查、没有报警,review 时"改了 origin 而 tier1 没动"的 diff 看起来完全正常。漂移安静地躺着,直到某天重新生成 diff 文档页,陈旧差异被当成"接入 niceeval 需要改的代码"展示出来,把"零改动"卖点砸掉;或者用户跑 tier 示例,踩到 origin 早就修掉的 bug。到那时离引入漂移的那次改动已经很远,没人记得该同步什么。

值得说清的一点:这条链上有两种性质不同的目录对。**origin → tier1 是 "副本 + 纯新增"**:tier1 对共享文件的改动只有脚手架那几个文件各 2~4 行,应用源码两边完全一致,其余差异全是 tier 私有的新增文件——它本质上就是"origin + 一小层接入 delta"。**tier1 → tier2、tier2 → tier3 是 "副本 + 修改"**:tier2 会改 tier1 带来的 eval 侧文件(`niceeval.config.ts` 加 telemetry、adapter 加 spanMapper),tier3 更是按定义要改应用的 `src/`(把内部可变点暴露成 flags)。两种目录对需要的都是同一个缺失的动词——`下游 rebase 上游`:上游动了,一条命令把本层的 delta 重放到新上游之上。只是原生 `git rebase` 作用于分支,而这里是同一棵树里的目录,原生命令用不上——本方案就是给目录对补上这个动词,顺带给"纯新增"那种目录对加上逐字节铁律的 CI 检查。

## 方案一句话

**用 rebase 的底层机制直接作用于目录树。** git 的 rebase/cherry-pick 每重放一步,内部就是一次"以共同祖先为 base 的三方合并";这个机制不要求输入是分支,`git merge-tree --write-tree --merge-base=<base>`(git ≥ 2.38)可以对任意三棵 tree 使用。于是:

- 每对目录记录一个"上次同步时上游目录的 tree hash"作为 base(相当于 rebase 里的分叉点);
- `tiers:sync` = 一条 `git merge-tree --write-tree --merge-base=<base> <tier树> <上游树>`,把上游自分叉点以来的全部变更重放进 tier,同时保住 tier 的 delta——**这就是 `tier rebase 上游`**,冲突体验也和 rebase 一致(就地留标记,人解完继续);
- 链式同步一条命令跑完:上一对的合并结果树直接作为下一对的上游输入,中途不要求提交;
- CI 用 tree hash 比对做秒级防漂移检查,对 origin → tier1 这种"纯新增"对额外做逐字节 verbatim 校验。

**不维护 overlay 清单**("哪些文件是 tier 私有的"由三方合并自动推导),**patch 只作为同步后自动导出的阅读产物,不作为事实源**。这也是 Google copybara / `git subtree` 解决的"目录级 vendoring + 上游追踪"问题的仓库内轻量版:合并机制 100% 是 git 自己的,脚本只做粘合。

## 为什么这样做(以及否决了什么)

### 否决:把示例做成真分支,用原生 `git rebase`

既然想要的是 rebase,最直觉的做法是让它真的可 rebase:每个示例的 origin 放一条独立分支,tier1 是它之上的接入提交,同步 = 原生 `git rebase`。否决理由:

- **示例必须同时存在于 main 的工作树里。** 文档链接指向真实目录、用户 clone 后并排浏览各层、`gen:diff-code` 直接 diff 两个目录——这些都要求全部代码在同一棵树上共存。分支化之后,还得把每条分支的内容物化回 main 的目录(否则以上全断),于是"分支"与"物化目录"变成双份记账,比现在更糟;
- **分支数量是 示例数 × tier 层数,** 五个示例三四层就是 15+ 条长期分支,rebase 后全部需要 force-push,历史被反复改写,协作成本失控;
- `git subtree split` 能把目录合成出伪分支再 rebase 回填,但那是三步咒语级的操作,比直接对目录树做三方合并绕远得多。

结论:要的是 rebase 的**机制**,不是 rebase 的**命令**。机制(同 base 三方合并)可以脱离分支直接用在目录树上,见"方案一句话"。

### 否决:patch 作为事实源(tier 只存 diff patch,apply 出目录)

即"tier1 只存对 origin 的 diff patch,tier2 存对 tier1 的 patch"(Debian quilt / 内核补丁队列模式)。patch 的"方便阅读"很诱人,但作为**存储格式**有四个硬伤:

- **双事实源,DX 崩坏。** 改接入代码(evals、agents、脚手架几行)时,要么手写 patch 文件——没人受得了;要么改物化目录再重新导出——目录和 patch 变成两份事实源,永远在打架。git history 也不可读了:改一行 eval,commit diff 是"diff 的 diff"。
- **示例必须是可运行、可浏览的真实目录。** 仓库规则要求文档链接指向真实目录,用户会 clone 后直接 `cd examples/zh/tier1/codex-sdk` 跑起来、在 GitHub 上直接读代码(有语法高亮和跳转,patch 文件没有)。物化产物要么提交(回到原点),要么 gitignore(文档链接与 GitHub 浏览全断)。
- **lockfile 无法用 patch 维护。** `pnpm-lock.yaml` 的内容随依赖版本剧烈漂移,patch 很快 apply 失败;它只能由 `pnpm install` 重新生成。
- **堆叠 patch 是出了名的维护地狱。** origin 改一行,可能要连修 tier1、tier2、tier3 三层 patch 的 fuzz/reject。现在的痛是"复制一遍",换成堆叠 patch 后痛变成"手工解 reject",更糟。

**"方便阅读"这个需求单独满足,不必绑架存储格式**:`gen:diff-code` 已经从两个物化目录生成 before/after 阅读页;本方案再让 `tiers:sync` 顺手导出一份 `<name>.patch` 纯阅读件(见下文)。patch 当**输出**,不当**输入**。

### 否决:纯复制 + allowDiff 清单

即维护一份清单声明"哪些文件 tier 私有、哪些允许有差异",同步 = 清单之外的文件从上游整文件复制。比 patch 好,但有两个硬伤:

- **清单要人工维护,且各示例不同**(langgraph 的 `package.json` 是 tier 私有,其它示例的是"共享但微改"),清单本身会漂移;
- **allowDiff 即检查盲区**:`package.json` 一旦列入 allowDiff,origin 给应用加依赖时,检查发现不了 tier1 没跟上。
- 对 tier2/tier3 这种"副本 + 修改"的目录对,清单会膨胀成"每个被 overlay 的文件一条",彻底退化成手工记账。

三方合并没有这些问题:私有文件自动推导,`package.json` 走真合并——origin 的新依赖能不能干净合入 tier1 的 `package.json`,取决于新依赖是否落在 tier 那 +2 行改动的同一位置(两者都紧挨着追加时会冲突,见下文"已知取舍");但即便冲突,也是显式报错,而不是像 allowDiff 清单那样检查不到。

### 采纳三方合并的正面理由

- **改 origin 后各层自动快进**:tier1/tier2 从不改应用 `src/`,所以 `src/` 的变更一路无冲突快进复制;tier3 改过的 `src/` 文件走真三方合并,只有上游改到 tier3 动过的同一区域才需要人工裁决——这正是三方合并存在的意义,覆盖日常绝大多数场景;
- **"origin → tier1 逐字节不变"的铁律从"靠自觉"变成"CI 保证"**:check 模式对 verbatim 契约的目录对做逐字节比对,漂移直接红(见"检查模式");
- **`gen:diff-code`、"接入只要 10-50 行"的验收方式完全不变**:相邻两层仍是完整目录,`diff -r` 照旧;
- **加一层免费获得同样机制**:上游指向上一层即可,形成 origin → tier1 → tier2 → tier3 的链,一条 `tiers:sync` 从头穿到尾。

已知取舍:

- 三方合并按行进行,两边在文件同一位置追加会冲突。这不是理论风险——沙盘验证时就复现了一例:origin 给 `dependencies` 加 `zod`、tier 在同一位置有 `niceeval`,merge-tree 就地留下标记要求人工裁决,体验与 rebase 冲突一致。按现有 diff 形状冲突频率低,且永远是**显式报错**(留标记 + check 拦截)而非静默错合。
- **解决冲突后不能简单重跑合并**:base 没动的情况下,同 base 三方合并会把同一处冲突原样再报一遍(这是合并语义的固有行为,git rebase 靠 `--continue` 记录裁决绕开它)。所以脚本在报冲突时把"这次要合到哪"记进状态文件的 `pending`,人解完标记、提交后重跑 `tiers:sync` 走的是**收尾**而不是重新合并(见"同步算法")。
- 文件重命名被视为"删除 + 新增",无 rename 检测;origin 重命名文件时 tier 侧若改过该文件会报一次冲突,人工确认即可。
- **lockfile 不参与合并**:`pnpm-lock.yaml` 完全由各层自己的 `pnpm install` 生成。上游只动 lockfile 而不动 `package.json` 的变更(比如区间内 `pnpm up`)不会传播到下游——需要时在下游手动 `pnpm install` 即可,这类变更不影响任何展示或断言。
- **verbatim 检查只覆盖 origin → tier1**。tier2/tier3 是"副本 + 修改"(overlay 契约),没有"必须逐字节一致"可言,check 对它们只能保证"上游动了必有同步动作";有人直接改 tier2 里本应跟随 tier1 的文件并提交,机器发现不了,要靠 review 时看 `diffs/<层级>-<name>.patch` 的形状。

## 如何实现

### 状态文件

单独一份 `examples/zh/.tier-sync.json`,**不放进各示例目录**——tier 目录里多任何一个文件都会出现在 `gen:diff-code` 的 before/after 页上,污染"接入只新增了这些文件"的叙事:

```json
{
  "pairs": [
    { "from": "examples/zh/origin/codex-sdk", "to": "examples/zh/tier1/codex-sdk", "contract": "verbatim", "baseTree": "a1b2c3..." },
    { "from": "examples/zh/tier1/codex-sdk",  "to": "examples/zh/tier2/codex-sdk", "contract": "overlay",  "baseTree": "d4e5f6..." },
    { "from": "examples/zh/tier2/codex-sdk",  "to": "examples/zh/tier3/codex-sdk", "contract": "overlay",  "baseTree": "0718ab..." }
  ]
}
```

- `baseTree` 是上次同步时上游目录**剥掉 `pnpm-lock.yaml` 之后**的 git tree hash(lockfile 不参与合并与比对,理由见"已知取舍";剥法是 `git ls-tree` 过滤后 `git mktree`,几毫秒)。base 的**内容**不需要另存——git 对象库天然保管。
- `contract` 声明这对目录的性质:`verbatim`(origin → tier1,"副本 + 纯新增",check 会做逐字节校验)或 `overlay`(tier1 → tier2、tier2 → tier3,"副本 + 修改",不做逐字节校验)。
- 报冲突时脚本会往该 pair 写一个 `pending` 字段(要合到的上游 tree + 是否需要重装依赖),收尾后自动删掉;它是同步中间态,不要手工编辑。
- pairs 的书写顺序不重要——脚本按 from/to 关系做拓扑排序;成环报错。

### 同步算法(`pnpm tiers:sync [name]`)

前置条件:**上游与 tier 两侧目录都必须无未提交改动**(lockfile 除外,它不参与比对)——合并的三个输入都取自提交过的 tree,同步才可复现、可回溯。工作流固定为:改 origin → 提交 → sync(自动穿透整条链)→ review → 一起提交。带 `name` 参数(目录 basename,如 `codex-sdk`)时只同步该应用的链。

对每一对 (from, to),核心是一条 git 命令(三棵输入树都已剥 lockfile):

```sh
git merge-tree --write-tree --merge-base=<baseTree> <tier树> <上游树>
```

输出第一行是合并后的 tree hash(退出码非零表示有冲突,后续行给出冲突文件清单;冲突文件在结果 tree 里已含 `<<<<<<<` 标记)。脚本把结果 tree 检出到 tier 目录(`git archive <tree> | tar -x -C <to>`)即完成同步。逐文件语义与 git merge/rebase 完全一致,等价于下表:

| 上游侧(base → 现在) | tier 侧(base → 现在) | 动作 |
| --- | --- | --- |
| 没变 | 任意 | 不动 |
| 变了 | 未改(== base) | **快进**:整文件复制 |
| 变了 | 改过 | `git merge-file` 三方合并;冲突留标记并报出 |
| 新增 | tier 无同名文件 | 复制过来 |
| 新增 | tier 已有同名文件 | 报冲突(极罕见,人工裁决) |
| 删除 | 未改(== base) | 跟着删 |
| 删除 | 改过 | 报冲突 |

只出现在 tier 侧、base 与上游都没有的文件,自动视为 **tier 私有**,永远不碰——`agents/`、`evals/`、langgraph 的 `package.json` 都落在这条规则里,无需任何配置。

**链式执行**:脚本对 pairs 拓扑排序后依次跑。上一对刚合并出的结果树(已在 git 对象库里)直接作为下一对的上游输入,所以一条命令就能从 origin 穿到 tier3,不要求中途提交;某一对报冲突时,它的整条下游跳过并计入失败,解完再跑一次即可续上。

**冲突与收尾**:冲突文件就地留 `<<<<<<<` 标记,脚本把"这次要合到的上游 tree"记进该 pair 的 `pending`,列出清单并以非零码退出。人解完标记、**提交**之后重跑 `tiers:sync`:脚本看到 `pending` 且标记已清,直接把 `baseTree` 推进到当时要合的上游 tree、补上 `pnpm install` / patch 导出,**不重新合并**——重新合并会把同一处冲突再报一遍(见"已知取舍")。收尾之后若上游又前进了,同一次运行里继续正常合并追平。

其余细节:

- 合并后若 `package.json` / `pnpm-workspace.yaml` 有变动,在 tier 目录执行 `pnpm install` 重新生成 lockfile(lockfile 本身从不进合并);
- 二进制文件 git 无法文本合并,两侧都改过时会作为冲突报出,人工裁决;
- 全部干净(或冲突已收尾)后,把该 pair 的 `baseTree` 更新为上游当前(剥 lockfile 的)tree hash,写回状态文件;
- 收尾时导出阅读件:`git diff <上游tree> <tier tree> > examples/zh/diffs/<层级>-<name>.patch`(如 `tier2-codex-sdk.patch`,同一应用的多层不撞名),这份 patch 是自动再生的**展示产物**,供快速阅读"这一层改了什么",与 `gen:diff-code` 的文档页同源同性质,永远不作为同步输入。

### 检查模式(`pnpm tiers:check`,进 CI)

不做合并,只读,秒级完成,对每对做三件事:

1. `baseTree` ≟ 剥 lockfile 后的 `HEAD:<from>`——不等即"上游变了但 tier 未同步",红,提示跑 `pnpm tiers:sync`;pair 带着未收尾的 `pending` 时同样红;
2. 扫描 tier 跟踪文件中的 `<<<<<<<` 冲突标记,有则红;
3. `contract: "verbatim"` 的对,额外做**逐字节铁律校验**:两侧都存在的同名文件必须完全一致、上游有的文件 tier 必须有(例外:三个脚手架文件、lockfile、`.env.example`)。直接在 tier1 里改共享文件并提交——以前这种漂移完全静默,现在 CI 红。

### 实现载体

- `scripts/sync-tiers.mjs`(约 300 行粘合代码:读写状态文件、剥 lockfile、调 `git merge-tree --write-tree`、拓扑排序、检出结果、pending 收尾、跑 `pnpm install`、导出 patch 阅读件),合并机制本身 100% 由 git 提供,不引第三方依赖;要求 git ≥ 2.38(`merge-tree --write-tree` 的最低版本);
- `package.json` 的 `"tiers:sync"` / `"tiers:check"` 两个 script;
- CI(现有 lint/typecheck 步骤旁)一步 `pnpm tiers:check`。

## 日常工作流(before / after)

改 origin 应用源码——没有这套机制时:

```sh
vim examples/zh/origin/codex-sdk/src/backend/agent.ts
# 然后必须人肉记得 tier1、tier2、tier3 各有一份同样的文件:
cp examples/zh/origin/codex-sdk/src/backend/agent.ts examples/zh/tier1/codex-sdk/src/backend/agent.ts
cp examples/zh/origin/codex-sdk/src/backend/agent.ts examples/zh/tier2/codex-sdk/src/backend/agent.ts
# tier3 改过这个文件?那 cp 会盖掉 tier3 的侵入改造,只能打开手工对……
# 忘了哪一层?没有任何检查会发现,diff 文档页从此静默失真。
```

方案落地后:

```sh
vim examples/zh/origin/codex-sdk/src/backend/agent.ts
git add examples/zh/origin/codex-sdk && git commit -m "..."
pnpm tiers:sync codex-sdk  # 一条命令穿透 tier1 → tier2 → tier3;必要时自动 pnpm install
git diff --stat            # review 各层的机器改动
git add -A examples/zh && git commit -m "sync tiers"
```

改 tier 私有文件(evals / agents / README):直接改,与同步机制无关。

改 tier 层的 overlay 文件(tier2 的 `niceeval.config.ts`、tier3 的 `src/backend/agent.ts` 这类"从上游复制来但本层改过"的文件):也是直接改——这些文件本来就是本层 delta 的一部分,下次上游动到同一文件时三方合并会把两边的改动合在一起,同点冲突时显式报出。

在 tier1/tier2 里改"应该跟上游逐字节一致"的共享文件(比如临时改一行 `src/backend/server.ts` 去验证个问题):这不是方案要覆盖的路径——tier1/tier2 的前提就是不改应用源码。改完把改动誊回对应的 origin 文件、提交、跑 `tiers:sync` 让它"转正"成一次 origin 变更;忘了誊、直接提交,`tiers:check` 的 verbatim 校验会红(tier1),或者留给下次同步撞冲突(tier2)。

反过来,如果是在下游先调试出的修复,想让上游也拿到:同步方向是单向的,没有 backport 命令。得手工把改动誊回上游对应文件、提交、跑 `tiers:sync` 让链条追平——不然下次同步会把这处改动误判成冲突。

origin 给应用加依赖(动了 `package.json`)——三方合并把新依赖行合进 tier1 的 `package.json`(tier 自己的 `"niceeval": "file:../../../.."` 在另一行,不冲突),随后自动 `pnpm install` 更新 lockfile,tier2/tier3 同样各自重装。

忘了同步就提交?CI 的 `tiers:check` 红:

```text
✗ examples/zh/tier1/codex-sdk 落后于 examples/zh/origin/codex-sdk
  base a1b2c3… ≠ 当前 9f8e7d…,运行 pnpm tiers:sync 后重新提交
```

## 验收标准(实现时逐条核对,已全部沙盘验证)

1. 对现有目录初始化 base 后,`tiers:sync` 是无操作(各层已一致),`tiers:check` 绿;
2. 改 origin 任一 `src/` 文件 → **一次** sync 后 tier1/tier2/tier3 同文件全部跟上(tier3 该文件有 overlay 改动时做真合并),中途无需提交;`gen:diff-code` 的 origin↔tier1 页不含该文件;
3. 改 origin `package.json`(加一个依赖)→ sync 后各层 `package.json` 同时含新依赖与本层集成行,lockfile 已重装;
4. 上游与下游在同一文件同一区域都有改动 → sync 报冲突、留标记、记 `pending`、非零退出,该应用的下游层跳过;`tiers:check` 在标记未解前保持红;
5. 解完标记、提交、重跑 `tiers:sync` → 直接收尾(不重报同一冲突),baseTree 前进,同一次运行里下游层继续同步;
6. 直接改 tier1 的共享文件并提交 → `tiers:check` 的 verbatim 校验红,指出具体文件;
7. langgraph(origin 为 Python、`package.json` 为 tier 私有)全流程不误伤 tier 私有文件;
8. `tiers:check` 在 base 落后时红、同步后绿,全程不写任何文件。
