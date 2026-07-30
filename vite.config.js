import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "vote.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
        embed: resolve(import.meta.dirname, "embed.html"),
      },
    },
  },
});
