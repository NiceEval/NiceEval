// @concord-file
// @concord-implements docs/feature/inspection/architecture.md
import { utf8ByteLength } from "./bytes.ts";

export function collectionPage<A>(
  values: readonly A[],
  offset: number,
  count: number,
  bytes: number,
  size: (value: A) => number = (value) => utf8ByteLength(JSON.stringify(value)) + 1,
) {
  let end = offset;
  let remaining = bytes;
  while (end < values.length && end - offset < count) {
    const weight = size(values[end]!);
    // An indivisible entry larger than the page gets its own page.
    if (end > offset && weight > remaining) break;
    remaining -= weight;
    end++;
  }
  return { items: values.slice(offset, end), end, omitted: values.length - end };
}

export function numberedCollectionPage<A>(
  values: readonly A[],
  page: number,
  count: number,
  bytes: number,
  size?: (value: A) => number,
) {
  if (!Number.isFinite(bytes)) {
    const offset = Math.min(values.length, page * count);
    return collectionPage(values, offset, count, bytes, () => 0);
  }
  let offset = 0;
  for (let index = 0; index < page && offset < values.length; index++) {
    offset = collectionPage(values, offset, count, bytes, size).end;
  }
  return collectionPage(values, offset, count, bytes, size);
}

export function callPage<A extends { readonly callId: string }, Receipt extends { readonly callId: string }>(
  calls: readonly A[],
  receipts: readonly Receipt[],
  page: number,
  count: number,
  bytes: number,
) {
  const byCall = new Map(receipts.map((receipt) => [receipt.callId, receipt]));
  const { items, omitted } = numberedCollectionPage(calls, page, count, bytes - 32, (call) => {
    const receipt = byCall.get(call.callId);
    return (
      utf8ByteLength(JSON.stringify(call)) + (receipt === undefined ? 0 : utf8ByteLength(JSON.stringify(receipt))) + 2
    );
  });
  return {
    calls: items,
    priceReceipts: items.flatMap((call) => {
      const receipt = byCall.get(call.callId);
      return receipt === undefined ? [] : [receipt];
    }),
    callsTruncated: omitted > 0,
    omittedCallCount: omitted,
  };
}
