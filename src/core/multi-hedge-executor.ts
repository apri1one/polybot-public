/**
 * poly-multi distributed hedge executor.
 *
 * Responsibilities:
 * 1. Resolve the active pairing for the current task/runtime.
 * 2. Split hedge quantity across hedge wallets.
 * 3. Execute IOC or GTC orders on the hedge wallets.
 * 4. Aggregate execution state for TaskExecutor and history UI.
 */

import { PolymarketRestClient } from '../polymarket/rest-client.js';
import type { WalletManager } from './wallet-manager.js';
import type { PairingService } from './pairing-service.js';
import { PolyTraderFactory } from './trader-factory.js';
import * as db from './db.js';
import type {
    HedgeCancelResult,
    HedgeDistribution,
    HedgeInterceptorParams,
    HedgeOrderCanceller,
    HedgeOrderRef,
    MultiHedgeRejection,
    MultiHedgeResult,
    OrderbookSnapshot,
} from './types.js';

const SUBMIT_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 300;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isFixedPrice(price: number | undefined): price is number {
    return Number.isFinite(price) && price! > 0;
}

function isRejection(result: MultiHedgeResult | MultiHedgeRejection): result is MultiHedgeRejection {
    return 'rejected' in result && result.rejected === true;
}

export { isRejection };

export class MultiHedgeExecutor {
    private polyRest = new PolymarketRestClient();
    private traderFactory = new PolyTraderFactory();

    constructor(
        private walletManager: WalletManager,
        private pairingService: PairingService,
    ) {}

    createInterceptor() {
        return async (params: HedgeInterceptorParams): Promise<MultiHedgeResult | null> => {
            const result = await this.executeMultiHedge(params);
            if (isRejection(result)) {
                console.log(`[MultiHedge] Interceptor rejected: [${result.reason}] ${result.message}`);
                return null;
            }
            return result;
        };
    }

    createOrderCanceller(): HedgeOrderCanceller {
        return async (orderRefs: HedgeOrderRef[]): Promise<HedgeCancelResult> => {
            return this.cancelOrders(orderRefs);
        };
    }

    async executeMultiHedge(params: HedgeInterceptorParams): Promise<MultiHedgeResult | MultiHedgeRejection> {
        if (!this.walletManager.isUnlocked()) {
            return { rejected: true, reason: 'wallet_locked', message: '钱包管理器未解锁' };
        }

        const resolved = this.pairingService.resolvePairingForTask(params.task);
        if (!resolved) {
            return { rejected: true, reason: 'no_active_pairing', message: '无法解析活跃配对路由' };
        }

        const { pairing, source } = resolved;
        if (!pairing.hedgeWallet) {
            return { rejected: true, reason: 'no_hedge_wallet', message: `配对 #${pairing.id} 未配置对冲钱包` };
        }

        const { quantity, side, tokenId, maxPrice, negRisk, task, orderType = 'IOC', marketTitle, expiresAt } = params;

        console.log(`[MultiHedge] Using pairing #${pairing.id} via ${source}`);

        const priceResult = await this.resolveExecutionPrice(params);
        if (!priceResult.ok) {
            return {
                rejected: true,
                reason: priceResult.reason,
                message: priceResult.message,
                orderbookSnapshot: priceResult.snapshot,
            };
        }

        const { price: executionPrice, snapshot } = priceResult;

        const hedge = pairing.hedgeWallet;
        const dist: HedgeDistribution = {
            walletId: hedge.id,
            walletLabel: hedge.label,
            quantity,
            orderType,
            status: 'PENDING',
            filledQty: 0,
            avgPrice: 0,
        };

        const execId = db.insertHedgeExecution({
            pairingId: pairing.id,
            taskId: task.id,
            predictOrderHash: task.currentOrderHash,
            predictFillQty: quantity,
            predictFillPrice: task.avgPredictPrice ?? 0,
            distribution: [dist],
        });

        const orderRefs: HedgeOrderRef[] = [];
        const liveOrderRefs: HedgeOrderRef[] = [];

        try {
            const creds = this.walletManager.getCredentials(hedge.id);
            if (!creds) {
                dist.status = 'FAILED';
                dist.error = 'credentials not found';
            } else {
                const trader = await this.traderFactory.getOrCreate(hedge.id, creds);
                console.log(`[MultiHedge] Placing ${orderType} ${side} order: token=${tokenId.slice(0, 10)}..., price=${executionPrice}, qty=${quantity}, negRisk=${negRisk}, wallet=#${hedge.id}`);
                const orderResult = await trader.placeOrder({
                    tokenId, side, price: executionPrice, quantity,
                    orderType, expiresAt, negRisk,
                    marketTitle: marketTitle ?? task.title,
                    conditionId: params.conditionId,
                });
                console.log(`[MultiHedge] placeOrder result: success=${orderResult.success}, orderId=${orderResult.orderId?.slice(0, 10) || 'null'}, error=${orderResult.error || 'none'}`);

                if (!orderResult.success || !orderResult.orderId) {
                    dist.status = 'FAILED';
                    dist.error = orderResult.error || 'order placement failed';
                } else {
                    dist.orderId = orderResult.orderId;
                    const ref: HedgeOrderRef = { walletId: hedge.id, orderId: orderResult.orderId, orderType };
                    orderRefs.push(ref);

                    if (orderType === 'GTC') {
                        dist.status = 'PENDING';
                        dist.avgPrice = executionPrice;
                        liveOrderRefs.push(ref);
                    } else {
                        const fillStatus = await this.pollOrderFill(trader, orderResult.orderId);
                        dist.filledQty = fillStatus.filledQty;
                        dist.avgPrice = fillStatus.avgPrice;
                        dist.status = fillStatus.filledQty >= quantity ? 'FILLED'
                            : fillStatus.filledQty > 0 ? 'PARTIAL' : 'FAILED';
                    }
                }
            }
        } catch (e: unknown) {
            dist.status = 'FAILED';
            dist.error = (e as Error).message;
        }

        const totalFilled = dist.filledQty;
        const avgPrice = dist.avgPrice;
        const overallStatus = this.getOverallStatus(orderType, quantity, totalFilled, [dist], liveOrderRefs.length);
        db.updateHedgeExecution(execId, overallStatus, [dist]);

        const result: MultiHedgeResult = {
            success: orderType === 'GTC' ? liveOrderRefs.length > 0 : totalFilled > 0,
            totalRequested: quantity,
            totalFilled,
            avgPrice,
            orderType,
            orderIds: orderRefs.map(ref => ref.orderId),
            orderRefs,
            liveOrderIds: liveOrderRefs.map(ref => ref.orderId),
            liveOrderRefs,
            distributions: [dist],
            orderbookSnapshot: snapshot,
        };

        console.log(`[MultiHedge] Completed: type=${orderType}, requested=${quantity}, filled=${totalFilled}, status=${overallStatus}`);
        return result;
    }

