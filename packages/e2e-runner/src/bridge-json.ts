// Bounded, duplicate-key rejecting JSON framing for both bridge directions.
export const BRIDGE_BYTES = 32 * 1024 * 1024;
export function parseBridgeJson(input: string | Uint8Array): unknown {
  if (Buffer.byteLength(input) > BRIDGE_BYTES) throw new Error("bridge JSON exceeds 32 MiB");
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  let offset = 0;
  let nodes = 0;
  const space = () => {
    while (/[\x20\t\r\n]/u.test(text[offset] ?? "x")) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === "\\") offset++;
      else if (char === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    throw new Error("unterminated JSON string");
  };
  const value = (depth: number): unknown => {
    space();
    if (((text[offset] === "{" || text[offset] === "[") && depth >= 64) || ++nodes > 200_000)
      throw new Error("bridge JSON exceeds depth/node budget");
    const char = text[offset];
    if (char === '"') return string();
    if (char === "{") {
      offset++;
      space();
      const output: Record<string, unknown> = Object.create(null);
      const keys = new Set<string>();
      if (text[offset] === "}") {
        offset++;
        return output;
      }
      while (true) {
        space();
        if (text[offset] !== '"') throw new Error("expected JSON object key");
        const key = string();
        if (keys.has(key)) throw new Error("duplicate JSON key");
        keys.add(key);
        space();
        if (text[offset++] !== ":") throw new Error("expected JSON colon");
        output[key] = value(depth + 1);
        space();
        const end = text[offset++];
        if (end === "}") return output;
        if (end !== ",") throw new Error("expected JSON object separator");
      }
    }
    if (char === "[") {
      offset++;
      space();
      const output: unknown[] = [];
      if (text[offset] === "]") {
        offset++;
        return output;
      }
      while (true) {
        if (output.length >= 50_000) throw new Error("bridge JSON exceeds array budget");
        output.push(value(depth + 1));
        space();
        const end = text[offset++];
        if (end === "]") return output;
        if (end !== ",") throw new Error("expected JSON array separator");
      }
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(offset));
    if (number === null) throw new Error("invalid JSON value");
    offset += number[0].length;
    const parsed = Number(number[0]);
    if (!Number.isFinite(parsed)) throw new Error("non-finite JSON number");
    return parsed;
  };
  const result = value(0);
  space();
  if (offset !== text.length) throw new Error("trailing bridge output");
  return result;
}
export function bridgeJson(value: unknown): string {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new Error("bridge request must contain only finite JSON values");
    return item;
  });
  parseBridgeJson(text);
  return text;
}
