# t.judge.agent 默认材料写死成 diff → 对话型 eval 误判 0 分

## 现象

`image-understanding.eval.ts` 里助手已经清楚描述了图片(「蓝色背景、中间一个白色方块」),但

```ts
t.judge.agent("助手是否描述了这张图片的内容(蓝色背景、中间一个白色方块)?").atLeast(0.7);
```

judge 给 0 分,理由是「本次运行没有产生任何文件改动,未提供任何关于图片内容的描述,属于答非所问」。
judge 根本没看到助手的回复。

## 根因

`src/scoring/judge.ts` 的 `materialFor(ctx, on)`:没传 `on` 时,**默认材料写死成 `diffMaterial(ctx)`**
(沙箱里 agent 产出的文件)。纯对话 eval 不往沙箱写文件 → `diffMaterial` 返回字面量
`"(本次运行没有产生任何文件改动)"` → judge 拿这句当材料 → 必然判 0。

对比:`t.judge.score(rubric)` 默认用 `deps.getReply()`(最后一条回复),所以 score 在对话 eval 上是对的;
只有 `agent` 这条把「coding agent 产出 = 文件」的假设写死进了通用方法。

## 修法

`materialFor` 默认分支改成「有文件就用 diff,没文件退回 `deps.getReply()`」:

```ts
if (Object.keys(ctx.diff.generatedFiles).length > 0) return diffMaterial(ctx);
return deps.getReply();
```

coding agent(产文件)行为不变;对话型 agent 现在 judge 读到的是真实回复。适用于任何
`judge.agent` 不显式传 `on` 的场景。教训:niceeval 是**通用** agent eval,judge/scoring 默认值不能
假设被测对象一定写文件(参见 [[events-user-message-and-source-loc]] 同类「core 不该绑定某种 agent 形态」)。