    async cancelOrders(orderRefs: HedgeOrderRef[]): Promise<HedgeCancelResult> {
        const refs = dedupeOrderRefs(orderRefs);
        if (refs.length === 0) {
            return { success: true, cancelledOrderIds: [], failed: [] };
        }

        if (!this.walletManager.isUnlocked()) {
            return {
                success: false,
                cancelledOrderIds: [],
                failed: refs.map(ref => ({ ...ref, error: 'wallet manager locked' })),
            };
        }

        const cancelledOrderIds: string[] = [];
        const failed: HedgeCancelResult['failed'] = [];

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            try {
                const creds = this.walletManager.getCredentials(ref.walletId);
                if (!creds) {
                    failed.push({ ...ref, error: 'credentials not found' });
                    continue;
                }

                const trader = await this.traderFactory.getOrCreate(ref.walletId, creds);
                const cancelled = await trader.cancelOrder(ref.orderId, {
                    timeoutMs: 5000,
                    skipTelegram: true,
                });

                if (cancelled) {
                    cancelledOrderIds.push(ref.orderId);
                } else {
                    failed.push({ ...ref, error: 'cancelOrder returned false' });
                }
            } catch (e: unknown) {
                failed.push({ ...ref, error: (e as Error).message });
            }

            if (i < refs.length - 1) {
                await delay(SUBMIT_INTERVAL_MS);
            }
        }

