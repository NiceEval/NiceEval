import {
  defineAdapter,
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
