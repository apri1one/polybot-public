/**
 * Sports-specific types for PolySportsService
 *
 * Types shared with the main poly-multi project (PolySportType, PolyMarketType,
 * PolyTokenMarketMetadata) are re-exported from ../types.js.
 */

export type { PolySportType, PolyMarketType, PolyTokenMarketMetadata } from '../types.js';

import type { PolySportType, PolyMarketType } from '../types.js';

// ============================================================================
// 赛事市场
// ============================================================================

export interface PolySportsMarket {
    conditionId: string;
    question: string;
    slug: string;
    sport: PolySportType;
    homeTeam: string;
    awayTeam: string;
    gameStartTime?: string;

    // 市场类型
    marketType: PolyMarketType;

    // Token (moneyline binary only)
    awayTokenId: string;        // clobTokenIds[0]
    homeTokenId: string;        // clobTokenIds[1]
    negRisk: boolean;
    tickSize: number;

    // 赔率 (来自 outcomePrices 或订单簿)
    awayPrice: number;
    homePrice: number;

    // 订单簿 (moneyline binary only)
    orderbook: PolySportsOrderbook;

    // 元数据
    volume: number;
    liquidity: number;
    eventTitle?: string;
    eventSlug?: string;

    // 多选 (three-way / futures / outright)
    isThreeWay?: boolean;
    selections?: PolySportsSelection[];

    lastUpdated: number;
}

export interface PolySportsOrderbook {
    awayBid: number; awayAsk: number;
    awayBidDepth: number; awayAskDepth: number;
    homeBid: number; homeAsk: number;
    homeBidDepth: number; homeAskDepth: number;
}

export interface PolySportsSelection {
    label: string;          // "Home"/"Draw"/"Away"
    conditionId: string;
    tokenId: string;        // YES token (clobTokenIds[0])
    noTokenId: string;      // NO token (clobTokenIds[1]) — 对冲腿使用
    price: number;
    bid: number; ask: number;
    bidDepth: number; askDepth: number;
}

export interface PolySportsSelectionView {
    label: string;
    conditionId: string;
    tokenId: string;
    noTokenId?: string;     // NO token — 对冲腿使用
    price: number;
    bid: number;
    ask: number;
    bidDepth: number;
    askDepth: number;
}

export interface PolySportsMarketView {
    conditionId: string;
    question: string;
    sport: PolySportType;
    homeTeam: string;
    awayTeam: string;
    gameStartTime?: string;
    marketType: PolyMarketType;
    awayTokenId: string;
    homeTokenId: string;
    negRisk: boolean;
    tickSize: number;
    awayPrice: number;
    homePrice: number;
    orderbook: PolySportsOrderbook;
    volume: number;
    liquidity: number;
    eventTitle?: string;
    isThreeWay?: boolean;
    selections?: PolySportsSelectionView[];
    rewardsDailyRate?: number;
}

// ============================================================================
// SSE 推送类型
// ============================================================================

export interface PolySportsSSE {
    snapshot?: boolean;
    updated: PolySportsMarketView[];
    removed: string[];          // conditionId 列表
    stats: PolySportsStats;
    balance?: number;
    lastUpdate: number;
}

export interface PolySportsStats {
    total: number;
    cachedTotal: number;
    activeTaskMarkets: number;
    bySport: Record<PolySportType, number>;
    rewardsBySport: Record<PolySportType, number>;
    totalRewards: number;
}
