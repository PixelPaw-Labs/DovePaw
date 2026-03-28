import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const root = import.meta.dirname;
const chatbot = resolve(root, "chatbot");

export default defineConfig({
  plugins: [react()],
  test: {
    root: chatbot,
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    alias: {
      "@": chatbot,
      "@@": root,
    },
  },
  resolve: {
    alias: {
      "@": chatbot,
      "@@": root,
    },
  },
});
