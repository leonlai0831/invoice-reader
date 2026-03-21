import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
  root: '.',
  base: '/static/dist/',
  build: {
    outDir: 'static/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/main.ts'),
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7788',
      '/static/style.css': 'http://localhost:7788',
      '/static/fonts': 'http://localhost:7788',
      '/static/chart.umd.min.js': 'http://localhost:7788',
    },
  },
});
