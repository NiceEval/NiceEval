import {
  defineAdapter,
  defineExperiment,
  type JsonValue,
  defineJudge,
  defineEval,
  defineConfig,
  type JudgeDefinition,
  defineAdapterContract,
  type AdapterCleanupContext,
  type AdapterImplementationInput,
  type AdapterAssertionsFactoryContext,
} from "niceeval";
import type { AdapterCleanupContext as AdapterCleanupContextFromSubpath } from "niceeval/adapter";
import type { AdapterAssertionsFactoryContext as AssertionsContextFromSubpath } from "niceeval/adapter";
import { satisfies, defineScoreMatch, defineMaterialMatch, defineContextMatch, type AgentMatchContext, type MaterialCollection, type CollectionValue, toolMatch, eventMatch, type BooleanMatch, countWhere, filterWhere, mapEach, mapValue, equals, not, inOrder, or, and } from "niceeval/expect";
import { OpenAIProvider, OpenRouterProvider, TypesafeProvider, VercelProvider, type JudgeProvider } from "niceeval/judge";

const provider: JudgeProvider = OpenAIProvider({ model: "judge-model" });
defineConfig({ judgeRuntime: provider });
defineConfig({ judgeRuntime: VercelProvider({ model: "gateway-model" }) });
defineConfig({ judgeRuntime: OpenRouterProvider({ model: "router-model", apiKeyEnv: "CUSTOM_KEY" }) });
defineConfig({ judgeRuntime: TypesafeProvider({ model: "jev-model", apiKey: "type-fixture-key" }) });
// @ts-expect-error A project must choose a Provider, not just a model.
defineConfig({ judgeRuntime: "model" });
// @ts-expect-error Legacy structural Judge configuration is not a Provider.
defineConfig({ judgeRuntime: { model: "model" } });
// @ts-expect-error A Provider has a required model.
OpenAIProvider({});
// @ts-expect-error A credential selects exactly one source.
OpenAIProvider({ model: "model", apiKey: "key", apiKeyEnv: "KEY" });
// @ts-expect-error TypeSafe has no server-side output-token limit.
TypesafeProvider({ model: "model", maxOutputTokens: 128 });

interface Post { id: string; text: string }
const hasText = satisfies<Post>("Post has text", (post) => post.text.length > 0);

