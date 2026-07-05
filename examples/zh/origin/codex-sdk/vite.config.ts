import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 31000,
    proxy: { "/api": "http://localhost:31001" },
  },
});
