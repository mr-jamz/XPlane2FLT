import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Keep production assets relative so the same build works at a GitHub Pages
  // project URL (for example /XPlane2FLT/) and on any other static host.
  base: "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
  },
  build: {
    target: "es2022",
  },
});
