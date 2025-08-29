import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/main.js",
  format: "cjs",
  platform: "browser",
  external: ["obsidian"],
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("✅ watching for changes...");
  } else {
    await esbuild.build(options);
    console.log("✅ build complete");
  }
}

run().catch(() => process.exit(1));

