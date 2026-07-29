/** Tailwind v4 走 PostCSS 插件接进 Next(node_modules/next/dist/docs/01-app/01-getting-started/11-css.md)。
    站点自己的版式仍写在 app/globals.css,utility 只服务 components/magicui/ 下的复制粘贴组件。 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
