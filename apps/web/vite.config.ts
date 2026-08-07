import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolveWebEnvironment, type WebEnvironmentMode } from './src/env.ts';

function toPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, '../../', 'VITE_');
  resolveWebEnvironment(publicEnv, mode as WebEnvironmentMode);
  const toolingEnv = loadEnv(mode, '../../', ['WEB_PORT', 'API_PORT']);
  const webPort = toPort(toolingEnv.WEB_PORT, 5173);
  const apiPort = toPort(toolingEnv.API_PORT, 3000);
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
