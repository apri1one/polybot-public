/**
 * 钱包查询服务 — 移植自 poly-query (Python)
 *
 * 查询 Polymarket 钱包的余额、持仓、交易量、最后活跃时间
 * 通过 Polygon RPC + Polymarket Data API
 */

import * as db from './db.js';
import type { WalletQueryResult, WalletQueryStatus } from './types.js';

// Polygon RPC 节点池
const POLYGON_RPC_URLS = [
    'https://polygon.drpc.org',
    'https://polygon-bor-rpc.publicnode.com',
    'https://137.rpc.thirdweb.com',
    'https://polygon.api.onfinality.io/public',
    'https://polygon-rpc.com',
    'https://polygon.gateway.tenderly.co',
    'https://polygon-bor.publicnode.com',
    'https://1rpc.io/matic',
];

// 合约地址
const SAFE_PROXY_FACTORY = '0xaacfeea03eb1561c4e67d661e40682bd20e3541b';
const COMPUTE_PROXY_SELECTOR = '0xd600539a';
const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const BALANCE_OF_SELECTOR = '0x70a08231';

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

let rpcIndex = 0;
function nextRpcUrl(): string {
    const url = POLYGON_RPC_URLS[rpcIndex % POLYGON_RPC_URLS.length];
    rpcIndex++;
    return url;
}

async function fetchWithRetry(doRequest: () => Promise<Response>, retries = MAX_RETRIES): Promise<any> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await doRequest();
            if (res.status === 429) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            return await res.json();
        } catch (e: unknown) {
            lastError = e as Error;
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
            }
        }
    }
    throw lastError;
}

// ---- RPC 查询 ----

async function rpcCall(to: string, data: string): Promise<string> {
    const result = await fetchWithRetry(() => {
        const url = nextRpcUrl();
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', method: 'eth_call',
                params: [{ to, data }, 'latest'], id: 1,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    });
    if (result.error) throw new Error(`RPC error: ${JSON.stringify(result.error)}`);
    return result.result || '0x';
}

function padAddress(address: string): string {
    return address.slice(2).toLowerCase().padStart(64, '0');
}

export async function getProxyAddress(eoa: string): Promise<string | null> {
    const data = COMPUTE_PROXY_SELECTOR + padAddress(eoa);
    const result = await rpcCall(SAFE_PROXY_FACTORY, data);
    if (result === '0x' || result.length < 66) return null;
    const addr = '0x' + result.slice(-40);
    if (addr === '0x0000000000000000000000000000000000000000') return null;
    return addr;
}

export async function getUsdcBalance(proxyAddress: string): Promise<number> {
    const data = BALANCE_OF_SELECTOR + padAddress(proxyAddress);
    const result = await rpcCall(USDC_CONTRACT, data);
    const wei = BigInt(result || '0x0');
    return Number(wei) / 1_000_000; // 6 decimals
}

// ---- REST 查询 ----

