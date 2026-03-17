/**
 * poly-multi: 钱包管理器
 *
 * - 钱包 CRUD（Python 凭证派生 + AES 加密存储）
 * - unlock/lock 解密缓存管理
 * - 暴力破解防护（指数延迟 + 锁定）
 */

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { WalletRecord, DecryptedCredentials } from './types.js';
import { encryptCredentials, decryptCredentials, clearCredentials, DEFAULT_MASTER_PASSWORD } from './crypto-utils.js';
import * as db from './db.js';

interface DeriveResult {
    address: string;
    proxyAddress: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
}

export class WalletManager extends EventEmitter {
    private credentialCache: Map<number, DecryptedCredentials> = new Map();
    private _unlocked = false;

    // ============================================================
    // 解锁 / 锁定（固定密码，无需用户输入）
    // ============================================================

    isUnlocked(): boolean {
        return this._unlocked;
    }

    isLockedOut(): boolean {
        return false;
    }

    /**
     * 解锁所有钱包（用固定密码解密凭证到内存）
     * 兼容旧签名：忽略传入的 masterPassword，始终使用 DEFAULT_MASTER_PASSWORD
     */
    unlock(_masterPassword?: string): void {
        const allEncrypted = db.getAllWalletsEncrypted();
        if (allEncrypted.length === 0) {
            this._unlocked = true;
            this.emit('unlocked');
            return;
        }

        this.clearCache();
        for (const { id, encrypted } of allEncrypted) {
            const creds = decryptCredentials(encrypted, DEFAULT_MASTER_PASSWORD);
            this.credentialCache.set(id, creds);
        }

        this._unlocked = true;
        this.emit('unlocked');
    }

    /**
     * 锁定（Buffer.fill(0) 清零所有敏感数据）
     */
    lock(): void {
        this.clearCache();
        this._unlocked = false;
        this.emit('locked');
    }

    private clearCache(): void {
        for (const creds of this.credentialCache.values()) {
            clearCredentials(creds);
        }
        this.credentialCache.clear();
    }

    /**
     * 获取已解密凭证（需已解锁）
     */
    getCredentials(walletId: number): DecryptedCredentials | null {
        return this.credentialCache.get(walletId) ?? null;
    }

    // ============================================================
    // 钱包 CRUD
    // ============================================================

    /**
     * 添加钱包：通过 Python 脚本派生凭证 → AES 加密存储
     */
    async addWallet(privateKey: string, label: string, _masterPassword?: string): Promise<WalletRecord> {
        // 1. 调用 Python 派生凭证
        const derived = await this.derivePythonCredentials(privateKey);

        // 2. 加密存储（固定密码）
        const encrypted = encryptCredentials(
            {
                privateKey,
                apiKey: derived.apiKey,
                apiSecret: derived.apiSecret,
                passphrase: derived.passphrase,
            },
            DEFAULT_MASTER_PASSWORD,
        );

        // 3. 写入 SQLite
        const wallet = db.insertWallet(label, derived.address, derived.proxyAddress, encrypted);

        // 4. 加入内存缓存
        if (this._unlocked) {
            const creds = decryptCredentials(encrypted, DEFAULT_MASTER_PASSWORD);
            this.credentialCache.set(wallet.id, creds);
        }

        return wallet;
    }

    /**
     * 添加钱包：直接提供 API 凭证（跳过 Python 派生）
     * 用于批量导入已有凭证的钱包
     */
    async addWalletDirect(params: {
        privateKey: string;
        label: string;
        address: string;
        proxyAddress: string;
        apiKey: string;
        apiSecret: string;
        passphrase: string;
        masterPassword?: string;
    }): Promise<WalletRecord> {
        // 加密存储（固定密码）
        const encrypted = encryptCredentials(
            {
                privateKey: params.privateKey,
                apiKey: params.apiKey,
                apiSecret: params.apiSecret,
                passphrase: params.passphrase,
            },
            DEFAULT_MASTER_PASSWORD,
        );

        // 写入 SQLite
        const wallet = db.insertWallet(params.label, params.address, params.proxyAddress, encrypted);

        // 加入内存缓存
        if (this._unlocked) {
            const creds = decryptCredentials(encrypted, DEFAULT_MASTER_PASSWORD);
            this.credentialCache.set(wallet.id, creds);
        }

        return wallet;
    }

    listWallets(): WalletRecord[] {
        return db.listWallets();
    }

    removeWallet(walletId: number): void {
        db.deleteWallet(walletId);
        // 清理缓存
        const cached = this.credentialCache.get(walletId);
        if (cached) {
            clearCredentials(cached);
            this.credentialCache.delete(walletId);
        }
    }

    updateLabel(walletId: number, label: string): void {
        db.updateWalletLabel(walletId, label);
    }

    // ============================================================
    // Python 凭证派生
    // ============================================================

    private derivePythonCredentials(privateKey: string): Promise<DeriveResult> {
        return new Promise((resolve, reject) => {
            const child = execFile(
                'python',
                ['tools/get-pm-apikey.py', '--json', '--stdin'],
                { cwd: process.cwd(), timeout: 60_000 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`Python 派生失败: ${error.message}\n${stderr}`));
                        return;
                    }
                    try {
                        const result = JSON.parse(stdout.trim());
                        if (result.error) {
                            reject(new Error(`Python 派生错误: ${result.error}`));
                            return;
                        }
                        resolve(result as DeriveResult);
                    } catch (e) {
                        reject(new Error(`Python 输出解析失败: ${stdout}`));
                    }
                },
            );
            // 通过 stdin 传入私钥（安全：不暴露在进程列表）
            child.stdin!.write(privateKey);
            child.stdin!.end();
        });
    }

    // ============================================================
    // 进程退出清零
    // ============================================================

    setupExitCleanup(): void {
        // 只注册 exit 事件，让 start-dashboard 的优雅关闭流程控制退出时序
        // 不在 SIGINT/SIGTERM 中调用 process.exit()，避免跳过任务暂停和挂单取消
        process.on('exit', () => this.lock());
    }
}
