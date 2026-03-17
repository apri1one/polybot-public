/**
 * poly-multi: 多账户 Polymarket 对冲管理模块 - 类型定义
 */


// ============================================================
// 钱包
// ============================================================

export interface WalletRecord {
    id: number;
    label: string;              // 用户备注（如 "主钱包A"）
    address: string;            // EOA checksum 地址
    proxyAddress: string;       // Gnosis Safe 代理钱包
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    cash?: number;
    positionValue?: number;
    volume?: number;
    lastTradeTime?: number;
    lastQueriedAt?: string;
}

export interface DecryptedCredentials {
    privateKey: Buffer;         // Buffer 存储，用后可 fill(0) 清零
    apiKey: string;
    apiSecret: string;
    passphrase: string;
}

// ============================================================
// 配对
// ============================================================

export interface Pairing {
    id: number;
    name: string;
    masterWalletId: number;
    hedgeWalletId: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PairingWithWallets extends Pairing {
    masterWallet: WalletRecord;
    hedgeWallet: WalletRecord | null;
}

export type PairingResolutionSource =
    | 'task_pairing_id'
    | 'task_master_wallet_id'
    | 'runtime_master_wallet'
    | 'single_active_pairing';

export interface PairingResolution {
    pairing: PairingWithWallets;
    source: PairingResolutionSource;
}

// ============================================================
// 对冲执行
// ============================================================

export interface HedgeDistribution {
    walletId: number;
    walletLabel: string;
    quantity: number;
    orderId?: string;
    orderType?: 'IOC' | 'GTC';
    status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'FAILED';
    filledQty: number;
    avgPrice: number;
    error?: string;
}

export interface HedgeOrderRef {
    walletId: number;
    orderId: string;
    orderType: 'IOC' | 'GTC';
}

export interface OrderbookSnapshot {
    tokenId: string;
    bestBid: number;
    bestAsk: number;
    bidDepth: number;
    askDepth: number;
    timestamp: number;
    source?: 'live' | 'fixed';
}

export type HedgeRejectionReason =
    | 'wallet_locked'
    | 'no_active_pairing'
    | 'no_hedge_wallet'
    | 'price_guard_rejected'
    | 'orderbook_fetch_failed';

export interface MultiHedgeRejection {
    rejected: true;
    reason: HedgeRejectionReason;
    message: string;
    orderbookSnapshot?: OrderbookSnapshot;
}

export interface MultiHedgeResult {
    success: boolean;
    totalRequested: number;
    totalFilled: number;
    avgPrice: number;
    orderType: 'IOC' | 'GTC';
    orderIds: string[];
    orderRefs: HedgeOrderRef[];
    liveOrderIds: string[];
    liveOrderRefs: HedgeOrderRef[];
    distributions: HedgeDistribution[];
    orderbookSnapshot?: OrderbookSnapshot;
}

export interface HedgeCancelFailure extends HedgeOrderRef {
    error: string;
}

export interface HedgeCancelResult {
    success: boolean;
    cancelledOrderIds: string[];
    failed: HedgeCancelFailure[];
}

export interface HedgeExecution {
    id: number;
    pairingId: number;
    taskId?: string;
    predictOrderHash?: string;
    predictFillQty: number;
    predictFillPrice: number;
    distribution: HedgeDistribution[];
    status: 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
    createdAt: string;
    completedAt?: string;
}

// ============================================================
// Interceptor
// ============================================================

export interface HedgeTaskContext {
    id: string;
    title?: string;
    polyMultiPairingId?: number;
    polyMultiMasterWalletId?: number;
    currentOrderHash?: string;
    avgPredictPrice?: number;
}

export interface HedgeInterceptorParams {
    task: HedgeTaskContext;
    quantity: number;
    side: 'BUY' | 'SELL';
    tokenId: string;
    maxPrice: number;
    negRisk: boolean;
    conditionId?: string;
    marketTitle?: string;
    orderType?: 'IOC' | 'GTC';
    fixedPrice?: number;
    expiresAt?: number;
}

/**
 * 对冲拦截器类型
 * 返回 null = 不拦截，fallthrough 到单钱包逻辑
 */
export type HedgeInterceptor = (params: HedgeInterceptorParams) => Promise<MultiHedgeResult | null>;
export type HedgeOrderCanceller = (orderRefs: HedgeOrderRef[]) => Promise<HedgeCancelResult>;

// ============================================================
// API 请求/响应
// ============================================================

export interface UnlockRequest {
    masterPassword: string;
}

export interface AddWalletRequest {
    privateKey: string;
    label: string;
    masterPassword: string;
}

export interface BatchWalletItem {
    privateKey: string;
    label: string;
    /** 直接提供地址（跳过 Python 派生） */
    address?: string;
    proxyAddress?: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;
}

export interface BatchAddWalletsRequest {
    wallets: BatchWalletItem[];
    masterPassword: string;
}

export interface CreatePairingRequest {
    name: string;
    masterWalletId: number;
    hedgeWalletId?: number;
}

export interface UpdatePairingRequest {
    name?: string;
    masterWalletId?: number;
    hedgeWalletId?: number;
}

export interface PolyMultiStatus {
    unlocked: boolean;
    walletCount: number;
    pairingCount: number;
    activePairingId: number | null;
    activePairingCount: number;
    resolvedPairingId: number | null;
    resolutionSource?: PairingResolutionSource;
    runtimeMasterWalletId: number | null;
}

// ============================================================
// 加密存储
// ============================================================

export interface EncryptedData {
    ciphertext: string;     // hex
    salt: string;           // hex, 16 bytes
    iv: string;             // hex, 12 bytes
    authTag: string;        // hex, GCM auth tag
}

// ============================================================
// 钱包查询
// ============================================================

export interface WalletQueryResult {
    walletId: number;
    proxyAddress: string;
    cash: number | null;
    positionValue: number | null;
    volume: number | null;
    lastTradeTime: number | null;
    error?: string;
}

export interface WalletQueryStatus {
    lastRefreshAt: number | null;
    nextRefreshAt: number | null;
    isRefreshing: boolean;
    walletCount: number;
}
