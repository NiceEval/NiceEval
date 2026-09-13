import { defineAdapter } from "niceeval";

export const migrationCustom = defineAdapter({
  name: "record-migration-custom",
  behaviorRevision: "1",
  create: () => ({ value: () => "custom:current" }),
});
