import { defineConfig } from "vite";

// Two separate IIFE builds into dist/:
//   vite build --mode loader  ->  dist/loader.js  (runs on the customer's page)
//   vite build --mode frame   ->  dist/frame.js and dist/frame.css  (runs in the iframe)
// Neither entry has exports, so the IIFE `name` below is never assigned to a
// global on the host page; Vite only requires it to be set.
export default defineConfig(({ mode }) => {
  if (mode !== "loader" && mode !== "frame") {
    throw new Error(`Unknown build mode "${mode}". Use --mode loader or --mode frame.`);
  }
  const isLoader = mode === "loader";
  return {
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: "dist",
      emptyOutDir: isLoader,
      target: "es2019",
      cssTarget: ["chrome90", "safari14", "firefox90"],
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      lib: {
        entry: isLoader ? "src/loader/index.ts" : "src/frame/index.ts",
        formats: ["iife"],
        name: isLoader ? "DocentLoader" : "DocentFrame",
        fileName: () => (isLoader ? "loader.js" : "frame.js"),
        cssFileName: "frame",
      },
    },
  };
});
