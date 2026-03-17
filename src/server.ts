/**
 * poly-multi HTTP 服务入口
 *
 * 集成 PolySportsService + 前端静态文件服务 + SSE 体育数据推送
 */

import { extname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from 'dotenv';

import { PolyMultiModule } from './core/index.js';
import { PolyMultiOrderService } from './core/order-service.js';
import { PolyMultiTaskService } from './core/task-service.js';
import { PolyMultiUserWsTelegramBridge } from './core/user-ws-telegram-bridge.js';
import { PolyTraderFactory } from './core/trader-factory.js';
import type { CreatePolyMultiTaskInput, PolyMultiTask } from './core/task-types.js';
import { TaskLogger } from './logger/index.js';
import { createTelegramNotifier, type TelegramNotifier } from './notification/telegram.js';
import { PolySportsService } from './sports/poly-sports-service.js';
import type { PolySportsSSE } from './sports/types.js';

// ============================================================================
// .env
// ============================================================================

config({ path: resolve(import.meta.dirname, '../.env') });

// ============================================================================
// 常量
// ============================================================================

const SERVICE_ID = 'poly-multi';
const DEFAULT_PORT = 4030;
const TERMINAL_TASK_STATUSES = new Set<PolyMultiTask['status']>(['PARTIAL', 'COMPLETED', 'CANCELLED', 'FAILED']);

// ============================================================================
// 工具函数
// ============================================================================

interface SSEClient {
    res: ServerResponse;
    initialized: boolean;
}

const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolveBody(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

function getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.jsx': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
    };
    return mimeMap[ext] || 'text/plain; charset=utf-8';
}

function extractActiveTaskTokenIds(tasks: Array<{ status?: string; tokenId?: string; hedgeTokenId?: string }> | undefined): string[] {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];

    const activeTokenIds = new Set<string>();
    for (const task of tasks) {
        if (!task || TERMINAL_TASK_STATUSES.has(task.status as PolyMultiTask['status'] || '' as PolyMultiTask['status'])) continue;
        if (task.tokenId) activeTokenIds.add(task.tokenId);
        if (task.hedgeTokenId) activeTokenIds.add(task.hedgeTokenId);
    }

    return Array.from(activeTokenIds);
}

// ============================================================================
// 主函数
// ============================================================================

