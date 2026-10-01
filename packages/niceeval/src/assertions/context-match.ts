import { Predicate } from "effect";
import { assertManagedValueMatch, isManagedToolMatch, isManagedEventMatch, type BooleanMatch, type ScoreMatch, type ManagedToolCalls, type ManagedEventOccurrences, type ToolMatch, type EventMatch, type ToolOccurrenceView, type EventOccurrenceView } from "./match.ts";

// A named container keeps recursive array elements deferred until they are read.
interface ReadonlyMaterialArray<T> extends ReadonlyArray<ReadonlyMaterial<T>> {}

export type ReadonlyMaterial<T> =
  T extends ManagedToolCalls | ManagedEventOccurrences ? T
  : T extends (...args: infer A) => infer R ? (...args: A) => ReadonlyMaterial<R>
  : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<K, ReadonlyMaterial<V>>
  : T extends ReadonlySet<infer V> ? ReadonlySet<ReadonlyMaterial<V>>
  : T extends readonly unknown[] ? ReadonlyArray<T[number]> extends Readonly<T>
    ? ReadonlyMaterialArray<T[number]>
    : { readonly [K in keyof T]: ReadonlyMaterial<T[K]> }
  : T extends object ? { readonly [K in keyof T]: ReadonlyMaterial<T[K]> } : T;
export type MatchContext<C> = ReadonlyMaterial<C>;
export interface MaterialItem<T> { readonly id: string; readonly value: T }
export type MaterialCollection<T> =
  | { readonly state: "complete"; readonly items: readonly MaterialItem<T>[] }
  | { readonly state: "partial"; readonly items: readonly MaterialItem<T>[]; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };
