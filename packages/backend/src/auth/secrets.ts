import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Secrets {
  adminPasswordHash: string;
  jwtSecret: string;
}

// Shape read from disk — may be legacy plain-text or current hash format
interface SecretsFile {
  adminPasswordHash?: string;
  adminPassword?: string; // legacy plain text
  jwtSecret?: string;
}

let secrets: Secrets | null = null;
let passwordFromEnv = false;

const SECRETS_FILE = path.resolve(process.cwd(), 'data/secrets.json');

// Unambiguous alphabet (no 0/O, 1/l/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(): string {
  return Array.from(crypto.randomBytes(16))
    .map(b => ALPHABET[b % ALPHABET.length])
    .join('');
}

function generateJwtSecret(): string {
  return crypto.randomBytes(48).toString('hex');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const supplied = crypto.scryptSync(password, salt, 64);
    return hashBuffer.length === supplied.length && crypto.timingSafeEqual(hashBuffer, supplied);
  } catch {
    return false;
  }
}

function restrictFilePermissions(filePath: string): void {
  if (process.platform === 'win32') {
    // 0o600 is ignored on Windows — use icacls to restrict to current user only
    const user = process.env.USERNAME;
    if (!user) return;
    try {
      execSync(`icacls "${filePath}" /inheritance:r /grant:r "${user}:F"`, { stdio: 'pipe' });
    } catch {
      console.warn('[Auth] Could not set restrictive permissions on secrets.json (icacls failed).');
    }
  }
  // On Unix, mode: 0o600 passed to writeFileSync handles this
}

function writeSecretsFile(data: Secrets): void {
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  restrictFilePermissions(SECRETS_FILE);
}

export function initSecrets(): void {
  const envPassword = process.env.ADMIN_PASSWORD;
  const envJwt = process.env.JWT_SECRET;

  // Both provided via env — hash in memory, no file involved
  if (envPassword && envJwt) {
    secrets = { adminPasswordHash: hashPassword(envPassword), jwtSecret: envJwt };
    passwordFromEnv = true;
    return;
  }

  if (envPassword) passwordFromEnv = true;

  // Try loading from persisted file (survives container restarts)
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) as SecretsFile;

      // Migrate legacy plain-text password to hash
      if (saved.adminPassword && !saved.adminPasswordHash) {
        saved.adminPasswordHash = hashPassword(saved.adminPassword);
        delete saved.adminPassword;
        writeSecretsFile({ adminPasswordHash: saved.adminPasswordHash, jwtSecret: saved.jwtSecret! });
        console.log('[Auth] Migrated plain-text password in secrets.json to scrypt hash.');
      }

      if (saved.adminPasswordHash && saved.jwtSecret) {
        secrets = {
          adminPasswordHash: envPassword ? hashPassword(envPassword) : saved.adminPasswordHash,
          jwtSecret: envJwt ?? saved.jwtSecret,
        };
        return;
      }
    } catch {
      // fall through to generate
    }
  }

  // First run — generate, hash, persist, and print plain-text password to logs
  const plainPassword = envPassword ?? generatePassword();
  const jwtSecret = envJwt ?? generateJwtSecret();
  secrets = { adminPasswordHash: hashPassword(plainPassword), jwtSecret };

  try {
    writeSecretsFile(secrets);
  } catch (e) {
    console.warn('[Auth] Could not persist secrets to disk:', e);
    console.warn('[Auth] Credentials will be regenerated on next restart.');
  }

  // Only announce if we auto-generated (env password users already know theirs)
  if (!envPassword) {
    const border = '='.repeat(62);
    console.log(`\n${border}`);
    console.log('  TeleRSS — First-run credentials generated');
    console.log(border);
    console.log(`  Admin password : ${plainPassword}`);
    console.log(`  Saved to       : ${SECRETS_FILE}`);
    console.log(`\n  To set a custom password, add to your .env:`);
    console.log(`  ADMIN_PASSWORD=your-password`);
    console.log(`${border}\n`);
  }
}

export function getSecrets(): Secrets {
  if (!secrets) throw new Error('Secrets not initialized — call initSecrets() first');
  return secrets;
}

export function isPasswordFromEnv(): boolean {
  return passwordFromEnv;
}

export function updatePassword(newPassword: string): void {
  if (!secrets) throw new Error('Secrets not initialized — call initSecrets() first');
  secrets.adminPasswordHash = hashPassword(newPassword);
  try {
    writeSecretsFile(secrets);
  } catch (e) {
    throw new Error(`Could not save new password to disk: ${e}`);
  }
}
