import crypto from 'crypto';
import { execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const scryptAsync = promisify(crypto.scrypt);

interface Secrets {
  adminPasswordHash: string;
  jwtSecret: string;
}

interface SecretsFile {
  adminPasswordHash?: string;
  adminPassword?: string;
  jwtSecret?: string;
}

let secrets: Secrets | null = null;
let passwordFromEnv = false;

function resolveSecretsFilePath(): string {
  const configuredPath = process.env.SECRETS_FILE_PATH;
  if (configuredPath && configuredPath.trim().length > 0) {
    return path.resolve(configuredPath.trim());
  }

  if (process.env.DATABASE_URL?.startsWith('file:/data/') || fs.existsSync('/data')) {
    return '/data/secrets.json';
  }

  return path.resolve(process.cwd(), 'data/secrets.json');
}

const SECRETS_FILE = resolveSecretsFilePath();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(): string {
  return Array.from(crypto.randomBytes(16))
    .map(b => ALPHABET[b % ALPHABET.length])
    .join('');
}

function generateJwtSecret(): string {
  return crypto.randomBytes(48).toString('hex');
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64) as Buffer).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const supplied = await scryptAsync(password, salt, 64) as Buffer;
    return hashBuffer.length === supplied.length && crypto.timingSafeEqual(hashBuffer, supplied);
  } catch {
    return false;
  }
}

function restrictFilePermissions(filePath: string): void {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    if (!user) return;
    try {
      execSync(`icacls "${filePath}" /inheritance:r /grant:r "${user}:F"`, { stdio: 'pipe' });
    } catch {
      console.warn('[Auth] Could not set restrictive permissions on secrets.json (icacls failed).');
    }
  }
}

function writeSecretsFile(data: Secrets): void {
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  restrictFilePermissions(SECRETS_FILE);
}

export async function initSecrets(): Promise<void> {
  const envPassword = process.env.ADMIN_PASSWORD;
  const envJwt = process.env.JWT_SECRET;

  if (envPassword && envJwt) {
    secrets = { adminPasswordHash: await hashPassword(envPassword), jwtSecret: envJwt };
    passwordFromEnv = true;
    return;
  }

  if (envPassword) passwordFromEnv = true;

  if (fs.existsSync(SECRETS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) as SecretsFile;

      if (saved.adminPassword && !saved.adminPasswordHash) {
        saved.adminPasswordHash = await hashPassword(saved.adminPassword);
        delete saved.adminPassword;
        writeSecretsFile({ adminPasswordHash: saved.adminPasswordHash, jwtSecret: saved.jwtSecret! });
        console.log('[Auth] Migrated plain-text password in secrets.json to scrypt hash.');
      }

      if (saved.adminPasswordHash && saved.jwtSecret) {
        secrets = {
          adminPasswordHash: envPassword ? await hashPassword(envPassword) : saved.adminPasswordHash,
          jwtSecret: envJwt ?? saved.jwtSecret,
        };
        return;
      }
    } catch {
      // fall through to generate
    }
  }

  const plainPassword = envPassword ?? generatePassword();
  const jwtSecret = envJwt ?? generateJwtSecret();
  secrets = { adminPasswordHash: await hashPassword(plainPassword), jwtSecret };

  try {
    writeSecretsFile(secrets);
  } catch (e) {
    console.warn('[Auth] Could not persist secrets to disk:', e);
    console.warn('[Auth] Credentials will be regenerated on next restart.');
  }

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

export async function updatePassword(newPassword: string): Promise<void> {
  if (!secrets) throw new Error('Secrets not initialized — call initSecrets() first');
  secrets.adminPasswordHash = await hashPassword(newPassword);
  try {
    writeSecretsFile(secrets);
  } catch (e) {
    throw new Error(`Could not save new password to disk: ${e}`);
  }
}
