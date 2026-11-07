# 设计裁决:串行复用那笔 commit 定名「复用 Sandbox 的题间重置点」,禁用「温基线」

**裁决**(2026-07-26,用户拍板):串行复用里公共 setup 完成后落下的那笔 commit,`docs/concepts.md`
总表定名 **复用 Sandbox 的题间重置点 / Between-eval reset point for Sandbox reuse**;正文首次
提到写全名,句内回指写「重置点」。「温基线」进 `docs/writing-rules.json` 的 `bannedTerms`,同批
扫掉正文 35 处(`runner.md`、`feature/sandbox/{README,architecture,serial-reuse}.md`、四篇
`sandbox/use-case/`、`engineering/testing/unit/sandbox.md`)。同批把「热道 / Hot lane」立进总表——
`serial-reuse.md`「N 条热道池」那一节靠它,没有更短的替代。

**曾选方案与否决理由**:「温基线 / Warm baseline」是这个概念在正文里实际通行的写法(35 处),
一度提议反过来把总表改成它、保留短名。用户选了长名:总表的词条要能自解释「这是复用模式下题间
重置到哪里」,`温基线` 三个字读不出这层意思。

**这次暴露的模式**:同一个概念的描述式长名已经死过一次。`abe7b03c` 之前总表立的是
「重置基线 / Reset baseline」,而 `docs/writing-baseline.json` 的 `deadTerms` 里就记着这一条——
立了词、正文一次没用,因为正文自己造了短名。所以立描述式长名的那次改动必须**同批扫正文**,
否则死词守护要到下一次跑 `pnpm test:docs` 才把它抓出来,而正文已经又攒了一批短名。

**波及的机器守护**:`deadTerms` 只查「总表声明了但正文没用」,查不出反向的「正文在用但总表没立」
——后者靠人读。所以正文出现一个总表里没有的词时,只有两条出路:立进总表,或进 `bannedTerms`
并同批扫干净;放着不管不会红灯。长名换短名会把若干行推过 120 列与 140 字线,
`pnpm test:docs` 会逐行点出来,改完跑 `-u` 收紧台账。

**不动的地方**:[reuse-once-setup-supersedes-idempotent-hooks](reuse-once-setup-supersedes-idempotent-hooks.md)
正文与索引行里的「温基线」照原样保留——memory 是过程记录,记的是 2026-07-21 当时的真实写法,
改它等于篡改记录。禁词只作用于 `docs/` 正文。
