/**
 * poly-multi: 多账户 PolymarketTrader 实例工厂
 *
 * 按 walletId 缓存 trader 实例，避免重复创建。
 * 多账户实例禁用 User WS 和 TG 通知。
 */

import { PolymarketTrader } from '../polymarket/polymarket-trader.js';
import type { DecryptedCredentials, WalletRecord } from './types.js';
import * as db from './db.js';

export class PolyTraderFactory {
    private traders: Map<number, PolymarketTrader> = new Map();

    /**
     * 获取或创建 trader 实例
     */
    async getOrCreate(walletId: number, creds: DecryptedCredentials): Promise<PolymarketTrader> {
        const existing = this.traders.get(walletId);
        if (existing) return existing;

        const wallet = db.getWalletById(walletId);
        if (!wallet) throw new Error(`钱包 #${walletId} 不存在`);

        const trader = new PolymarketTrader({
            privateKey: creds.privateKey.toString('utf8'),
            proxyAddress: wallet.proxyAddress,
            traderAddress: wallet.address,  // 必须用钱包自己的 EOA，否则回退到 .env 地址导致 401
            apiKey: creds.apiKey,
            apiSecret: creds.apiSecret,
            passphrase: creds.passphrase,
            disableUserWs: true,       // REST-only 模式，避免 User WS 单例竞争
            disableTelegram: true,      // 由 MultiHedgeExecutor 统一通知
        });
        await trader.init();

        this.traders.set(walletId, trader);
        return trader;
    }

    /**
     * 销毁指定钱包的 trader 实例
     */
    destroy(walletId: number): void {
        const trader = this.traders.get(walletId);
        if (trader) {
            trader.removeAllListeners();
            this.traders.delete(walletId);
        }
    }

    /**
     * 销毁所有 trader 实例
     */
    destroyAll(): void {
        for (const trader of this.traders.values()) {
            trader.removeAllListeners();
        }
        this.traders.clear();
    }

    get size(): number {
        return this.traders.size;
    }
}
