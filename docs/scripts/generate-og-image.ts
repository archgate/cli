/**
 * Generates the default Open Graph image (1200×630 PNG) for social sharing.
 * Uses sharp (already a project dependency) to render an SVG template to PNG.
 *
 * Run: bun run docs/scripts/generate-og-image.ts
 */
import sharp from "sharp";
import { join } from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;

const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0a"/>
      <stop offset="100%" style="stop-color:#1a1a2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#818cf8"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-width="0.3" opacity="0.08"/>
  </pattern>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>

  <!-- Accent line at top -->
  <rect x="0" y="0" width="${WIDTH}" height="4" fill="url(#accent)"/>

  <!-- Terminal window decoration -->
  <rect x="80" y="100" width="160" height="32" rx="16" fill="#1e1e2e"/>
  <circle cx="102" cy="116" r="5" fill="#ff5f57"/>
  <circle cx="122" cy="116" r="5" fill="#febc2e"/>
  <circle cx="142" cy="116" r="5" fill="#28c840"/>

  <!-- Brand name -->
  <text x="600" y="270" text-anchor="middle" font-size="80" font-weight="700" fill="#ffffff" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" letter-spacing="-2">Archgate</text>

  <!-- Tagline -->
  <text x="600" y="340" text-anchor="middle" font-size="26" fill="#a0a0b0" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">Architecture Decision Records as Executable Rules</text>

  <!-- Divider -->
  <rect x="520" y="375" width="160" height="2" rx="1" fill="url(#accent)" opacity="0.6"/>

  <!-- Subtitle -->
  <text x="600" y="420" text-anchor="middle" font-size="20" fill="#6366f1" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" letter-spacing="3">CLI DOCUMENTATION</text>

  <!-- URL -->
  <text x="600" y="560" text-anchor="middle" font-size="18" fill="#555" font-family="'SF Mono', 'Cascadia Code', 'Fira Code', monospace">cli.archgate.dev</text>
</svg>`;

const outputPath = join(import.meta.dirname, "..", "public", "og-image.png");

await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outputPath);

console.log(`Generated OG image: ${outputPath}`);
