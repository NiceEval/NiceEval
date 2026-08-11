/**
 * Canonical radix construction is shared by the entity catalog, Attempt locator index and
 * committed-root index. Frozen key validation and byte ordering are supplied by protocol;
 * this module never derives an identity by concatenating business fields.
 */
export interface CanonicalRadixKeyContract {
  readonly length: number;
  readonly nibbles: readonly string[];
  readonly compare: (left: string, right: string) => number;
}

export interface CanonicalRadixEntry<Value> {
  readonly key: string;
  readonly value: Value;
}

export interface CanonicalRadixLeaf<Value> {
  readonly kind: "leaf";
  readonly key: string;
  readonly value: Value;
}

export interface CanonicalRadixChild<Value> {
  readonly nibble: string;
  readonly node: CanonicalRadixNode<Value>;
}

export interface CanonicalRadixBranch<Value> {
  readonly kind: "branch";
  /** Absolute path from the root, not a relative compression fragment. */
  readonly prefix: string;
  readonly children: readonly CanonicalRadixChild<Value>[];
}

export type CanonicalRadixNode<Value> = CanonicalRadixLeaf<Value> | CanonicalRadixBranch<Value>;

export type CanonicalRadixBuildIssue =
  | { readonly kind: "invalid-key-contract"; readonly detail: string }
  | { readonly kind: "invalid-key"; readonly key: string }
  | { readonly kind: "duplicate-key"; readonly key: string };

export type CanonicalRadixBuildResult<Value> =
  | { readonly state: "valid"; readonly root: CanonicalRadixNode<Value> }
  | { readonly state: "invalid"; readonly issues: readonly CanonicalRadixBuildIssue[] };

/**
 * Builds the only legal compressed radix shape for a set of full keys. The caller supplies
 * protocol's canonical comparator, so insertion order cannot affect output.
 */
export function buildCanonicalRadix<Value>(
  entries: Iterable<CanonicalRadixEntry<Value>>,
  contract: CanonicalRadixKeyContract,
): CanonicalRadixBuildResult<Value> {
  const contractIssue = validateKeyContract(contract);
  if (contractIssue !== undefined) {
    return { state: "invalid", issues: Object.freeze([contractIssue]) };
  }

  const sorted = [...entries].sort((left, right) => contract.compare(left.key, right.key));
  const issues: CanonicalRadixBuildIssue[] = [];
  let previousKey: string | undefined;
  for (const entry of sorted) {
    if (!isValidKey(entry.key, contract)) {
      issues.push({ kind: "invalid-key", key: entry.key });
    }
    if (previousKey === entry.key) {
      issues.push({ kind: "duplicate-key", key: entry.key });
    }
    previousKey = entry.key;
  }
  if (issues.length > 0) {
    return { state: "invalid", issues: Object.freeze(issues) };
  }

  if (sorted.length === 0) {
    return {
      state: "valid",
      root: branchOf("", []),
    };
  }
  return {
    state: "valid",
    root: buildNonEmpty(sorted, contract),
  };
}

export interface CanonicalRadixProofStep<Value> {
  readonly branch: CanonicalRadixBranch<Value>;
  readonly selectedNibble: string;
  readonly siblings: readonly CanonicalRadixChild<Value>[];
}

export type CanonicalRadixNonMembershipTerminal<Value> =
  | { readonly kind: "empty-root" }
  | { readonly kind: "prefix-mismatch"; readonly branch: CanonicalRadixBranch<Value> }
  | {
      readonly kind: "missing-child";
      readonly branch: CanonicalRadixBranch<Value>;
      readonly nibble: string;
    }
  | { readonly kind: "mismatched-leaf"; readonly leaf: CanonicalRadixLeaf<Value> };

export type CanonicalRadixLookup<Value> =
  | {
      readonly state: "found";
      readonly leaf: CanonicalRadixLeaf<Value>;
      readonly path: readonly CanonicalRadixProofStep<Value>[];
    }
  | {
      readonly state: "absent";
      readonly path: readonly CanonicalRadixProofStep<Value>[];
      readonly terminal: CanonicalRadixNonMembershipTerminal<Value>;
    }
  | { readonly state: "invalid-key"; readonly key: string };

/**
 * Resolves a full key and returns the exact branch path required for membership or authenticated
 * absence. The returned siblings preserve canonical child order.
 */
