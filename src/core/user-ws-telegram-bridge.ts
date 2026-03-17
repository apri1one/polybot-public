import { createHash } from 'node:crypto';

import type { ISportsMetadataProvider, PolyTokenMarketMetadata } from '../types.js';
import { createTelegramNotifier, type TelegramNotifier } from '../notification/telegram.js';
import {
    PolymarketUserWsClient,
    type OrderEvent,
    type TradeEvent,
    type UserWsAuth,
} from '../polymarket/user-ws-client.js';
import type { PairingService } from './pairing-service.js';
import type { PolyMultiTask } from './task-types.js';
import type { WalletManager } from './wallet-manager.js';

const TERMINAL_TASK_STATUSES = new Set<PolyMultiTask['status']>(['PARTIAL', 'COMPLETED', 'CANCELLED', 'FAILED']);
const NOTIFICATION_DEDUPE_TTL_MS = 60_000;
const ORDER_CONTEXT_TTL_MS = 10 * 60_000;

export interface WsHedgeFillEvent {
    orderId: string;
    filledQty: number;
    avgPrice: number;
}

interface PolyMultiUserWsTelegramBridgeOptions {
    sportsService: ISportsMetadataProvider;
    walletManager: WalletManager;
    pairingService: PairingService;
    getTasks: () => PolyMultiTask[];
    getActiveHedgeOrderIds?: () => Set<string>;
    onHedgeFill?: (event: WsHedgeFillEvent) => void;
}

interface ClientSpec {
    key: string;
    label: string;
    auth: UserWsAuth;
}

interface ClientRuntime {
    label: string;
    client: PolymarketUserWsClient;
    listenerIds: string[];
}

interface OrderContext {
    metadata: PolyTokenMarketMetadata | null;
    assetId: string;
    conditionId: string;
    outcome?: string;
    side: 'BUY' | 'SELL';
    timestamp: number;
}

function readEnvAuth(): UserWsAuth | null {
    const apiKey = process.env.POLYMARKET_API_KEY;
    const secret = process.env.POLYMARKET_API_SECRET;
    const passphrase = process.env.POLYMARKET_PASSPHRASE;
    if (!apiKey || !secret || !passphrase) {
        return null;
    }
    return { apiKey, secret, passphrase };
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(
        values
            .map(value => String(value || '').trim())
            .filter(Boolean),
    ));
}

