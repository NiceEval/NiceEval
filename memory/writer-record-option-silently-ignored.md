# Writer CLI silently accepted an unsupported Record source

`exp migration-agent --dry --json --record another-record` and `accept --run <id> --dry --record another-record` both returned success in installed candidate 69f2a5cf89b30f2dd2c827abdc7e41c0cd884f887bbb463dd543e0bbcb16c83f. CLI schemas promised source selection, while Experiment Host always used the canonical Record and overwrote the adoption input with undefined.

Run's contract requires a single project Record (`docs/feature/run/README.md`, `docs/feature/run/cli.md`). The repair removes the CLI options and public Host fields. Adoption itself constructs the canonical project root, so even an extra JavaScript input cannot select an alternate writer path. The public CLI rejects --record through its ordinary unknown-option path.

Owner: `e2e/record/test/writer-source-options.test.ts#neref_df9c70804d807b04aec21afe968788a0`. Inventory: `neinv_PWKHS2P1AX41J1EX`. Managed old-candidate red: `nered_A38G12KK9EV9JAY5`. Fixed candidate SHA-256 072dfef83fffb60d2f6e050ba92ebdea8a9c429f4a49cba7a7583d6e902ea197 passed the target run, three isolated copies, same-copy repetitions and single-case observations. The candidate includes concurrent checkout changes and is not a claim about a commit containing only this fix.

Complete takeover did not pass: Repo default execution passed this owner but failed the pending active reference-only Run reproduction and two Darwin owner-recovery cases. No netake certificate was issued; no regression relation or fixed resolution was fabricated. Keep this Problem open until fresh managed evidence and complete takeover validate. Raw receipts and logs are under `/private/tmp/ne-review/fix-owner-2/source-options-formal-red`, `source-options-green`, and `source-options-takeover`.
