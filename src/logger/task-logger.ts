/**
 * 轻量级 TaskLogger — poly-multi 专用
 *
 * 原始版本 (predict-engine/src/dashboard/task-logger/task-logger.ts) 为 1,254 行，
 * 含异步队列、批量 flush、快照管理、7 天日志清理、脱敏等功能。
 *
 * 本实现保留 poly-multi task-service.ts 所需的 3 个日志方法 + 通知集成，
 * 写入策略简化为直接 appendFile（无队列），约 200 行。
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
    type TaskLogEvent,
    type TaskLogEventType,
    type TaskLifecycleEventType,
    type TaskLifecyclePayload,
    type OrderEventType,
    type OrderEventPayload,
    type HedgeEventType,
    type HedgePayload,
    type StructuredError,
    type EventPriority,
    EVENT_PRIORITY_MAP,
    NOTIFY_EVENTS,
    LOG_SCHEMA_VERSION,
} from './types.js';

// ============================================================================
// TaskLogger
// ============================================================================

export class TaskLogger extends EventEmitter {
    private readonly baseDir: string;
    private readonly executorId: string;
    private readonly sequenceMap = new Map<string, number>();
    private closed = false;

    constructor(opts: { baseDir: string }) {
        super();
        this.baseDir = path.resolve(opts.baseDir);
        this.executorId = this.generateId();
        fs.mkdir(this.baseDir, { recursive: true }).catch(() => {});
    }

    // ========================================================================
    // 公共方法 — 事件记录
    // ========================================================================

    async logTaskLifecycle(
        taskId: string,
        type: TaskLifecycleEventType,
        payload: Omit<TaskLifecyclePayload, 'error'> & { error?: Error | StructuredError },
    ): Promise<void> {
        const event: TaskLogEvent = {
            timestamp: Date.now(),
            taskId,
            sequence: this.nextSequence(taskId),
            logSchemaVersion: LOG_SCHEMA_VERSION,
            executorId: this.executorId,
            priority: EVENT_PRIORITY_MAP[type],
            type,
            payload: {
                ...payload,
                error: payload.error ? this.structureError(payload.error) : undefined,
            },
        };
        await this.writeEvent(taskId, event);
    }

    async logOrderEvent(
        taskId: string,
        type: OrderEventType,
        payload: Omit<OrderEventPayload, 'error'> & { error?: Error | StructuredError },
        orderHash?: string,
    ): Promise<void> {
        const event: TaskLogEvent = {
            timestamp: Date.now(),
            taskId,
            sequence: this.nextSequence(taskId),
            logSchemaVersion: LOG_SCHEMA_VERSION,
            executorId: this.executorId,
            orderId: payload.orderId,
            orderHash,
            priority: EVENT_PRIORITY_MAP[type],
            type,
            payload: {
                ...payload,
                error: payload.error ? this.structureError(payload.error) : undefined,
            },
        };
        await this.writeEvent(taskId, event);
    }

    async logHedgeEvent(
        taskId: string,
        type: HedgeEventType,
        payload: Omit<HedgePayload, 'error'> & { error?: Error | StructuredError },
        attemptId?: string,
    ): Promise<void> {
        const event: TaskLogEvent = {
            timestamp: Date.now(),
            taskId,
            sequence: this.nextSequence(taskId),
            logSchemaVersion: LOG_SCHEMA_VERSION,
            executorId: this.executorId,
            attemptId,
            priority: EVENT_PRIORITY_MAP[type],
            type,
            payload: {
                ...payload,
                error: payload.error ? this.structureError(payload.error) : undefined,
            },
        };
        await this.writeEvent(taskId, event);
    }

    // ========================================================================
    // 通知集成
    // ========================================================================

    connectNotifier(
        handler: (data: { taskId: string; event: TaskLogEvent }) => void | Promise<void>,
    ): () => void {
        const wrapped = (data: { taskId: string; event: TaskLogEvent }) => {
            try {
                const result = handler(data);
                if (result instanceof Promise) {
                    result.catch(err => console.error('[TaskLogger] Notification handler error:', err));
                }
            } catch (err) {
                console.error('[TaskLogger] Notification handler error:', err);
            }
        };
        this.on('notify', wrapped);
        return () => { this.off('notify', wrapped); };
    }

    formatEventForNotification(taskId: string, event: TaskLogEvent): string {
        const time = new Date(event.timestamp).toLocaleTimeString('zh-CN');
        const { title, platform, side, detail } = this.extractEventInfo(event);
        const emoji = this.getEventEmoji(event.type);

        let message = `${emoji} <b>${event.type}</b>\n`;
        message += `<b>时间:</b> ${time}\n`;
        if (title) message += `<b>市场:</b> ${title}\n`;
        if (platform) message += `<b>平台:</b> ${platform.toUpperCase()}\n`;
        if (side) message += `<b>方向:</b> ${side}\n`;
        if (detail) message += detail;
        message += `<b>任务:</b> <code>${taskId}</code>`;
        return message;
    }

    // ========================================================================
    // 生命周期
    // ========================================================================

    async flush(): Promise<void> {
        // 直接写入，无队列需要 flush — 此方法为接口兼容保留
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.removeAllListeners();
    }

    // ========================================================================
    // 私有方法 — 写入
    // ========================================================================

    private async writeEvent(taskId: string, event: TaskLogEvent): Promise<void> {
        if (this.closed) return;

        try {
            const taskDir = path.join(this.baseDir, taskId);
            await fs.mkdir(taskDir, { recursive: true });
            const filePath = path.join(taskDir, 'events.jsonl');
            await fs.appendFile(filePath, JSON.stringify(event) + '\n', 'utf-8');
        } catch (err) {
            console.error(`[TaskLogger] Write error for task ${taskId}:`, err);
        }

        if (NOTIFY_EVENTS.has(event.type)) {
            this.emit('notify', { taskId, event });
        }
    }

    // ========================================================================
    // 私有方法 — 工具
    // ========================================================================

    private nextSequence(taskId: string): number {
        const current = this.sequenceMap.get(taskId) || 0;
        const next = current + 1;
        this.sequenceMap.set(taskId, next);
        return next;
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    }

    private structureError(error: Error | StructuredError): StructuredError {
        if ('errorType' in error) return error as StructuredError;
        const e = error as Error & { code?: string; status?: number; response?: { data?: unknown } };
        return {
            errorType: e.name || 'Error',
            message: e.message,
            stack: e.stack,
            code: e.code,
            httpStatus: e.status,
            responseBody: e.response?.data ? JSON.stringify(e.response.data).substring(0, 500) : undefined,
        };
    }

    // ========================================================================
    // 私有方法 — 通知格式化
    // ========================================================================

    private extractEventInfo(event: TaskLogEvent): {
        title?: string;
        platform?: string;
        side?: string;
        detail: string;
    } {
        const payload = event.payload as unknown as Record<string, unknown>;
        let title: string | undefined;
        let platform: string | undefined;
        let side: string | undefined;
        let detail = '';

        // 标题
        if (payload.title) title = payload.title as string;

        // TaskLifecycle — taskConfig
        if (payload.taskConfig) {
            const config = payload.taskConfig as { title?: string; type?: string; quantity?: number; predictPrice?: number };
            if (!title) title = config.title;
            side = config.type;
            if (config.quantity !== undefined && config.predictPrice !== undefined) {
                detail += `<b>数量:</b> ${config.quantity} shares\n`;
                detail += `<b>价格:</b> $${config.predictPrice.toFixed(2)}\n`;
            }
        }

        // Order/Hedge — platform, side, outcome
        if (payload.platform !== undefined) platform = payload.platform as string;
        if (payload.side !== undefined && !side) {
            const sideText = payload.side as string;
            const outcomeText = payload.outcome as string | undefined;
            if (outcomeText) {
                const outcomeIcon = outcomeText === 'YES' ? '\u{1F7E2}' : '\u{1F534}';
                side = `${sideText} ${outcomeText} ${outcomeIcon}`;
            } else {
                side = sideText;
            }
        }

        if (payload.price !== undefined) detail += `<b>价格:</b> $${(payload.price as number).toFixed(2)}\n`;
        if (payload.quantity !== undefined) detail += `<b>数量:</b> ${payload.quantity} shares\n`;

        if (payload.filledQty !== undefined) {
            const filled = payload.filledQty as number;
            const remaining = (payload.remainingQty as number | undefined) ?? 0;
            detail += `<b>成交:</b> ${filled} / ${filled + remaining}\n`;
        }

        // Hedge
        if (payload.hedgeQty !== undefined) {
            detail += `<b>对冲数量:</b> ${payload.hedgeQty}\n`;
            if (payload.totalHedged !== undefined) detail += `<b>累计对冲:</b> ${payload.totalHedged}\n`;
            if (payload.avgHedgePrice !== undefined) detail += `<b>平均价格:</b> $${(payload.avgHedgePrice as number).toFixed(2)}\n`;
            if (payload.avgTotalCost !== undefined) detail += `<b>总成本/share:</b> $${(payload.avgTotalCost as number).toFixed(4)}\n`;
        }

        // 利润
        if (payload.profit !== undefined) {
            const profit = payload.profit as number;
            const profitEmoji = profit >= 0 ? '\u{1F4C8}' : '\u{1F4C9}';
            detail += `${profitEmoji} <b>利润:</b> $${profit.toFixed(2)}\n`;
        }
        if (payload.profitPercent !== undefined) {
            detail += `<b>利润率:</b> ${(payload.profitPercent as number).toFixed(2)}%\n`;
        }

        // 错误
        if (payload.error) {
            const err = payload.error as { message?: string };
            detail += `<b>错误:</b> ${err.message || 'Unknown error'}\n`;
        }

        // 原因
        if (payload.reason) detail += `<b>原因:</b> ${payload.reason as string}\n`;

        return { title, platform, side, detail };
    }

    private getEventEmoji(type: TaskLogEventType): string {
        const map: Record<string, string> = {
            TASK_CREATED: '\u{1F4DD}',
            TASK_STARTED: '\u{1F680}',
            TASK_COMPLETED: '\u2705',
            TASK_FAILED: '\u274C',
            TASK_CANCELLED: '\u{1F6D1}',
            ORDER_SUBMITTED: '\u{1F4E4}',
            ORDER_FILLED: '\u{1F4B0}',
            ORDER_PARTIAL_FILL: '\u{1F504}',
            ORDER_CANCELLED: '\u274C',
            ORDER_FAILED: '\u26A0\uFE0F',
            HEDGE_STARTED: '\u{1F500}',
            HEDGE_COMPLETED: '\u2705',
            HEDGE_FAILED: '\u274C',
            HEDGE_PARTIAL: '\u{1F504}',
            MULTI_HEDGE: '\u{1F500}',
        };
        return map[type] || '\u{1F4CB}';
    }
}