        return {
            success: failed.length === 0,
            cancelledOrderIds,
            failed,
        };
    }

    destroyAll(): void {
        this.traderFactory.destroyAll();
    }

    private async resolveExecutionPrice(params: HedgeInterceptorParams): Promise<
        | { ok: true; price: number; snapshot: OrderbookSnapshot }
        | { ok: false; reason: 'price_guard_rejected' | 'orderbook_fetch_failed'; message: string; snapshot?: OrderbookSnapshot }
    > {
        if (isFixedPrice(params.fixedPrice)) {
            return { ok: true, price: params.fixedPrice, snapshot: { tokenId: params.tokenId, bestBid: 0, bestAsk: 0, bidDepth: 0, askDepth: 0, timestamp: Date.now(), source: 'fixed' as const } };
        }

        try {
            const book = await this.polyRest.getNormalizedOrderBook(params.tokenId);
            const bestAsk = book.asks.length > 0 ? book.asks[0][0] : Infinity;
            const bestBid = book.bids.length > 0 ? book.bids[0][0] : 0;
            const askDepth = book.asks.reduce((sum, [, qty]) => sum + qty, 0);
            const bidDepth = book.bids.reduce((sum, [, qty]) => sum + qty, 0);

            const snapshot: OrderbookSnapshot = {
                tokenId: params.tokenId,
                bestBid,
                bestAsk: bestAsk === Infinity ? 0 : bestAsk,
                bidDepth: Math.round(bidDepth * 100) / 100,
                askDepth: Math.round(askDepth * 100) / 100,
                timestamp: Date.now(),
                source: 'live',
            };

            if (params.side === 'BUY') {
                // 价格守护: mainPrice + bestAsk <= 1 允许（含保本），> 1 拒绝（亏损）
                // 使用 1e-9 epsilon 容差防止浮点精度误判 (如 1-0.77=0.22999999999999998)
                if (bestAsk > params.maxPrice + 1e-9) {
                    const message = `价格守护拒绝: bestAsk=${bestAsk} > maxPrice=${params.maxPrice}, 总成本超过 1`;
                    console.log(`[MultiHedge] ${message}`);
                    return { ok: false, reason: 'price_guard_rejected', message, snapshot };
                }
                return { ok: true, price: bestAsk, snapshot };
            }

            // SELL 侧守护: bestBid >= maxPrice 允许, < maxPrice 拒绝
            if (bestBid < params.maxPrice - 1e-9) {
                const message = `价格守护拒绝: bestBid=${bestBid} < minPrice=${params.maxPrice}`;
                console.log(`[MultiHedge] ${message}`);
                return { ok: false, reason: 'price_guard_rejected', message, snapshot };
            }
            return { ok: true, price: bestBid, snapshot };
        } catch (e: unknown) {
            const message = `订单簿获取失败: ${(e as Error).message}`;
            console.warn(`[MultiHedge] ${message}`);
            return { ok: false, reason: 'orderbook_fetch_failed', message };
        }
    }

    private getOverallStatus(
        orderType: 'IOC' | 'GTC',
        quantity: number,
        totalFilled: number,
        distributions: HedgeDistribution[],
        liveCount: number,
    ): 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' {
        if (orderType === 'GTC') {
            if (liveCount === 0) return 'FAILED';
            return distributions.some(dist => dist.status === 'FAILED') ? 'PARTIAL' : 'PENDING';
        }

        const allFailed = distributions.every(dist => dist.status === 'FAILED');
        if (allFailed) return 'FAILED';
        if (totalFilled >= quantity) return 'COMPLETED';
        if (totalFilled > 0) return 'PARTIAL';
        return 'FAILED';
    }

    private async pollOrderFill(
        trader: import('../polymarket/polymarket-trader.js').PolymarketTrader,
        orderId: string,
    ): Promise<{ filledQty: number; avgPrice: number }> {
        const maxRetries = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);
        for (let i = 0; i < maxRetries; i++) {
            try {
                const status = await trader.getOrderStatus(orderId);
                if (!status) {
                    console.log(`[MultiHedge] Poll ${i + 1}/${maxRetries}: order ${orderId.slice(0, 10)}... not found`);
                    await delay(POLL_INTERVAL_MS);
                    continue;
                }
                console.log(`[MultiHedge] Poll ${i + 1}/${maxRetries}: status=${status.status}, filled=${status.filledQty}/${status.remainingQty + status.filledQty}`);
                if (status.status === 'MATCHED' || status.status === 'CANCELLED') {
                    return { filledQty: status.filledQty, avgPrice: status.avgPrice };
                }
            } catch (e: unknown) {
                console.warn(`[MultiHedge] Poll ${i + 1}/${maxRetries} error: ${(e as Error).message}`);
            }
            await delay(POLL_INTERVAL_MS);
        }

        try {
            console.log(`[MultiHedge] Poll timeout, cancelling order ${orderId.slice(0, 10)}...`);
            await trader.cancelOrder(orderId).catch(() => {});
            await delay(200);
            const status = await trader.getOrderStatus(orderId);
            if (status) {
                console.log(`[MultiHedge] Final status after cancel: status=${status.status}, filled=${status.filledQty}`);
                return { filledQty: status.filledQty, avgPrice: status.avgPrice };
            }
        } catch {
            // Ignore timeout cleanup errors.
        }

        console.warn(`[MultiHedge] pollOrderFill gave up: orderId=${orderId.slice(0, 10)}...`);
        return { filledQty: 0, avgPrice: 0 };
    }
}

function dedupeOrderRefs(orderRefs: HedgeOrderRef[]): HedgeOrderRef[] {
    const deduped = new Map<string, HedgeOrderRef>();
    for (const ref of orderRefs) {
        if (!ref?.orderId || !Number.isFinite(ref.walletId)) continue;
        deduped.set(`${ref.walletId}:${ref.orderId}`, ref);
    }
    return Array.from(deduped.values());
}
