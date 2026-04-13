import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_ORIGIN ?? "http://localhost:4000",
        changeOrigin: true,
        secure: false
      }
    }
  }
});

