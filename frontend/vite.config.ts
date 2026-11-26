import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // запросы к /api/... уходят на FastAPI (см. docs/contracts.md)
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
