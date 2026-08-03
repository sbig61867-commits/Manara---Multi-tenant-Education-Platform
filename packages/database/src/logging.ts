export interface LoggerLike {
  debug?: (object: Record<string, unknown>, message: string) => void;
  info?: (object: Record<string, unknown>, message: string) => void;
  warn?: (object: Record<string, unknown>, message: string) => void;
  error?: (object: Record<string, unknown>, message: string) => void;
  fatal?: (object: Record<string, unknown>, message: string) => void;
}

export interface DatabaseLogEvent {
  event: string;
  host?: string;
  port?: number;
  database?: string;
  code?: string;
  message?: string;
  version?: string;
  name?: string;
}

export interface DatabaseLogger {
  info(event: DatabaseLogEvent): void;
  warn(event: DatabaseLogEvent): void;
  error(event: DatabaseLogEvent): void;
}

function noop(): void {}

export function fromPinoLogger(logger: LoggerLike): DatabaseLogger {
  const info = (logger.info ?? noop).bind(logger);
  const warn = (logger.warn ?? noop).bind(logger);
  const error = (logger.error ?? noop).bind(logger);
  return {
    info: (event) => info({ ...event }, 'database'),
    warn: (event) => warn({ ...event }, 'database'),
    error: (event) => error({ ...event }, 'database'),
  };
}

export function nullDatabaseLogger(): DatabaseLogger {
  return { info: noop, warn: noop, error: noop };
}
