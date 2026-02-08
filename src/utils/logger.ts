import { Logger } from "tslog";

const logLevel = process.env.LOG_LEVEL ?? "info";

const levelMap: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

export function createLogger(name: string): Logger<unknown> {
  return new Logger({
    name,
    minLevel: levelMap[logLevel] ?? 3,
    prettyLogTemplate:
      "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] ",
  });
}