export function lookupCanonicalRadix<Value>(
  root: CanonicalRadixNode<Value>,
  key: string,
  contract: CanonicalRadixKeyContract,
): CanonicalRadixLookup<Value> {
  if (!isValidKey(key, contract)) return { state: "invalid-key", key };

  const path: CanonicalRadixProofStep<Value>[] = [];
  let current: CanonicalRadixNode<Value> = root;
  while (current.kind === "branch") {
    if (current.children.length === 0) {
      return {
        state: "absent",
        path: Object.freeze(path),
        terminal: { kind: "empty-root" },
      };
    }
    if (!key.startsWith(current.prefix)) {
      return {
        state: "absent",
        path: Object.freeze(path),
        terminal: { kind: "prefix-mismatch", branch: current },
      };
    }

    const selectedNibble = key[current.prefix.length];
    if (selectedNibble === undefined) {
      return {
        state: "absent",
        path: Object.freeze(path),
        terminal: { kind: "prefix-mismatch", branch: current },
      };
    }
    const child = childFor(current.children, selectedNibble);
    if (child === undefined) {
      return {
        state: "absent",
        path: Object.freeze(path),
        terminal: { kind: "missing-child", branch: current, nibble: selectedNibble },
      };
    }

    path.push({
      branch: current,
      selectedNibble,
      siblings: Object.freeze(current.children.filter((candidate) => candidate.nibble !== selectedNibble)),
    });
    current = child.node;
  }

  if (current.key === key) {
    return {
      state: "found",
      leaf: current,
      path: Object.freeze(path),
    };
  }
  return {
    state: "absent",
    path: Object.freeze(path),
    terminal: { kind: "mismatched-leaf", leaf: current },
  };
}

export type CanonicalPaginationResult<Value> =
  | { readonly state: "valid"; readonly pages: readonly (readonly Value[])[] }
  | { readonly state: "invalid-page-size"; readonly pageSize: number };

/**
 * Splits an already canonical sequence without creating a zero-entry page. Non-final pages are
 * always full, which is the shared 128-entry rule when protocol supplies 128 as `pageSize`.
 */
export function paginateCanonicalSequence<Value>(
  values: Iterable<Value>,
  pageSize: number,
): CanonicalPaginationResult<Value> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    return { state: "invalid-page-size", pageSize };
  }

  const sequence = [...values];
  const pages: (readonly Value[])[] = [];
  for (let offset = 0; offset < sequence.length; offset += pageSize) {
    pages.push(Object.freeze(sequence.slice(offset, offset + pageSize)));
  }
  return { state: "valid", pages: Object.freeze(pages) };
}

function buildNonEmpty<Value>(
  entries: readonly CanonicalRadixEntry<Value>[],
  contract: CanonicalRadixKeyContract,
): CanonicalRadixNode<Value> {
  if (entries.length === 1) {
    const entry = entries[0];
    if (entry === undefined) return branchOf("", []);
    return Object.freeze({ kind: "leaf", key: entry.key, value: entry.value });
  }

  const prefix = commonPrefix(entries, contract.length);
  const buckets = new Map<string, CanonicalRadixEntry<Value>[]>();
  for (const entry of entries) {
    const nibble = entry.key[prefix.length];
    if (nibble === undefined) continue;
    const bucket = buckets.get(nibble);
    if (bucket === undefined) {
      buckets.set(nibble, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const children: CanonicalRadixChild<Value>[] = [];
  for (const nibble of contract.nibbles) {
    const bucket = buckets.get(nibble);
    if (bucket === undefined) continue;
    children.push(Object.freeze({ nibble, node: buildNonEmpty(bucket, contract) }));
  }
  return branchOf(prefix, children);
}

function branchOf<Value>(prefix: string, children: readonly CanonicalRadixChild<Value>[]): CanonicalRadixBranch<Value> {
  return Object.freeze({
    kind: "branch",
    prefix,
    children: Object.freeze([...children]),
  });
}

function commonPrefix<Value>(entries: readonly CanonicalRadixEntry<Value>[], maximum: number): string {
  const firstEntry = entries[0];
  if (firstEntry === undefined) return "";
  const first = firstEntry.key;
  let length = 0;
  while (length < maximum) {
    const character = first[length];
    if (character === undefined) break;
    if (entries.some((entry) => entry.key[length] !== character)) break;
    length += 1;
  }
  return first.slice(0, length);
}

function childFor<Value>(
  children: readonly CanonicalRadixChild<Value>[],
  nibble: string,
): CanonicalRadixChild<Value> | undefined {
  return children.find((child) => child.nibble === nibble);
}

function isValidKey(key: string, contract: CanonicalRadixKeyContract): boolean {
  if (key.length !== contract.length) return false;
  const nibbles = new Set(contract.nibbles);
  for (const character of key) {
    if (!nibbles.has(character)) return false;
  }
  return true;
}

function validateKeyContract(contract: CanonicalRadixKeyContract): CanonicalRadixBuildIssue | undefined {
  if (!Number.isSafeInteger(contract.length) || contract.length < 1) {
    return { kind: "invalid-key-contract", detail: "length must be a positive JSON-safe integer" };
  }
  if (contract.nibbles.length < 2) {
    return { kind: "invalid-key-contract", detail: "at least two ordered nibbles are required" };
  }
  const seen = new Set<string>();
  for (const nibble of contract.nibbles) {
    if (nibble.length !== 1 || seen.has(nibble)) {
      return { kind: "invalid-key-contract", detail: "nibbles must be unique one-character values" };
    }
    seen.add(nibble);
  }
  return undefined;
}
