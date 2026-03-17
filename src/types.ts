/**
 * Shared types — extracted from predict-engine/src/polymarket-dashboard/types.ts
 *
 * Only types that poly-multi core modules actually import.
 */

// ============================================================================
// 运动类型 & 市场类型
// ============================================================================

export type PolySportType = 'nba' | 'nhl' | 'football' | 'lol' | 'cs2' | 'dota2';

export type PolyMarketType = 'moneyline' | 'three-way' | 'futures' | 'outright';

// ============================================================================
// 下单类型 (used by core/order-service.ts)
// ============================================================================

export interface PolyOrderRequest {
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    negRisk: boolean;
    orderType?: 'GTC' | 'IOC';
    expiresAt?: number;
}

export interface PolyOrderResponse {
    success: boolean;
    orderId?: string;
    error?: string;
}

// ============================================================================
// Token 元数据 (used by user-ws-telegram-bridge.ts)
// ============================================================================

export interface PolyTokenMarketMetadata {
    tokenId: string;
    conditionId: string;
    question: string;
    eventTitle?: string;
    selectionLabel: string;
    sport: PolySportType;
    marketType: PolyMarketType;
}

// ============================================================================
// 依赖注入接口 (解耦 PolySportsService)
// ============================================================================

/**
 * 最小体育元数据提供者接口。
 * poly-multi 通过此接口获取 token 元数据，而非直接依赖完整的 PolySportsService。
 */
export interface ISportsMetadataProvider {
    getTokenMetadata(tokenId: string): PolyTokenMarketMetadata | null;
    setActiveTaskTokens?(tokenIds: string[]): void;
}
