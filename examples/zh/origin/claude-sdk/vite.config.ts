import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 32000,
    proxy: { "/api": "http://localhost:32001" },
  },
});
