import { successfulSlowCleanup } from "../fixtures/custom-applications.ts";

export default successfulSlowCleanup.defineEval({
  test(t) {
    let invalidReturnRejected = false;
    try { t.invalidReturn(); } catch (error) { invalidReturnRejected = error instanceof TypeError; }
    if (!invalidReturnRejected) throw new Error("A Boolean return must not impersonate an Assertion handle");
    let asyncReturnRejected = false;
    try { t.invalidAsyncReturn(); } catch (error) { asyncReturnRejected = error instanceof TypeError; }
    if (!asyncReturnRejected) throw new Error("A Promise return must not impersonate an Assertion handle");
    t.hasValue(42);
  },
});
