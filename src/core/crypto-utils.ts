/**
 * poly-multi: AES-256-GCM 加密/解密模块
 *
 * 安全设计:
 * - 每行独立随机 salt (16 bytes)
 * - PBKDF2 600K 迭代 (OWASP 2023 建议)
 * - 随机 IV (12 bytes)
 * - privateKey 用 Buffer 存储，可 fill(0) 清零
 */

import crypto from 'node:crypto';
import type { EncryptedData, DecryptedCredentials } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32;       // 256 bits
const SALT_LENGTH = 16;      // 128 bits
const IV_LENGTH = 12;        // 96 bits (GCM 推荐)
const DIGEST = 'sha512';

/** 固定内部密码（无需用户输入） */
export const DEFAULT_MASTER_PASSWORD = 'poly-multi-local';

/**
 * 从 master password + salt 派生加密密钥
 */
function deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
}

/**
 * 加密凭证 JSON
 * @returns 加密数据（含独立 salt、IV、authTag）
 */
export function encryptCredentials(
    credentials: {
        privateKey: string;
        apiKey: string;
        apiSecret: string;
        passphrase: string;
    },
    masterPassword: string,
): EncryptedData {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(masterPassword, salt);

    try {
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const plaintext = JSON.stringify(credentials);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        return {
            ciphertext: encrypted.toString('hex'),
            salt: salt.toString('hex'),
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
        };
    } finally {
        key.fill(0);
    }
}

/**
 * 解密凭证
 * @returns 解密后的凭证（privateKey 为 Buffer）
 * @throws 密码错误或数据被篡改时抛出异常
 */
export function decryptCredentials(
    encrypted: EncryptedData,
    masterPassword: string,
): DecryptedCredentials {
    const salt = Buffer.from(encrypted.salt, 'hex');
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');
    const key = deriveKey(masterPassword, salt);

    let decrypted: Buffer | null = null;
    try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);

        // 注意: parsed 中的字符串是 JS 不可变对象，无法清零，
        // 只能依赖 GC 回收。这是 Node.js 环境的固有限制。
        const parsed = JSON.parse(decrypted.toString('utf8')) as {
            privateKey: string;
            apiKey: string;
            apiSecret: string;
            passphrase: string;
        };

        return {
            privateKey: Buffer.from(parsed.privateKey, 'utf8'),
            apiKey: parsed.apiKey,
            apiSecret: parsed.apiSecret,
            passphrase: parsed.passphrase,
        };
    } finally {
        key.fill(0);
        if (decrypted) decrypted.fill(0);
    }
}

/**
 * 安全清零 DecryptedCredentials 中的敏感数据
 */
export function clearCredentials(creds: DecryptedCredentials): void {
    creds.privateKey.fill(0);
    creds.apiKey = '';
    creds.apiSecret = '';
    creds.passphrase = '';
}
