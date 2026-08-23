/**
 * Private exact-decimal primitives for the future cost projection. Monetary
 * inputs are always canonical strings; JavaScript numbers and decimal-library
 * values never enter this boundary.
 */

import {
  makeCanonicalDecimal,
  type CanonicalDecimal,
  type NonNegativeSafeInteger,
} from "../record/family/source-receipt/model.ts";

const TOKENS_PER_MILLION_SCALE = 6;

/** Internal coefficient × 10^-scale representation. */
export interface DecimalCoefficient {
  readonly coefficient: bigint;
  readonly scale: number;
}

/** Internal exact quotient used for a mean before its display rounding. */
export interface DecimalRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly scale: number;
}

/**
 * Reasoning is already included in the recorded output bucket and therefore
 * must never become a second independently priced token bucket.
 */
export const INDEPENDENTLY_BILLABLE_TOKEN_BUCKETS = Object.freeze([
  "input",
  "output",
  "cache-read",
  "cache-write",
] as const);

export type IndependentlyBillableTokenBucket =
  (typeof INDEPENDENTLY_BILLABLE_TOKEN_BUCKETS)[number];

export function isIndependentlyBillableTokenBucket(
  value: string,
): value is IndependentlyBillableTokenBucket {
  return (INDEPENDENTLY_BILLABLE_TOKEN_BUCKETS as readonly string[]).includes(value);
}

/** Parses one validated, non-negative canonical decimal without Number coercion. */
export function parseCanonicalDecimal(value: CanonicalDecimal): DecimalCoefficient {
  const canonical = makeCanonicalDecimal(value);
  if (canonical === undefined) {
    throw new TypeError("Cost decimal must be a non-negative canonical decimal string");
  }
  const point = canonical.indexOf(".");
  const scale = point === -1 ? 0 : canonical.length - point - 1;
  const digits = point === -1 ? canonical : `${canonical.slice(0, point)}${canonical.slice(point + 1)}`;
  return Object.freeze({ coefficient: BigInt(digits), scale });
}

/** Normalizes a non-negative coefficient × 10^-scale back to CanonicalDecimal. */
export function normalizeCanonicalDecimal(value: DecimalCoefficient): CanonicalDecimal {
  if (value.coefficient < 0n) {
    throw new RangeError("Cost decimal coefficient must be non-negative");
  }
  if (!Number.isSafeInteger(value.scale) || value.scale < 0) {
    throw new RangeError("Cost decimal scale must be a non-negative safe integer");
  }
  if (value.coefficient === 0n) return canonicalDecimal("0");

  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }

  const digits = coefficient.toString();
  const text = scale === 0
    ? digits
    : digits.length > scale
    ? `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`
    : `0.${"0".repeat(scale - digits.length)}${digits}`;
  return canonicalDecimal(text);
}

/** Adds canonical amounts exactly. An empty sequence has the valid amount zero. */
export function addCanonicalDecimals(
  values: readonly CanonicalDecimal[],
): CanonicalDecimal {
  return normalizeCanonicalDecimal(addDecimalCoefficients(values.map(parseCanonicalDecimal)));
}

/** Adds non-negative decimal coefficients exactly, retaining the shared scale. */
export function addDecimalCoefficients(
  values: readonly DecimalCoefficient[],
): DecimalCoefficient {
  if (values.length === 0) return Object.freeze({ coefficient: 0n, scale: 0 });
  const scale = Math.max(...values.map((value) => checkedScale(value.scale)));
  const coefficient = values.reduce(
    (total, value) => total + checkedCoefficient(value) * tenTo(scale - checkedScale(value.scale)),
    0n,
  );
  return Object.freeze({ coefficient, scale });
}

/** Multiplies two canonical amounts exactly, without accepting Number operands. */
export function multiplyCanonicalDecimals(
  left: CanonicalDecimal,
  right: CanonicalDecimal,
): CanonicalDecimal {
  const first = parseCanonicalDecimal(left);
  const second = parseCanonicalDecimal(right);
  return normalizeCanonicalDecimal({
    coefficient: first.coefficient * second.coefficient,
    scale: first.scale + second.scale,
  });
}

/** Multiplies one canonical amount by a recorded non-negative integer quantity. */
export function multiplyCanonicalDecimalByInteger(
  value: CanonicalDecimal,
  multiplier: NonNegativeSafeInteger,
): CanonicalDecimal {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0) {
    throw new TypeError("Cost quantity must be a non-negative safe integer");
  }
  const decimal = parseCanonicalDecimal(value);
  return normalizeCanonicalDecimal({
    coefficient: decimal.coefficient * BigInt(multiplier),
    scale: decimal.scale,
  });
}

/**
 * Prices an exact recorded token count against a canonical per-million amount.
 * The fixed 10^6 unit preserves a terminating decimal; arbitrary token units
 * are intentionally unsupported until a public pricing contract exists.
 */
export function costForPerMillionTokens(
  amountPerMillion: CanonicalDecimal,
  tokens: NonNegativeSafeInteger,
): CanonicalDecimal {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new TypeError("Recorded token quantity must be a non-negative safe integer");
  }
  const decimal = parseCanonicalDecimal(amountPerMillion);
  return normalizeCanonicalDecimal({
    coefficient: decimal.coefficient * BigInt(tokens),
    scale: decimal.scale + TOKENS_PER_MILLION_SCALE,
  });
}

/** Turns an exact decimal into an exact rational without Number coercion. */
export function rationalFromDecimal(value: DecimalCoefficient): DecimalRational {
  return Object.freeze({
    numerator: checkedCoefficient(value),
    denominator: 1n,
    scale: checkedScale(value.scale),
  });
}

/** Divides an exact decimal by a positive integral denominator for a mean. */
export function divideDecimalCoefficient(
  value: DecimalCoefficient,
  denominator: number,
): DecimalRational {
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("Cost mean denominator must be a positive safe integer");
  }
  return Object.freeze({
    numerator: checkedCoefficient(value),
    denominator: BigInt(denominator),
    scale: checkedScale(value.scale),
  });
}

/**
 * Rounds a non-negative rational to a Profile display scale. All monetary
 * inputs are non-negative, so half-away-from-zero is exact half-up here.
 */
export function roundDecimalRationalHalfAway(
  value: DecimalRational,
  decimalPlaces: number,
): CanonicalDecimal {
  if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 9) {
    throw new RangeError("Cost display decimalPlaces must be an integer from 0 through 9");
  }
  if (value.numerator < 0n || value.denominator <= 0n) {
    throw new RangeError("Cost rational must be non-negative with a positive denominator");
  }
  const scale = checkedScale(value.scale);
  const scaledNumerator = value.numerator * tenTo(decimalPlaces);
  const scaledDenominator = value.denominator * tenTo(scale);
  const coefficient = (scaledNumerator * 2n + scaledDenominator) / (scaledDenominator * 2n);
  return normalizeCanonicalDecimal({ coefficient, scale: decimalPlaces });
}

function tenTo(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError("Cost decimal exponent must be a non-negative safe integer");
  }
  return 10n ** BigInt(exponent);
}

function checkedCoefficient(value: DecimalCoefficient): bigint {
  if (value.coefficient < 0n) throw new RangeError("Cost decimal coefficient must be non-negative");
  return value.coefficient;
}

function checkedScale(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Cost decimal scale must be a non-negative safe integer");
  }
  return value;
}

function canonicalDecimal(value: string): CanonicalDecimal {
  const canonical = makeCanonicalDecimal(value);
  if (canonical === undefined) {
    throw new RangeError("Cost decimal result exceeds canonical decimal limits");
  }
  return canonical;
}
