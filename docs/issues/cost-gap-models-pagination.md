# Cost gap model lists have no page bound or continuation

## Observation

`attempt.usage` and `experiment.get` cost summaries return `totalCosts.gaps[].models` as a `readonly string[]` with every unpriced model name, deduplicated across the whole ledger and repeated in full on every page. There is no byte budget, item limit or continuation for this list. Its only bound is a per-item 8,192-byte check in the Inspection result codec (`packages/niceeval/src/inspection/results.ts`). A model name above 8,192 bytes is recorded correctly but cannot be read back through `show`, and a ledger with many distinct unpriced models makes every page carry the whole list.

## Expected

Like `calls` (128 entries / 128 KiB per page, oversized single entries on their own page), the unpriced-model diagnostic should be complete and losslessly readable, with page-level bounds instead of per-value caps or truncation.

## Impact

- Very long model identifiers make cost summaries unreadable instead of degrading.
- Ledgers with many distinct unpriced models inflate every cost-summary page.

## Reproduction

Publish adapter usage whose model name is ~1 MiB, then `niceeval show <locator> usage --json`: the Record write succeeds and the read fails at `totalCosts.gaps[0].models[0]`.

## Provenance

Found on 2026-11-23 while removing the 256-byte adapter-usage identity limit from the Record schema.
