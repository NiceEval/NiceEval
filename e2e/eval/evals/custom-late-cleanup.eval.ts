import { lateCreateCleanup } from "../fixtures/custom-applications.ts";
export default lateCreateCleanup.defineEval({ test() { throw new Error("Cancelled create cannot enter test"); } });
