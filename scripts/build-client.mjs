import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outdir = resolve(root, "dist/client");

mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/client/app.ts")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV !== "production",
  outfile: resolve(outdir, "app.js"),
  logLevel: "info",
});

// Copy static assets verbatim.
for (const file of ["index.html", "styles.css"]) {
  copyFileSync(resolve(root, "src/client", file), resolve(outdir, file));
}

console.log("Client build complete →", outdir);
