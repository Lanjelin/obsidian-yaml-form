import esbuild from "esbuild";
const watch = process.argv.includes("--watch");

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  sourcemap: watch ? "inline" : false,
  external: ["obsidian"],
  logLevel: "info",
  watch: watch && {
    onRebuild(err) { if (err) console.error("❌ rebuild failed", err); else console.log("✅ rebuild"); }
  }
}).then(() => console.log("✅ build")).catch(() => process.exit(1));

