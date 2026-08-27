import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const APP_ROOT = fileURLToPath(new URL("./src/view/app/", import.meta.url));

export default defineConfig({
  root: APP_ROOT,
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    sourcemap: false,
    target: "es2022",
  },
});
