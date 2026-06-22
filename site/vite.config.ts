import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Relative base so the build works both at a domain root (custom domain) and
// under a project-pages sub-path (wassgha.github.io/opendex).
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
});
