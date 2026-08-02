import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Trace generators are pure and run in node, which is the common case and
    // much faster. Component tests opt into a DOM per file with a docblock:
    //   // @vitest-environment jsdom
    // (Vitest 4 removed `environmentMatchGlobs`.)
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
