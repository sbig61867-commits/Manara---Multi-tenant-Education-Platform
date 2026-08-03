import { pino, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

const REDACT_PATHS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'email',
  'phone',
  'apiKey',
  'secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    name: options.service,
    level: options.level ?? 'info',
    base: { service: options.service },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  if (options.pretty) {
    loggerOptions.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:standard', singleLine: true },
    };
  }
  return pino(loggerOptions);
}

export type { Logger };
