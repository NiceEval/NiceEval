import {
  defineMaterialMatch,
  eventMatch,
  satisfies,
  toolMatch,
  type ManagedEventOccurrences,
  type ManagedToolCalls,
  type MaterialCollection,
  type ReadonlyMaterial,
} from "niceeval/expect";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
declare const value: ReadonlyMaterial<Json>;
const json: Json = value;

interface JsonArray extends ReadonlyArray<InterfaceJson> {}
interface JsonObject { readonly [key: string]: InterfaceJson }
type InterfaceJson = null | boolean | number | string | JsonArray | JsonObject;
declare const interfaceJson: ReadonlyMaterial<InterfaceJson>;
declare const interfaceArray: ReadonlyMaterial<JsonArray>;
const sameInterfaceJson: InterfaceJson = interfaceJson;
const sameInterfaceArray: JsonArray = interfaceArray;
// Standard readonly-array overloads remain available after material transformation.
interfaceArray.toLocaleString("en-US", { style: "decimal" });
interfaceArray.toLocaleString();

declare const fixedTuple: ReadonlyMaterial<readonly ["first", { count: number }]>;
const sameFixedTuple: readonly ["first", { readonly count: number }] = fixedTuple;
// @ts-expect-error Fixed tuples retain their exact length.
const longerTuple: readonly ["first", { readonly count: number }, boolean] = fixedTuple;
declare const optionalTuple: ReadonlyMaterial<[{ count: number }?]>;
const sameOptionalTuple: readonly [{ readonly count: number }?] = optionalTuple;
if (optionalTuple[0] !== undefined) {
  // @ts-expect-error Optional tuple elements remain deeply read-only.
  optionalTuple[0].count = 2;
}
declare const trailingTuple: ReadonlyMaterial<[...Folder[], { count: number }]>;
const sameTrailingTuple: readonly [...ReadonlyMaterial<Folder>[], { readonly count: number }] = trailingTuple;

declare const tuple: ReadonlyMaterial<[string, { nested: { count: number } }, ...Folder[]]>;
const first: string = tuple[0];
const second: number = tuple[1].nested.count;
const rest: ReadonlyMaterial<Folder> = tuple[2];
// @ts-expect-error Tuple positions retain their exact element types.
const wrongFirst: number = tuple[0];
// @ts-expect-error Tuple positions remain read-only.
tuple[0] = "changed";
// @ts-expect-error Tuple elements remain deeply read-only.
tuple[1].nested.count = 2;
// @ts-expect-error Rest tuple elements remain deeply read-only.
tuple[2].entries[0].parent.name = "changed";

interface Folder { name: string; entries: Entry[] }
interface Entry { name: string; parent: Folder; payload: Json }
interface Application {
  history(): MaterialCollection<Json>;
  folders(): MaterialCollection<Folder>;
  root: Folder;
}

defineMaterialMatch<Application, Json>({
  name: "recursive-json",
  read: (ctx) => ctx.history(),
  match: satisfies<ReadonlyMaterial<Json>>("json", () => true),
});

defineMaterialMatch<Application, Folder>({
  name: "recursive-folders",
  read: (ctx) => {
    // @ts-expect-error Reader contexts remain deeply read-only across mutual recursion.
    ctx.root.entries[0].parent.entries[0].name = "changed";
    const result = ctx.folders();
    if (result.state === "complete") {
      // @ts-expect-error Function-returned material items remain deeply read-only.
      result.items[0].value.entries[0].parent.name = "changed";
    }
    return result;
  },
  match: satisfies<ReadonlyMaterial<Folder>>("folder", (folder) => folder.name.length > 0),
});

declare const folder: ReadonlyMaterial<Folder>;
const recursiveName: string = folder.entries[0].parent.entries[0].parent.name;
// @ts-expect-error Recursive arrays do not expose mutators.
folder.entries.push({ name: "entry", parent: { name: "folder", entries: [] }, payload: null });
// @ts-expect-error A recursive material cannot become a mutable DTO.
const mutableFolder: Folder = folder;
// @ts-expect-error No recursion cutoff may make a distant DTO writable.
folder.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.entries[0].parent.name = "changed";

type MutableJson = null | boolean | number | string | MutableJson[] | { [key: string]: MutableJson };
declare const jsonArray: ReadonlyMaterial<MutableJson[]>;
declare const jsonObject: ReadonlyMaterial<{ [key: string]: MutableJson }>;
// @ts-expect-error Mutable JSON arrays become read-only.
jsonArray.push(null);
// @ts-expect-error Mutable JSON object indexes become read-only.
jsonObject.child = null;

interface Leaf { name: string; nested: { count: number } }
interface Collections {
  map: ReadonlyMap<{ id: string }, Leaf>;
  set: ReadonlySet<Leaf>;
  read(input: Leaf): Leaf;
}
declare const collections: ReadonlyMaterial<Collections>;
const mapValue = collections.map.get({ id: "key" });
if (mapValue !== undefined) {
  // @ts-expect-error Map values are deeply read-only.
  mapValue.nested.count = 2;
}
for (const key of collections.map.keys()) key.id = "key-semantics-preserved";
for (const item of collections.set) {
  // @ts-expect-error Set values are deeply read-only.
  item.nested.count = 2;
}
// @ts-expect-error Material maps remain ReadonlyMap.
collections.map.set({ id: "key" }, { name: "leaf", nested: { count: 1 } });
// @ts-expect-error Material sets remain ReadonlySet.
collections.set.add({ name: "leaf", nested: { count: 1 } });
const read: (input: Leaf) => ReadonlyMaterial<Leaf> = collections.read;
const input: Parameters<typeof read>[0] = { name: "input", nested: { count: 1 } };
input.nested.count = 2;
const returned = read(input);
// @ts-expect-error Function results remain deeply read-only.
returned.nested.count = 2;

declare const calls: ReadonlyMaterial<ManagedToolCalls<"turn">>;
declare const events: ReadonlyMaterial<ManagedEventOccurrences<"session">>;
const sameCalls: ManagedToolCalls<"turn"> = calls;
const sameEvents: ManagedEventOccurrences<"session"> = events;
const materialCalls: ReadonlyMaterial<ManagedToolCalls<"turn">> = sameCalls;
const materialEvents: ReadonlyMaterial<ManagedEventOccurrences<"session">> = sameEvents;
// @ts-expect-error Plain arrays do not acquire the managed tool brand.
const forgedCalls: ReadonlyMaterial<ManagedToolCalls> = [];
// @ts-expect-error Plain arrays do not acquire the managed event brand.
const forgedEvents: ReadonlyMaterial<ManagedEventOccurrences> = [];
// @ts-expect-error Managed tool scopes remain distinct.
const sessionCalls: ManagedToolCalls<"session"> = calls;
// @ts-expect-error Managed event scopes remain distinct.
const turnEvents: ManagedEventOccurrences<"turn"> = events;
defineMaterialMatch<{ calls: ManagedToolCalls<"turn"> }>({
  name: "managed-tools",
  read: (ctx) => ctx.calls,
  match: toolMatch("read"),
});
defineMaterialMatch<{ events: ManagedEventOccurrences<"session"> }>({
  name: "managed-events",
  read: (ctx) => ctx.events,
  match: eventMatch("message"),
});

void [json, sameInterfaceJson, sameInterfaceArray, sameFixedTuple, longerTuple, sameOptionalTuple, sameTrailingTuple, first, second, rest, wrongFirst, recursiveName, mutableFolder, materialCalls, materialEvents, forgedCalls, forgedEvents, sessionCalls, turnEvents];
