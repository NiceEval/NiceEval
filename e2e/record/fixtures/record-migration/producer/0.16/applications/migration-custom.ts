import { defineApplication } from "niceeval";

export const migrationCustom = defineApplication({
  name: "record-migration-custom",
  behaviorRevision: "1",
  create: () => ({ value: () => "custom:predecessor" }),
});