export async function getPositionValue(proxyAddress: string): Promise<number> {
    const result = await fetchWithRetry(() =>
        fetch(`${POLYMARKET_DATA_API}/positions?user=${proxyAddress.toLowerCase()}`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    );
    if (!Array.isArray(result)) return 0;
    let total = 0;
    for (const pos of result) {
        const val = Number(pos.currentValue);
        if (Number.isFinite(val)) total += val;
    }
    return total;
}

export async function getVolumeAndActivity(proxyAddress: string): Promise<{
    volume: number;
    lastTradeTime: number | null;
}> {
    const addr = proxyAddress.toLowerCase();

    // 1. Leaderboard API → volume
    const leaderboard = await fetchWithRetry(() =>
        fetch(`${POLYMARKET_DATA_API}/v1/leaderboard?user=${addr}&timePeriod=ALL`, {
            signal: AbortSignal.timeout(30_000),
        })
    );
    const volume = (Array.isArray(leaderboard) && leaderboard.length > 0)
        ? (Number(leaderboard[0].vol) || 0)
        : 0;

    // 2. Activity API → lastTradeTime (最近一条交易的时间戳)
    let lastTradeTime: number | null = null;
    try {
        const activity = await fetchWithRetry(() =>
            fetch(`${POLYMARKET_DATA_API}/activity?user=${addr}&limit=1&offset=0`, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
        );
        if (Array.isArray(activity) && activity.length > 0 && activity[0].timestamp) {
            lastTradeTime = Number(activity[0].timestamp);
        }
    } catch {
        // activity 查询失败不影响其他数据
    }

    return { volume, lastTradeTime };
}

// ---- 单钱包完整查询 ----

export async function queryWallet(walletId: number, proxyAddress: string): Promise<WalletQueryResult> {
    const result: WalletQueryResult = {
        walletId,
        proxyAddress,
        cash: null,
        positionValue: null,
        volume: null,
        lastTradeTime: null,
    };

    const [cash, posVal, volData] = await Promise.allSettled([
        getUsdcBalance(proxyAddress),
        getPositionValue(proxyAddress),
        getVolumeAndActivity(proxyAddress),
    ]);

    if (cash.status === 'fulfilled') result.cash = cash.value;
    if (posVal.status === 'fulfilled') result.positionValue = posVal.value;
    if (volData.status === 'fulfilled') {
        result.volume = volData.value.volume;
        result.lastTradeTime = volData.value.lastTradeTime;
    }

    const errors: string[] = [];
    if (cash.status === 'rejected') errors.push(`cash: ${cash.reason}`);
    if (posVal.status === 'rejected') errors.push(`position: ${posVal.reason}`);
    if (volData.status === 'rejected') errors.push(`volume: ${volData.reason}`);
    if (errors.length > 0) result.error = errors.join('; ');

    return result;
}

// ---- 定时刷新服务 ----

export class WalletQueryScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private _isRefreshing = false;
    private _lastRefreshAt: number | null = null;

    start(): void {
        if (this.timer) return;
        void this.refreshAll();
        this.timer = setInterval(() => void this.refreshAll(), REFRESH_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getStatus(): WalletQueryStatus {
        return {
            lastRefreshAt: this._lastRefreshAt,
            nextRefreshAt: this._lastRefreshAt ? this._lastRefreshAt + REFRESH_INTERVAL_MS : null,
            isRefreshing: this._isRefreshing,
            walletCount: db.listWallets().length,
        };
    }

    async refreshAll(): Promise<WalletQueryResult[]> {
        if (this._isRefreshing) return [];
        this._isRefreshing = true;

        const wallets = db.listWallets();
        const results: WalletQueryResult[] = [];

        try {
            for (const wallet of wallets) {
                if (!wallet.proxyAddress) continue;

                try {
                    const result = await queryWallet(wallet.id, wallet.proxyAddress);
                    db.updateWalletQueryData(wallet.id, {
                        cash: result.cash,
                        positionValue: result.positionValue,
                        volume: result.volume,
                        lastTradeTime: result.lastTradeTime,
                    });
                    results.push(result);
                    console.log(
                        `[WalletQuery] ${wallet.label}: cash=$${result.cash?.toFixed(2) ?? '?'}, ` +
                        `pos=$${result.positionValue?.toFixed(2) ?? '?'}, vol=$${result.volume?.toFixed(0) ?? '?'}`,
                    );
                } catch (e: unknown) {
                    console.warn(`[WalletQuery] Failed for ${wallet.label}: ${(e as Error).message}`);
                    results.push({
                        walletId: wallet.id,
                        proxyAddress: wallet.proxyAddress,
                        cash: null, positionValue: null, volume: null, lastTradeTime: null,
                        error: (e as Error).message,
                    });
                }

                // 150ms 间隔避免被限流
                await new Promise(r => setTimeout(r, 150));
            }
        } finally {
            this._isRefreshing = false;
            this._lastRefreshAt = Date.now();
        }

        return results;
    }

    async refreshSingle(walletId: number): Promise<WalletQueryResult | null> {
        const wallet = db.getWalletById(walletId);
        if (!wallet?.proxyAddress) return null;

        const result = await queryWallet(walletId, wallet.proxyAddress);
        db.updateWalletQueryData(walletId, {
            cash: result.cash,
            positionValue: result.positionValue,
            volume: result.volume,
            lastTradeTime: result.lastTradeTime,
        });
        return result;
    }
}
