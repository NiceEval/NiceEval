export const siteOperations = new Set([
  "site.page.load",
  "site.navigation",
  "site.docs.open",
  "site.install_guide.copy",
]);

export const siteRouteOperations: Record<string, string> = {
  "/": "site.page.load",
  "/en": "site.page.load",
  "/zh": "site.page.load",
  "/[lang]": "site.page.load",
  "/blog": "site.page.load",
  "/en/blog": "site.page.load",
  "/zh/blog": "site.page.load",
  "/[lang]/blog": "site.page.load",
  "/[lang]/blog/[slug]": "site.page.load",
  "/INIT.md": "site.docs.open",
  "/docs": "site.docs.open",
  "/docs/quickstart": "site.docs.open",
  "/docs/introduction": "site.docs.open",
  "/docs/zh/introduction": "site.docs.open",
  "/docs/zh/tutorials/quickstart": "site.docs.open",
};
