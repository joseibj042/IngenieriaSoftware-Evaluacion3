import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // En desarrollo, Vite sigue funcionando si lo necesitas para editar React.
  // Para usar Merqia desde Django, compila con npm run build.
  base: command === 'build' ? '/static/nexo/' : '/',
  build: {
    outDir: '../backend/static_build/nexo',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
}));
