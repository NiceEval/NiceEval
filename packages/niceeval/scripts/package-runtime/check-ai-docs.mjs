/** Validate the installation guide before packaging or promoting stable content. */
export function validateInitGuide(guide) {
  if (Buffer.byteLength(guide, "utf8") > 16384) throw new Error("INIT.md exceeds 16384 UTF-8 bytes");
  for (const match of guide.matchAll(/https?:\/\/[^\s)<>]+/g)) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.{}-]+\/?$/.test(match[0])) {
      throw new Error(`INIT.md contains an online documentation link: ${match[0]}`);
    }
  }
}
