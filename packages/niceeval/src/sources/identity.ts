import type { Brand } from "effect";

/** Opaque manifest identity for one package in one Run-owned Sources snapshot. */
export const SOURCE_PACKAGE_ITEM_ID_BRAND =
  "@niceeval/sources/SourcePackageItemId" as const;

/** Opaque manifest identity for one file inside one package item. */
export const SOURCE_FILE_ITEM_ID_BRAND =
  "@niceeval/sources/SourceFileItemId" as const;

/** A lower-case SHA-256 hex digest of canonical UTF-8 source text. */
export const SHA256_DIGEST_BRAND = "@niceeval/sources/Sha256Digest" as const;

export type SourcePackageItemId =
  string & Brand.Brand<typeof SOURCE_PACKAGE_ITEM_ID_BRAND>;
export type SourceFileItemId =
  string & Brand.Brand<typeof SOURCE_FILE_ITEM_ID_BRAND>;
export type Sha256Digest = string & Brand.Brand<typeof SHA256_DIGEST_BRAND>;
