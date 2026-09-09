import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createLocalApiPlugin } from "./local-api.mjs";

export default defineConfig({
  plugins: [react(), createLocalApiPlugin()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