const social = defineAdapter({
  name: "typed-social",
  async create(ctx) {
    const signal: AbortSignal = ctx.signal;
    ctx.onCleanup(() => undefined);
    ctx.onCleanup((cleanupContext) => {
      const rootExport: AdapterCleanupContext = cleanupContext;
      const adapterExport: AdapterCleanupContextFromSubpath = rootExport;
      const cleanupSignal: AbortSignal = adapterExport.signal;
      void cleanupSignal;
    });
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

const textQuality = defineScoreMatch<Post>({ name: "text quality", score: () => 0.75 });
declare const assertionsFactoryContext: AdapterAssertionsFactoryContext<{ readPost(): Post }>;
const assertionsSubpathContext: AssertionsContextFromSubpath<{ readPost(): Post }> = assertionsFactoryContext;
void assertionsSubpathContext;
const assertedSocial = defineAdapter({
  name: "asserted-social",
  create: () => ({ readPost: (): Post => ({ id: "p", text: "hello" }) }),
  assertions: ({ app, check }) => ({
    hasText() { return check(app.readPost(), hasText); },
    requiredText() { return check(app.readPost(), hasText).gate(); },
    quality(label: string) { return check(app.readPost(), textQuality).label(label); },
  }),
});
assertedSocial.defineEval({
  async test(t) {
    const post: Post = await t.hasText().orStop();
    t.hasText().gate();
    t.quality("quality").gate(0.5);
    const measurement: number = await t.quality("quality").orStop(0.5);
    // @ts-expect-error Pass sugar must not acquire Score capabilities.
    t.hasText().score(1);
    // @ts-expect-error Pass measurement sugar must not acquire Score capabilities.
    t.quality("quality").score(1);
    // @ts-expect-error Measurement gates require a minimum.
    t.quality("quality").gate();
    // @ts-expect-error Sugar preserves method argument types.
    t.quality(1);
    // @ts-expect-error A gate configured in the factory cannot be configured twice.
    t.requiredText().gate();
    void post; void measurement;
  },
});
assertedSocial.defineScoreEval({
  async test(t) {
    t.hasText().score(1).gate();
    t.requiredText().score(1);
    t.quality("quality").gate(0.5).score(2);
    const post: Post = await t.hasText().orStop();
    // @ts-expect-error Boolean gates take no measurement threshold.
    t.hasText().gate(0.5);
    void post;
  },
});

const assertedContract = defineAdapterContract<{ readPost(): Post }>({ name: "asserted-contract" })
  .withAssertions(({ app, check }) => ({ hasText() { return check(app.readPost(), hasText); } }));
const assertedImplementation = assertedContract.implement({
  name: "asserted-implementation", create: () => ({ readPost: (): Post => ({ id: "p", text: "hi" }) }),
});
assertedContract.defineScoreEval({ test(t) { t.hasText().score(1); } });
assertedImplementation.defineEval({ test(t) {
  t.hasText().gate();
  // @ts-expect-error Implementations retain Pass handle restrictions.
  t.hasText().score(1);
} });

// @ts-expect-error A custom assertion must return a check handle, not a Boolean.
defineAdapter({ name: "boolean-sugar", create: () => ({}), assertions: () => ({ invalid: () => true }) });
// @ts-expect-error A custom assertion must synchronously return its handle.
defineAdapter({ name: "async-sugar", create: () => ({}), assertions: ({ check }) => ({ invalid: async () => check({ id: "p", text: "hi" }, hasText) }) });
// @ts-expect-error Sugar cannot replace an app member.
defineAdapter({ name: "app-sugar-collision", create: () => ({ hasText: () => true }), assertions: ({ check }) => ({ hasText: () => check({ id: "p", text: "hi" }, hasText) }) });
// @ts-expect-error Sugar cannot replace core check.
defineAdapter({ name: "core-sugar-collision", create: () => ({}), assertions: ({ check }) => ({ check: () => check({ id: "p", text: "hi" }, hasText) }) });

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
social.defineEval({ judge: "eval-judge", async test(t) {
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
  t.closeQA(defineMaterialMatch<unknown, string>({ name: "answer", read: () => ({ state: "complete", items: [{ id: "p", value: "Paris" }] }), match: satisfies<string>("answer", () => true) }), "Is the capital named?").score(2).gate(0.8);
  t.factuality({ input: "Capital?", output: "Paris", expected: "Paris" }).score(1);
  // @ts-expect-error closeQA requires a source-bound selector and a question.
  t.closeQA({ input: "Capital?", output: "Paris" });
} });
defineEval({ async test(t) {
  const turn = await t.send("Capital?");
  t.closeQA("Does the whole task satisfy the request?").gate(0.8);
  turn.closeQA("Is this turn clear?").gate(0.8);
  turn.closeQA(eventMatch("message", { role: "assistant" }), "Are all explanations clear?").gate(0.8);
  t.closeQA(toolMatch("read"), "Do the inputs and outputs support completion?").gate(0.8);
  const qa = turn.closeQA;
  qa("Is this still the captured turn?").gate(0.8);
  // @ts-expect-error Fixed Agent sugar accepts no extra Match.
  turn.usedNoTools(toolMatch("read"));
  // @ts-expect-error A value predicate has no implicit Agent source.
  turn.closeQA(equals("yes"), "Is this clear?");
  turn.factuality({ input: "Capital?", output: turn.message, expected: "Paris" }).gate(1);
  t.newSession().closeQA(defineMaterialMatch<AgentMatchContext<"session">>({ name: "messages", read: (ctx) => ctx.eventOccurrences, match: eventMatch("message", { role: "assistant" }) }), "Is the capital named?").gate(1);
  t.faithfulness({ input: "Capital?", output: turn.message, context: ["France: Paris"] }).gate(1);
  // @ts-expect-error Pass Eval measurement cannot contribute points.
  t.factuality({ input: "Capital?", output: turn.message, expected: "Paris" }).score(1);
} });

// Compile real collection sugar against the installed public package, without casts or type arguments at callsites.
interface RecordedActor { readonly id: string; readonly hp: number; readonly aliveAtEnd: boolean }
interface GameEvent { readonly actorId: string; readonly actorsAtEnd: MaterialCollection<RecordedActor> }
type GameMatchValue = RecordedActor | GameEvent;
const npc = satisfies<GameMatchValue>("participant", value => "id" in value ? value.id === "a" : value.actorId === "a");
const actorsApplication = defineAdapter({
  name: "collection-types",
  create: () => ({ actors: (): MaterialCollection<RecordedActor> => ({ state: "complete", items: [] }) }),
  assertions: ({ app, check }) => ({
    hp(selector: BooleanMatch<GameMatchValue, GameMatchValue>, inner: BooleanMatch<CollectionValue<number>, CollectionValue<number>>) {
      return check(app.actors(), filterWhere(selector, mapEach((actor: GameMatchValue) => "hp" in actor ? actor.hp : NaN, inner)));
    },
  }),
});
actorsApplication.defineScoreEval({ test(t) {
  t.hp(npc, countWhere(equals(0), equals(3))).gate().score(10);
  const selected: BooleanMatch<CollectionValue<GameMatchValue>, CollectionValue<GameMatchValue>> = filterWhere(npc, mapEach(actor => "hp" in actor ? actor.hp : NaN, countWhere(equals(0), equals(3))));
  void selected;
  const unfinished = mapValue("actors at end", (event: GameEvent) => event.actorsAtEnd, countWhere(npc, not(equals(1))));
  t.check({ actorId: "a", actorsAtEnd: t.actors() }, unfinished).score(10);
} });

// Formal hearing precedes the movement that adopts it, in application commit order.
interface OrderedGameEvent { readonly type: "heard" | "movement"; readonly actorId: string; readonly adopted: boolean }
const formallyHeard = satisfies<OrderedGameEvent>("heard-by-b", event => event.type === "heard" && event.actorId === "b");
const adoptedMovement = satisfies<OrderedGameEvent>("adopted movement", event => event.type === "movement" && event.adopted);
interface GameHistory { history(): MaterialCollection<OrderedGameEvent> }
const orderedApplication = defineAdapter({
  name: "ordered-events-types",
  create: (): GameHistory => ({ history: () => ({ state: "complete", items: [] }) }),
  assertions: ({ app, check }) => ({
    events(match: BooleanMatch<CollectionValue<OrderedGameEvent>, CollectionValue<OrderedGameEvent>>) {
      return check(defineContextMatch<GameHistory, CollectionValue<OrderedGameEvent>>({
        name: "formally committed game history", read: ctx => ({ state: "available", value: ctx.history() }), match,
      }));
    },
    orderedValues(values: readonly number[]) { return check(values, inOrder([equals(1), equals(2)])); },
  }),
});
orderedApplication.defineScoreEval({ async test(t) {
  const numbers: readonly number[] = [1, 2, 3];
  const unchangedNumbers: readonly number[] = await t.check(numbers, inOrder([equals(1), equals(2)])).orStop();
  const alternatives: readonly number[] = await t.check(numbers, or(inOrder([equals(1), equals(2)]), inOrder([equals(2), equals(3)]))).orStop();
  const negated: readonly number[] = await t.check(numbers, not(inOrder([equals(3), equals(1)]))).orStop();
  const conjoined: readonly number[] = await t.check(numbers, and(inOrder([equals(1), equals(2)]), inOrder([equals(2), equals(3)]))).orStop();
  const fromSugar: readonly number[] = await t.orderedValues(numbers).orStop();
  const materials: MaterialCollection<OrderedGameEvent> = await t.check(t.history(), inOrder([formallyHeard, adoptedMovement])).orStop();
  const raw: readonly OrderedGameEvent[] = [];
  const unchangedEvents: readonly OrderedGameEvent[] = await t.check(raw, inOrder([formallyHeard, adoptedMovement])).orStop();
  t.events(inOrder([formallyHeard, adoptedMovement])).gate().score(1);
  // @ts-expect-error A number history cannot be inspected by GameEvent steps.
  t.check(numbers, inOrder([formallyHeard, adoptedMovement]));
  // @ts-expect-error A domain step cannot mix with ordinary values.
  inOrder([toolMatch("move"), formallyHeard]);
  // @ts-expect-error ContextMatch reads a source; it is not an item step.
  inOrder([postFactScore, postFactScore]);
  void [unchangedNumbers, alternatives, negated, conjoined, fromSugar, materials, unchangedEvents];
} });

// Flags infer only from the selected Adapter's synchronous parser.
interface StrategyFlags { strategy: "safe" | "fast"; limit: number }
declare function parseStrategyFlags(input: unknown): StrategyFlags;
const strategyAdapter = defineAdapter({
  name: "strategy",
  parseFlags: parseStrategyFlags,
  create(ctx) {
    const strategy: "safe" | "fast" = ctx.flags.strategy;
    const limit: number = ctx.flags.limit;
    // @ts-expect-error The parser returns a numeric limit.
    const encoded: string = ctx.flags.limit;
    return { read: () => ({ strategy, limit }) };
  },
});
strategyAdapter.defineEval({ test(t) {
  const strategy: "safe" | "fast" = t.flags.strategy;
  const limit: number = t.flags.limit;
  // @ts-expect-error Parsed flags do not have an open index signature.
  t.flags.missing;
  void strategy; void limit;
} });
strategyAdapter.defineScoreEval({ test(t) { const limit: number = t.flags.limit; t.score(limit); } });
const typedExperiment = defineExperiment({ adapter: strategyAdapter, flags: { strategy: "safe", limit: 2 } });
const normalizedLimit: number = typedExperiment.flags.limit;
// @ts-expect-error Flags cannot widen the Adapter's literal strategy type.
defineExperiment({ adapter: strategyAdapter, flags: { strategy: "typo", limit: 2 } });
// An omitted flags object is passed to the parser as {} for defaulting or rejection.
defineExperiment({ adapter: strategyAdapter });
// @ts-expect-error Explicit flags must provide the complete parser result shape.
defineExperiment({ adapter: strategyAdapter, flags: { strategy: "safe" } });
// @ts-expect-error Experiment input uses the same numeric limit as the parser output.
defineExperiment({ adapter: strategyAdapter, flags: { strategy: "safe", limit: "2" } });
// @ts-expect-error Excess flags do not fall back to JSON.
defineExperiment({ adapter: strategyAdapter, flags: { strategy: "safe", limit: 2, typo: true } });
const widenedAttack = { adapter: strategyAdapter, flags: { strategy: "typo" as const, limit: 2 } };
// @ts-expect-error Passing a variable cannot make inference widen the Adapter.
defineExperiment(widenedAttack);

const optionalAdapter = defineAdapter({ name: "optional", parseFlags: (_input: unknown): { strategy?: "safe" } => ({}), create: (ctx) => ({ read: () => ctx.flags.strategy }) });
defineExperiment({ adapter: optionalAdapter });
defineExperiment({ adapter: social, flags: { enabled: false, count: 2, strategy: "safe" } });
// @ts-expect-error Adapters without a parser also reject arrays.
defineExperiment({ adapter: social, flags: { legacy: [true, 2, null] } });
// @ts-expect-error Adapters without a parser reject null.
defineExperiment({ adapter: social, flags: { value: null } });
// @ts-expect-error Adapters without a parser reject nested objects.
defineExperiment({ adapter: social, flags: { value: { enabled: true } } });

const flagsContract = defineAdapterContract<{ read(): number }>({ name: "shared-flags" }).withParseFlags(parseStrategyFlags);
flagsContract.defineEval({ test(t) { const limit: number = t.flags.limit; void limit; } });
const flagsImplementation = flagsContract.implement({ name: "shared-flags-impl", create(ctx) {
  const limit: number = ctx.flags.limit;
  return { read: () => limit };
} });
defineExperiment({ adapter: flagsImplementation, flags: { strategy: "fast", limit: 2 } });
// @ts-expect-error Shared implementations preserve exact parsed flags.
defineExperiment({ adapter: flagsImplementation, flags: { strategy: "typo", limit: 2 } });
const flagsAndAssertions = flagsContract.withAssertions(({ app, check }) => ({
  valid() { return check(app.read(), satisfies<number>("positive", (value) => value > 0)); },
}));
flagsAndAssertions.defineScoreEval({ test(t) { const limit: number = t.flags.limit; t.valid().score(limit); } });
const assertionFlagsAdapter = defineAdapter({
  name: "assertion-flags",
  parseFlags: parseStrategyFlags,
  create: (ctx) => ({ read: () => ctx.flags.limit }),
  assertions: ({ app, check }) => ({ valid() { return check(app.read(), satisfies<number>("positive", (value) => value > 0)); } }),
});
assertionFlagsAdapter.defineEval({ test(t) { const limit: number = t.flags.limit; t.valid(); void limit; } });
void normalizedLimit;

// @ts-expect-error Parser outputs must remain flat, even when all nested values are JSON.
defineAdapter({ name: "nested-flags", parseFlags: (_input: unknown) => ({ nested: { count: 1 } }), create: () => ({}) });
// @ts-expect-error Arrays cannot be flag values.
defineAdapter({ name: "array-member", parseFlags: (_input: unknown) => ({ names: ["a"] }), create: () => ({}) });
// @ts-expect-error Null cannot be a flag value.
defineAdapter({ name: "null-member", parseFlags: (_input: unknown) => ({ value: null }), create: () => ({}) });
// @ts-expect-error Required undefined cannot be a flag value.
defineAdapter({ name: "undefined-member", parseFlags: (_input: unknown) => ({ value: undefined }), create: () => ({}) });
strategyAdapter.defineEval({ test(t) {
  // @ts-expect-error Normalized flags remain read-only.
  t.flags.limit = 3;
} });
// @ts-expect-error An async parser cannot provide synchronous flags.
defineAdapter({ name: "async-flags", parseFlags: async (_input: unknown) => ({ ok: true }), create: () => ({}) });
// @ts-expect-error The parser must return a record, not a primitive.
defineAdapter({ name: "primitive-flags", parseFlags: (_input: unknown) => 1, create: () => ({}) });
// @ts-expect-error JSON flags cannot contain function members.
defineAdapter({ name: "function-flags", parseFlags: (_input: unknown) => ({ nested: { method() {} } }), create: () => ({}) });
// @ts-expect-error Root arrays are not flags records.
defineAdapter({ name: "array-flags", parseFlags: (_input: unknown) => [1], create: () => ({}) });
// @ts-expect-error A shared contract also requires a synchronous parser.
flagsContract.withParseFlags(async (_input: unknown) => ({ strategy: "safe" }));

declare function parseJsonFlags(input: unknown): Record<string, JsonValue>;
// @ts-expect-error Arbitrary JSON parser output is wider than scalar flags.
defineAdapter({ name: "json-flags", parseFlags: parseJsonFlags, create: () => ({}) });


interface PostApp { history(): MaterialCollection<Post> }
const postSource = (match: BooleanMatch<Post, Post>) => defineMaterialMatch<PostApp, Post>({ name: "posts", read: (ctx) => ctx.history(), match });
const sourcedSocial = defineAdapter({
  name: "material-social",
  create: () => ({ history: () => ({ state: "complete" as const, items: [{ id: "p", value: { id: "p", text: "hello" } }] }) }),
  assertions({ check }) {
    return { said(match: BooleanMatch<Post, Post>) { return check(postSource(match)); } };
  },
});
sourcedSocial.defineScoreEval({ test(t) {
  t.said(hasText).gate().score(1);
  t.check(postSource(hasText)).gate().score(1);
  t.closeQA(postSource(hasText), "Is the post clear?").gate(0.8).score(30);
  // @ts-expect-error Existential Boolean gates do not accept a threshold.
  t.said(hasText).gate(0.8);
  // @ts-expect-error Material QA requires a measurement threshold.
  t.closeQA(postSource(hasText), "Is the post clear?").gate();
  // @ts-expect-error A naked item Match has no material source.
  t.closeQA(hasText, "Is the post clear?");
  // @ts-expect-error A forged selector is not a source-bound selector.
  t.closeQA({ kind: "material-selector" }, "Is the post clear?");
} });
sourcedSocial.defineEval({ test(t) {
  t.said(hasText).gate();
  t.closeQA(postSource(hasText), "Is the post clear?").gate(0.8);
  // @ts-expect-error Pass material QA cannot contribute points.
  t.closeQA(postSource(hasText), "Is the post clear?").score(30);
  // @ts-expect-error Pass existence cannot contribute points.
  t.said(hasText).score(1);
} });

const postFactScore = defineContextMatch<PostApp, number>({ name: "post-count", read: (ctx) => ({ state: "available", value: ctx.history().state === "unavailable" ? 0 : 1 }), match: defineScoreMatch({ name: "count-score", score: (n: number) => n }) });
sourcedSocial.defineScoreEval({ test(t) {
  t.check(postFactScore).gate(.8).score(30);
  // @ts-expect-error Context Score is not a Boolean gate.
  t.check(postFactScore).gate();
  // @ts-expect-error closeQA requires a collection, not a scalar fact.
  t.closeQA(postFactScore, "Is it clear?");
  const wrong = defineMaterialMatch<{ unrelated(): string }, string>({ name: "wrong", read: (ctx) => ({ state: "complete", items: [{ id: "w", value: ctx.unrelated() }] }), match: satisfies<string>("string", () => true) });
  // @ts-expect-error This Match requires another application ctx.
  t.check(wrong);
} });
defineEval({ async test(t) {
  const turn = await t.send("read");
  const byTurn = defineMaterialMatch<AgentMatchContext<"turn">>({ name: "turn-only", read: (ctx) => ctx.toolCalls, match: toolMatch("read") });
  turn.check(byTurn).gate();
  // @ts-expect-error A turn reader cannot consume session context.
  t.newSession().check(byTurn);
  // @ts-expect-error An Attempt receiver cannot consume turn context.
  t.closeQA(byTurn, "Is it clear?");
} });

// Ordinary author formulas keep a fixed, auditable weight without a ScoreMatch.
sourcedSocial.defineScoreEval({ test(t) {
  const ratio = 60 / (60 + 120);
  t.score(ratio, { weight: 50 }).label("completion time").gate(.1);
  t.score({ state: "unavailable", reason: "completion-missing" }, { weight: 50 });
  // @ts-expect-error Weight is already configured by the score call.
  t.score(ratio, { weight: 50 }).score(20);
  // @ts-expect-error A string is not a numeric ratio.
  t.score(".5", { weight: 50 });
} });

defineAdapter({ name: "cleanup-types", cleanupTimeoutMs: 120_000, create(ctx) {
  const reason = ctx.signal.reason;
  if (reason?.kind === "timeout") {
    const deadline: number = reason.deadlineAt;
    const source: "flag" | "experiment" | "eval" | "config" = reason.source;
    void [deadline, source];
  }
  ctx.onCleanup(({ signal, timeoutMs, deadlineAt }) => {
    const duration: number = timeoutMs;
    const limit: number = deadlineAt;
    void [signal.aborted, duration, limit];
  });
  return {};
} });
