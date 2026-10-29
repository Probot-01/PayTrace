// Starts the production build (`npm run build` first). Next's standalone output needs the static
// assets copied next to it; the Docker image does this at build time, this script does it locally.
import { cpSync, existsSync } from "node:fs";

if (!existsSync(".next/standalone/server.js")) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
await import("../.next/standalone/server.js");
