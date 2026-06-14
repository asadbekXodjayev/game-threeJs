import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Split heavy libs so they cache independently of app code and keep
        // the initial app chunk small (isFast gate).
        manualChunks: {
          three: ['three'],
          gsap: ['gsap'],
        },
      },
    },
  },
  preview: { port: 4190, strictPort: true },
  server: { port: 5173 },
});
