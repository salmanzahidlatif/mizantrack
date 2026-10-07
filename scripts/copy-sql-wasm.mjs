import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * sql.js fetches its WebAssembly binary over HTTP in the browser, so the file
 * must be served from public/. Copying it on install and before each build
 * keeps it in step with the installed package, rather than committing a binary
 * that can silently go stale.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "node_modules", "sql.js", "dist");
const publicDir = join(root, "public");

const WASM_FILES = ["sql-wasm.wasm", "sql-wasm-browser.wasm"];

if (!existsSync(distDir)) {
	console.warn("[sql-wasm] sql.js is not installed yet; skipping copy.");
	process.exit(0);
}

mkdirSync(publicDir, { recursive: true });

for (const file of WASM_FILES) {
	const source = join(distDir, file);
	if (!existsSync(source)) continue;
	copyFileSync(source, join(publicDir, file));
	console.log(`[sql-wasm] copied ${file} to public/`);
}
