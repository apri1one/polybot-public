import type { HedgeDistribution, PairingResolutionSource } from './types.js';

export type PolyMultiTaskStatus =
    | 'PENDING'
    | 'LIVE'
    | 'HEDGE_PENDING'
    | 'PARTIAL'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'FAILED';

export type PolyMultiTaskHedgeStatus =
    | 'IDLE'
    | 'ACTIVE'
    | 'COMPLETED'
    | 'FAILED';

export interface PolyMultiTaskOrderRef {
    orderId: string;
    walletId?: number;
    orderType: 'GTC' | 'IOC';
}

export interface CreatePolyMultiTaskInput {
    tokenId: string;
    conditionId: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    negRisk: boolean;
    orderType?: 'GTC' | 'IOC';
    eventTitle?: string;
    marketQuestion?: string;
    selectionLabel?: string;
    sport?: string;
    marketType?: 'moneyline' | 'three-way' | 'futures' | 'outright';
    hedgeTokenId?: string;
    hedgeSide?: 'BUY' | 'SELL';
    hedgeSelectionLabel?: string;
    hedgeMaxPrice?: number;
    polyMultiPairingId?: number;
    polyMultiMasterWalletId?: number;
    expiresAt?: number;
    idempotencyKey?: string;
}

export interface PolyMultiTask {
    id: string;
    tokenId: string;
    conditionId: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    negRisk: boolean;
    orderType: 'GTC' | 'IOC';
    status: PolyMultiTaskStatus;
    eventTitle?: string;
    marketQuestion?: string;
    selectionLabel?: string;
    sport?: string;
    marketType?: 'moneyline' | 'three-way' | 'futures' | 'outright';
    hedgeTokenId?: string;
    hedgeSide?: 'BUY' | 'SELL';
    hedgeSelectionLabel?: string;
    hedgeMaxPrice?: number;
    polyMultiPairingId?: number;
    polyMultiMasterWalletId?: number;
    resolvedPairingId?: number;
    resolvedMasterWalletId?: number;
    resolutionSource?: PairingResolutionSource | 'fallback_env';
    currentOrderRef?: PolyMultiTaskOrderRef;
    hedgeStatus: PolyMultiTaskHedgeStatus;
    hedgeDistributions?: HedgeDistribution[];
    filledQty: number;
    remainingQty: number;
    avgPrice: number;
    hedgedQty: number;
    avgHedgePrice: number;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    expiresAt?: number;
    completedAt?: number;
    error?: string;
    hedgeError?: string;
}

export interface PolyMultiTaskSnapshot {
    snapshot: true;
    tasks: PolyMultiTask[];
    stats: {
        total: number;
        active: number;
        live: number;
        hedgePending: number;
        completed: number;
        cancelled: number;
        failed: number;
        partial: number;
    };
    lastUpdate: number;
}
