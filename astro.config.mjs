// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
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
      },
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/danielsousaoliveira/cs-fundamentals/edit/main/',
      },
    }),
  ],
});
