import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  // Pages stay prerendered files; only src/pages/api/** (and the manage page) run on demand through this server.
  adapter: node({ mode: 'standalone' }),
  vite: {
    build: {
      rollupOptions: {
        output: {
          // three.js and the 3D scene load only on desktop, as one separate chunk named "three".
          manualChunks(id) {
            const p = id.split('\\').join('/');
            if (p.includes('/node_modules/three/') || p.includes('/src/scripts/three/scene') || p.includes('/src/scripts/three/objects')) {
              return 'three';
            }
          },
        },
      },
    },
  },
});
