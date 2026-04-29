import crypto from 'node:crypto';
import type { AppConfig } from './config.js';

export type Role = 'viewer' | 'controller';

type TokenPayload = {
  role: Role;
  exp: number;
};

const tokenTtlMs = 24 * 60 * 60 * 1000;

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function roleForPassword(password: string, config: AppConfig): Role | null {
  if (password === config.controlPassword) return 'controller';
  if (password === config.viewPassword) return 'viewer';
  return null;
}

export function createToken(role: Role, config: AppConfig): string {
  const payload: TokenPayload = {
    role,
    exp: Date.now() + tokenTtlMs
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, config.tokenSecret);
  return `${encodedPayload}.${signature}`;
}

export function verifyToken(token: string | undefined, config: AppConfig): Role | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload, config.tokenSecret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TokenPayload;
    if ((payload.role !== 'viewer' && payload.role !== 'controller') || payload.exp < Date.now()) {
      return null;
    }
    return payload.role;
  } catch {
    return null;
  }
}
