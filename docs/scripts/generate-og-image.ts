import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generates the default Open Graph image (1200x630 PNG) for social sharing.
 * Reads the branded SVG from the website repo and converts it to PNG via sharp.
 *
 * Run: bun run docs/scripts/generate-og-image.ts
 */
import sharp from "sharp";

const svgPath = join(import.meta.dirname, "..", "public", "og-image.svg");
const outputPath = join(import.meta.dirname, "..", "public", "og-image.png");

const svg = readFileSync(svgPath, "utf-8");

await sharp(Buffer.from(svg))
  .resize(1200, 630)
  .png({ quality: 90 })
  .toFile(outputPath);

console.log(`Generated OG image: ${outputPath}`);
