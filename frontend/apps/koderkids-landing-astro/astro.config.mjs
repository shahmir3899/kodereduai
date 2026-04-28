// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL || 'https://www.kodereduai.pk';

// https://astro.build/config
export default defineConfig({
  site,
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8000',
      },
    },
  },
  integrations: [
    react(),
    sitemap(),
  ],
});
