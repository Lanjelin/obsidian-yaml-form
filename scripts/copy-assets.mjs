import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const DIST = "dist";
const ASSETS = ["manifest.json", "styles.css", "README.md"];

async function ensureDistEmpty() {
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true, force: true });
  }
  await mkdir(DIST, { recursive: true });
}

async function copyAssets() {
  for (const f of ASSETS) {
    if (!existsSync(f)) {
      // Create placeholder if missing to avoid build breaks; tweak if undesired.
      await writeFile(`${DIST}/${basename(f)}`, "");
      continue;
    }
    await cp(f, `${DIST}/${basename(f)}`, { recursive: false });
  }
}

const mode = process.argv[2] ?? "all"; // "clean" | "copy" | "all"
if (mode === "clean") {
  await ensureDistEmpty();
} else if (mode === "copy") {
  if (!existsSync(DIST)) await mkdir(DIST, { recursive: true });
  await copyAssets();
} else {
  await ensureDistEmpty();
  await copyAssets();
}
console.log("✅ assets prepared");