function formatTimestamp(timestamp: string | number | undefined): string {
    if (timestamp === undefined) {
        return new Date().toLocaleString('zh-CN', { hour12: false });
    }

    const raw = typeof timestamp === 'number' ? String(timestamp) : String(timestamp);
    const numeric = Number.parseInt(raw, 10);
    if (Number.isFinite(numeric)) {
        const normalized = numeric > 1e12 ? numeric : numeric * 1000;
        return new Date(normalized).toLocaleString('zh-CN', { hour12: false });
    }

    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) {
        return parsed.toLocaleString('zh-CN', { hour12: false });
    }

    return new Date().toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export class PolyMultiUserWsTelegramBridge {
    private readonly telegram: TelegramNotifier | null;
    private readonly clients = new Map<string, ClientRuntime>();
    private readonly recentNotifications = new Map<string, number>();
    private readonly orderContexts = new Map<string, OrderContext>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private syncTimer: ReturnType<typeof setInterval> | null = null;
    private started = false;

    constructor(private readonly options: PolyMultiUserWsTelegramBridgeOptions) {
        const botToken = process.env.POLY_MULTI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.POLY_MULTI_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        this.telegram = botToken && chatId
            ? createTelegramNotifier({
                botToken,
                chatId,
                enabled: true,
            })
            : null;
    }

    enabled(): boolean {
        return Boolean(this.telegram);
    }

    async start(): Promise<void> {
        if (this.started || !this.telegram) return;

        this.started = true;
        this.cleanupTimer = setInterval(() => this.cleanupCaches(), 60_000);
        this.syncTimer = setInterval(() => {
            void this.sync().catch(error => {
                console.warn(`[PolyMulti TG WS] periodic sync failed: ${error?.message || error}`);
            });
        }, 15_000);
        await this.sync();
    }

    async sync(): Promise<void> {
        if (!this.started || !this.telegram) {
            return;
        }

        const conditionIds = uniqueStrings(
            this.options
                .getTasks()
                .filter(task => !TERMINAL_TASK_STATUSES.has(task.status))
                .map(task => task.conditionId),
        );

        if (conditionIds.length === 0) {
            this.destroyAllClients();
            return;
        }

        const specs = this.buildClientSpecs();
        const nextKeys = new Set(specs.map(spec => spec.key));

        for (const [key, runtime] of this.clients) {
            if (nextKeys.has(key)) continue;
            this.destroyClient(key, runtime);
        }

        for (const spec of specs) {
            await this.upsertClient(spec, conditionIds);
        }
    }

    stop(): void {
        this.started = false;
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        this.destroyAllClients();
        this.recentNotifications.clear();
        this.orderContexts.clear();
    }

    private buildClientSpecs(): ClientSpec[] {
        const specsByKey = new Map<string, ClientSpec>();
        const pushSpec = (label: string, auth: UserWsAuth | null) => {
            if (!auth) return;
            const key = createHash('sha1')
                .update(`${auth.apiKey}:${auth.passphrase}:${auth.secret}`)
                .digest('hex');
            if (specsByKey.has(key)) return;
            specsByKey.set(key, { key, label, auth });
        };

        pushSpec('Env Trader', readEnvAuth());

        for (const pairing of this.options.pairingService.listActivePairings()) {
            const wallets = [pairing.masterWallet, ...(pairing.hedgeWallet ? [pairing.hedgeWallet] : [])];
            for (const wallet of wallets) {
                const creds = this.options.walletManager.getCredentials(wallet.id);
                if (!creds) continue;
                pushSpec(wallet.label, {
                    apiKey: creds.apiKey,
                    secret: creds.apiSecret,
                    passphrase: creds.passphrase,
                });
            }
        }

        return Array.from(specsByKey.values());
    }

    private async upsertClient(spec: ClientSpec, conditionIds: string[]): Promise<void> {
        const existing = this.clients.get(spec.key);
        if (existing) {
            await existing.client.resubscribeMarkets(conditionIds);
            return;
        }

        const client = new PolymarketUserWsClient(spec.auth, {
            markets: conditionIds,
            pingIntervalMs: 10_000,
        });

        const runtime: ClientRuntime = {
            label: spec.label,
            client,
            listenerIds: [],
        };

        runtime.listenerIds = [
            client.addOrderEventListener(event => {
                void this.handleOrderEvent(spec.key, runtime.label, event);
            }),
            client.addTradeEventListener(event => {
                void this.handleTradeEvent(spec.key, runtime.label, event);
            }),
            client.addErrorListener(error => {
                console.warn(`[PolyMulti TG WS] ${runtime.label} user WS error: ${error.message}`);
            }),
            client.addDisconnectListener((code, reason) => {
                console.warn(`[PolyMulti TG WS] ${runtime.label} user WS disconnected: ${code} ${reason}`);
            }),
        ];

        await client.connect();
        this.clients.set(spec.key, runtime);
    }

    private destroyClient(key: string, runtime: ClientRuntime): void {
        for (const listenerId of runtime.listenerIds) {
            if (listenerId.startsWith('order_')) runtime.client.removeOrderEventListener(listenerId);
            if (listenerId.startsWith('trade_')) runtime.client.removeTradeEventListener(listenerId);
            if (listenerId.startsWith('error_')) runtime.client.removeErrorListener(listenerId);
            if (listenerId.startsWith('disconnect_')) runtime.client.removeDisconnectListener(listenerId);
        }
        runtime.client.disconnect();
        this.clients.delete(key);
    }

    private destroyAllClients(): void {
        for (const [key, runtime] of this.clients) {
            this.destroyClient(key, runtime);
        }
    }

    private async handleOrderEvent(clientKey: string, label: string, event: OrderEvent): Promise<void> {
        const metadata = this.options.sportsService.getTokenMetadata(event.asset_id);
        this.orderContexts.set(this.getOrderContextKey(clientKey, event.id), {
            metadata,
            assetId: event.asset_id,
            conditionId: event.market,
            outcome: event.outcome,
            side: event.side,
            timestamp: Date.now(),
        });

        const key = `${clientKey}:order:${event.id}:${event.type}:${event.status}:${event.size_matched}`;
        if (this.isDuplicate(key)) return;

        const price = Number.parseFloat(event.price || '0');
        const originalSize = Number.parseFloat(event.original_size || '0');
        const matchedSize = Number.parseFloat(event.size_matched || '0');
        const marketTitle = metadata?.eventTitle || metadata?.question || `Condition ${event.market.slice(0, 10)}...`;
        const selectionLabel = event.outcome || metadata?.selectionLabel || 'Unknown';
        const typeText = event.type === 'PLACEMENT'
            ? '📤 挂单提交'
            : event.type === 'CANCELLATION'
                ? '🛑 订单取消'
                : '🔄 订单更新';

        let quantityText = `${originalSize.toFixed(0)} shares`;
        if (event.type === 'UPDATE') {
            quantityText = `${matchedSize.toFixed(0)} / ${originalSize.toFixed(0)} shares`;
        } else if (event.type === 'CANCELLATION' && matchedSize > 0) {
            quantityText = `${matchedSize.toFixed(0)} / ${originalSize.toFixed(0)} shares`;
        }

        const sideText = event.side === 'BUY' ? '买入' : '卖出';

        await this.telegram!.sendText(
            `\n<b>${escapeHtml(typeText)}</b>\n` +
            `<b>账户:</b> ${escapeHtml(label)}\n` +
            `<b>市场:</b> ${escapeHtml(marketTitle)}\n` +
            `<b>选项:</b> ${escapeHtml(selectionLabel)}\n` +
            `<b>方向:</b> ${escapeHtml(sideText)}\n` +
            `<b>价格:</b> ${(price * 100).toFixed(1)}c\n` +
            `<b>数量:</b> ${escapeHtml(quantityText)}\n` +
            `<b>状态:</b> ${escapeHtml(String(event.status || 'LIVE'))}\n` +
            `<b>时间:</b> ${escapeHtml(formatTimestamp(event.timestamp))}\n` +
            `\n<i>via Polymarket User WS</i>`,
        );
    }

    private async handleTradeEvent(clientKey: string, label: string, event: TradeEvent): Promise<void> {
        if (!['CONFIRMED', 'FAILED'].includes(event.status)) {
            return;
        }

        const price = Number.parseFloat(event.price || '0');

        // 用户是 taker → 使用 event.size
        const takerContext = this.orderContexts.get(this.getOrderContextKey(clientKey, event.taker_order_id));
        if (takerContext) {
            const size = Number.parseFloat(event.size || '0');
            // 去重 key 不含 status，避免 MATCHED→CONFIRMED 重复推送
            const key = `${clientKey}:trade:${event.taker_order_id}:${size}`;
            if (!this.isDuplicate(key)) {
                await this.sendTradeNotification(label, event, takerContext, event.taker_order_id, size);
            }
            if (event.status === 'CONFIRMED' && size > 0) {
                this.tryEmitHedgeFill(event.taker_order_id, size, price);
            }
            return;
        }

        // 用户是 maker → 从 maker_orders 找到本账号订单，使用 matched_amount
        if (Array.isArray(event.maker_orders)) {
            for (const maker of event.maker_orders) {
                const ctx = this.orderContexts.get(this.getOrderContextKey(clientKey, maker.order_id));
                if (!ctx) continue;

                const matchedAmount = Number.parseFloat(maker.matched_amount || '0');
                if (matchedAmount <= 0) continue;

                const key = `${clientKey}:trade:${maker.order_id}:${matchedAmount}`;
                if (this.isDuplicate(key)) continue;

                await this.sendTradeNotification(label, event, ctx, maker.order_id, matchedAmount);
                if (event.status === 'CONFIRMED') {
                    this.tryEmitHedgeFill(maker.order_id, matchedAmount, price);
                }
            }
        }

        // taker/maker 均无 orderContext → 非本账号已知订单，跳过
    }

    private tryEmitHedgeFill(orderId: string, filledQty: number, avgPrice: number): void {
        const { getActiveHedgeOrderIds, onHedgeFill } = this.options;
        if (!getActiveHedgeOrderIds || !onHedgeFill) return;

        const activeIds = getActiveHedgeOrderIds();
        if (!activeIds.has(orderId)) return;

        // 去重: 同一 orderId + size 组合 60s 内不重复触发
        const dedupeKey = `hedge_fill:${orderId}:${filledQty}`;
        if (this.isDuplicate(dedupeKey)) return;

        onHedgeFill({ orderId, filledQty, avgPrice });
    }

    private async sendTradeNotification(
        label: string,
        event: TradeEvent,
        context: OrderContext,
        orderId: string,
        size: number,
    ): Promise<void> {
        const metadata = context.metadata || null;
        const marketTitle = metadata?.eventTitle || metadata?.question || `Order ${orderId.slice(0, 10)}...`;
        const selectionLabel = context.outcome || metadata?.selectionLabel || '未知';
        const price = Number.parseFloat(event.price || '0');
        const statusText = event.status === 'CONFIRMED'
            ? '✅ 成交确认'
            : event.status === 'FAILED'
                ? '❌ 成交失败'
                : '⛏️ 链上确认';
        const sideText = (context.side || event.side) === 'BUY' ? '买入' : '卖出';

        await this.telegram!.sendText(
            `\n<b>${escapeHtml(statusText)}</b>\n` +
            `<b>账户:</b> ${escapeHtml(label)}\n` +
            `<b>市场:</b> ${escapeHtml(marketTitle)}\n` +
            `<b>选项:</b> ${escapeHtml(selectionLabel)}\n` +
            `<b>方向:</b> ${escapeHtml(sideText)}\n` +
            `<b>价格:</b> ${(price * 100).toFixed(1)}c\n` +
            `<b>成交:</b> ${size.toFixed(0)} shares\n` +
            `<b>时间:</b> ${escapeHtml(formatTimestamp(event.timestamp))}\n` +
            `\n<i>via Polymarket User WS</i>`,
        );
    }

    private getOrderContextKey(clientKey: string, orderId: string): string {
        return `${clientKey}:${orderId}`;
    }

    private isDuplicate(key: string): boolean {
        const now = Date.now();
        const lastTime = this.recentNotifications.get(key);
        if (lastTime && now - lastTime < NOTIFICATION_DEDUPE_TTL_MS) {
            return true;
        }
        this.recentNotifications.set(key, now);
        return false;
    }

    private cleanupCaches(): void {
        const now = Date.now();

        for (const [key, timestamp] of this.recentNotifications) {
            if (now - timestamp > NOTIFICATION_DEDUPE_TTL_MS * 2) {
                this.recentNotifications.delete(key);
            }
        }

        for (const [key, context] of this.orderContexts) {
            if (now - context.timestamp > ORDER_CONTEXT_TTL_MS) {
                this.orderContexts.delete(key);
            }
        }
    }
}
