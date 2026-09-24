export interface Config {
  host: string;
  port: number;
  version: string;
  /** Directory of the built frontend. If unset, the server does not serve the frontend. */
  staticDir: string | undefined;
  /** Postgres connection URL. If unset, the standard variables `PGHOST`, `PGUSER`, … apply. */
  databaseUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    version: env.APP_VERSION ?? 'dev',
    staticDir: env.STATIC_DIR || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
  };
}
