// Persistent pin 只保护尚未成为 committed Record revision 的显式导入根。receipt 与普通
// read handle 均不能暗中创建 pin；read lease 和 committedRoots 各有自己的 GC 语义。

import { randomUUID } from "node:crypto";
import { LocalStorePhysicalCorruptionError } from "./errors.ts";
import {
  readDirectoryIfPresent,
  readFileIfPresent,
  removeFileIfPresent,
  writeFileExclusively,
} from "./fs.ts";
import { localPinPath, type LocalStorePaths } from "./paths.ts";
import type { LocalStagingProtocol } from "./staging.ts";

const PIN_SCHEMA = "niceeval.record-store-pin/1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface LocalPersistentPinRecord<Descriptor> {
  readonly pinId: string;
  readonly root: Descriptor;
}

interface EncodedPinRecord {
  readonly schema: typeof PIN_SCHEMA;
  readonly pinId: string;
  readonly root: unknown;
}

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function parseEncodedPin(value: unknown): EncodedPinRecord | undefined {
  const schema = valueAt(value, "schema");
  const pinId = valueAt(value, "pinId");
  const root = valueAt(value, "root");
  if (
    schema !== PIN_SCHEMA ||
    typeof pinId !== "string" || !/^[A-Za-z0-9._-]+$/.test(pinId) ||
    root === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ schema, pinId, root });
}

async function readPin<Descriptor>(
  paths: LocalStorePaths,
  pinId: string,
  protocol: LocalStagingProtocol<Descriptor>,
): Promise<LocalPersistentPinRecord<Descriptor> | undefined> {
  const path = localPinPath(paths, pinId);
  const bytes = await readFileIfPresent(path);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "pin",
      path,
      detail: "persistent pin is not valid JSON",
    });
  }
  const encoded = parseEncodedPin(parsed);
  const root = encoded === undefined ? undefined : protocol.decodeReference(encoded.root);
  if (encoded === undefined || root === undefined) {
    throw new LocalStorePhysicalCorruptionError({
      component: "pin",
      path,
      detail: "persistent pin does not match the v1 physical shape",
    });
  }
  return Object.freeze({ pinId: encoded.pinId, root });
}

export class LocalPersistentPin<Descriptor> implements AsyncDisposable {
  #closed = false;
  #closeResult: Promise<void> | undefined;

  private constructor(
    private readonly paths: LocalStorePaths,
    readonly pinId: string,
    readonly root: Descriptor,
  ) {}

  static async create<Descriptor>(
    paths: LocalStorePaths,
    root: Descriptor,
    protocol: LocalStagingProtocol<Descriptor>,
  ): Promise<LocalPersistentPin<Descriptor>> {
    for (;;) {
      const pinId = randomUUID();
      const path = localPinPath(paths, pinId);
      let bytes: Uint8Array;
      try {
        bytes = encoder.encode(JSON.stringify({
          schema: PIN_SCHEMA,
          pinId,
          root: protocol.encodeReference(root),
        }));
      } catch {
        throw new LocalStorePhysicalCorruptionError({
          component: "pin",
          path,
          detail: "protocol reference encoder produced a non-JSON persistent pin",
        });
      }
      // An exclusive create has no post-rename ambiguity: if write/sync/parent-fsync fails,
      // fs.ts closes the handle and removes only this call's newly-created path before throwing.
      // A UUID collision is harmless and cannot overwrite another persistent root.
      if (await writeFileExclusively(path, bytes) === "created") {
        return new LocalPersistentPin(paths, pinId, root);
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = removeFileIfPresent(localPinPath(this.paths, this.pinId));
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export async function listLocalPersistentPins<Descriptor>(
  paths: LocalStorePaths,
  protocol: LocalStagingProtocol<Descriptor>,
): Promise<readonly LocalPersistentPinRecord<Descriptor>[]> {
  const names = await readDirectoryIfPresent(paths.pins);
  const pins: LocalPersistentPinRecord<Descriptor>[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const pinId = name.slice(0, -".json".length);
    if (!/^[A-Za-z0-9._-]+$/.test(pinId)) continue;
    const pin = await readPin(paths, pinId, protocol);
    if (pin === undefined) continue;
    if (pin.pinId !== pinId) {
      throw new LocalStorePhysicalCorruptionError({
        component: "pin",
        path: localPinPath(paths, pinId),
        detail: "persistent pin filename and payload identity disagree",
      });
    }
    pins.push(pin);
  }
  return Object.freeze(pins);
}
