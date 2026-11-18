import { defineConfig } from 'astro/config';

export default defineConfig({
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
