import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 33000,
    proxy: { "/api": "http://localhost:33001" },
  },
});
