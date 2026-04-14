import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  loader: {
    ".html": "text",
    // .js files under src/web/js/ are imported as text strings, not as modules.
    // This only affects explicitly imported .js files; .ts source files use the ts loader.
    ".js": "text",
  },
});
