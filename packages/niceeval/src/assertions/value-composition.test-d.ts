// cases: docs/engineering/testing/unit/assertions.md
// Type-only consumer contracts, checked by package typecheck and excluded from runtime Unit collection.
import { expectTypeOf } from "vitest";
import { countWhere, defineValueMatch, equals, filterWhere, mapEach, mapValue, inOrder, or, not, and, toolMatch, eventMatch, defineScoreMatch, type BooleanMatch, type CollectionValue } from "./match.ts";
import { defineContextMatch, type MaterialCollection } from "./context-match.ts";
import type { AssertionCheck } from "./api.ts";

// Compile against the unchanged public check overload, including collection subtypes.
declare const check: AssertionCheck<"pass">;
const subject = [1, 2] as readonly number[];
const counted = check(subject, countWhere(equals(0), equals(1))).orStop();
expectTypeOf(counted).toEqualTypeOf<Promise<readonly number[]>>();
const mapped = check(subject, mapEach((value: number) => value, equals(subject))).orStop();
expectTypeOf(mapped).toEqualTypeOf<Promise<readonly number[]>>();
const filtered = check(subject, filterWhere(equals(0), equals([]))).orStop();
expectTypeOf(filtered).toEqualTypeOf<Promise<readonly number[]>>();
const material = { state: "complete", items: [{ id: "first", value: 1 }] } as const;
const materialCount = check(material, countWhere(equals(1), equals(1))).orStop();
expectTypeOf(materialCount).toEqualTypeOf<Promise<typeof material>>();

type RecordedActor = { readonly kind: "actor"; readonly hp: number };
type GameEvent = { readonly kind: "event"; readonly actorsAtEnd: CollectionValue<RecordedActor> };
type GameMatchValue = GameEvent | RecordedActor;
const npcMatch = defineValueMatch<GameMatchValue>({ name: "npc", evaluate: (value) => value.kind === "actor" });
declare const hp: (selector: BooleanMatch<GameMatchValue, GameMatchValue>, inner: BooleanMatch<CollectionValue<number>, CollectionValue<number>>) => unknown;
hp(npcMatch, countWhere(equals(0), equals(3)));
const actors: CollectionValue<RecordedActor> = [];
const actorsCount = check(actors, countWhere(npcMatch, equals(3))).orStop();
expectTypeOf(actorsCount).toEqualTypeOf<Promise<readonly RecordedActor[]>>();
const selector = defineValueMatch<RecordedActor>({ name: "alive", evaluate: (value) => value.hp > 0 });
const selected = filterWhere(selector, mapEach(actor => actor.hp, countWhere(equals(0), equals(3))));
expectTypeOf(selected).toEqualTypeOf<BooleanMatch<CollectionValue<RecordedActor>, CollectionValue<RecordedActor>>>();
check(actors, filterWhere(selector, mapEach(actor => actor.hp, countWhere(equals(0), equals(3)))));
const end = mapValue("末态人物", (event: GameEvent) => event.actorsAtEnd, countWhere(npcMatch, equals(3)));
expectTypeOf(end).toEqualTypeOf<BooleanMatch<GameEvent, GameEvent>>();

const stringOnly = defineValueMatch<string>({ name: "string", evaluate: () => true });
// @ts-expect-error A string-only item match cannot inspect number array subjects.
check(subject, countWhere(stringOnly, equals(0)));
// @ts-expect-error Contextual projection items have the actor shape, without invented fields.
filterWhere(selector, mapEach(actor => actor.missingField, countWhere(equals(0), equals(3))));

const ordered = check(subject, inOrder([equals(1), equals(2)])).orStop();
expectTypeOf(ordered).toEqualTypeOf<Promise<readonly number[]>>();
const materialOrder = check(material, inOrder([equals(1), equals(2)])).orStop();
expectTypeOf(materialOrder).toEqualTypeOf<Promise<typeof material>>();
const alternatives = check(subject, or(inOrder([equals(1), equals(2)]), inOrder([equals(2), equals(3)]))).orStop();
expectTypeOf(alternatives).toMatchTypeOf<Promise<readonly number[]>>();
expectTypeOf<Promise<readonly number[]>>().toMatchTypeOf<typeof alternatives>();
const negated = check(subject, not(inOrder([equals(1), equals(2)]))).orStop();
expectTypeOf(negated).toEqualTypeOf<Promise<readonly number[]>>();
const conjunction = check(subject, and(inOrder([equals(1), equals(2)]), inOrder([equals(2), equals(3)]))).orStop();
expectTypeOf(conjunction).toMatchTypeOf<Promise<readonly number[]>>();
expectTypeOf<Promise<readonly number[]>>().toMatchTypeOf<typeof conjunction>();
const reusableSequence = inOrder([equals(1), equals(2)]);
const reused = check(subject, reusableSequence).orStop();
expectTypeOf(reused).toEqualTypeOf<Promise<readonly number[]>>();

type OrderedGameEvent = { readonly type: "heard" | "movement"; readonly actorId: string; readonly adopted: boolean };
const heard = defineValueMatch<OrderedGameEvent>({ name: "heard", evaluate: event => event.type === "heard" });
const adoptedMovement = defineValueMatch<OrderedGameEvent>({ name: "adopted movement", evaluate: event => event.type === "movement" && event.adopted });
declare const gameEvents: readonly OrderedGameEvent[];
declare const gameMaterials: MaterialCollection<OrderedGameEvent>;
const eventOrder = check(gameEvents, inOrder([heard, adoptedMovement])).orStop();
expectTypeOf(eventOrder).toEqualTypeOf<Promise<readonly OrderedGameEvent[]>>();
const eventMaterialOrder = check(gameMaterials, inOrder([heard, adoptedMovement])).orStop();
expectTypeOf(eventMaterialOrder).toEqualTypeOf<Promise<MaterialCollection<OrderedGameEvent>>>();
const sequence: BooleanMatch<CollectionValue<OrderedGameEvent>, CollectionValue<OrderedGameEvent>> = inOrder([heard, adoptedMovement]);
const contextual = defineContextMatch<{ events(): MaterialCollection<OrderedGameEvent> }, CollectionValue<OrderedGameEvent>>({
  name: "events", read: ctx => ({ state: "available", value: ctx.events() }), match: sequence,
});
// @ts-expect-error Context readers cannot be sequence steps.
inOrder([contextual, contextual]);
// @ts-expect-error Tool and value domains cannot mix.
inOrder([toolMatch("tool"), equals(1)]);
// @ts-expect-error Event and value domains cannot mix.
inOrder([eventMatch("message"), equals(1)]);
// @ts-expect-error Managed domains cannot mix.
inOrder([eventMatch("message"), toolMatch("tool")]);
// @ts-expect-error Scores are not Boolean steps.
inOrder([defineScoreMatch<number>({ name: "score", score: () => 1 }), equals(1)]);
// @ts-expect-error A sequence needs at least two steps.
inOrder([equals(1)]);
// @ts-expect-error Structural lookalikes cannot forge the Match brand.
inOrder([{ name: "raw", kind: "boolean", domain: "value" }, equals(1)]);
// @ts-expect-error String-only steps cannot consume a number collection.
check(subject, inOrder([stringOnly, stringOnly]));
// @ts-expect-error Every step must consume the same item type.
inOrder([heard, stringOnly]);
