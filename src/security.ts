import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [method, salt, encoded] = stored.split(':');
  if (method !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await derive(password, salt, 64) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function tokenService(secret: string) {
  if (secret.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres aleatórios.');
  const key = new TextEncoder().encode(secret);
  return {
    issue: (id: string) => new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
      .setIssuer('whatsapp-central').setAudience('central-api').setIssuedAt().setExpirationTime('8h').sign(key),
    verify: async (token: string) => (await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer: 'whatsapp-central', audience: 'central-api'
    })).payload.sub
  };
}
