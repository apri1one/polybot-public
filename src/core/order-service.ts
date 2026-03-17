import type { PolyOrderRequest, PolyOrderResponse } from '../types.js';
import type { PolyOrderStatus } from '../polymarket/polymarket-trader.js';
import type { PairingResolutionSource } from './types.js';
import type { PairingService } from './pairing-service.js';
import type { WalletManager } from './wallet-manager.js';
import { PolyTraderFactory } from './trader-factory.js';

/**
 * 最小交易服务接口（fallback 到 .env 单钱包）
 * 原 PolyTradeService 的方法签名子集
 */
export interface PolyTradeService {
    placeOrder(input: PolyOrderRequest): Promise<PolyOrderResponse>;
    cancelOrder(orderId: string): Promise<boolean>;
    getOrderStatus(orderId: string): Promise<PolyOrderStatus | null>;
    getBalance(): Promise<number>;
}

export interface RoutedPolyOrderRequest extends PolyOrderRequest {
    conditionId?: string;
    marketQuestion?: string;
    selectionLabel?: string;
    polyMultiPairingId?: number;
    polyMultiMasterWalletId?: number;
}

export interface RoutedPolyOrderResult extends PolyOrderResponse {
    walletId?: number;
    pairingId?: number;
    resolutionSource?: PairingResolutionSource | 'fallback_env';
}

interface OrderRouteOptions {
    requirePolyMultiRoute?: boolean;
    walletId?: number;
    polyMultiPairingId?: number;
    polyMultiMasterWalletId?: number;
}

interface ResolvedTraderRoute {
    walletId?: number;
    pairingId?: number;
    resolutionSource: PairingResolutionSource | 'fallback_env';
        trader: {
            placeOrder(input: {
                tokenId: string;
                side: 'BUY' | 'SELL';
                price: number;
                quantity: number;
                negRisk: boolean;
                orderType: 'GTC' | 'IOC';
                expiresAt?: number;
                marketTitle?: string;
                outcomeName?: string;
                conditionId?: string;
            }): Promise<{ success: boolean; orderId?: string; error?: string }>;
        cancelOrder(orderId: string): Promise<boolean>;
        getOrderStatus(orderId: string): Promise<PolyOrderStatus | null>;
        getBalance(): Promise<number>;
    };
}

export class PolyMultiOrderService {
    private traderFactory = new PolyTraderFactory();

    constructor(
        private readonly walletManager: WalletManager,
        private readonly pairingService: PairingService,
        private readonly fallbackTradeService: PolyTradeService | null,
    ) {}

    destroy(): void {
        this.traderFactory.destroyAll();
    }

    async placeOrder(input: RoutedPolyOrderRequest, options?: OrderRouteOptions): Promise<RoutedPolyOrderResult> {
        const route = await this.resolveTraderRoute({
            requirePolyMultiRoute: options?.requirePolyMultiRoute,
            polyMultiPairingId: options?.polyMultiPairingId ?? input.polyMultiPairingId,
            polyMultiMasterWalletId: options?.polyMultiMasterWalletId ?? input.polyMultiMasterWalletId,
        });

        const result = await route.trader.placeOrder({
            tokenId: input.tokenId,
            side: input.side,
            price: input.price,
            quantity: input.quantity,
            negRisk: input.negRisk,
            orderType: input.orderType || 'GTC',
            expiresAt: input.expiresAt,
            marketTitle: input.marketQuestion,
            outcomeName: input.selectionLabel,
            conditionId: input.conditionId,
        });

        return {
            success: result.success,
            orderId: result.orderId,
            error: result.error,
            walletId: route.walletId,
            pairingId: route.pairingId,
            resolutionSource: route.resolutionSource,
        };
    }

    async cancelOrder(orderId: string, options?: OrderRouteOptions): Promise<boolean> {
        const route = await this.resolveTraderRoute(options);
        return route.trader.cancelOrder(orderId);
    }

    async getOrderStatus(orderId: string, options?: OrderRouteOptions): Promise<PolyOrderStatus | null> {
        const route = await this.resolveTraderRoute(options);
        return route.trader.getOrderStatus(orderId);
    }

    async getBalance(options?: OrderRouteOptions): Promise<number> {
        const route = await this.resolveTraderRoute(options);
        return route.trader.getBalance();
    }

    private async resolveTraderRoute(options?: OrderRouteOptions): Promise<ResolvedTraderRoute> {
        if (options?.walletId) {
            const creds = this.walletManager.getCredentials(options.walletId);
            if (!creds) {
                throw new Error(`Wallet #${options.walletId} is not unlocked`);
            }

            const trader = await this.traderFactory.getOrCreate(options.walletId, creds);
            return {
                walletId: options.walletId,
                resolutionSource: 'task_master_wallet_id',
                trader,
            };
        }

        const resolvedPairing = this.pairingService.resolvePairingForTask({
            polyMultiPairingId: options?.polyMultiPairingId,
            polyMultiMasterWalletId: options?.polyMultiMasterWalletId,
        });

        if (resolvedPairing) {
            const walletId = resolvedPairing.pairing.masterWalletId;
            const creds = this.walletManager.getCredentials(walletId);
            if (!creds) {
                throw new Error(`Master wallet #${walletId} is not unlocked`);
            }

            const trader = await this.traderFactory.getOrCreate(walletId, creds);
            return {
                walletId,
                pairingId: resolvedPairing.pairing.id,
                resolutionSource: resolvedPairing.source,
                trader,
            };
        }

        // 有活跃配对但无法自动选择时，报错提示用户指定配对
        const activePairings = this.pairingService.listActivePairings();
        if (activePairings.length > 0) {
            throw new Error(
                `${activePairings.length} 个活跃配对无法自动选择，请在创建任务时指定配对`,
            );
        }

        if (options?.requirePolyMultiRoute) {
            throw new Error('No active poly-multi pairing could be resolved for this order');
        }

        if (!this.fallbackTradeService) {
            throw new Error('Trading is not enabled');
        }

        return {
            resolutionSource: 'fallback_env',
            trader: this.fallbackTradeService,
        };
    }
}
