import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { PolyOrderStatus } from '../polymarket/polymarket-trader.js';
import { TaskLogger, type StructuredError, type TaskConfigSnapshot } from '../logger/index.js';
import { getDataDir } from './db.js';
import { isRejection, type MultiHedgeExecutor } from './multi-hedge-executor.js';
import type { PolyMultiOrderService } from './order-service.js';
import type {
    CreatePolyMultiTaskInput,
    PolyMultiTask,
    PolyMultiTaskSnapshot,
    PolyMultiTaskStatus,
} from './task-types.js';
import type {
    HedgeDistribution,
    HedgeTaskContext,
    MultiHedgeResult,
    MultiHedgeRejection,
} from './types.js';

const TERMINAL_STATUSES: PolyMultiTaskStatus[] = ['PARTIAL', 'COMPLETED', 'CANCELLED', 'FAILED'];
const ACTIVE_STATUSES: PolyMultiTaskStatus[] = ['PENDING', 'LIVE', 'HEDGE_PENDING'];
const REFRESH_INTERVAL_MS = 5_000;
const MIN_HEDGE_QTY = 1;
const EPSILON = 1e-6;

function roundQty(value: number): number {
    return Math.max(0, Math.round(value * 10000) / 10000);
}

function clampPrice(value: number): number {
    return Math.max(0.01, Math.min(0.99, Number.isFinite(value) ? value : 0.5));
}

export class PolyMultiTaskService extends EventEmitter {
    private readonly tasks = new Map<string, PolyMultiTask>();
    private readonly persistPath: string;
    private writeQueue: Promise<void> = Promise.resolve();
    private loaded = false;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private readonly lastLoggedOrderState = new Map<string, {
        status?: PolyOrderStatus['status'];
        filledQty: number;
    }>();
    private readonly lastLoggedHedgeQty = new Map<string, number>();

    constructor(
        private readonly orderService: PolyMultiOrderService,
        private readonly hedgeExecutor?: MultiHedgeExecutor,
        private readonly taskLogger?: TaskLogger,
        persistPath?: string,
    ) {
        super();
        this.persistPath = persistPath || path.join(getDataDir(), 'tasks.json');
    }

    async init(): Promise<void> {
        if (this.loaded) return;

        await fs.mkdir(path.dirname(this.persistPath), { recursive: true });

        try {
            const data = await fs.readFile(this.persistPath, 'utf-8');
            const entries = JSON.parse(data) as Array<[string, PolyMultiTask]>;
            for (const [id, task] of entries) {
                this.tasks.set(id, this.normalizeLoadedTask(task));
            }
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.error('[PolyMultiTaskService] Failed to load tasks:', error.message);
            }
        }

