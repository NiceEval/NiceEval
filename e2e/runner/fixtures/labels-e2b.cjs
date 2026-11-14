const fs = require("node:fs");
class Sandbox {
  static async create(template, options) {
    fs.writeFileSync(process.env.NICEEVAL_LABEL_RECEIPT, JSON.stringify((options || template).metadata));
    throw new Error("fixture refused allocation after recording Provider creation metadata");
  }
}
module.exports = { Sandbox, CommandExitError: class extends Error {}, NotFoundError: class extends Error {}, RateLimitError: class extends Error {} };
