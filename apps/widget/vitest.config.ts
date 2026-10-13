import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    environmentOptions: {
      happyDOM: {
        url: "http://localhost:5173/",
        // Iframes get a window but never navigate, so tests stay offline.
        settings: { enableIframePageLoading: true, navigation: { disableChildFrameNavigation: true } },
      },
    },
  },
});
