import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": `${import.meta.dirname}/src` } },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/index.md": "http://127.0.0.1:8787",
      "/llms.txt": "http://127.0.0.1:8787",
    },
  },
});
