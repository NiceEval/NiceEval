import {
  defineAdapter,
  defineJudge,
  defineEval,
  type JudgeDefinition,
  defineAdapterContract,
  type AdapterImplementationInput,
} from "niceeval";
import { satisfies } from "niceeval/expect";

interface Post { id: string; text: string }
const hasText = satisfies<Post>("Post has text", (post) => post.text.length > 0);

const social = defineAdapter({
  name: "typed-social",
  async create(ctx) {
    const signal: AbortSignal = ctx.signal;
    ctx.onCleanup(() => undefined);
    return {
      count: 0,
      increment() {
        this.count += 1;
        // @ts-expect-error Adapter this does not include evaluator methods.
        this.check(1, hasText);
      },
      async post(text: string): Promise<Post> {
        signal.throwIfAborted();
        return { id: "post-1", text };
      },
      echo: <T>(value: T): T => value,
    };
  },
});

social.defineEval({
  async test(t) {
    const post = await t.post("hello");
    t.check(post, hasText);
    const id: string = post.id;
    const same: number = t.echo(42);
    t.increment();
    const increment = t.increment;
    increment();
    // @ts-expect-error Adapter method arguments stay typed.
    await t.post(42);
    // @ts-expect-error Adapter method results stay typed.
    const invalid: number = post.text;
    // @ts-expect-error Adapter does not provide an Agent send method.
    await t.send("hello");
    // @ts-expect-error Pass Eval has no direct Score contribution.
    t.score(1);
    // @ts-expect-error Top-level Adapter fields are read-only on t.
    t.count = 10;
    // @ts-expect-error Generic method relationships are preserved.
    const wrong: number = t.echo("hello");
  },
});

social.defineScoreEval({ async test(t) { t.score(1); t.check(await t.post("hi"), hasText).score(2); } });

// @ts-expect-error Adapters cannot replace core check.
defineAdapter({ name: "collision", create: () => ({ check: () => 1 }) });
// @ts-expect-error score is reserved in both Pass and Score contexts.
defineAdapter({ name: "score-collision", create: () => ({ score: () => 1 }) });
declare const openContext: Record<string, unknown>;
// @ts-expect-error Open string dictionaries cannot prove a collision-free context.
defineAdapter({ name: "dictionary", create: () => openContext });
declare const unionContext: { post(): Post } | { check(): number };
// @ts-expect-error Every union branch must be collision-free.
defineAdapter({ name: "union", create: () => unionContext });
// @ts-expect-error Synchronous thenable fields cannot disappear before validation.
defineAdapter({ name: "thenable", create: () => ({ then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); } }) });

interface Twitter {
  post(text: string): Promise<Post>;
}

const twitterContract = defineAdapterContract<Twitter>({ name: "twitter/v1" });

function defineTwitter<ImplementationContext extends Twitter>(
  input: AdapterImplementationInput<Twitter, ImplementationContext>,
) {
  return twitterContract.implement(input);
}

const shared = defineTwitter({
  name: "with-extra-action",
  create: () => ({
    post: async (text: string) => ({ id: "p", text }),
    generateImage: () => "image.png",
  }),
});
shared.defineEval({ async test(t) {
  t.check(await t.post("hello"), hasText);
  // @ts-expect-error Shared Eval only sees the shared contract, not implementation extras.
  t.generateImage();
} });
// @ts-expect-error A shared implementation must provide the contracted operations.
defineTwitter({ name: "missing-post", create: () => ({ generateImage: () => "image.png" }) });
// @ts-expect-error Implementation-only extras cannot shadow the neutral evaluator.
defineTwitter({ name: "hidden-collision", create: () => ({ post: async (text: string) => ({ id: "p", text }), check: () => 1 }) });
// @ts-expect-error Core identity is reserved independently of the Adapter interface.
defineAdapter({ name: "kind-collision", create: () => ({ evaluationKind: "pass" }) });
// @ts-expect-error Object-prototype names cannot be Adapter actions.
defineAdapter({ name: "prototype-collision", create: () => ({ toString: () => "adapter" }) });


const quality = defineJudge({ name: "post-quality", rubric: "Post text is relevant to the task." });
const qualityAlias: JudgeDefinition = quality;
social.defineEval({ judge: { model: "eval-judge" }, async test(t) {
  const post: Post = await t.post("hello");
  t.check({ task: "greet", post }, qualityAlias).gate(0.8);
} });
social.defineScoreEval({  async test(t) {
  t.judge(await t.post("hello"), quality).score(25).gate(0.7).orStop();
} });
defineEval({  async test(t) {
  const turn = await t.send("hello");
  turn.check({ task: turn.input, reply: turn.message }, quality).gate(0.8);
  turn.judge({ task: turn.input, reply: turn.message }, quality).gate(0.7);
  t.judge(turn.message, quality).gate(0.7).orStop();
  // @ts-expect-error Measurement gates require an explicit minimum.
  t.check(turn.message, quality).gate();
  // @ts-expect-error A bare measurement has no stop condition.
  t.judge(turn.message, quality).orStop();
  // @ts-expect-error Judge sugar cannot evaluate an ordinary Match.
  t.judge({ id: "p", text: "hi" }, hasText);
  // @ts-expect-error Judge requires explicit material as well as its definition.
  turn.judge(quality);
  // @ts-expect-error Thresholds belong to a check, not the reusable Judge.
  quality.atLeast(0.7);
  // @ts-expect-error A gate already declares the single measurement condition.
  t.judge(turn.message, quality).gate(0.7).orStop(0.8);
  // @ts-expect-error A gate may only be configured once.
  t.judge(turn.message, quality).gate(0.7).gate(0.8);
} });
// @ts-expect-error Provider configuration belongs to judgeRuntime, not defineJudge.
defineJudge({ name: "bad-provider", rubric: "quality", model: "provider-model" });
// @ts-expect-error A plain object cannot forge the managed Judge brand.
const forgedJudge: JudgeDefinition = { kind: "judge-match", name: "forged", rubric: "quality", anchors: [], maxMaterialBytes: 1 };
// @ts-expect-error Judge configuration cannot be a definition list.
social.defineEval({ judge: [], async test() {} });

// @ts-expect-error Judge is owned by the Eval context, not an Adapter action.
defineAdapter({ name: "judge-collision", create: () => ({ judge: () => 1 }) });

// @ts-expect-error Eval judge config cannot contain a Match definition.
social.defineEval({ judge: quality, async test() {} });
// @ts-expect-error Official Judge helpers are reserved evaluator operations.
defineAdapter({ name: "factuality-collision", create: () => ({ factuality: () => 1 }) });
social.defineScoreEval({ test(t) {
  t.closeQA({ input: "Capital?", output: "Paris", context: "France: Paris" }).score(2).gate(0.8);
  t.factuality({ input: "Capital?", output: "Paris", expected: "Paris" }).score(1);
  // @ts-expect-error closeQA needs explicit context.
  t.closeQA({ input: "Capital?", output: "Paris" });
} });
defineEval({ async test(t) {
  const turn = await t.send("Capital?");
  turn.factuality({ input: "Capital?", output: turn.message, expected: "Paris" }).gate(1);
  t.newSession().closeQA({ input: "Capital?", output: "Paris", context: "France: Paris" }).gate(1);
  t.faithfulness({ input: "Capital?", output: turn.message, context: ["France: Paris"] }).gate(1);
  // @ts-expect-error Pass Eval measurement cannot contribute points.
  t.factuality({ input: "Capital?", output: turn.message, expected: "Paris" }).score(1);
} });
