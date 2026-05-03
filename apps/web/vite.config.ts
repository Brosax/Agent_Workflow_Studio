import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/ws": {
        target: "ws://127.0.0.1:4000",
        ws: true
      }
    }
  }
});

