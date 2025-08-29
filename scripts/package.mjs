import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import archiver from "archiver";

const DIST = "dist";
const OUTDIR = "release";

async function getPkg() {
  const raw = await readFile("package.json", "utf8");
  return JSON.parse(raw);
}

async function ensureOutdir() {
  await mkdir(OUTDIR, { recursive: true });
}

async function zipWithArchiver(distDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(archive.pointer()));
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(distDir, false); // zip contents of dist/ at root
    archive.finalize();
  });
}

(async () => {
  if (!existsSync(DIST)) {
    throw new Error("dist/ not found. Run `npm run build` first.");
  }
  const pkg = await getPkg();
  const name = pkg.name || "yaml-form";
  const version = pkg.version || "0.0.0";
  const outName = `${name}-v${version}.zip`;
  const outPath = `${OUTDIR}/${outName}`;

  await ensureOutdir();
  try { await rm(outPath, { force: true }); } catch {}

  const bytes = await zipWithArchiver(DIST, outPath);
  const s = await stat(outPath);

  console.log(`📦 Packed -> ${outPath} (${Math.round(s.size / 1024)} KB, ${bytes} bytes written)`);
})().catch((e) => {
  console.error("Pack failed:", e);
  process.exit(1);
});

