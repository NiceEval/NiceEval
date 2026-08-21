import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  define: { "import.meta": "{}" },
  build: {
    modulePreload: false,
    outDir: resolve(here, "../client-dist"),
    emptyOutDir: true,
    copyPublicDir: false,
    minify: true,
    rollupOptions: {
      input: resolve(here, "main.tsx"),
      output: {
        format: "iife",
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
