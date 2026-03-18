/**
 * poly-multi: HTTP API 路由
 *
 * 所有写端点强制要求 Content-Type: application/json（CSRF 防护）
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { JsonRpcProvider } from 'ethers';
import type { WalletManager } from './wallet-manager.js';
import type { PairingService } from './pairing-service.js';
import type {
    AddWalletRequest,
    BatchAddWalletsRequest,
    CreatePairingRequest,
    UpdatePairingRequest,
    PolyMultiStatus,
} from './types.js';
import * as db from './db.js';
import { redeemAll } from './redeem-service.js';
import type { RedeemRequest } from './redeem-service.js';

const MAX_BODY_SIZE = 512 * 1024; // 512KB

// ============================================================
// 辅助
// ============================================================

function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body) as T);
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function json(res: ServerResponse, data: unknown, status = 200, corsHeaders: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400, corsHeaders: Record<string, string> = {}): void {
    json(res, { success: false, error: message }, status, corsHeaders);
}

/**
 * CSRF 防护: 写操作必须携带 Content-Type: application/json
 */
function requireJsonContentType(req: IncomingMessage): boolean {
    const ct = req.headers['content-type'] || '';
    return ct.includes('application/json');
}

// ============================================================
// 路由处理器
// ============================================================

export function createPolyMultiRouter(
    walletManager: WalletManager,
    pairingService: PairingService,
    getCorsHeaders: (req: IncomingMessage) => Record<string, string>,
    walletQueryScheduler?: import('./wallet-query-service.js').WalletQueryScheduler,
) {
    /**
     * 处理 /api/poly-multi/* 请求
     * @returns true 如果已处理，false 如果路由不匹配
     */
    return async function handlePolyMultiRequest(
        req: IncomingMessage,
        res: ServerResponse,
    ): Promise<boolean> {
        const url = (req.url || '').split('?')[0];
        const method = req.method || 'GET';
        const cors = getCorsHeaders(req);

        // ============ Status ============
        if (url === '/api/poly-multi/status' && method === 'GET') {
            const activePairings = pairingService.listActivePairings();
            const resolved = pairingService.resolvePairingForTask();
            const runtimeMaster = pairingService.getRuntimeMasterWallet();
            const status: PolyMultiStatus = {
                unlocked: walletManager.isUnlocked(),
                walletCount: walletManager.listWallets().length,
                pairingCount: db.listPairings().length,
                activePairingId: resolved?.pairing.id ?? activePairings[0]?.id ?? null,
                activePairingCount: activePairings.length,
                resolvedPairingId: resolved?.pairing.id ?? null,
                resolutionSource: resolved?.source,
                runtimeMasterWalletId: runtimeMaster?.id ?? null,
            };
            json(res, status, 200, cors);
            return true;
        }

        // ============ Unlock / Lock ============
        if (url === '/api/poly-multi/unlock' && method === 'POST') {
            try {
                walletManager.unlock();
                json(res, { success: true, unlocked: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 500, cors);
            }
            return true;
        }

        if (url === '/api/poly-multi/lock' && method === 'POST') {
            walletManager.lock();
            json(res, { success: true, unlocked: false }, 200, cors);
            return true;
        }

        // ============ Wallets CRUD ============
        if (url === '/api/poly-multi/wallets' && method === 'GET') {
            json(res, walletManager.listWallets(), 200, cors);
            return true;
        }

        if (url === '/api/poly-multi/wallets' && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<AddWalletRequest>(req);
                const masterPassword = body.masterPassword || process.env.POLY_MULTI_MASTER_PASSWORD?.trim() || 'poly-multi-local';
                if (!body.privateKey || !body.label) {
                    error(res, 'privateKey and label are required', 400, cors);
                    return true;
                }
                const wallet = await walletManager.addWallet(body.privateKey, body.label, masterPassword);
                json(res, wallet, 201, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 500, cors);
            }
            return true;
        }

        // POST /api/poly-multi/wallets/batch — 批量添加钱包
        if (url === '/api/poly-multi/wallets/batch' && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<BatchAddWalletsRequest>(req);
                const masterPassword = body.masterPassword || process.env.POLY_MULTI_MASTER_PASSWORD?.trim() || 'poly-multi-local';
                if (!Array.isArray(body.wallets) || body.wallets.length === 0) {
                    error(res, 'wallets array is required and must not be empty', 400, cors);
                    return true;
                }

                const results: Array<{ label: string; success: boolean; wallet?: unknown; error?: string }> = [];

                for (const item of body.wallets) {
                    try {
                        if (!item.privateKey || !item.label) {
                            results.push({ label: item.label || '(unnamed)', success: false, error: 'privateKey and label are required' });
                            continue;
                        }

                        // 如果提供了完整 API 凭证，使用直接导入；否则通过 Python 派生
                        const hasDirect = item.address && item.proxyAddress && item.apiKey && item.apiSecret && item.passphrase;
                        let wallet;
                        if (hasDirect) {
                            wallet = await walletManager.addWalletDirect({
                                privateKey: item.privateKey,
                                label: item.label,
                                address: item.address!,
                                proxyAddress: item.proxyAddress!,
                                apiKey: item.apiKey!,
                                apiSecret: item.apiSecret!,
                                passphrase: item.passphrase!,
                                masterPassword,
                            });
                        } else {
                            wallet = await walletManager.addWallet(item.privateKey, item.label, masterPassword);
                        }
                        results.push({ label: item.label, success: true, wallet });
                    } catch (e: unknown) {
                        results.push({ label: item.label, success: false, error: (e as Error).message });
                    }
                }

                const successCount = results.filter(r => r.success).length;
                json(res, { success: successCount > 0, total: body.wallets.length, successCount, results }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 500, cors);
            }
            return true;
        }

        // GET /api/poly-multi/wallets/unmatched (must be before wallets/:id)
        if (url === '/api/poly-multi/wallets/unmatched' && method === 'GET') {
            json(res, pairingService.listUnmatchedWallets(), 200, cors);
            return true;
        }

        // DELETE /api/poly-multi/wallets/:id
        const walletDeleteMatch = url.match(/^\/api\/poly-multi\/wallets\/(\d+)$/);
        if (walletDeleteMatch && method === 'DELETE') {
            try {
                walletManager.removeWallet(parseInt(walletDeleteMatch[1]));
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // PATCH /api/poly-multi/wallets/:id
        const walletPatchMatch = url.match(/^\/api\/poly-multi\/wallets\/(\d+)$/);
        if (walletPatchMatch && method === 'PATCH') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<{ label: string }>(req);
                walletManager.updateLabel(parseInt(walletPatchMatch[1]), body.label);
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // ============ Pairings CRUD ============
        if (url === '/api/poly-multi/pairings' && method === 'GET') {
            json(res, pairingService.listPairings(), 200, cors);
            return true;
        }

        if (url === '/api/poly-multi/pairings' && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<CreatePairingRequest>(req);
                const pairing = pairingService.createPairing(body.name, body.masterWalletId, body.hedgeWalletId);
                json(res, pairing, 201, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // POST /api/poly-multi/pairings/auto-match (must be before pairings/:id)
        if (url === '/api/poly-multi/pairings/auto-match' && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<{ masterWalletId: number; hedgeWalletId?: number }>(req);
                if (!body.masterWalletId) {
                    error(res, 'masterWalletId is required', 400, cors);
                    return true;
                }
                const pairing = pairingService.autoMatch(body.masterWalletId, body.hedgeWalletId);
                json(res, pairing, 201, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // PATCH /api/poly-multi/pairings/:id
        const pairingPatchMatch = url.match(/^\/api\/poly-multi\/pairings\/(\d+)$/);
        if (pairingPatchMatch && method === 'PATCH') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const body = await parseJsonBody<UpdatePairingRequest>(req);
                pairingService.updatePairing(parseInt(pairingPatchMatch[1]), body);
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // DELETE /api/poly-multi/pairings/:id
        const pairingDeleteMatch = url.match(/^\/api\/poly-multi\/pairings\/(\d+)$/);
        if (pairingDeleteMatch && method === 'DELETE') {
            try {
                pairingService.removePairing(parseInt(pairingDeleteMatch[1]));
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // POST /api/poly-multi/pairings/:id/activate
        const activateMatch = url.match(/^\/api\/poly-multi\/pairings\/(\d+)\/activate$/);
        if (activateMatch && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                pairingService.activatePairing(parseInt(activateMatch[1]));
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // POST /api/poly-multi/pairings/:id/deactivate
        const deactivateMatch = url.match(/^\/api\/poly-multi\/pairings\/(\d+)\/deactivate$/);
        if (deactivateMatch && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                pairingService.deactivatePairing(parseInt(deactivateMatch[1]));
                json(res, { success: true }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 400, cors);
            }
            return true;
        }

        // ============ Wallet Query ============
        if (url === '/api/poly-multi/wallet-query/status' && method === 'GET') {
            json(res, walletQueryScheduler?.getStatus() ?? { error: 'not available' }, 200, cors);
            return true;
        }

        if (url === '/api/poly-multi/wallet-query/refresh' && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }
            try {
                const results = await walletQueryScheduler?.refreshAll();
                json(res, { success: true, results }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 500, cors);
            }
            return true;
        }

        // ============ Redeem ============
        const redeemMatch = url.match(/^\/api\/poly-multi\/wallets\/(\d+)\/redeem$/);
        if (redeemMatch && method === 'POST') {
            if (!requireJsonContentType(req)) {
                error(res, 'Content-Type must be application/json', 415, cors);
                return true;
            }

            const walletId = parseInt(redeemMatch[1], 10);
            const wallet = walletManager.listWallets().find(w => w.id === walletId);
            if (!wallet) {
                error(res, `Wallet ${walletId} not found`, 404, cors);
                return true;
            }

            const creds = walletManager.getCredentials(walletId);
            if (!creds) {
                error(res, 'Wallet credentials not available (locked?)', 403, cors);
                return true;
            }

            try {
                // 1. 查询可赎回仓位
                const positionsRes = await fetch(
                    `https://data-api.polymarket.com/positions?user=${wallet.proxyAddress}&sizeThreshold=0&redeemable=true`,
                );
                if (!positionsRes.ok) {
                    error(res, `Failed to fetch positions: HTTP ${positionsRes.status}`, 502, cors);
                    return true;
                }
                const positions = await positionsRes.json() as Array<{
                    conditionId: string;
                    size: number;
                    outcome: string;
                    title: string;
                    redeemable: boolean;
                }>;

                const redeemable = positions.filter(p => p.redeemable && p.size > 0);
                if (redeemable.length === 0) {
                    json(res, { success: true, message: 'No redeemable positions', results: [] }, 200, cors);
                    return true;
                }

                // 2. 查询 negRisk 状态
                const requests: RedeemRequest[] = [];
                for (const pos of redeemable) {
                    let negRisk = false;
                    try {
                        const marketRes = await fetch(`https://clob.polymarket.com/markets/${pos.conditionId}`);
                        if (marketRes.ok) {
                            const marketData = await marketRes.json() as { neg_risk?: boolean };
                            negRisk = marketData.neg_risk === true;
                        }
                    } catch { /* 默认 negRisk=false */ }

                    const req: RedeemRequest = { conditionId: pos.conditionId, negRisk };
                    if (negRisk) {
                        const amount = BigInt(Math.round(pos.size * 1e6));
                        req.amounts = pos.outcome === 'Yes' ? [amount, 0n] : [0n, amount];
                    }
                    requests.push(req);
                }

                // 3. 执行批量 redeem
                const RPC_URLS = [
                    'https://polygon.drpc.org',
                    'https://polygon-bor-rpc.publicnode.com',
                    'https://polygon-rpc.com',
                ];
                let provider: JsonRpcProvider | null = null;
                for (const rpcUrl of RPC_URLS) {
                    try {
                        const p = new JsonRpcProvider(rpcUrl, 137);
                        await p.getBlockNumber();
                        provider = p;
                        break;
                    } catch { continue; }
                }
                if (!provider) {
                    error(res, 'All Polygon RPC endpoints failed', 502, cors);
                    return true;
                }

                const privateKey = creds.privateKey.toString('utf8');
                const results = await redeemAll(provider, privateKey, wallet.proxyAddress, requests);

                const succeeded = results.filter(r => r.success).length;
                json(res, {
                    success: true,
                    total: results.length,
                    succeeded,
                    failed: results.length - succeeded,
                    results: results.map(r => ({
                        conditionId: r.conditionId,
                        success: r.success,
                        txHash: r.txHash || undefined,
                        error: r.error || undefined,
                    })),
                }, 200, cors);
            } catch (e: unknown) {
                error(res, (e as Error).message, 500, cors);
            }
            return true;
        }

        // ============ Hedge History ============
        if (url === '/api/poly-multi/hedge-history' && method === 'GET') {
            json(res, db.listHedgeExecutions(), 200, cors);
            return true;
        }

        // 路由不匹配
        return false;
    };
}
