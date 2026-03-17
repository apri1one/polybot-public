/**
 * poly-multi: 模块入口
 *
 * 多账户 Polymarket 对冲管理模块
 * 提供钱包管理、配对系统、分布式对冲执行
 */

import { WalletManager } from './wallet-manager.js';
import { PairingService } from './pairing-service.js';
import { MultiHedgeExecutor } from './multi-hedge-executor.js';
import { createPolyMultiRouter } from './api-routes.js';
import { WalletQueryScheduler } from './wallet-query-service.js';
import type { HedgeInterceptor, HedgeOrderCanceller } from './types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class PolyMultiModule {
    readonly walletManager: WalletManager;
    readonly pairingService: PairingService;
    readonly hedgeExecutor: MultiHedgeExecutor;
    readonly walletQueryScheduler: WalletQueryScheduler;

    private _router: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;

    constructor() {
        this.walletManager = new WalletManager();
        this.pairingService = new PairingService();
        this.hedgeExecutor = new MultiHedgeExecutor(this.walletManager, this.pairingService);
        this.walletQueryScheduler = new WalletQueryScheduler();

        // 进程退出清零
        this.walletManager.setupExitCleanup();

        // 自动解锁（固定密码，无需用户输入）
        try {
            this.walletManager.unlock();
            console.log('[PolyMulti] 已自动解锁');
        } catch (e: unknown) {
            console.warn(`[PolyMulti] 自动解锁失败: ${(e as Error).message}`);
        }
    }

    /**
     * 初始化 HTTP 路由
     */
    initRouter(getCorsHeaders: (req: IncomingMessage) => Record<string, string>): void {
        this.walletQueryScheduler.start();
        this._router = createPolyMultiRouter(
            this.walletManager,
            this.pairingService,
            getCorsHeaders,
            this.walletQueryScheduler,
        );
    }

    /**
     * 处理 /api/poly-multi/* 请求
     */
    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        if (!this._router) return false;
        return this._router(req, res);
    }

    /**
     * 是否有活跃配对且已解锁
     */
    isReady(): boolean {
        return this.walletManager.isUnlocked() && this.pairingService.hasActivePairing();
    }

    /**
     * 创建对冲拦截器（注入 TaskExecutor）
     */
    createInterceptor(): HedgeInterceptor {
        return this.hedgeExecutor.createInterceptor();
    }

    createOrderCanceller(): HedgeOrderCanceller {
        return this.hedgeExecutor.createOrderCanceller();
    }

    /**
     * 注册 unlock/lock 事件回调
     */
    onUnlocked(callback: () => void): void {
        this.walletManager.on('unlocked', callback);
    }

    onLocked(callback: () => void): void {
        this.walletManager.on('locked', callback);
    }

    /**
     * 清理资源（优雅关闭时调用）
     */
    destroy(): void {
        this.walletQueryScheduler.stop();
        this.walletManager.lock();
        this.hedgeExecutor.destroyAll();
        // 关闭 SQLite 连接，确保 WAL checkpoint
        import('./db.js').then(dbMod => dbMod.closeDb()).catch(() => {});
    }
}

// 导出类型和子模块
export { WalletQueryScheduler } from './wallet-query-service.js';
export type { HedgeInterceptor, HedgeOrderCanceller } from './types.js';
export type { WalletRecord, DecryptedCredentials, PairingWithWallets, MultiHedgeResult, MultiHedgeRejection, OrderbookSnapshot, HedgeOrderRef, HedgeCancelResult } from './types.js';
