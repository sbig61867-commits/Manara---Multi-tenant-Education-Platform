import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

function toPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const webPort = toPort(env.WEB_PORT, 5173);
  const apiPort = toPort(env.API_PORT, 3000);
  return {
    plugins: [react()],
    envDir: '../../',
    server: {
      port: webPort,
      proxy: {
        '/v1': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/health': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
