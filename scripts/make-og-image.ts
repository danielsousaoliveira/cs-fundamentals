/**
 * Render the site's Open Graph card once, to `public/og.png`.
 *
 * Why a single static card rather than one per page. Per-page images need a
 * canvas renderer running inside the build, and the standard option for
 * Starlight (`astro-og-canvas`) does not work under Astro 7 — its
 * `OGImageRoute()` returns an empty object, so the route has no
 * `getStaticPaths`, and driving its lower-level generator directly then fails
 * inside CanvasKit's font manager. That is a lot of fragility in the build for
 * a preview thumbnail.
 *
 * A single card gets most of the value: Starlight already emits per-page
 * `og:title`, `og:description` and `og:url` from frontmatter, so a shared link
 * shows the right words. Only the picture is generic.
 *
 * `sharp` is a devDependency and the PNG is committed, so nothing runs at build
 * time and CI does not need this. Re-run with `pnpm og:image` after changing
 * the design.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;

/** Kept in sync by eye with tokens.css — this is the only place they are duplicated. */
const COLORS = {
  bg: '#17181c',
  bgTo: '#1e2026',
  accent: '#526fff',
  text: '#ffffff',
  dim: '#aaafbe',
};

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.bg}"/>
      <stop offset="100%" stop-color="${COLORS.bgTo}"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="20" height="${HEIGHT}" fill="${COLORS.accent}"/>

  <text x="90" y="250" font-family="Helvetica, Arial, sans-serif" font-size="82"
        font-weight="700" fill="${COLORS.text}">CS Fundamentals</text>

  <text x="90" y="330" font-family="Helvetica, Arial, sans-serif" font-size="34"
        fill="${COLORS.dim}">Data structures, algorithms and systems —</text>
  <text x="90" y="380" font-family="Helvetica, Arial, sans-serif" font-size="34"
        fill="${COLORS.dim}">derived, visualised, and honest about the trade-offs.</text>

  <!-- A row of array cells: the site's own visual vocabulary, in miniature. -->
  ${[0, 1, 2, 3, 4, 5, 6, 7]
    .map(
      (i) => `<rect x="${90 + i * 78}" y="450" width="64" height="64" rx="8"
        fill="${i === 2 || i === 5 ? COLORS.accent : 'none'}"
        stroke="${i === 2 || i === 5 ? COLORS.accent : '#3a3d47'}" stroke-width="3"/>`,
    )
    .join('\n  ')}
</svg>`;

const out = path.resolve(process.cwd(), 'public/og.png');
fs.mkdirSync(path.dirname(out), { recursive: true });

await sharp(Buffer.from(svg)).png().toFile(out);

const { size } = fs.statSync(out);
console.log(
  `Wrote ${path.relative(process.cwd(), out)} — ${WIDTH}×${HEIGHT}, ${Math.round(size / 1024)} KB`,
);
