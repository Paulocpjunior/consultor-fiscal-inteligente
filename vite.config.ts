import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    server: {
        host: '0.0.0.0',
        port: parseInt(process.env.PORT || '3000'),
    },
    preview: {
        host: '0.0.0.0',
        port: parseInt(process.env.PORT || '3000'),
    }
});
