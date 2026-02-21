// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      // React 17+ için yeni JSX dönüşümünü otomatik algılar
      jsxRuntime: "automatic",
    }),
  ],
  server: {
    port: 5174,   // istersen değiştir
    open: true,   // dev sunucu açıldığında otomatik tarayıcı aç
  },
});
