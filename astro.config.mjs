// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from 'rehype-mermaid';

import { buildSidebar } from './src/lib/sections.ts';

const SITE = 'https://danielsousaoliveira.github.io';
const BASE = '/cs-fundamentals';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',

  markdown: {
    // Astro 7 defaults to the Sätteri engine, which does NOT run remark/rehype
    // plugins — setting `markdown.remarkPlugins` there fails silently. Opting
    // into the unified processor is what makes the maths actually render.
    //
    // Complexity bounds get derived on these pages, not asserted, and that needs
    // real Σ notation. KaTeX runs at build time: costs CSS, ships zero JS.
    // The engineering sections are full of architecture that only makes sense
    // as a picture. `strategy: 'inline-svg'` renders each diagram at build time
    // into inline SVG, so a page with six diagrams still ships zero runtime
    // JavaScript — the same trade KaTeX makes below.
    //
    // It drives Playwright's Chromium to do the rendering, which is already a
    // devDependency for the e2e suite. That is a real build-time cost and a
    // real CI dependency: `deploy.yml` installs the browser before building.
    //
    // Ordered before rehypeKatex only for determinism; they touch disjoint
    // nodes (```mermaid fences vs. math nodes) so the order is not load-bearing.
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [
        [
          rehypeMermaid,
          {
            strategy: 'inline-svg',
            // These must be literal colours, not `var()` references. Mermaid
            // parses each one and derives shades from it (borders are the fill
            // adjusted for lightness), so a `var()` throws "Unsupported color
            // format" at build time. Fails loudly, at least.
            //
            // Consequence: a build-time render cannot itself be theme-aware.
            // The palette below matches the dark theme — the site's default —
            // and `tokens.css` overrides it for light mode via `.mermaid`
            // rules. The hexes here are duplicated from the dark-mode values
            // in tokens.css; that file's `.mermaid` block is the other half of
            // this pair and says so.
            mermaidConfig: {
              theme: 'base',
              themeVariables: {
                background: '#17181c',
                primaryColor: '#1e3a5f',
                primaryTextColor: '#9ecbff',
                primaryBorderColor: '#4493f8',
                secondaryColor: '#2a2d36',
                tertiaryColor: '#22242b',
                lineColor: '#6b7280',
                textColor: '#e5e7eb',
                mainBkg: '#2a2d36',
                nodeBorder: '#6b7280',
                clusterBkg: '#1c1e24',
                clusterBorder: '#3a3d47',
                edgeLabelBackground: '#17181c',
                fontSize: '15px',
              },
            },
          },
        ],
        rehypeKatex,
      ],
    }),
  },

  integrations: [
    react(),
    starlight({
      title: 'CS Fundamentals',
      description:
        'Computer science explained in depth — every claim derived, every structure ' +
        'shown working, and every failure mode named.',
      // The sidebar is read off the filesystem. Adding a page or a whole section
      // never touches this file. See src/lib/sections.ts.
      sidebar: buildSidebar(),
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/danielsousaoliveira/cs-fundamentals',
        },
      ],
      customCss: [
        'katex/dist/katex.min.css',
        './src/components/viz/tokens.css',
        './src/components/viz/viz.css',
        './src/styles/custom.css',
      ],
      components: {
        // Injects the status banner and prereq strip above every page's content.
        PageTitle: './src/components/overrides/PageTitle.astro',
        // Adds og:image and the Twitter card type on top of Starlight's own
        // per-page OG tags.
        Head: './src/components/overrides/Head.astro',
      },
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/danielsousaoliveira/cs-fundamentals/edit/main/',
      },
    }),
  ],
});