export interface MaterialCaptureBudget { readonly maxItems?: number; readonly maxBytes?: number; readonly maxNodes?: number; readonly maxDepth?: number }
export type FactCaptureBudget = Omit<MaterialCaptureBudget, "maxItems">;
export type MatchFact<T> = { readonly state: "available"; readonly value: T } | { readonly state: "unavailable"; readonly reason: string };
const contextBrand: unique symbol = Symbol("niceeval.match.context");
const valueBrand: unique symbol = Symbol("niceeval.match.fact");
export interface MaterialMatch<in C, out T> { readonly kind: "material"; readonly [contextBrand]: (ctx: C) => void; readonly [valueBrand]: T }
export interface ContextBooleanMatch<in C, out T> { readonly kind: "context-boolean"; readonly [contextBrand]: (ctx: C) => void; readonly [valueBrand]: T }
export interface ContextScoreMatch<in C, out T> { readonly kind: "context-score"; readonly [contextBrand]: (ctx: C) => void; readonly [valueBrand]: T }
/** @internal Erased descriptor; only the owning receiver supplies a context. */
export type ContextualMatch = MaterialMatch<never, unknown> | ContextBooleanMatch<never, unknown> | ContextScoreMatch<never, unknown>;
/** @internal Resolved, finite capture bounds. */
export interface ResolvedMaterialCaptureBudget { readonly maxItems: number; readonly maxBytes: number; readonly maxNodes: number; readonly maxDepth: number }
/** @internal Reader declarations never capture an Attempt. */
export interface ContextMatchDefinition {
  readonly name: string;
  readonly kind: ContextualMatch["kind"];
  readonly read: (context: unknown) => unknown;
  readonly match: unknown;
  readonly capture: ResolvedMaterialCaptureBudget;
}
const definitions = new WeakMap<object, ContextMatchDefinition>();
const defaults = { maxItems: 256, maxBytes: 48 * 1024, maxNodes: 16384, maxDepth: 32 };
const maximum = { maxItems: 16384, maxBytes: 4 * 1024 * 1024, maxNodes: 1048576, maxDepth: 64 };
function captureBudget(value: unknown, single: boolean): ResolvedMaterialCaptureBudget {
  const result = { ...defaults, ...(single ? { maxItems: 1 } : {}) };
  if (value === undefined) return Object.freeze(result);
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError("Context Match capture budget must be an object");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(defaults, key) || single && key === "maxItems") throw new TypeError("Unknown Context Match capture budget " + String(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Capture budget fields must be data properties");
    const count: unknown = descriptor.value;
    const field = key as keyof typeof defaults;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0 || count > maximum[field]) throw new TypeError("Capture " + field + " must be a positive integer at most " + maximum[field]);
    result[field] = count;
  }
  return Object.freeze(result);
}
function declare(value: unknown, collection: boolean): ContextualMatch {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError("Context Match definition must be an object");
  const spec = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !["name", "read", "match", "capture"].includes(key) || descriptor === undefined || !("value" in descriptor)) throw new TypeError("Context Match accepts name, read, match and optional capture data properties");
  }
  if (typeof spec.name !== "string" || spec.name.trim() === "" || new TextEncoder().encode(spec.name).length > 128 || /[\u0000-\u001f\u007f]/u.test(spec.name)) throw new TypeError("Context Match name must be nonempty and at most 128 UTF-8 bytes");
  if (typeof spec.read !== "function") throw new TypeError("Context Match requires a synchronous reader");
  let kind: ContextualMatch["kind"] = "material";
  if (!(collection && (isManagedToolMatch(spec.match) || isManagedEventMatch(spec.match)))) {
    const match = assertManagedValueMatch(spec.match, "Context Match definition");
    if (collection && match.kind !== "boolean") throw new TypeError("Material collections require a BooleanMatch");
    if (!collection) kind = match.kind === "score" ? "context-score" : "context-boolean";
  }
  const match = Object.freeze({ kind }) as ContextualMatch;
  definitions.set(match, Object.freeze({ name: spec.name, read: spec.read as ContextMatchDefinition["read"], match: spec.match, kind, capture: captureBudget(spec.capture, !collection) }));
  return match;
}
export function defineMaterialMatch<C, T>(definition: { readonly name: string; readonly read: (ctx: MatchContext<C>) => MaterialCollection<ReadonlyMaterial<T>>; readonly match: BooleanMatch<ReadonlyMaterial<T>, ReadonlyMaterial<T>>; readonly capture?: MaterialCaptureBudget }): MaterialMatch<C, ReadonlyMaterial<T>>;
export function defineMaterialMatch<C>(definition: { readonly name: string; readonly read: (ctx: MatchContext<C>) => ManagedToolCalls; readonly match: ToolMatch; readonly capture?: MaterialCaptureBudget }): MaterialMatch<C, ToolOccurrenceView>;
export function defineMaterialMatch<C>(definition: { readonly name: string; readonly read: (ctx: MatchContext<C>) => ManagedEventOccurrences; readonly match: EventMatch; readonly capture?: MaterialCaptureBudget }): MaterialMatch<C, EventOccurrenceView>;
export function defineMaterialMatch(definition: unknown): ContextualMatch { return declare(definition, true); }
export function defineContextMatch<C, T>(definition: { readonly name: string; readonly read: (ctx: MatchContext<C>) => MatchFact<ReadonlyMaterial<T>>; readonly match: BooleanMatch<ReadonlyMaterial<T>, ReadonlyMaterial<T>>; readonly capture?: FactCaptureBudget }): ContextBooleanMatch<C, ReadonlyMaterial<T>>;
export function defineContextMatch<C, T>(definition: { readonly name: string; readonly read: (ctx: MatchContext<C>) => MatchFact<ReadonlyMaterial<T>>; readonly match: ScoreMatch<ReadonlyMaterial<T>>; readonly capture?: FactCaptureBudget }): ContextScoreMatch<C, ReadonlyMaterial<T>>;
export function defineContextMatch(definition: unknown): ContextualMatch { return declare(definition, false); }
/** @internal Brands are verified without probing application names. */
export function isContextualMatch(value: unknown): value is ContextualMatch { return Predicate.isObject(value) && definitions.has(value); }
/** @internal Private reader access is limited to the authoring receiver. */
export function contextMatchDefinitionOf(match: object): ContextMatchDefinition { const definition = definitions.get(match); if (definition === undefined) throw new TypeError("Expected a defined contextual Match"); return definition; }
