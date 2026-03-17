/**
 * Polymarket Sports Service
 *
 * Standalone poly-multi only needs Polymarket market data, but the refresh
 * policy is split into:
 * - cached universe: keep all matched markets in memory
 * - visible window: only surface markets that start within 48 hours
 * - hot lane: active-task markets refresh at 100ms
 * - cold lane: visible non-task markets refresh at 500ms
 */

import { PolymarketRestClient } from '../polymarket/rest-client.js';
import type {
    PolySportType,
    PolySportsMarket,
    PolySportsMarketView,
    PolySportsSSE,
    PolyTokenMarketMetadata,
    PolySportsSelection,
    PolySportsSelectionView,
    PolySportsStats,
} from './types.js';

const MARKET_REFRESH_INTERVAL = 60_000;
const HOT_ORDERBOOK_REFRESH_INTERVAL = 100;
const COLD_ORDERBOOK_REFRESH_INTERVAL = 500;
const FRONTEND_VISIBILITY_WINDOW_MS = 48 * 60 * 60 * 1000;
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const FETCH_TIMEOUT_MS = 10_000;
const BROAD_LIMIT = 500;
const BROAD_MAX_PAGES = 6;

const POLY_SPORT_TAG_IDS: Record<string, number> = {
    nba: 745,
    nhl: 899,
    football: 82,
    lol: 65,
};

const SLUG_SPORT_MAP: [RegExp, PolySportType][] = [
    [/^nba-/, 'nba'],
    [/^nhl-/, 'nhl'],
    [/^(epl|la-liga|serie-a|bundesliga|ligue-1|soccer|ucl|mls|copa)-/, 'football'],
    [/^lol-/, 'lol'],
    [/^cs2?-/, 'cs2'],
    [/^dota-/, 'dota2'],
];

const IGNORED_SLUG_PREFIXES = /^(cbb|cwbb|cfb|ncaa|ufc|wbc|cricc|shl|snhl|khl|ahl|dehl|cehl|wll|pll|bknbl|euroleague|crint)-/;

interface GammaMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    outcomes: string;
    outcomePrices: string;
    clobTokenIds: string;
    endDate: string;
    volume: string;
    liquidity: string;
    active: boolean;
    closed: boolean;
    gameStartTime?: string;
    neg_risk?: boolean;
    negRisk?: boolean;
    groupItemTitle?: string;
    events?: Array<{
        title?: string;
        slug?: string;
    }>;
}

function safeParseJSON<T>(str: string | null | undefined): T | null {
    if (!str) return null;
    try {
        return JSON.parse(str) as T;
    } catch {
        return null;
    }
}

function detectSportFromSlug(slug: string): PolySportType | null {
    const normalized = slug.toLowerCase();
    if (IGNORED_SLUG_PREFIXES.test(normalized)) return null;
    for (const [pattern, sport] of SLUG_SPORT_MAP) {
        if (pattern.test(normalized)) {
            return sport;
        }
    }
    return null;
}

