import { RecordSha256 } from "../../definition/digest.ts";

export const AdapterCallPriceBuckets = Object.freeze([
  "input",
  "output",
  "cache-read",
  "cache-write",
] as const);

export type AdapterCallPriceBucket = (typeof AdapterCallPriceBuckets)[number];

interface DecimalParts {
  readonly digits: bigint;
  readonly scale: number;
}

function decimalParts(value: string): DecimalParts {
  const [integer, fraction = ""] = value.split(".");
  return Object.freeze({ digits: BigInt(`${integer}${fraction}`), scale: fraction.length });
}

function canonicalDecimal(parts: DecimalParts): string {
  if (parts.digits === 0n) return "0";
  if (parts.scale === 0) return parts.digits.toString();
  const padded = parts.digits.toString().padStart(parts.scale + 1, "0");
  const integer = padded.slice(0, -parts.scale);
  const fraction = padded.slice(-parts.scale).replace(/0+$/u, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

/** Converts one finite non-negative JS config number to its exact canonical decimal spelling. */
export function canonicalDecimalFromNumber(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const text = value.toString().toLowerCase();
  if (!text.includes("e")) return text.includes(".") ? text.replace(/\.?0+$/u, "") : text;
  const [coefficient, exponentText] = text.split("e");
  const exponent = Number(exponentText);
  if (coefficient === undefined || !Number.isSafeInteger(exponent)) return undefined;
  const [integer, fraction = ""] = coefficient.split(".");
  const digits = `${integer}${fraction}`;
  const point = integer!.length + exponent;
  if (point <= 0) return canonicalDecimal({ digits: BigInt(digits), scale: digits.length - point });
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}`;
  return canonicalDecimal({ digits: BigInt(digits), scale: digits.length - point });
}

export function multiplyCanonicalDecimalPerMillion(rate: string, tokens: number): string {
  const value = decimalParts(rate);
  return canonicalDecimal({ digits: value.digits * BigInt(tokens), scale: value.scale + 6 });
}

export function addCanonicalDecimals(values: readonly string[]): string {
  if (values.length === 0) return "0";
  const parts = values.map(decimalParts);
  const scale = Math.max(...parts.map((value) => value.scale));
  return canonicalDecimal({
    digits: parts.reduce((sum, value) =>
      sum + value.digits * 10n ** BigInt(scale - value.scale), 0n),
    scale,
  });
}

/** Stable digest of the effective profile only; it is intentionally not the catalog snapshot digest. */
export function adapterCallPricingProfileDigest(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return `sha256:${new RecordSha256().update(bytes).digestHex()}`;
}
