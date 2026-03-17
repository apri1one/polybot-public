/**
 * TaskLogger 类型 — poly-multi 精简版
 *
 * 仅包含 poly-multi task-service.ts 实际使用的事件类型。
 * 原始完整定义见 predict-engine/src/dashboard/task-logger/types.ts (721 行)。
 */

// ============================================================================
// 常量
// ============================================================================

export const LOG_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// 事件优先级
// ============================================================================

export type EventPriority = 'CRITICAL' | 'INFO';

// ============================================================================
// 基础结构
// ============================================================================

export interface StructuredError {
    errorType: string;
    message: string;
    stack?: string;
    httpStatus?: number;
    responseBody?: string;
    code?: string;
}

// ============================================================================
// 任务配置快照
// ============================================================================

export interface TaskConfigSnapshot {
    type: 'BUY' | 'SELL';
    marketId: number;
    title: string;
    predictPrice: number;
    polymarketMaxAsk?: number;
    polymarketMinBid?: number;
    quantity: number;
    polymarketConditionId: string;
    polymarketNoTokenId: string;
    polymarketYesTokenId: string;
    isInverted: boolean;
    feeRateBps: number;
    tickSize: number;
    negRisk: boolean;
    arbSide: 'YES' | 'NO';
    strategy?: 'MAKER' | 'TAKER';
    predictAskPrice?: number;
    maxTotalCost?: number;
}

// ============================================================================
// 任务生命周期事件
// ============================================================================

export type TaskLifecycleEventType =
    | 'TASK_CREATED'
    | 'TASK_STARTED'
    | 'TASK_COMPLETED'
    | 'TASK_FAILED'
    | 'TASK_CANCELLED';

export interface TaskLifecyclePayload {
    status: string;
    previousStatus?: string;
    reason?: string;
    error?: StructuredError;
    taskConfig?: TaskConfigSnapshot;
    profit?: number;
    profitPercent?: number;
    duration?: number;
}

// ============================================================================
// 订单事件
// ============================================================================

export type OrderEventType =
    | 'ORDER_SUBMITTED'
    | 'ORDER_FILLED'
    | 'ORDER_PARTIAL_FILL'
    | 'ORDER_CANCELLED'
    | 'ORDER_FAILED';

export interface OrderEventPayload {
    platform: 'polymarket';
    orderId: string;
    side: 'BUY' | 'SELL';
    outcome?: 'YES' | 'NO';
    price: number;
    quantity: number;
    filledQty: number;
    remainingQty: number;
    avgPrice: number;
    error?: StructuredError;
    title?: string;
    adjustReason?: string;
    cancelReason?: string;
}

// ============================================================================
// 对冲事件
// ============================================================================

export type HedgeEventType =
    | 'HEDGE_STARTED'
    | 'HEDGE_PARTIAL'
    | 'HEDGE_COMPLETED'
    | 'HEDGE_FAILED'
    | 'MULTI_HEDGE';

export interface HedgePayload {
    hedgeQty: number;
    totalHedged: number;
    totalPredictFilled?: number;
    avgHedgePrice?: number;
    retryCount?: number;
    error?: StructuredError;
    reason?: string;
    wallets?: number;
    title?: string;
    side?: 'BUY' | 'SELL';
    outcome?: 'YES' | 'NO';
    orderId?: string;
    orderStatus?: string;
    avgPredictPrice?: number;
    avgTotalCost?: number;
    hedgePrice?: number;
    // poly-multi 附加字段 (multi-hedge-executor rejection)
    rejectionReason?: string;
    orderbookSnapshot?: unknown;
}

// ============================================================================
// 统一事件
// ============================================================================

export type TaskLogEventType =
    | TaskLifecycleEventType
    | OrderEventType
    | HedgeEventType;

export interface BaseLogEvent {
    timestamp: number;
    taskId: string;
    sequence: number;
    logSchemaVersion: string;
    executorId?: string;
    attemptId?: string;
    orderId?: string;
    orderHash?: string;
    priority: EventPriority;
}

export interface TaskLifecycleEvent extends BaseLogEvent {
    type: TaskLifecycleEventType;
    payload: TaskLifecyclePayload;
}

export interface OrderEvent extends BaseLogEvent {
    type: OrderEventType;
    payload: OrderEventPayload;
}

export interface HedgeEvent extends BaseLogEvent {
    type: HedgeEventType;
    payload: HedgePayload;
}

export type TaskLogEvent =
    | TaskLifecycleEvent
    | OrderEvent
    | HedgeEvent;

// ============================================================================
// 事件优先级映射
// ============================================================================

export const EVENT_PRIORITY_MAP: Record<TaskLogEventType, EventPriority> = {
    // 生命周期
    TASK_CREATED: 'CRITICAL',
    TASK_STARTED: 'CRITICAL',
    TASK_COMPLETED: 'CRITICAL',
    TASK_FAILED: 'CRITICAL',
    TASK_CANCELLED: 'CRITICAL',
    // 订单
    ORDER_SUBMITTED: 'CRITICAL',
    ORDER_FILLED: 'CRITICAL',
    ORDER_PARTIAL_FILL: 'INFO',
    ORDER_CANCELLED: 'CRITICAL',
    ORDER_FAILED: 'CRITICAL',
    // 对冲
    HEDGE_STARTED: 'CRITICAL',
    HEDGE_PARTIAL: 'INFO',
    HEDGE_COMPLETED: 'CRITICAL',
    HEDGE_FAILED: 'CRITICAL',
    MULTI_HEDGE: 'CRITICAL',
};

/** 需要发送通知的事件类型 */
export const NOTIFY_EVENTS: Set<TaskLogEventType> = new Set([
    'TASK_STARTED',
    'TASK_COMPLETED',
    'TASK_FAILED',
    'TASK_CANCELLED',
    'ORDER_SUBMITTED',
    'ORDER_FILLED',
    'ORDER_PARTIAL_FILL',
    'ORDER_CANCELLED',
    'HEDGE_STARTED',
    'HEDGE_COMPLETED',
    'HEDGE_FAILED',
    'MULTI_HEDGE',
]);