        this.loaded = true;
        this.refreshTimer = setInterval(() => {
            this.refreshActiveTasks().catch(error => {
                console.warn('[PolyMultiTaskService] Refresh active tasks failed:', error?.message || error);
            });
        }, REFRESH_INTERVAL_MS);
    }

    destroy(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        this.lastLoggedOrderState.clear();
        this.lastLoggedHedgeQty.clear();
    }

    listTasks(includeCompleted = true): PolyMultiTask[] {
        return Array.from(this.tasks.values())
            .filter(task => includeCompleted || !TERMINAL_STATUSES.includes(task.status))
            .sort((left, right) => right.createdAt - left.createdAt);
    }

    getTask(taskId: string): PolyMultiTask | null {
        return this.tasks.get(taskId) || null;
    }

    createTask(input: CreatePolyMultiTaskInput): PolyMultiTask {
        const id = this.generateTaskId(input);
        if (this.tasks.has(id)) {
            throw new Error(`Task ${id} already exists`);
        }

        const now = Date.now();
        const task: PolyMultiTask = {
            id,
            tokenId: input.tokenId,
            conditionId: input.conditionId,
            side: input.side,
            price: input.price,
            quantity: input.quantity,
            negRisk: input.negRisk,
            orderType: input.orderType || 'GTC',
            status: 'PENDING',
            eventTitle: input.eventTitle,
            marketQuestion: input.marketQuestion,
            selectionLabel: input.selectionLabel,
            sport: input.sport,
            marketType: input.marketType,
            hedgeTokenId: input.hedgeTokenId,
            hedgeSide: input.hedgeSide || 'BUY',
            hedgeSelectionLabel: input.hedgeSelectionLabel,
            hedgeMaxPrice: input.hedgeMaxPrice,
            polyMultiPairingId: input.polyMultiPairingId,
            polyMultiMasterWalletId: input.polyMultiMasterWalletId,
            expiresAt: Number.isFinite(input.expiresAt) ? input.expiresAt : undefined,
            hedgeStatus: input.hedgeTokenId ? 'IDLE' : 'FAILED',
            hedgeDistributions: [],
            filledQty: 0,
            remainingQty: input.quantity,
            avgPrice: 0,
            hedgedQty: 0,
            avgHedgePrice: 0,
            createdAt: now,
            updatedAt: now,
            hedgeError: input.hedgeTokenId ? undefined : 'Hedge leg is not configured for this market',
        };

        this.tasks.set(id, task);
        this.persistAsync();
        this.emit('task:created', task);
        this.emitSnapshot();
        void this.logTaskCreated(task);
        return task;
    }

    async startTask(taskId: string): Promise<PolyMultiTask> {
        const task = this.getTaskOrThrow(taskId);
        if (task.status !== 'PENDING') {
            throw new Error(`Task ${taskId} cannot be started from status ${task.status}`);
        }
        if (task.expiresAt && Date.now() >= task.expiresAt) {
            return this.updateTask(taskId, {
                status: 'CANCELLED',
                error: 'Task expired before start',
                completedAt: Date.now(),
            });
        }

        let result: Awaited<ReturnType<PolyMultiOrderService['placeOrder']>>;
        try {
            result = await this.orderService.placeOrder({
                tokenId: task.tokenId,
                conditionId: task.conditionId,
                side: task.side,
                price: task.price,
                quantity: task.quantity,
                negRisk: task.negRisk,
                orderType: task.orderType,
                expiresAt: task.expiresAt,
                marketQuestion: task.marketQuestion,
                selectionLabel: task.selectionLabel,
                polyMultiPairingId: task.polyMultiPairingId,
                polyMultiMasterWalletId: task.polyMultiMasterWalletId,
            });
        } catch (error: any) {
            void this.logOrderFailed(task, error?.message || 'Failed to resolve routing for task order');
            return this.updateTask(taskId, {
                status: 'FAILED',
                error: error?.message || 'Failed to resolve routing for task order',
                completedAt: Date.now(),
            });
        }

        if (!result.success || !result.orderId) {
            void this.logOrderFailed(task, result.error || 'Failed to place order');
            return this.updateTask(taskId, {
                status: 'FAILED',
                error: result.error || 'Failed to place order',
                completedAt: Date.now(),
            });
        }

        this.updateTask(taskId, {
            status: 'LIVE',
            currentOrderRef: {
                orderId: result.orderId,
                walletId: result.walletId,
                orderType: task.orderType,
            },
            resolvedPairingId: result.pairingId,
            resolvedMasterWalletId: result.walletId,
            resolutionSource: result.resolutionSource,
            startedAt: Date.now(),
            error: undefined,
        });
        void this.logOrderSubmitted({
            ...task,
            currentOrderRef: {
                orderId: result.orderId,
                walletId: result.walletId,
                orderType: task.orderType,
            },
            resolvedPairingId: result.pairingId,
            resolvedMasterWalletId: result.walletId,
            resolutionSource: result.resolutionSource,
            status: 'LIVE',
        });

        await this.refreshTaskStatus(taskId);
        return this.getTaskOrThrow(taskId);
    }

    async cancelTask(
        taskId: string,
        options?: {
            bypassExpiryCheck?: boolean;
            cancellationError?: string;
        },
    ): Promise<PolyMultiTask> {
        const task = this.getTaskOrThrow(taskId);

        if (TERMINAL_STATUSES.includes(task.status)) {
            return task;
        }

        if (task.currentOrderRef?.orderId) {
            const cancelled = await this.orderService.cancelOrder(task.currentOrderRef.orderId, {
                walletId: task.currentOrderRef.walletId,
                polyMultiPairingId: task.resolvedPairingId ?? task.polyMultiPairingId,
                polyMultiMasterWalletId: task.resolvedMasterWalletId ?? task.polyMultiMasterWalletId,
            });

            if (!cancelled) {
                const status = await this.orderService.getOrderStatus(task.currentOrderRef.orderId, {
                    walletId: task.currentOrderRef.walletId,
                    polyMultiPairingId: task.resolvedPairingId ?? task.polyMultiPairingId,
                    polyMultiMasterWalletId: task.resolvedMasterWalletId ?? task.polyMultiMasterWalletId,
                });
                if (status?.status === 'LIVE' || !status) {
                    throw new Error(`Failed to cancel task order ${task.currentOrderRef.orderId}`);
                }
            }
        }

        await this.cancelLiveHedgeOrders(taskId);
        await this.refreshTaskStatus(taskId, { bypassExpiryCheck: options?.bypassExpiryCheck });
        let refreshed = this.getTaskOrThrow(taskId);

        // 强制终态：如果取消后任务仍非终态，手动设为 CANCELLED 或 PARTIAL
        if (!TERMINAL_STATUSES.includes(refreshed.status)) {
            const terminalStatus: PolyMultiTaskStatus = refreshed.filledQty >= MIN_HEDGE_QTY ? 'PARTIAL' : 'CANCELLED';
            refreshed = this.updateTask(taskId, {
                status: terminalStatus,
                error: options?.cancellationError || '手动取消',
                completedAt: refreshed.completedAt || Date.now(),
            });
        } else if (options?.cancellationError) {
            refreshed = this.updateTask(taskId, {
                error: options.cancellationError,
            });
        }

        return refreshed;
    }

    deleteTask(taskId: string): boolean {
        const task = this.getTaskOrThrow(taskId);
        if (!TERMINAL_STATUSES.includes(task.status)) {
            throw new Error(`Cannot delete active task ${taskId}`);
        }

        this.tasks.delete(taskId);
        this.lastLoggedOrderState.delete(taskId);
        this.lastLoggedHedgeQty.delete(taskId);
        this.persistAsync();
        this.emit('task:deleted', taskId);
        this.emitSnapshot();
        return true;
    }

    async refreshActiveTasks(): Promise<void> {
        const activeTasks = this.listTasks(false);
        await Promise.all(activeTasks.map(task => this.refreshTaskStatus(task.id)));
    }

    setTaskExpiry(taskId: string, expiresAt?: number | null): PolyMultiTask {
        const task = this.getTaskOrThrow(taskId);
        if (TERMINAL_STATUSES.includes(task.status)) {
            throw new Error(`Cannot update expiry for terminal task ${taskId}`);
        }

        return this.updateTask(taskId, {
            expiresAt: Number.isFinite(expiresAt as number) ? Number(expiresAt) : undefined,
        });
    }

    getSnapshot(): PolyMultiTaskSnapshot {
        const tasks = this.listTasks(true);
        return {
            snapshot: true,
            tasks,
            stats: {
                total: tasks.length,
                active: tasks.filter(task => ACTIVE_STATUSES.includes(task.status)).length,
                live: tasks.filter(task => task.status === 'LIVE').length,
                hedgePending: tasks.filter(task => task.status === 'HEDGE_PENDING').length,
                completed: tasks.filter(task => task.status === 'COMPLETED').length,
                cancelled: tasks.filter(task => task.status === 'CANCELLED').length,
                failed: tasks.filter(task => task.status === 'FAILED').length,
                partial: tasks.filter(task => task.status === 'PARTIAL').length,
            },
            lastUpdate: Date.now(),
        };
    }

    private async refreshTaskStatus(
        taskId: string,
        options?: {
            bypassExpiryCheck?: boolean;
        },
    ): Promise<void> {
        let task = this.getTask(taskId);
        if (!task) return;

        if (!options?.bypassExpiryCheck && await this.handleExpiredTask(task)) {
            return;
        }

        let mainOrderStatus: PolyOrderStatus | null = null;
        if (task.currentOrderRef?.orderId) {
            mainOrderStatus = await this.orderService.getOrderStatus(task.currentOrderRef.orderId, {
                walletId: task.currentOrderRef.walletId,
                polyMultiPairingId: task.resolvedPairingId ?? task.polyMultiPairingId,
                polyMultiMasterWalletId: task.resolvedMasterWalletId ?? task.polyMultiMasterWalletId,
            });

            if (mainOrderStatus) {
                task = this.updateTask(taskId, {
                    filledQty: roundQty(mainOrderStatus.filledQty),
                    remainingQty: roundQty(mainOrderStatus.remainingQty),
                    avgPrice: mainOrderStatus.avgPrice,
                });
            }
        }

        if (mainOrderStatus) {
            void this.logMainOrderProgress(task, mainOrderStatus);
        }

        task = await this.refreshLiveHedgeOrders(taskId);
        task = await this.maybeTriggerHedge(task, mainOrderStatus);
        this.updateTask(task.id, this.buildDerivedPatch(task, mainOrderStatus));
    }

    private async handleExpiredTask(task: PolyMultiTask): Promise<boolean> {
        if (!task.expiresAt || Date.now() < task.expiresAt || TERMINAL_STATUSES.includes(task.status)) {
            return false;
        }

        if (task.currentOrderRef?.orderId || this.getLiveHedgeDistributions(task).length > 0) {
            await this.cancelTask(task.id, {
                bypassExpiryCheck: true,
                cancellationError: 'Task expired and was cancelled automatically',
            });
            return true;
        }

        this.updateTask(task.id, {
            status: 'CANCELLED',
            error: 'Task expired before execution',
            completedAt: Date.now(),
        });
        return true;
    }

    private async refreshLiveHedgeOrders(taskId: string): Promise<PolyMultiTask> {
        const task = this.getTaskOrThrow(taskId);
        const liveDistributions = this.getLiveHedgeDistributions(task);
        if (liveDistributions.length === 0) {
            return task;
        }

        const updatedDistributions = [...(task.hedgeDistributions || [])];
        let changed = false;

        for (const distribution of liveDistributions) {
            const status = await this.orderService.getOrderStatus(distribution.orderId!, {
                walletId: distribution.walletId,
            });

            if (!status) continue;

            const nextDistribution = this.mapHedgeOrderStatus(distribution, status);
            const index = updatedDistributions.findIndex(item =>
                item.orderId === distribution.orderId && item.walletId === distribution.walletId,
            );

            if (index >= 0 && this.areDistributionsEqual(updatedDistributions[index], nextDistribution)) {
                continue;
            }

            changed = true;
            if (index >= 0) {
                updatedDistributions[index] = nextDistribution;
            } else {
                updatedDistributions.push(nextDistribution);
            }
        }

        if (!changed) {
            return task;
        }

        const summary = this.summarizeHedges(updatedDistributions);
        const updatedTask = this.updateTask(taskId, {
            hedgeDistributions: updatedDistributions,
            hedgedQty: summary.hedgedQty,
            avgHedgePrice: summary.avgHedgePrice,
        });
        void this.logHedgeProgress(task, updatedTask);
        return updatedTask;
    }

    private async maybeTriggerHedge(task: PolyMultiTask, mainOrderStatus: PolyOrderStatus | null): Promise<PolyMultiTask> {
        if (!task.hedgeTokenId || !this.hedgeExecutor) {
            return task;
        }

        const unhedgedQty = roundQty(task.filledQty - task.hedgedQty);
        if (unhedgedQty < MIN_HEDGE_QTY) {
            return task;
        }

        const mainStatus = mainOrderStatus?.status;
        if (!mainStatus) {
            return task;
        }

        // 主单仍 LIVE 时不触发对冲，只有成交 (MATCHED) 或取消 (CANCELLED 但有成交) 后才对冲
        if (mainStatus === 'LIVE') {
            return task;
        }

        // 三方市场同样支持对冲：主单买 YES → 对冲账号买 NO（同 selection），价格守护 maxPrice = 1 - mainPrice

        if (this.getLiveHedgeDistributions(task).length > 0) {
            return task;
        }

        // GTC 对冲: 以 bestAsk 价格挂单等待成交，WS 实时检测 + 5s 轮询 fallback
        // maxPrice = 1 - mainPrice 作为价格守护上限
        const hedgeMaxPrice = this.resolveHedgePrice(task);
        const hedgeTaskContext = this.toHedgeTaskContext(task);
        const hedgeOrderType = 'GTC';
        // GTC 对冲订单过期: 使用任务过期时间，无过期时间则默认 1 小时
        const DEFAULT_GTC_HEDGE_TTL_MS = 60 * 60 * 1000;
        const hedgeExpiresAt = task.expiresAt || (Date.now() + DEFAULT_GTC_HEDGE_TTL_MS);
        void this.logHedgeStarted(task, unhedgedQty, hedgeOrderType, hedgeMaxPrice);
        const hedgeResult = await this.hedgeExecutor.executeMultiHedge({
            task: hedgeTaskContext,
            quantity: unhedgedQty,
            side: task.hedgeSide || 'BUY',
            tokenId: task.hedgeTokenId,
            maxPrice: hedgeMaxPrice,
            expiresAt: hedgeExpiresAt,
            negRisk: task.negRisk,
            conditionId: task.conditionId,
            marketTitle: task.marketQuestion,
            orderType: hedgeOrderType,
        });

        if (isRejection(hedgeResult)) {
            const errorMsg = `[${hedgeResult.reason}] ${hedgeResult.message}`;
            void this.logHedgeFailed(task, unhedgedQty, errorMsg, hedgeResult);
            return this.updateTask(task.id, {
                hedgeStatus: 'FAILED',
                hedgeError: errorMsg,
            });
        }

        const updatedTask = this.applyHedgeResult(task.id, hedgeResult, hedgeOrderType);
        void this.logHedgeResult(updatedTask, hedgeResult, hedgeOrderType, unhedgedQty, hedgeMaxPrice);
        return updatedTask;
    }

    private applyHedgeResult(taskId: string, result: MultiHedgeResult, hedgeOrderType: 'IOC' | 'GTC'): PolyMultiTask {
        const task = this.getTaskOrThrow(taskId);
        const nextDistributions = this.mergeHedgeDistributions(task.hedgeDistributions || [], result.distributions);
        const summary = this.summarizeHedges(nextDistributions);

        return this.updateTask(taskId, {
            hedgeDistributions: nextDistributions,
            hedgedQty: summary.hedgedQty,
            avgHedgePrice: summary.avgHedgePrice,
            hedgeStatus: hedgeOrderType === 'GTC'
                ? 'ACTIVE'
                : summary.hedgedQty + EPSILON >= task.filledQty ? 'COMPLETED' : 'ACTIVE',
            hedgeError: result.success ? undefined : 'Hedge execution returned no live or filled orders',
        });
    }

    private async cancelLiveHedgeOrders(taskId: string): Promise<void> {
        const task = this.getTaskOrThrow(taskId);
        const liveDistributions = this.getLiveHedgeDistributions(task);

        for (const distribution of liveDistributions) {
            try {
                await this.orderService.cancelOrder(distribution.orderId!, {
                    walletId: distribution.walletId,
                });
            } catch (error: any) {
                console.warn(
                    `[PolyMultiTaskService] Failed to cancel hedge order ${distribution.orderId}: ${error?.message || error}`,
                );
            }
        }
    }

    private buildDerivedPatch(
        task: PolyMultiTask,
        mainOrderStatus: PolyOrderStatus | null,
    ): Partial<PolyMultiTask> {
        const summary = this.summarizeHedges(task.hedgeDistributions || []);
        const hasLiveHedges = this.getLiveHedgeDistributions({
            ...task,
            hedgeDistributions: task.hedgeDistributions || [],
        }).length > 0;
        const unhedgedQty = roundQty(task.filledQty - summary.hedgedQty);

        let hedgeStatus = task.hedgeStatus;
        if (!task.hedgeTokenId) {
            hedgeStatus = 'FAILED';
        } else if (summary.hedgedQty > 0 && unhedgedQty < MIN_HEDGE_QTY && !hasLiveHedges) {
            hedgeStatus = 'COMPLETED';
        } else if (hasLiveHedges || unhedgedQty >= MIN_HEDGE_QTY) {
            hedgeStatus = 'ACTIVE';
        } else if (task.hedgeError) {
            hedgeStatus = 'FAILED';
        } else {
            hedgeStatus = 'IDLE';
        }

        let status = task.status;
        if (mainOrderStatus?.status === 'LIVE') {
            status = 'LIVE';
        } else if (mainOrderStatus?.status === 'MATCHED') {
            status = unhedgedQty < MIN_HEDGE_QTY && !hasLiveHedges ? 'COMPLETED' : 'HEDGE_PENDING';
        } else if (mainOrderStatus?.status === 'CANCELLED') {
            if (task.filledQty < MIN_HEDGE_QTY) {
                status = 'CANCELLED';
            } else if (unhedgedQty < MIN_HEDGE_QTY && !hasLiveHedges) {
                status = 'PARTIAL';
            } else {
                status = 'HEDGE_PENDING';
            }
        } else if (task.status === 'HEDGE_PENDING' && unhedgedQty < MIN_HEDGE_QTY && !hasLiveHedges) {
            status = task.filledQty + EPSILON >= task.quantity ? 'COMPLETED' : 'PARTIAL';
        } else if (task.status === 'LIVE' && task.filledQty < MIN_HEDGE_QTY && task.remainingQty < MIN_HEDGE_QTY) {
            status = 'CANCELLED';
        }

        if (status === 'HEDGE_PENDING' && task.hedgeError && !hasLiveHedges) {
            status = 'FAILED';
        }

        return {
            hedgedQty: summary.hedgedQty,
            avgHedgePrice: summary.avgHedgePrice,
            hedgeStatus,
            status,
            completedAt: TERMINAL_STATUSES.includes(status) ? (task.completedAt || Date.now()) : undefined,
        };
    }

    private summarizeHedges(distributions: HedgeDistribution[]): { hedgedQty: number; avgHedgePrice: number } {
        let hedgedQty = 0;
        let weightedPrice = 0;

        for (const distribution of distributions) {
            if (distribution.filledQty <= 0) continue;
            hedgedQty += distribution.filledQty;
            weightedPrice += distribution.filledQty * distribution.avgPrice;
        }

        return {
            hedgedQty: roundQty(hedgedQty),
            avgHedgePrice: hedgedQty > 0 ? weightedPrice / hedgedQty : 0,
        };
    }

    private getLiveHedgeDistributions(task: PolyMultiTask): HedgeDistribution[] {
        return (task.hedgeDistributions || []).filter(distribution =>
            distribution.orderType === 'GTC' &&
            distribution.orderId &&
            (distribution.status === 'PENDING' || distribution.status === 'PARTIAL'),
        );
    }

    private mergeHedgeDistributions(
        existing: HedgeDistribution[],
        incoming: HedgeDistribution[],
    ): HedgeDistribution[] {
        const merged = [...existing];

        for (const distribution of incoming) {
            if (!distribution.orderId) {
                continue;
            }

            const index = merged.findIndex(item =>
                item.orderId === distribution.orderId && item.walletId === distribution.walletId,
            );

            if (index >= 0) {
                merged[index] = {
                    ...merged[index],
                    ...distribution,
                };
            } else {
                merged.push({ ...distribution });
            }
        }

        return merged;
    }

    private mapHedgeOrderStatus(
        distribution: HedgeDistribution,
        status: PolyOrderStatus,
    ): HedgeDistribution {
        if (status.status === 'MATCHED') {
            return {
                ...distribution,
                status: 'FILLED',
                filledQty: roundQty(status.filledQty),
                avgPrice: status.avgPrice,
            };
        }

        if (status.status === 'CANCELLED') {
            return {
                ...distribution,
                status: status.filledQty > 0 ? 'PARTIAL' : 'FAILED',
                filledQty: roundQty(status.filledQty),
                avgPrice: status.avgPrice,
            };
        }

        return {
            ...distribution,
            status: status.filledQty > 0 ? 'PARTIAL' : 'PENDING',
            filledQty: roundQty(status.filledQty),
            avgPrice: status.avgPrice,
        };
    }

    /**
     * WS 驱动的对冲成交更新（替代 5s 轮询的主路径）
     * 由 UserWsTelegramBridge 在检测到 hedge orderId 的 trade event 时调用
     */
    /**
     * WS 驱动的对冲成交更新（替代 5s 轮询的主路径）
     * 注意: filledQty 是本次 trade 的增量，非累计值
     * 同一个 orderId 只会出现在一个活跃任务中
     */
    applyWsHedgeFill(orderId: string, tradeQty: number, tradePrice: number): void {
        for (const task of this.tasks.values()) {
            if (TERMINAL_STATUSES.includes(task.status)) continue;

            const distributions = task.hedgeDistributions || [];
            const index = distributions.findIndex(d => d.orderId === orderId);
            if (index < 0) continue;

            const dist = distributions[index];
            // 增量累加，clamp 不超过订单总量
            const nextFilledQty = roundQty(Math.min(dist.filledQty + tradeQty, dist.quantity));
            if (nextFilledQty <= dist.filledQty + EPSILON) return;

            // 加权均价
            const prevTotal = dist.filledQty * dist.avgPrice;
            const incrQty = nextFilledQty - dist.filledQty;
            const nextAvgPrice = nextFilledQty > 0
                ? (prevTotal + incrQty * tradePrice) / nextFilledQty
                : tradePrice;

            const nextStatus: HedgeDistribution['status'] =
                nextFilledQty >= dist.quantity ? 'FILLED' : nextFilledQty > 0 ? 'PARTIAL' : dist.status;
            const updatedDistributions = [...distributions];
            updatedDistributions[index] = { ...dist, filledQty: nextFilledQty, avgPrice: nextAvgPrice, status: nextStatus };

            const summary = this.summarizeHedges(updatedDistributions);
            const previousTask = { ...task };
            const updatedTask = this.updateTask(task.id, {
                hedgeDistributions: updatedDistributions,
                hedgedQty: summary.hedgedQty,
                avgHedgePrice: summary.avgHedgePrice,
            });

            console.log(`[PolyMultiTaskService] WS hedge fill: task=${task.id.slice(0, 8)}, orderId=${orderId.slice(0, 10)}, +${roundQty(incrQty)} filled=${nextFilledQty}/${dist.quantity}, avgPrice=${nextAvgPrice.toFixed(4)}`);
            void this.logHedgeProgress(previousTask, updatedTask);
            return;
        }
    }

    /**
     * 获取所有活跃任务的 hedge orderIds（供 WS bridge 匹配用）
     */
    getActiveHedgeOrderIds(): Set<string> {
        const ids = new Set<string>();
        for (const task of this.tasks.values()) {
            if (TERMINAL_STATUSES.includes(task.status)) continue;
            for (const dist of task.hedgeDistributions || []) {
                if (dist.orderId && (dist.status === 'PENDING' || dist.status === 'PARTIAL')) {
                    ids.add(dist.orderId);
                }
            }
        }
        return ids;
    }

    private toHedgeTaskContext(task: PolyMultiTask): HedgeTaskContext {
        return {
            id: task.id,
            title: task.eventTitle || task.marketQuestion || task.selectionLabel || task.id,
            polyMultiPairingId: task.resolvedPairingId ?? task.polyMultiPairingId,
            polyMultiMasterWalletId: task.resolvedMasterWalletId ?? task.polyMultiMasterWalletId,
            currentOrderHash: task.currentOrderRef?.orderId,
            avgPredictPrice: task.avgPrice || task.price,
        };
    }

    private resolveHedgePrice(task: PolyMultiTask): number {
        if (Number.isFinite(task.hedgeMaxPrice) && task.hedgeMaxPrice! > 0) {
            return clampPrice(task.hedgeMaxPrice!);
        }

        const mainPrice = task.avgPrice > 0 ? task.avgPrice : task.price;
        return clampPrice(1 - mainPrice);
    }

    private normalizeLoadedTask(task: PolyMultiTask): PolyMultiTask {
        const normalized: PolyMultiTask = {
            ...task,
            expiresAt: Number.isFinite(task.expiresAt) ? task.expiresAt : undefined,
            hedgeSide: task.hedgeSide || 'BUY',
            hedgeStatus: task.hedgeStatus || (task.hedgeTokenId ? 'IDLE' : 'FAILED'),
            hedgeDistributions: task.hedgeDistributions || [],
            hedgedQty: task.hedgedQty || 0,
            avgHedgePrice: task.avgHedgePrice || 0,
        };

        const summary = this.summarizeHedges(normalized.hedgeDistributions || []);
        normalized.hedgedQty = summary.hedgedQty;
        normalized.avgHedgePrice = summary.avgHedgePrice;
        return normalized;
    }

    private logTaskCreated(task: PolyMultiTask): void {
        if (!this.taskLogger) return;
        void this.taskLogger.logTaskLifecycle(task.id, 'TASK_CREATED', {
            status: 'PENDING',
            taskConfig: this.toTaskConfigSnapshot(task),
        });
    }

    private logOrderSubmitted(task: PolyMultiTask): void {
        if (!this.taskLogger || !task.currentOrderRef?.orderId) return;
        this.lastLoggedOrderState.set(task.id, {
            status: 'LIVE',
            filledQty: 0,
        });
        void this.taskLogger.logOrderEvent(task.id, 'ORDER_SUBMITTED', {
            platform: 'polymarket',
            orderId: task.currentOrderRef.orderId,
            side: task.side,
            price: task.price,
            quantity: task.quantity,
            filledQty: 0,
            remainingQty: task.quantity,
            avgPrice: 0,
            title: this.getTaskDisplayTitle(task),
        }, task.currentOrderRef.orderId);
    }

    private logOrderFailed(task: PolyMultiTask, errorMessage: string): void {
        if (!this.taskLogger) return;
        const orderId = task.currentOrderRef?.orderId || `${task.id}:main`;
        void this.taskLogger.logOrderEvent(task.id, 'ORDER_FAILED', {
            platform: 'polymarket',
            orderId,
            side: task.side,
            price: task.price,
            quantity: task.quantity,
            filledQty: task.filledQty,
            remainingQty: task.remainingQty,
            avgPrice: task.avgPrice,
            title: this.getTaskDisplayTitle(task),
            error: this.toStructuredError(errorMessage),
        }, task.currentOrderRef?.orderId);
    }

    private logMainOrderProgress(task: PolyMultiTask, status: PolyOrderStatus): void {
        if (!this.taskLogger || !task.currentOrderRef?.orderId) return;

        const previous = this.lastLoggedOrderState.get(task.id) || {
            status: undefined,
            filledQty: 0,
        };
        const nextFilledQty = roundQty(status.filledQty);
        const title = this.getTaskDisplayTitle(task);

        if (nextFilledQty > previous.filledQty + EPSILON) {
            const eventType = nextFilledQty + EPSILON >= task.quantity || status.status === 'MATCHED'
                ? 'ORDER_FILLED'
                : 'ORDER_PARTIAL_FILL';
            void this.taskLogger.logOrderEvent(task.id, eventType, {
                platform: 'polymarket',
                orderId: task.currentOrderRef.orderId,
                side: task.side,
                price: status.avgPrice > 0 ? status.avgPrice : task.price,
                quantity: task.quantity,
                filledQty: nextFilledQty,
                remainingQty: roundQty(status.remainingQty),
                avgPrice: status.avgPrice,
                title,
            }, task.currentOrderRef.orderId);
        }

        if (status.status === 'CANCELLED' && previous.status !== 'CANCELLED') {
            void this.taskLogger.logOrderEvent(task.id, 'ORDER_CANCELLED', {
                platform: 'polymarket',
                orderId: task.currentOrderRef.orderId,
                side: task.side,
                price: status.avgPrice > 0 ? status.avgPrice : task.price,
                quantity: task.quantity,
                filledQty: nextFilledQty,
                remainingQty: roundQty(status.remainingQty),
                avgPrice: status.avgPrice,
                title,
            }, task.currentOrderRef.orderId);
        }

        this.lastLoggedOrderState.set(task.id, {
            status: status.status,
            filledQty: nextFilledQty,
        });
    }

    private logHedgeStarted(task: PolyMultiTask, hedgeQty: number, orderType: 'IOC' | 'GTC', hedgePrice: number): void {
        if (!this.taskLogger) return;
        void this.taskLogger.logHedgeEvent(task.id, 'HEDGE_STARTED', {
            hedgeQty,
            totalHedged: task.hedgedQty,
            title: this.getHedgeDisplayTitle(task),
            side: task.hedgeSide || 'BUY',
            hedgePrice,
            reason: orderType,
        });
    }

    private logHedgeFailed(task: PolyMultiTask, hedgeQty: number, errorMessage: string, rejection?: MultiHedgeRejection): void {
        if (!this.taskLogger) return;
        void this.taskLogger.logHedgeEvent(task.id, 'HEDGE_FAILED', {
            hedgeQty,
            totalHedged: task.hedgedQty,
            title: this.getHedgeDisplayTitle(task),
            side: task.hedgeSide || 'BUY',
            error: this.toStructuredError(errorMessage),
            ...(rejection?.reason ? { rejectionReason: rejection.reason } : {}),
            ...(rejection?.orderbookSnapshot ? { orderbookSnapshot: rejection.orderbookSnapshot } : {}),
        });
    }

    private logHedgeResult(
        task: PolyMultiTask,
        result: MultiHedgeResult,
        hedgeOrderType: 'IOC' | 'GTC',
        requestedQty: number,
        hedgePrice: number,
    ): void {
        if (!this.taskLogger) return;

        const totalHedged = roundQty(task.hedgedQty);
        const title = this.getHedgeDisplayTitle(task);
        const orderId = result.orderIds[0] || result.liveOrderIds[0];

        void this.taskLogger.logHedgeEvent(task.id, 'MULTI_HEDGE', {
            hedgeQty: requestedQty,
            totalHedged,
            avgHedgePrice: result.avgPrice || hedgePrice,
            title,
            side: task.hedgeSide || 'BUY',
            wallets: result.distributions.length,
            orderId,
            ...(result.orderbookSnapshot ? { orderbookSnapshot: result.orderbookSnapshot } : {}),
        });

        const completed = totalHedged + EPSILON >= task.filledQty && this.getLiveHedgeDistributions(task).length === 0;
        const hasProgress = result.totalFilled > 0 || result.liveOrderRefs.length > 0;
        const eventType = completed ? 'HEDGE_COMPLETED' : hasProgress ? 'HEDGE_PARTIAL' : 'HEDGE_FAILED';

        void this.taskLogger.logHedgeEvent(task.id, eventType, {
            hedgeQty: requestedQty,
            totalHedged,
            avgHedgePrice: result.avgPrice || hedgePrice,
            title,
            side: task.hedgeSide || 'BUY',
            wallets: result.distributions.length,
            orderId,
            orderStatus: hedgeOrderType === 'GTC'
                ? (result.liveOrderRefs.length > 0 ? 'LIVE' : 'FAILED')
                : (result.totalFilled > 0 ? 'MATCHED' : 'FAILED'),
            reason: eventType === 'HEDGE_PARTIAL' && hedgeOrderType === 'GTC'
                ? 'GTC hedge pending fill'
                : undefined,
        });
    }

    private logHedgeProgress(previousTask: PolyMultiTask, updatedTask: PolyMultiTask): void {
        if (!this.taskLogger) return;

        const previousQty = this.lastLoggedHedgeQty.get(previousTask.id) ?? roundQty(previousTask.hedgedQty);
        const nextQty = roundQty(updatedTask.hedgedQty);
        if (nextQty <= previousQty + EPSILON) {
            return;
        }

        this.lastLoggedHedgeQty.set(updatedTask.id, nextQty);
        const delta = roundQty(nextQty - previousQty);
        const hasLiveHedges = this.getLiveHedgeDistributions(updatedTask).length > 0;
        const eventType = nextQty + EPSILON >= updatedTask.filledQty && !hasLiveHedges ? 'HEDGE_COMPLETED' : 'HEDGE_PARTIAL';

        void this.taskLogger.logHedgeEvent(updatedTask.id, eventType, {
            hedgeQty: delta,
            totalHedged: nextQty,
            avgHedgePrice: updatedTask.avgHedgePrice,
            title: this.getHedgeDisplayTitle(updatedTask),
            side: updatedTask.hedgeSide || 'BUY',
        });
    }

    private logTaskStatusTransition(previousTask: PolyMultiTask, updatedTask: PolyMultiTask): void {
        if (!this.taskLogger || previousTask.status === updatedTask.status) return;

        if (previousTask.status === 'PENDING' && updatedTask.status === 'LIVE') {
            void this.taskLogger.logTaskLifecycle(updatedTask.id, 'TASK_STARTED', {
                status: 'PREDICT_SUBMITTED',
                previousStatus: 'PENDING',
                taskConfig: this.toTaskConfigSnapshot(updatedTask),
            });
            return;
        }

        if (updatedTask.status === 'COMPLETED') {
            void this.taskLogger.logTaskLifecycle(updatedTask.id, 'TASK_COMPLETED', {
                status: 'COMPLETED',
                previousStatus: previousTask.status === 'LIVE' ? 'PREDICT_SUBMITTED' : 'HEDGE_PENDING',
            });
            return;
        }

        if (updatedTask.status === 'FAILED') {
            void this.taskLogger.logTaskLifecycle(updatedTask.id, 'TASK_FAILED', {
                status: 'FAILED',
                previousStatus: this.toLifecycleStatus(previousTask.status),
                error: updatedTask.error ? this.toStructuredError(updatedTask.error) : undefined,
            });
            return;
        }

        if (updatedTask.status === 'CANCELLED') {
            void this.taskLogger.logTaskLifecycle(updatedTask.id, 'TASK_CANCELLED', {
                status: 'CANCELLED',
                previousStatus: this.toLifecycleStatus(previousTask.status),
                reason: updatedTask.error,
            });
        }
    }

    private toTaskConfigSnapshot(task: PolyMultiTask): TaskConfigSnapshot {
        return {
            type: task.side,
            marketId: 0,
            title: this.getTaskDisplayTitle(task),
            predictPrice: task.price,
            polymarketConditionId: task.conditionId,
            polymarketNoTokenId: task.hedgeTokenId || task.tokenId,
            polymarketYesTokenId: task.tokenId,
            isInverted: false,
            feeRateBps: 0,
            tickSize: 0.01,
            negRisk: task.negRisk,
            arbSide: task.side === 'BUY' ? 'YES' : 'NO',
            quantity: task.quantity,
        };
    }

    private getTaskDisplayTitle(task: PolyMultiTask): string {
        const base = task.eventTitle || task.marketQuestion || 'Untitled event';
        return task.selectionLabel ? `${base} / ${task.selectionLabel}` : base;
    }

    private getHedgeDisplayTitle(task: PolyMultiTask): string {
        const base = task.eventTitle || task.marketQuestion || 'Untitled event';
        return task.hedgeSelectionLabel ? `${base} / ${task.hedgeSelectionLabel}` : base;
    }

    private toStructuredError(message: string): StructuredError {
        return {
            errorType: 'PolyMultiTaskError',
            message,
        };
    }

    private toLifecycleStatus(status: PolyMultiTaskStatus): 'PENDING' | 'PREDICT_SUBMITTED' | 'HEDGE_PENDING' | 'FAILED' | 'CANCELLED' | 'COMPLETED' {
        switch (status) {
            case 'LIVE':
                return 'PREDICT_SUBMITTED';
            case 'HEDGE_PENDING':
                return 'HEDGE_PENDING';
            case 'FAILED':
                return 'FAILED';
            case 'CANCELLED':
                return 'CANCELLED';
            case 'COMPLETED':
                return 'COMPLETED';
            default:
                return 'PENDING';
        }
    }

    private updateTask(taskId: string, update: Partial<PolyMultiTask>): PolyMultiTask {
        const existing = this.getTaskOrThrow(taskId);
        if (!this.hasChanges(existing, update)) {
            return existing;
        }

        const updated: PolyMultiTask = {
            ...existing,
            ...update,
            updatedAt: Date.now(),
        };

        this.tasks.set(taskId, updated);
        this.logTaskStatusTransition(existing, updated);
        this.persistAsync();
        this.emit('task:updated', updated);
        this.emitSnapshot();
        return updated;
    }

    private hasChanges(existing: PolyMultiTask, update: Partial<PolyMultiTask>): boolean {
        for (const [key, value] of Object.entries(update) as Array<[keyof PolyMultiTask, PolyMultiTask[keyof PolyMultiTask]]>) {
            const current = existing[key];
            if (typeof value === 'object' && value !== null) {
                if (JSON.stringify(current) !== JSON.stringify(value)) {
                    return true;
                }
                continue;
            }
            if (current !== value) {
                return true;
            }
        }
        return false;
    }

    private areDistributionsEqual(left: HedgeDistribution, right: HedgeDistribution): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    private getTaskOrThrow(taskId: string): PolyMultiTask {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        return task;
    }

    private emitSnapshot(): void {
        this.emit('tasks:snapshot', this.getSnapshot());
    }

    private generateTaskId(input: CreatePolyMultiTaskInput): string {
        if (input.idempotencyKey) {
            return input.idempotencyKey;
        }

        const timeWindow = Math.floor(Date.now() / 10_000);
        return crypto
            .createHash('sha256')
            .update([
                input.conditionId,
                input.tokenId,
                input.side,
                input.price.toFixed(6),
                input.quantity.toFixed(4),
                input.polyMultiPairingId ?? '',
                input.polyMultiMasterWalletId ?? '',
                Number.isFinite(input.expiresAt) ? input.expiresAt : '',
                timeWindow,
            ].join(':'))
            .digest('hex')
            .slice(0, 16);
    }

    private persistAsync(): void {
        this.writeQueue = this.writeQueue.then(async () => {
            const data = JSON.stringify(Array.from(this.tasks.entries()), null, 2);
            const tempPath = `${this.persistPath}.tmp`;
            await fs.writeFile(tempPath, data, 'utf-8');
            await fs.rename(tempPath, this.persistPath);
        }).catch(error => {
            console.error('[PolyMultiTaskService] Failed to persist tasks:', error);
        });
    }
}
