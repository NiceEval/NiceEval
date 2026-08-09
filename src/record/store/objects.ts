// Content-addressed raw object namespace。Store 不解码 graph / payload；协议适配器只负责 descriptor
// 与 raw bytes 的完整性，而本模块负责不覆盖、同 typed ref byte 验证与目录 durability。

import { timingSafeEqual } from "node:crypto";
import {
  readFileIfPresent,
  statIfPresent,
  writeFileExclusively,
} from "./fs.ts";
import { localObjectPath, type LocalStorePaths } from "./paths.ts";

export type LocalObjectVerification =
  | { readonly state: "valid" }
  | { readonly state: "invalid"; readonly detail: string };

/**
 * Descriptor 的 schema 与 media-type 语义住在 protocol。Store 只需要一个已验证的 SHA-256
 * address 和检查 raw bytes 的函数，避免把 frozen protocol 复制成第二套类型。
 */
export interface LocalObjectProtocol<Descriptor> {
  readonly objectAddress: (descriptor: Descriptor) => string | undefined;
  readonly verifyObject: (descriptor: Descriptor, bytes: Uint8Array) => LocalObjectVerification;
}

export type LocalObjectPutResult<Descriptor> =
  | { readonly state: "stored" | "already-present" }
  | {
      readonly state: "invalid-reference" | "typed-ref-byte-conflict";
      readonly ref: Descriptor;
      readonly detail: string;
    }
  | {
      readonly state: "digest-collision";
      readonly ref: Descriptor;
      readonly detail: string;
    };

export type LocalObjectReadResult<Descriptor> =
  | { readonly state: "missing"; readonly ref: Descriptor }
  | { readonly state: "available"; readonly bytes: Uint8Array }
  | { readonly state: "corrupt"; readonly ref: Descriptor; readonly detail: string };

function safeAddress<Descriptor>(
  protocol: LocalObjectProtocol<Descriptor>,
  ref: Descriptor,
): string | undefined {
  const address = protocol.objectAddress(ref);
  return address !== undefined && /^[0-9a-f]{64}$/.test(address) ? address : undefined;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export class LocalObjectStore<Descriptor> {
  constructor(
    private readonly paths: LocalStorePaths,
    private readonly protocol: LocalObjectProtocol<Descriptor>,
  ) {}

  async put(ref: Descriptor, bytes: Uint8Array): Promise<LocalObjectPutResult<Descriptor>> {
    const address = safeAddress(this.protocol, ref);
    if (address === undefined) {
      return { state: "invalid-reference", ref, detail: "descriptor did not yield a v1 SHA-256 object address" };
    }
    const input = this.protocol.verifyObject(ref, bytes);
    if (input.state === "invalid") {
      return { state: "invalid-reference", ref, detail: input.detail };
    }

    const path = localObjectPath(this.paths, address);
    const created = await writeFileExclusively(path, bytes);
    if (created === "created") return { state: "stored" };

    const existing = await readFileIfPresent(path);
    if (existing === undefined) {
      // EEXIST 后的 remove / GC race 只能由 Store barrier 排除；若 backend 使用方没有持有
      // 相应 barrier，就把它视为重试边界，而不是假装写入成功。
      return { state: "typed-ref-byte-conflict", ref, detail: "object disappeared after exclusive-create collision" };
    }
    if (sameBytes(existing, bytes)) return { state: "already-present" };

    const existingVerification = this.protocol.verifyObject(ref, existing);
    if (existingVerification.state === "valid") {
      return {
        state: "digest-collision",
        ref,
        detail: "distinct raw byte sequences both verified for the same typed reference",
      };
    }
    return {
      state: "typed-ref-byte-conflict",
      ref,
      detail: "existing object bytes differ from the requested typed reference",
    };
  }

  async read(ref: Descriptor): Promise<LocalObjectReadResult<Descriptor>> {
    const address = safeAddress(this.protocol, ref);
    if (address === undefined) {
      return { state: "corrupt", ref, detail: "descriptor did not yield a v1 SHA-256 object address" };
    }
    const path = localObjectPath(this.paths, address);
    const metadata = await statIfPresent(path);
    if (metadata === undefined) return { state: "missing", ref };
    if (!metadata.isFile()) {
      return { state: "corrupt", ref, detail: "object address is not a regular file" };
    }
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) return { state: "missing", ref };
    const validation = this.protocol.verifyObject(ref, bytes);
    if (validation.state === "invalid") {
      return { state: "corrupt", ref, detail: validation.detail };
    }
    return { state: "available", bytes };
  }
}
