import { defineAdapter } from "niceeval";

export const usageUnsealedAdapter = defineAdapter({
  name: "usage-unsealed",
  behaviorRevision: "1",
  create() {
    // Successful creation does not prove that the application journal was read.
    return {};
  },
});
