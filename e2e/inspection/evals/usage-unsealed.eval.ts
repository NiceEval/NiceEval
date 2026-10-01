import { usageUnsealedAdapter } from "../adapters/usage-unsealed.ts";

export default usageUnsealedAdapter.defineEval({
  description: "Unread application journal leaves costs unknown after an Eval error",
  test() {
    throw new Error("JOURNAL_NOT_SEALED");
  },
});
