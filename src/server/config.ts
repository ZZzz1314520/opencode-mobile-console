import dotenv from 'dotenv';

dotenv.config();

export type AppConfig = {
  host: string;
  port: number;
  viewPassword: string;
  controlPassword: string;
  shell: string;
  startCommand: string;
  tokenSecret: string;
  historyLimit: number;
  cwd: string;
};

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

export const config: AppConfig = {
  host: process.env.HOST || '0.0.0.0',
  port: readNumber('PORT', 8787),
  viewPassword: process.env.VIEW_PASSWORD || 'readonly123',
  controlPassword: process.env.CONTROL_PASSWORD || 'control123',
  shell: process.env.SHELL || 'powershell.exe',
  startCommand: process.env.START_COMMAND || 'oc',
  tokenSecret: process.env.TOKEN_SECRET || 'dev-token-secret',
  historyLimit: readNumber('HISTORY_LIMIT', 200000),
  cwd: process.cwd()
};

if (config.viewPassword === config.controlPassword) {
  throw new Error('VIEW_PASSWORD and CONTROL_PASSWORD must be different');
}
