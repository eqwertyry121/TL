import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" && process.env.GITHUB_ACTIONS ? "/TL/admin/" : "/",
  plugins: [react()],
}));
