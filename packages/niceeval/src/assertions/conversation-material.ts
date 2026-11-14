import type { StreamEvent } from "../o11y/types.ts";
import type { JsonValue } from "../shared/types.ts";

/** Private capabilities prevent ordinary objects from impersonating conversation handles. */
const readers = new WeakMap<object, () => JsonValue>();
const projections = new WeakSet<object>();
export function bindConversationMaterial<T extends object>(handle: T, read: () => JsonValue): T {
  readers.set(handle, read);
  return handle;
}
export function conversationMaterialOf(value: unknown): JsonValue | undefined {
  return typeof value === "object" && value !== null ? readers.get(value)?.() : undefined;
}
export function copyConversationProjection(from: object, to: object): void {
  if (projections.has(from)) projections.add(to);
}

export function projectConversation(
  turns: readonly {
    readonly events: readonly StreamEvent[];
    readonly partial: readonly string[];
    readonly reply: string;
  }[],
): JsonValue {
  const records: JsonValue[] = [];
  for (const turn of turns) {
    if (turn.partial.length > 0) records.push({ kind: "partial", reasons: [...turn.partial] });
    let finalIndex = -1;
    turn.events.forEach((event, index) => {
      if (event.type === "message" && event.role === "assistant") finalIndex = index;
    });
    turn.events.forEach((event, index) => {
      if ((event.truncated?.length ?? 0) > 0 || (event.redacted?.length ?? 0) > 0)
        records.push({
          kind: "partial",
          eventIndex: index,
          truncated: event.truncated?.map((item) => ({ path: item.path, originalBytes: item.originalBytes })) ?? [],
          redacted: [...(event.redacted ?? [])],
        });
      if (event.type === "message")
        records.push({
          kind: event.role === "user" ? "user-input" : index === finalIndex ? "final-reply" : "assistant-message",
          text: event.text,
        });
      else if (event.type === "operation.started")
        records.push({
          kind: "tool-call",
          id: event.operationId,
          name: event.operation.name,
          input: event.operation.kind === "tool" ? JSON.stringify(event.operation.input) : "",
          status: "started",
        });
      else if (event.type === "operation.finished")
        records.push({
          kind: "tool-result",
          id: event.operationId,
          status: event.status,
          output: JSON.stringify(event.output ?? null),
        });
      else if (event.type === "input.requested")
        records.push({ kind: "input-request", request: JSON.parse(JSON.stringify(event.request)) as JsonValue });
    });
    if (finalIndex < 0 && turn.reply !== "") records.push({ kind: "final-reply", text: turn.reply });
  }
  const value = {
    kind: "conversation-material",
    records,
    omissions: [],
  };
  projections.add(value);
  return value;
}

/** Trim only authenticated projections; arbitrary author data and protected records stay intact. */
export function trimConversationMaterial<T>(material: T, maximumBytes: number, encode: (value: T) => string): T {
  if (!containsConversationMaterial(material)) return material;
  const candidates: {
    parent: Record<string, unknown>;
    key: string;
    text: string;
    path: string;
    priority: number;
    projection: { omissions: JsonValue[] };
  }[] = [];
  const clone = (value: unknown, path: string): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((child, index) => clone(child, `${path}/${index}`));
    // Judge images are opaque and have no own data properties.
    if (Reflect.ownKeys(value).length === 0) return value;
    const output = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        clone(child, `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`),
      ]),
    );
    if (projections.has(value)) {
      projections.add(output);
      const records = output.records as Record<string, unknown>[];
      const projection = output as { omissions: JsonValue[] };
      records.forEach((record, index) => {
        const key =
          record.kind === "tool-result"
            ? "output"
            : record.kind === "tool-call"
              ? "input"
              : record.kind === "assistant-message"
                ? "text"
                : undefined;
        if (key !== undefined && typeof record[key] === "string")
          candidates.push({
            parent: record,
            key,
            text: record[key],
            path: `${path}/records/${index}/${key}`,
            priority: key === "output" ? 0 : key === "input" ? 1 : 2,
            projection,
          });
      });
    }
    return output;
  };
  const output = clone(material, "") as T;
  const size = () => new TextEncoder().encode(encode(output)).length;
  if (size() <= maximumBytes) return material;
  const length = (value: string) => new TextEncoder().encode(value).length;
  candidates.sort((a, b) => a.priority - b.priority || (a.priority < 2 ? length(b.text) - length(a.text) : 0));
  for (const candidate of candidates) {
    const points = Array.from(candidate.text);
    const originalBytes = length(candidate.text);
    const omissions = candidate.projection.omissions;
    const omissionIndex = omissions.length;
    const apply = (keep: number) => {
      const head = points.slice(0, Math.ceil(keep / 2)).join("");
      const tail = points.slice(points.length - Math.floor(keep / 2)).join("");
      const omittedBytes = originalBytes - length(head) - length(tail);
      candidate.parent[candidate.key] =
        `${head}[niceeval omitted ${omittedBytes} UTF-8 bytes at ${candidate.path}]${tail}`;
      omissions[omissionIndex] = { path: candidate.path, omittedBytes };
    };
    if (originalBytes <= length(`[niceeval omitted ${originalBytes} UTF-8 bytes at ${candidate.path}]`)) continue;
    apply(0);
    if (size() > maximumBytes) continue;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      apply(middle);
      if (size() <= maximumBytes) low = middle;
      else high = middle - 1;
    }
    apply(low);
    break;
  }
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(output);
  return output;
}

export function containsConversationMaterial(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (projections.has(value)) return true;
  return Object.values(value).some(containsConversationMaterial);
}