async function main(): Promise<void> {
    const port = Number.parseInt(process.env.POLY_MULTI_PORT || String(DEFAULT_PORT), 10);
    const host = process.env.POLY_MULTI_HOST || '0.0.0.0';

    // 数据目录
    const dataDir = resolve(process.env.POLY_MULTI_DATA_DIR?.trim() || './data');
    process.env.POLY_MULTI_DATA_DIR = dataDir;

    // ========================================================================
    // SSE
    // ========================================================================

    const sseClients = new Map<ServerResponse, SSEClient>();

    const sendSSE = (client: SSEClient, event: string, data: string) => {
        const message = `event: ${event}\ndata: ${data}\n\n`;
        try {
            client.res.write(message);
        } catch {
            sseClients.delete(client.res);
        }
    };

    const broadcastSSE = (event: string, data: string) => {
        for (const client of sseClients.values()) {
            if (!client.initialized) continue;
            sendSSE(client, event, data);
        }
    };

    // ========================================================================
    // 核心模块初始化
    // ========================================================================

    const sportsService = new PolySportsService();
    const polyMulti = new PolyMultiModule();
    polyMulti.initRouter(() => corsHeaders);

    const logsBaseDir = resolve(dataDir, 'logs', 'tasks');
    const taskLogger = new TaskLogger({ baseDir: logsBaseDir });

    // Telegram
    const pmBotToken = process.env.POLY_MULTI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const pmChatId = process.env.POLY_MULTI_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    const telegram: TelegramNotifier | null = pmBotToken && pmChatId
        ? createTelegramNotifier({ botToken: pmBotToken, chatId: pmChatId, enabled: true })
        : null;

    // OrderService — 无 fallback 单钱包
    const orderService = new PolyMultiOrderService(polyMulti.walletManager, polyMulti.pairingService, null);

    // TaskService
    const taskService = new PolyMultiTaskService(orderService, polyMulti.hedgeExecutor, taskLogger);
    await taskService.init();

    // ========================================================================
    // 通知集成
    // ========================================================================

    const resolveWalletLabel = (taskId: string): string => {
        const task = taskService.getTask(taskId);
        if (!task) return '';
        const pid = task.resolvedPairingId || task.polyMultiPairingId;
        if (!pid) return '';
        const pairings = polyMulti.pairingService.listPairings();
        const pairing = pairings.find(p => p.id === pid);
        if (!pairing) return '';
        const masterLabel = pairing.masterWallet?.label || `#${pairing.masterWalletId}`;
        const hedgeLabel = pairing.hedgeWallet?.label || `#${pairing.hedgeWalletId}`;
        return `[${masterLabel} \u2194 ${hedgeLabel}]`;
    };

    const disconnectTaskLoggerNotifier = telegram
        ? taskLogger.connectNotifier(({ taskId, event }) => {
            const text = taskLogger.formatEventForNotification(taskId, event);
            const walletTag = resolveWalletLabel(taskId);
            const message = walletTag ? `<b>${walletTag}</b>\n${text}` : text;
            return telegram.sendText(message);
        })
        : () => {};

    // ========================================================================
    // WS Telegram Bridge
    // ========================================================================

    const wsTelegramBridge = new PolyMultiUserWsTelegramBridge({
        sportsService,
        walletManager: polyMulti.walletManager,
        pairingService: polyMulti.pairingService,
        getTasks: () => taskService.listTasks(true),
        getActiveHedgeOrderIds: () => taskService.getActiveHedgeOrderIds(),
        onHedgeFill: (event) => taskService.applyWsHedgeFill(event.orderId, event.filledQty, event.avgPrice),
    });
    await wsTelegramBridge.start();

    // ========================================================================
    // 事件订阅
    // ========================================================================

    // Wire sportsService active token tracking + start
    sportsService.setActiveTaskTokens(extractActiveTaskTokenIds(taskService.getSnapshot().tasks));

    taskService.on('tasks:snapshot', snapshot => {
        sportsService.setActiveTaskTokens(extractActiveTaskTokenIds(snapshot.tasks));
        broadcastSSE('tasks', JSON.stringify(snapshot));
        void wsTelegramBridge.sync().catch(error => {
            console.warn(`[${SERVICE_ID}] WS Telegram sync failed: ${(error as Error)?.message || error}`);
        });
    });

    polyMulti.onUnlocked(() => {
        void wsTelegramBridge.sync().catch(error => {
            console.warn(`[${SERVICE_ID}] WS Telegram sync failed after unlock: ${(error as Error)?.message || error}`);
        });
    });

    polyMulti.onLocked(() => {
        void wsTelegramBridge.sync().catch(error => {
            console.warn(`[${SERVICE_ID}] WS Telegram sync failed after lock: ${(error as Error)?.message || error}`);
        });
    });

    // ========================================================================
    // Sports Service 启动
    // ========================================================================

    await sportsService.start((data: PolySportsSSE) => {
        broadcastSSE('sports', JSON.stringify(data));
    });

    // ========================================================================
    // HTTP 服务
    // ========================================================================

    const FRONTEND_DIR = resolve(import.meta.dirname, 'frontend');

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const method = req.method || 'GET';
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const url = requestUrl.pathname;

        // CORS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204, corsHeaders);
            res.end();
            return;
        }

        // --- Health ---
        if (url === '/api/health' && method === 'GET') {
            sendJson(res, 200, {
                success: true,
                service: SERVICE_ID,
                polyMultiReady: polyMulti.isReady(),
                polyMultiDataDir: dataDir,
                telegramEnabled: Boolean(telegram),
                taskStats: taskService.getSnapshot().stats,
            });
            return;
        }

        // --- Poly Multi 子路由 ---
        if (url.startsWith('/api/poly-multi')) {
            try {
                const handled = await polyMulti.handleRequest(req, res);
                if (handled) return;
            } catch (error: unknown) {
                sendJson(res, 500, { success: false, error: (error as Error)?.message || 'Poly Multi request failed' });
                return;
            }
            sendJson(res, 404, { success: false, error: 'Not Found' });
            return;
        }

        // --- SSE (both /api/events and /api/stream for frontend compat) ---
        if ((url === '/api/events' || url === '/api/stream') && method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                ...corsHeaders,
            });

            const client: SSEClient = { res, initialized: false };
            sseClients.set(res, client);
            req.on('close', () => sseClients.delete(res));

            // 发送初始快照
            const sportsSnapshot = sportsService.getSnapshot();
            sendSSE(client, 'sports', JSON.stringify(sportsSnapshot));
            sendSSE(client, 'tasks', JSON.stringify(taskService.getSnapshot()));
            client.initialized = true;
            return;
        }

        // --- Sports API ---
        if (url === '/api/sports' && method === 'GET') {
            sendJson(res, 200, sportsService.getAllMarkets());
            return;
        }

        // --- Account API ---
        if (url === '/api/account' && method === 'GET') {
            sendJson(res, 200, {
                balance: 0,
                tradeEnabled: polyMulti.isReady(),
                polyMultiReady: polyMulti.isReady(),
                telegramEnabled: Boolean(telegram),
                taskStats: taskService.getSnapshot().stats,
            });
            return;
        }

        // --- Tasks: GET list ---
        if (url === '/api/tasks' && method === 'GET') {
            sendJson(res, 200, { success: true, data: taskService.listTasks(true) });
            return;
        }

        // --- Tasks: POST create ---
        if (url === '/api/tasks' && method === 'POST') {
            try {
                const input = JSON.parse(await readBody(req)) as CreatePolyMultiTaskInput & { autoStart?: boolean };
                const task = taskService.createTask(input);

                if (input.autoStart !== false) {
                    const started = await taskService.startTask(task.id);
                    sendJson(res, 201, { success: true, data: started, started: true });
                    return;
                }

                sendJson(res, 201, { success: true, data: task, started: false });
            } catch (error: unknown) {
                sendJson(res, 400, { success: false, error: (error as Error)?.message || 'Failed to create task' });
            }
            return;
        }

        // --- Tasks: DELETE all (must be checked before single-task DELETE) ---
        if (url === '/api/tasks/all' && method === 'DELETE') {
            try {
                const activeTasks = taskService.listTasks(false);
                const cancelResults: string[] = [];

                // 1. 取消所有活跃任务
                for (const task of activeTasks) {
                    try {
                        await taskService.cancelTask(task.id);
                        cancelResults.push(task.id);
                    } catch (e: unknown) {
                        console.warn(`[cancelAll] 任务 ${task.id} 取消失败: ${(e as Error)?.message}`);
                    }
                }

                // 2. 从活跃任务中收集主钱包，调用 cancelAllOrders
                const cancelledWallets: string[] = [];
                if (polyMulti.walletManager.isUnlocked()) {
                    const masterWalletIds = new Set<number>();
                    for (const task of activeTasks) {
                        const wid = task.resolvedMasterWalletId ?? task.polyMultiMasterWalletId;
                        if (wid) masterWalletIds.add(wid);
                    }

                    if (masterWalletIds.size > 0) {
                        const factory = new PolyTraderFactory();
                        const pairings = polyMulti.pairingService.listPairings();

                        for (const masterId of masterWalletIds) {
                            const creds = polyMulti.walletManager.getCredentials(masterId);
                            if (!creds) continue;

                            const walletLabel = pairings.find(p => p.masterWalletId === masterId)?.masterWallet?.label || `#${masterId}`;
                            try {
                                const trader = await factory.getOrCreate(masterId, creds);
                                const ok = await trader.cancelAllOrders({ timeoutMs: 8000 });
                                if (ok) cancelledWallets.push(walletLabel);
                            } catch (e: unknown) {
                                console.warn(`[cancelAll] 钱包 ${walletLabel} cancelAll 失败: ${(e as Error)?.message}`);
                            }
                        }

                        factory.destroyAll();
                    }
                }

                sendJson(res, 200, {
                    success: true,
                    cancelledTasks: cancelResults.length,
                    cancelledWallets,
                });
            } catch (error: unknown) {
                sendJson(res, 500, { success: false, error: (error as Error)?.message || 'Failed to cancel all' });
            }
            return;
        }

        // --- Tasks: POST start (must be before single-task GET/PATCH/DELETE) ---
        const taskStartMatch = url.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/start$/);
        if (taskStartMatch && method === 'POST') {
            try {
                const task = await taskService.startTask(taskStartMatch[1]);
                sendJson(res, 200, { success: true, data: task });
            } catch (error: unknown) {
                sendJson(res, 400, { success: false, error: (error as Error)?.message || 'Failed to start task' });
            }
            return;
        }

        // --- Tasks: single-task routes ---
        const taskIdMatch = url.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
        if (taskIdMatch) {
            const taskId = taskIdMatch[1];

            // GET single task
            if (method === 'GET') {
                const task = taskService.getTask(taskId);
                if (!task) {
                    sendJson(res, 404, { success: false, error: 'Task not found' });
                    return;
                }
                sendJson(res, 200, { success: true, data: task });
                return;
            }

            // PATCH update expiry
            if (method === 'PATCH') {
                try {
                    const body = JSON.parse(await readBody(req)) as { expiresAt?: number | null };
                    const task = taskService.setTaskExpiry(taskId, body.expiresAt ?? null);
                    sendJson(res, 200, { success: true, data: task });
                } catch (error: unknown) {
                    sendJson(res, 400, { success: false, error: (error as Error)?.message || 'Failed to update task' });
                }
                return;
            }

            // DELETE cancel/delete
            if (method === 'DELETE') {
                try {
                    const task = taskService.getTask(taskId);
                    if (!task) {
                        sendJson(res, 404, { success: false, error: 'Task not found' });
                        return;
                    }

                    if (TERMINAL_TASK_STATUSES.has(task.status)) {
                        taskService.deleteTask(task.id);
                        sendJson(res, 200, { success: true, deleted: true });
                        return;
                    }

                    const cancelled = await taskService.cancelTask(task.id);
                    sendJson(res, 200, { success: true, data: cancelled, deleted: false });
                } catch (error: unknown) {
                    sendJson(res, 400, { success: false, error: (error as Error)?.message || 'Failed to cancel task' });
                }
                return;
            }
        }

        // --- Static file serving (frontend) ---
        const relativePath = url === '/' ? '/poly-multi.html' : url;
        const filePath = resolve(FRONTEND_DIR, `.${relativePath}`);

        if (!filePath.startsWith(FRONTEND_DIR)) {
            res.writeHead(403, corsHeaders);
            res.end('Forbidden');
            return;
        }

        if (!existsSync(filePath)) {
            sendJson(res, 404, { success: false, error: 'Not Found' });
            return;
        }

        try {
            const content = readFileSync(filePath);
            res.writeHead(200, {
                'Content-Type': getMimeType(filePath),
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                ...corsHeaders,
            });
            res.end(content);
        } catch (error: unknown) {
            sendJson(res, 500, { success: false, error: (error as Error)?.message || 'Failed to read file' });
        }
    });

    // ========================================================================
    // 启动
    // ========================================================================

    server.listen(port, host, () => {
        console.log(`=== poly-multi server ===`);
        console.log(`URL: http://localhost:${port}`);
        console.log(`Host: ${host}`);
        console.log(`Data dir: ${dataDir}`);
        console.log(`Poly Multi ready: ${polyMulti.isReady() ? 'yes' : 'no'}`);
        console.log(`Telegram: ${telegram ? 'enabled' : 'disabled'}`);
    });

    // ========================================================================
    // Graceful shutdown
    // ========================================================================

    let shuttingDown = false;

    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[${SERVICE_ID}] Shutting down...`);

        disconnectTaskLoggerNotifier();
        wsTelegramBridge.stop();
        taskService.destroy();
        orderService.destroy();

        try {
            await taskLogger.close();
        } catch (error: unknown) {
            console.warn(`[${SERVICE_ID}] Task logger close failed: ${(error as Error)?.message || error}`);
        }

        sportsService.stop();
        polyMulti.destroy();
        server.close(() => process.exit(0));
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
}

// ============================================================================
// 入口
// ============================================================================

main().catch(error => {
    console.error(`[${SERVICE_ID}] Fatal error:`, error);
    process.exit(1);
});
