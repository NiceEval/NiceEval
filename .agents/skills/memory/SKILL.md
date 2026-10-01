---
name: memory
description: Record, search, resolve, reopen, supersede, promote, or retire NiceEval development problems, decisions, and reusable insights.
metadata:
  command: pnpm memory
  design: docs/engineering/feedback-memory/README.md
---

# Memory

Read the [Memory design](../../../docs/engineering/feedback-memory/README.md#memory) before changing structured Memory state. Run `pnpm memory --help` for current syntax.

Use Problem for a reproducible problem and its root cause, Decision for an adopted choice, and Insight for know-how that remains useful without a problem lifecycle. Search existing Memory first. Do not create Feedback merely to justify a Memory.

Use native CLI fields instead of assembling metadata or resolution JSON. Create with `pnpm memory add <id> --title <title> --kind <problem|decision|insight|note> --body <path|->`; `--created-at` is optional. Send agent-generated Markdown through stdin with `--body -`; pass a path only when the Markdown already exists as a durable input. Do not create a temporary file solely to pass generated Markdown to the command. Resolve with `pnpm memory resolve <id> --kind <kind> --reason <reason>`; the profile binds the current epoch and validates its managed formal evidence under the publication lease. For author changes, use the managed `memory author set` operation from `--help`: it changes the complete author body, binds owner and author preimage digests, and preserves the current frontmatter history.

Resolve a product Problem as fixed only when a current runner-inventoried case points to it and formal red, green, and complete takeover-certificate receipts validate for that same case/candidate. A diagnose receipt, legacy file metadata, retired case, or free-form proof cannot pass. Promote a conclusion by linking to the exact current Roadmap, Feature, Use Case, or Engineering target; Memory remains historical evidence and never replaces the target contract. Use `retire` when an exact promotion stops being current, and never edit promotion history by hand.

For a fixed Problem, first run `pnpm run repo docs test regression add --help` and publish the case relation plus its managed evidence index. Confirm it with `pnpm run repo docs test show <path#caseId> --json`; only then run `pnpm memory resolve <id> --kind fixed ...`. The Memory command revalidates the persisted red, green, inventory, reliability receipts and certificate under the same Trace lease; Caller-supplied receipt or epoch metadata cannot replace that gate.

Every Memory uses concord.document/v1. Captured records retain their classification without asserting a current lifecycle; activate a classified record explicitly with a reason. Notes remain captured. Superseded Problems are inapplicable records, not fixed Problems. Historical attested resolutions are unverified and never satisfy new fixed evidence gates. Historical Memory is lifecycle evidence, not a generic record that can be physically deleted. Run `check` after mutations and include only the changed Memory files in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm run repo docs trace recover` and retry the public command.