function isVsHeadToHead(market: GammaMarket): boolean {
    const eventTitle = (market.events?.[0]?.title || '').trim();
    if (!eventTitle) return false;
    return /\bvs\.?\s+/i.test(eventTitle) || /\s@\s/.test(eventTitle);
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

function createEmptyOrderbook() {
    return {
        awayBid: 0,
        awayAsk: 0,
        awayBidDepth: 0,
        awayAskDepth: 0,
        homeBid: 0,
        homeAsk: 0,
        homeBidDepth: 0,
        homeAskDepth: 0,
    };
}

function resetSelectionOrderbook(selection: PolySportsSelection): void {
    selection.bid = 0;
    selection.ask = 0;
    selection.bidDepth = 0;
    selection.askDepth = 0;
}

function resetMarketOrderbook(market: PolySportsMarket): void {
    market.orderbook = createEmptyOrderbook();
    if (market.selections) {
        for (const selection of market.selections) {
            resetSelectionOrderbook(selection);
        }
    }
}

export class PolySportsService {
    private readonly polyClient = new PolymarketRestClient();
    private readonly markets = new Map<string, PolySportsMarket>();
    private readonly lastBroadcastSnapshots = new Map<string, string>();
    private readonly tokenMetadata = new Map<string, PolyTokenMarketMetadata>();
    private activeTaskTokenIds = new Set<string>();

    private marketRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private hotOrderbookRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private coldOrderbookRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private onUpdate: ((data: PolySportsSSE) => void) | null = null;
    private hotRefreshInFlight = false;
    private coldRefreshInFlight = false;

    async start(onUpdate: (data: PolySportsSSE) => void): Promise<void> {
        this.onUpdate = onUpdate;
        console.log('[PolySports] Starting sports service...');

        await this.fetchMarkets();
        const initialTouched = await this.refreshOrderbooks('all');
        this.broadcast(true, initialTouched);

        this.marketRefreshTimer = setInterval(() => {
            this.fetchMarkets().catch(error => {
                console.error('[PolySports] Market refresh failed:', error.message);
            });
        }, MARKET_REFRESH_INTERVAL);

        this.hotOrderbookRefreshTimer = setInterval(() => {
            if (this.hotRefreshInFlight) return;
            this.hotRefreshInFlight = true;
            this.refreshOrderbooks('hot')
                .then(touchedMarketIds => this.broadcast(false, touchedMarketIds))
                .catch(error => console.error('[PolySports] Hot orderbook refresh failed:', error.message))
                .finally(() => {
                    this.hotRefreshInFlight = false;
                });
        }, HOT_ORDERBOOK_REFRESH_INTERVAL);

        this.coldOrderbookRefreshTimer = setInterval(() => {
            if (this.coldRefreshInFlight) return;
            this.coldRefreshInFlight = true;
            this.refreshOrderbooks('cold')
                .then(touchedMarketIds => this.broadcast(false, touchedMarketIds))
                .catch(error => console.error('[PolySports] Cold orderbook refresh failed:', error.message))
                .finally(() => {
                    this.coldRefreshInFlight = false;
                });
        }, COLD_ORDERBOOK_REFRESH_INTERVAL);

        console.log(`[PolySports] Service ready: cached=${this.markets.size}, visible=${this.getVisibleMarkets().length}`);
    }

    stop(): void {
        if (this.marketRefreshTimer) clearInterval(this.marketRefreshTimer);
        if (this.hotOrderbookRefreshTimer) clearInterval(this.hotOrderbookRefreshTimer);
        if (this.coldOrderbookRefreshTimer) clearInterval(this.coldOrderbookRefreshTimer);
        this.marketRefreshTimer = null;
        this.hotOrderbookRefreshTimer = null;
        this.coldOrderbookRefreshTimer = null;
    }

    setActiveTaskTokens(tokenIds: string[]): void {
        const next = new Set(
            tokenIds
                .map(tokenId => String(tokenId || '').trim())
                .filter(Boolean),
        );

        const current = Array.from(this.activeTaskTokenIds).sort();
        const incoming = Array.from(next).sort();
        if (current.length === incoming.length && current.every((value, index) => value === incoming[index])) {
            return;
        }

        this.activeTaskTokenIds = next;
        this.trimDormantMarkets();

        void this.refreshOrderbooks('hot')
            .then(() => this.broadcast(false))
            .catch(error => {
                console.warn('[PolySports] Active task hot refresh failed:', error?.message || error);
                this.broadcast(false);
            });
    }

    getSnapshot(): PolySportsSSE {
        return {
            snapshot: true,
            updated: this.getVisibleMarkets(),
            removed: [],
            stats: this.getStats(),
            lastUpdate: Date.now(),
        };
    }

    getAllMarkets(): PolySportsMarketView[] {
        return this.getVisibleMarkets();
    }

    getTokenMetadata(tokenId: string): PolyTokenMarketMetadata | null {
        return this.tokenMetadata.get(String(tokenId || '').trim()) || null;
    }

    private async fetchMarkets(): Promise<void> {
        const startTime = Date.now();
        const allRawMarkets: GammaMarket[] = [];

        const tagIds = Object.entries(POLY_SPORT_TAG_IDS);
        const tagResults: { name: string; count: number }[] = [];

        const tagFetches = tagIds.map(async ([sport, tagId]) => {
            try {
                const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=50&tag_id=${tagId}&sports_market_types=moneyline`;
                const res = await fetchWithTimeout(url);
                if (!res.ok) {
                    tagResults.push({ name: sport, count: 0 });
                    return [];
                }
                const markets = await res.json() as GammaMarket[];
                tagResults.push({ name: sport, count: markets.length });
                return markets;
            } catch (error: any) {
                tagResults.push({ name: sport, count: 0 });
                console.warn(`[PolySports] Tag ${sport} fetch failed: ${error.message}`);
                return [];
            }
        });

        allRawMarkets.push(...(await Promise.all(tagFetches)).flat());

        let broadCount = 0;
        for (let page = 0; page < BROAD_MAX_PAGES; page += 1) {
            try {
                const offset = page * BROAD_LIMIT;
                const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${BROAD_LIMIT}&offset=${offset}&sports_market_types=moneyline`;
                const res = await fetchWithTimeout(url);
                if (!res.ok) break;
                const pageMarkets = await res.json() as GammaMarket[];
                if (!Array.isArray(pageMarkets) || pageMarkets.length === 0) break;
                allRawMarkets.push(...pageMarkets);
                broadCount += pageMarkets.length;
                if (pageMarkets.length < BROAD_LIMIT) break;
            } catch (error: any) {
                console.warn(`[PolySports] Broad page ${page} fetch failed: ${error.message}`);
                break;
            }
        }

        const tagSummary = tagResults.map(result => `${result.name}:${result.count}`).join(', ');
        console.log(`[PolySports] Source counts: tags(${tagSummary}) broad:${broadCount}`);

        const deduped = Array.from(new Map(allRawMarkets.map(market => [market.id, market])).values());
        const vsMarkets = deduped.filter(isVsHeadToHead);

        const nextMarkets = new Map<string, PolySportsMarket>();
        this.buildMarkets(vsMarkets, nextMarkets);

        for (const [id, market] of nextMarkets) {
            const previous = this.markets.get(id);
            if (!previous) continue;

            market.orderbook = previous.orderbook;
            market.lastUpdated = previous.lastUpdated;
            if (market.selections && previous.selections) {
                for (let index = 0; index < market.selections.length && index < previous.selections.length; index += 1) {
                    const nextSelection = market.selections[index];
                    const prevSelection = previous.selections[index];
                    if (nextSelection.conditionId !== prevSelection.conditionId) continue;
                    nextSelection.bid = prevSelection.bid;
                    nextSelection.ask = prevSelection.ask;
                    nextSelection.bidDepth = prevSelection.bidDepth;
                    nextSelection.askDepth = prevSelection.askDepth;
                }
            }
        }

        this.markets.clear();
        for (const [id, market] of nextMarkets) {
            this.markets.set(id, market);
        }
        this.rebuildTokenMetadataIndex();

        this.trimDormantMarkets();

        const typeCounts: Record<string, number> = {};
        for (const market of this.markets.values()) {
            typeCounts[market.marketType] = (typeCounts[market.marketType] || 0) + 1;
        }
        const typeSummary = Object.entries(typeCounts).map(([key, value]) => `${key}:${value}`).join(', ');
        console.log(`[PolySports] Cached ${this.markets.size} markets [${typeSummary}] in ${Date.now() - startTime}ms`);
    }

    private buildMarkets(rawMarkets: GammaMarket[], out: Map<string, PolySportsMarket>): void {
        const eventGroups = new Map<string, GammaMarket[]>();
        const standaloneMarkets: GammaMarket[] = [];
        const now = Date.now();

        for (const market of rawMarkets) {
            if (market.closed) continue;

            const endTime = market.endDate ? new Date(market.endDate).getTime() : 0;
            const startTime = market.gameStartTime ? new Date(market.gameStartTime).getTime() : 0;
            const latestTime = Math.max(endTime, startTime);
            if (latestTime > 0 && latestTime < now - 6 * 3600_000) continue;

            const isNegRisk = market.neg_risk || market.negRisk || false;
            if (isNegRisk) {
                if (!detectSportFromSlug(market.slug)) continue;
                const eventSlug = market.events?.[0]?.slug || market.slug;
                const baseSlug = this.getEventBaseSlug(eventSlug);
                if (!eventGroups.has(baseSlug)) {
                    eventGroups.set(baseSlug, []);
                }
                eventGroups.get(baseSlug)!.push(market);
                continue;
            }

            standaloneMarkets.push(market);
        }

        for (const market of standaloneMarkets) {
            const key = market.conditionId;
            if (out.has(key)) continue;

            const outcomes = safeParseJSON<string[]>(market.outcomes) || [];
            const prices = safeParseJSON<number[]>(market.outcomePrices) || [];
            const tokenIds = safeParseJSON<string[]>(market.clobTokenIds) || [];
            if (tokenIds.length < 2) continue;

            const sport = detectSportFromSlug(market.slug);
            if (!sport) continue;

            out.set(key, {
                conditionId: key,
                question: market.question || '',
                slug: market.slug || '',
                sport,
                marketType: 'moneyline',
                homeTeam: outcomes[1]?.trim() || 'Home',
                awayTeam: outcomes[0]?.trim() || 'Away',
                gameStartTime: market.gameStartTime || market.endDate || undefined,
                awayTokenId: tokenIds[0],
                homeTokenId: tokenIds[1],
                negRisk: false,
                tickSize: 0.01,
                awayPrice: prices[0] || 0,
                homePrice: prices[1] || 0,
                orderbook: createEmptyOrderbook(),
                volume: parseFloat(market.volume || '0') || 0,
                liquidity: parseFloat(market.liquidity || '0') || 0,
                eventTitle: market.events?.[0]?.title || market.question || undefined,
                eventSlug: market.events?.[0]?.slug || market.slug || undefined,
                lastUpdated: 0,
            });
        }

        for (const [baseSlug, group] of eventGroups) {
            if (group.length < 2) continue;

            const primaryMarket = group[0];
            const eventTitle = primaryMarket.events?.[0]?.title || primaryMarket.question || '';
            const sport = detectSportFromSlug(primaryMarket.slug);
            if (!sport) continue;

            const vsMatch = eventTitle.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
            const homeTeam = vsMatch ? vsMatch[1].trim() : 'Home';
            const awayTeam = vsMatch ? vsMatch[2].trim() : 'Away';

            const selections: PolySportsSelection[] = [];
            let totalVolume = 0;
            let totalLiquidity = 0;

            for (const market of group) {
                const tokenIds = safeParseJSON<string[]>(market.clobTokenIds) || [];
                if (tokenIds.length < 2) continue;
                const prices = safeParseJSON<number[]>(market.outcomePrices) || [];
                const label = market.groupItemTitle || market.question || 'Unknown';

                selections.push({
                    label,
                    conditionId: market.conditionId,
                    tokenId: tokenIds[0],
                    noTokenId: tokenIds[1] || '',
                    price: prices[0] || 0,
                    bid: 0,
                    ask: 0,
                    bidDepth: 0,
                    askDepth: 0,
                });

                totalVolume += parseFloat(market.volume || '0') || 0;
                totalLiquidity += parseFloat(market.liquidity || '0') || 0;
            }

            selections.sort((left, right) => {
                const getOrder = (selection: PolySportsSelection) => {
                    const label = selection.label.toLowerCase();
                    if (label.includes('draw') || label.includes('tie')) return 1;
                    if (label.includes(homeTeam.toLowerCase()) || label.startsWith(homeTeam.split(' ')[0].toLowerCase())) return 0;
                    return 2;
                };
                return getOrder(left) - getOrder(right);
            });

            const isThreeWay = group.length === 3 && selections.some(selection =>
                selection.label.toLowerCase().includes('draw') || selection.label.toLowerCase().includes('tie'),
            );

            const eventKey = `event-${baseSlug}`;
            out.set(eventKey, {
                conditionId: eventKey,
                question: eventTitle,
                slug: baseSlug,
                sport,
                marketType: isThreeWay ? 'three-way' : 'futures',
                homeTeam,
                awayTeam,
                gameStartTime: primaryMarket.gameStartTime || primaryMarket.endDate || undefined,
                awayTokenId: '',
                homeTokenId: '',
                negRisk: true,
                tickSize: 0.01,
                awayPrice: 0,
                homePrice: 0,
                orderbook: createEmptyOrderbook(),
                volume: totalVolume,
                liquidity: totalLiquidity,
                eventTitle: eventTitle || undefined,
                eventSlug: baseSlug || undefined,
                isThreeWay,
                selections,
                lastUpdated: 0,
            });
        }
    }

    private getEventBaseSlug(slug: string): string {
        const dateMatch = slug.match(/^(.+?-\d{4}-\d{2}-\d{2})(?:-.+)?$/);
        return dateMatch ? dateMatch[1] : slug;
    }

    private rebuildTokenMetadataIndex(): void {
        this.tokenMetadata.clear();

        for (const market of this.markets.values()) {
            if (market.selections?.length) {
                for (const selection of market.selections) {
                    if (!selection.tokenId) continue;
                    this.tokenMetadata.set(selection.tokenId, {
                        tokenId: selection.tokenId,
                        conditionId: selection.conditionId,
                        question: market.question,
                        eventTitle: market.eventTitle,
                        selectionLabel: selection.label,
                        sport: market.sport,
                        marketType: market.marketType,
                    });
                }
                continue;
            }

            if (market.awayTokenId) {
                this.tokenMetadata.set(market.awayTokenId, {
                    tokenId: market.awayTokenId,
                    conditionId: market.conditionId,
                    question: market.question,
                    eventTitle: market.eventTitle,
                    selectionLabel: market.awayTeam,
                    sport: market.sport,
                    marketType: market.marketType,
                });
            }

            if (market.homeTokenId) {
                this.tokenMetadata.set(market.homeTokenId, {
                    tokenId: market.homeTokenId,
                    conditionId: market.conditionId,
                    question: market.question,
                    eventTitle: market.eventTitle,
                    selectionLabel: market.homeTeam,
                    sport: market.sport,
                    marketType: market.marketType,
                });
            }
        }
    }

    private async refreshOrderbooks(mode: 'hot' | 'cold' | 'all'): Promise<Set<string>> {
        const { tokenIds, tokenToMarket } = this.collectRefreshTargets(mode);
        const touchedMarketIds = new Set<string>(
            Array.from(tokenToMarket.values()).map(mapping => mapping.marketId),
        );

        if (tokenIds.length === 0) {
            return touchedMarketIds;
        }

        try {
            const chunks: string[][] = [];
            for (let index = 0; index < tokenIds.length; index += 500) {
                chunks.push(tokenIds.slice(index, index + 500));
            }

            const allBooks = (await Promise.all(
                chunks.map(chunk => this.polyClient.getOrderBooks(chunk)),
            )).flat();

            const now = Date.now();
            for (const book of allBooks) {
                const normalized = this.polyClient.normalizeOrderBook(book);
                const mapping = tokenToMarket.get(book.asset_id);
                if (!mapping) continue;

                const market = this.markets.get(mapping.marketId);
                if (!market) continue;

                const bestBid = normalized.bids[0]?.[0] || 0;
                const bestAsk = normalized.asks[0]?.[0] || 0;
                const bidDepth = normalized.bids.reduce((sum, [, size]) => sum + size, 0);
                const askDepth = normalized.asks.reduce((sum, [, size]) => sum + size, 0);

                if (normalized.tickSize > 0) {
                    market.tickSize = normalized.tickSize;
                }

                if (market.selections && mapping.selectionIdx !== undefined) {
                    const selection = market.selections[mapping.selectionIdx];
                    if (selection) {
                        selection.bid = bestBid;
                        selection.ask = bestAsk;
                        selection.bidDepth = bidDepth;
                        selection.askDepth = askDepth;
                        if (bestAsk > 0 && bestAsk < 1) {
                            selection.price = bestAsk;
                        }
                    }
                } else if (mapping.side === 'away') {
                    market.orderbook.awayBid = bestBid;
                    market.orderbook.awayAsk = bestAsk;
                    market.orderbook.awayBidDepth = bidDepth;
                    market.orderbook.awayAskDepth = askDepth;
                    if (bestAsk > 0 && bestAsk < 1) {
                        market.awayPrice = bestAsk;
                    }
                } else {
                    market.orderbook.homeBid = bestBid;
                    market.orderbook.homeAsk = bestAsk;
                    market.orderbook.homeBidDepth = bidDepth;
                    market.orderbook.homeAskDepth = askDepth;
                    if (bestAsk > 0 && bestAsk < 1) {
                        market.homePrice = bestAsk;
                    }
                }

                market.lastUpdated = now;
            }
        } catch (error: any) {
            console.error(`[PolySports] Batch orderbook refresh failed (${mode}): ${error.message}`);
        }

        return touchedMarketIds;
    }

    private collectRefreshTargets(mode: 'hot' | 'cold' | 'all'): {
        tokenIds: string[];
        tokenToMarket: Map<string, { marketId: string; side: 'away' | 'home'; selectionIdx?: number }>;
    } {
        const now = Date.now();
        const tokenIds: string[] = [];
        const tokenToMarket = new Map<string, { marketId: string; side: 'away' | 'home'; selectionIdx?: number }>();
        const tokenIdSet = new Set<string>();

        for (const [marketId, market] of this.markets) {
            const isHot = this.isHotMarket(market);
            const isVisible = this.isVisibleToFrontend(market, now);

            const shouldRefresh =
                mode === 'all'
                    ? isVisible || isHot
                    : mode === 'hot'
                        ? isHot
                        : isVisible && !isHot;

            if (!shouldRefresh) continue;

            if (market.selections?.length) {
                for (let index = 0; index < market.selections.length; index += 1) {
                    const selection = market.selections[index];
                    if (!selection.tokenId || tokenIdSet.has(selection.tokenId)) continue;
                    tokenIds.push(selection.tokenId);
                    tokenIdSet.add(selection.tokenId);
                    tokenToMarket.set(selection.tokenId, {
                        marketId,
                        side: 'away',
                        selectionIdx: index,
                    });
                }
                continue;
            }

            if (market.awayTokenId && !tokenIdSet.has(market.awayTokenId)) {
                tokenIds.push(market.awayTokenId);
                tokenIdSet.add(market.awayTokenId);
                tokenToMarket.set(market.awayTokenId, { marketId, side: 'away' });
            }

            if (market.homeTokenId && !tokenIdSet.has(market.homeTokenId)) {
                tokenIds.push(market.homeTokenId);
                tokenIdSet.add(market.homeTokenId);
                tokenToMarket.set(market.homeTokenId, { marketId, side: 'home' });
            }
        }

        return { tokenIds, tokenToMarket };
    }

    private isVisibleToFrontend(market: PolySportsMarket, now = Date.now()): boolean {
        if (this.isHotMarket(market)) return true;
        if (!market.gameStartTime) return true;
        const startTime = new Date(market.gameStartTime).getTime();
        if (!Number.isFinite(startTime)) return true;
        return startTime <= now + FRONTEND_VISIBILITY_WINDOW_MS;
    }

    private isHotMarket(market: PolySportsMarket): boolean {
        for (const tokenId of this.getMarketTokenIds(market)) {
            if (this.activeTaskTokenIds.has(tokenId)) {
                return true;
            }
        }
        return false;
    }

    private getMarketTokenIds(market: PolySportsMarket): string[] {
        if (market.selections?.length) {
            return market.selections
                .map(selection => selection.tokenId)
                .filter(Boolean);
        }
        return [market.awayTokenId, market.homeTokenId].filter(Boolean);
    }

    private trimDormantMarkets(): void {
        const now = Date.now();
        for (const market of this.markets.values()) {
            if (this.isVisibleToFrontend(market, now) || this.isHotMarket(market)) {
                continue;
            }
            resetMarketOrderbook(market);
            market.lastUpdated = 0;
        }
    }

    private getVisibleMarkets(): PolySportsMarketView[] {
        const now = Date.now();
        const visibleMarkets: PolySportsMarketView[] = [];
        for (const market of this.markets.values()) {
            if (!this.isVisibleToFrontend(market, now)) continue;
            visibleMarkets.push(this.serializeMarket(market));
        }
        return visibleMarkets;
    }

    private serializeMarket(market: PolySportsMarket): PolySportsMarketView {
        return {
            conditionId: market.conditionId,
            question: market.question,
            sport: market.sport,
            homeTeam: market.homeTeam,
            awayTeam: market.awayTeam,
            gameStartTime: market.gameStartTime,
            marketType: market.marketType,
            awayTokenId: market.awayTokenId,
            homeTokenId: market.homeTokenId,
            negRisk: market.negRisk,
            tickSize: market.tickSize,
            awayPrice: market.awayPrice,
            homePrice: market.homePrice,
            orderbook: market.orderbook,
            volume: market.volume,
            liquidity: market.liquidity,
            eventTitle: market.eventTitle,
            isThreeWay: market.isThreeWay,
            selections: market.selections?.map<PolySportsSelectionView>(selection => ({
                label: selection.label,
                conditionId: selection.conditionId,
                tokenId: selection.tokenId,
                noTokenId: selection.noTokenId,
                price: selection.price,
                bid: selection.bid,
                ask: selection.ask,
                bidDepth: selection.bidDepth,
                askDepth: selection.askDepth,
            })),
        };
    }

    private broadcast(isSnapshot: boolean, candidateMarketIds?: Iterable<string>): void {
        if (!this.onUpdate) return;

        if (isSnapshot) {
            this.lastBroadcastSnapshots.clear();
            const visibleMarkets = this.getVisibleMarkets();
            for (const market of visibleMarkets) {
                this.lastBroadcastSnapshots.set(market.conditionId, JSON.stringify(market));
            }
            this.onUpdate({
                snapshot: true,
                updated: visibleMarkets,
                removed: [],
                stats: this.getStats(),
                lastUpdate: Date.now(),
            });
            return;
        }

        const now = Date.now();
        const currentVisibleIds = new Set<string>();
        const updated: PolySportsMarketView[] = [];
        const candidateIds = candidateMarketIds ? new Set(candidateMarketIds) : null;

        for (const [marketId, market] of this.markets) {
            if (!this.isVisibleToFrontend(market, now)) continue;
            currentVisibleIds.add(marketId);

            if (candidateIds && !candidateIds.has(marketId)) {
                continue;
            }

            const serialized = this.serializeMarket(market);
            const json = JSON.stringify(serialized);
            if (this.lastBroadcastSnapshots.get(marketId) === json) {
                continue;
            }

            updated.push(serialized);
            this.lastBroadcastSnapshots.set(marketId, json);
        }

        const removed: string[] = [];
        for (const marketId of Array.from(this.lastBroadcastSnapshots.keys())) {
            if (currentVisibleIds.has(marketId)) continue;
            removed.push(marketId);
            this.lastBroadcastSnapshots.delete(marketId);
        }

        if (updated.length === 0 && removed.length === 0) {
            return;
        }

        this.onUpdate({
            snapshot: false,
            updated,
            removed,
            stats: this.getStats(),
            lastUpdate: Date.now(),
        });
    }

    private getStats(): PolySportsStats {
        const bySport: Record<PolySportType, number> = {
            nba: 0,
            nhl: 0,
            football: 0,
            lol: 0,
            cs2: 0,
            dota2: 0,
        };

        let total = 0;
        let activeTaskMarkets = 0;
        const now = Date.now();

        for (const market of this.markets.values()) {
            const isVisible = this.isVisibleToFrontend(market, now);
            if (isVisible) {
                total += 1;
                bySport[market.sport] = (bySport[market.sport] || 0) + 1;
            }
            if (this.isHotMarket(market)) {
                activeTaskMarkets += 1;
            }
        }

        return {
            total,
            cachedTotal: this.markets.size,
            activeTaskMarkets,
            bySport,
        };
    }
}
