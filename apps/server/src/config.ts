export interface Config {
  host: string;
  port: number;
  version: string;
  /** Verzeichnis mit dem gebauten Frontend. Ohne Angabe liefert der Server kein Frontend aus. */
  staticDir: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Ungültiger PORT: ${env.PORT}`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    version: env.APP_VERSION ?? 'dev',
    staticDir: env.STATIC_DIR || undefined,
  };
}
