/**
 * Telegram Notification Module
 *
 * Sends alerts for:
 * - Order placed / cancelled / filled
 * - Execution errors
 */

import TelegramBot from 'node-telegram-bot-api';

export interface TelegramConfig {
    botToken: string;
    chatId: string;
    enabled?: boolean;
}

export interface OrderAlert {
    type: 'PLACED' | 'CANCELLED' | 'FILLED' | 'PARTIAL_FILL' | 'FAILED';
    platform: 'POLYMARKET';
    marketName: string;
    action: 'BUY' | 'SELL';             // 买入/卖出
    side: 'YES' | 'NO';                 // YES/NO 方向
    outcome?: string;                   // 多选市场的选项名（如 "Trump"），二元市场可省略
    price: number;
    quantity: number;
    filledQuantity?: number;
    filledDelta?: number;               // 本次成交增量（用于分批成交显示）
    timestamp?: number;                 // 下单时间戳 (ms)
    error?: string;                     // 错误信息 (用于 FAILED 类型)
    role?: 'Maker' | 'Taker';           // 角色：挂单方/吃单方
    orderHash?: string;                 // 订单哈希
    dataSource?: string;                // 数据来源 (如 "REST API")
    // 延迟统计 (ms)
    latency?: {
        submitToFirstStatus?: number;   // 下单到首次获取状态
        submitToFill?: number;          // 下单到成交
        statusFetchAttempts?: number;   // 状态获取尝试次数
        taskTotalMs?: number;           // 任务总耗时
    };
}

export interface ExecutionErrorAlert {
    operation: string;
    platform: 'POLYMARKET';
    marketName: string;
    error: string;
    stack?: string;
    requiresManualIntervention: boolean;
}

export class TelegramNotifier {
    private bot: TelegramBot | null = null;
    private chatId: string;
    private enabled: boolean;
    private messageQueue: string[] = [];
    private isSending = false;

    constructor(config: TelegramConfig) {
        this.chatId = config.chatId;
        this.enabled = config.enabled ?? true;

        if (this.enabled && config.botToken) {
            try {
                this.bot = new TelegramBot(config.botToken, { polling: false });
                console.log('[TG] Telegram notifier initialized');
            } catch (error) {
                console.error('[TG] Failed to initialize Telegram bot:', error);
                this.enabled = false;
            }
        }
    }

    // ============================================================================
    // Public Alert Methods
    // ============================================================================

    /**
     * Send order status alert
     *
     * 格式：平台标识 + 状态 + 角色 + 数据来源
     * 🔵 Polymarket
     */
    async alertOrder(alert: OrderAlert): Promise<void> {
        const platformIcon = '🔵';
        const emoji = this.getOrderEmoji(alert.type);
        const statusText = this.getOrderStatusText(alert.type);

        // 操作类型图标
        const actionIcon = alert.action === 'BUY' ? '📈' : '📉';
        const actionText = alert.action === 'BUY' ? '买入开仓' : '卖出平仓';

        // 角色
        const roleText = alert.role || (alert.type === 'PLACED' ? 'Maker' : 'Taker');
        const roleDesc = roleText === 'Maker' ? '(挂单)' : '';

        // 多选市场显示选项名
        const outcomeText = alert.outcome
            ? `[${this.escapeHtml(alert.outcome)}] ${alert.side}`
            : alert.side;

        // 数量格式根据状态不同
        const filled = alert.filledQuantity ?? 0;
        const delta = alert.filledDelta;
        const deltaText = delta !== undefined && delta > 0 ? ` (+${delta.toFixed(0)})` : '';

        let quantityText: string;
        let priceLabel: string;
        let amountText: string = '';

        switch (alert.type) {
            case 'PLACED':
                quantityText = `${alert.quantity.toFixed(0)} 股`;
                priceLabel = '挂单价';
                amountText = `\n<b>金额:</b> $${(alert.price * alert.quantity).toFixed(2)}`;
                break;
            case 'FILLED':
                quantityText = `${filled.toFixed(0)} 股`;
                priceLabel = '成交价';
                amountText = `\n<b>成交额:</b> $${(alert.price * filled).toFixed(2)}`;
                break;
            case 'PARTIAL_FILL':
                quantityText = `${filled.toFixed(0)}/${alert.quantity.toFixed(0)} 股${deltaText}`;
                priceLabel = '成交价';
                amountText = `\n<b>成交额:</b> $${(alert.price * filled).toFixed(2)}`;
                break;
            case 'CANCELLED':
                quantityText = filled > 0
                    ? `${filled.toFixed(0)}/${alert.quantity.toFixed(0)} 股 (已取消)`
                    : `${alert.quantity.toFixed(0)} 股 (已取消)`;
                priceLabel = '挂单价';
                break;
            case 'FAILED':
                quantityText = `${filled.toFixed(0)}/${alert.quantity.toFixed(0)} 股`;
                priceLabel = '价格';
                break;
            default:
                quantityText = `${filled.toFixed(0)}/${alert.quantity.toFixed(0)} 股`;
                priceLabel = '价格';
        }

        // 下单时间
        const timeText = alert.timestamp
            ? new Date(alert.timestamp).toLocaleString('zh-CN', { hour12: false })
            : new Date().toLocaleString('zh-CN', { hour12: false });

        // 数据来源
        const dataSource = alert.dataSource || 'Polymarket WS';

        let message = `${platformIcon} ${emoji} <b>${alert.platform} 订单${statusText}</b>

<b>类型:</b> ${actionIcon} ${actionText}
<b>市场:</b> ${this.escapeHtml(alert.marketName)}
<b>方向:</b> ${outcomeText}
<b>角色:</b> ${roleText} ${roleDesc}
<b>${priceLabel}:</b> ${(alert.price * 100).toFixed(1)}¢
<b>数量:</b> ${quantityText}${amountText}`;

        // 订单哈希
        if (alert.orderHash) {
            message += `\n\n<b>订单:</b> <code>${alert.orderHash.slice(0, 18)}...</code>`;
        }

        message += `\n<b>时间:</b> ${timeText}`;

        // 添加延迟信息
        if (alert.latency) {
            message += `\n\n<b>⏱️ 延迟统计:</b>`;
            if (alert.latency.submitToFirstStatus !== undefined) {
                message += `\n  首次状态: ${(alert.latency.submitToFirstStatus / 1000).toFixed(2)}s`;
            }
            if (alert.latency.submitToFill !== undefined) {
                message += `\n  下单到成交: ${(alert.latency.submitToFill / 1000).toFixed(2)}s`;
            }
            if (alert.latency.taskTotalMs !== undefined) {
                message += `\n  任务总耗时: ${(alert.latency.taskTotalMs / 1000).toFixed(2)}s`;
            }
            if (alert.latency.statusFetchAttempts !== undefined) {
                message += `\n  轮询次数: ${alert.latency.statusFetchAttempts}`;
            }
        }

        // 添加错误信息 (用于 FAILED 类型)
        if (alert.error) {
            message += `\n\n<b>❌ 错误:</b>\n<code>${this.escapeHtml(alert.error)}</code>`;
        }

        message += `\n\n📡 <i>via ${dataSource}</i>`;
        await this.send(message);
    }

    /**
     * Send execution error alert
     */
    async alertError(alert: ExecutionErrorAlert): Promise<void> {
        const emoji = alert.requiresManualIntervention ? '🚨' : '⚠️';
        const urgency = alert.requiresManualIntervention ? '严重' : '警告';

        const message = `
${emoji} <b>${urgency}: 执行错误</b> ${emoji}

<b>操作:</b> ${alert.operation}
<b>平台:</b> ${alert.platform}
<b>市场:</b> ${this.escapeHtml(alert.marketName)}

<b>错误信息:</b>
<code>${this.escapeHtml(alert.error)}</code>

${alert.stack ? `<b>堆栈:</b>\n<code>${this.escapeHtml(alert.stack.slice(0, 500))}</code>` : ''}

${alert.requiresManualIntervention ? '<b>⚡ 需要人工介入 ⚡</b>' : ''}
`;
        await this.send(message);
    }

    /**
     * Send simple text message
     */
    async sendText(text: string): Promise<void> {
        await this.send(text);
    }

    /**
     * 发送消息并置顶
     * @returns messageId 用于后续取消置顶
     */
    async sendAndPin(text: string): Promise<number | null> {
        if (!this.enabled || !this.bot) return null;
        try {
            const msg = await this.bot.sendMessage(this.chatId, text.trim(), {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            });
            try {
                await this.bot.pinChatMessage(this.chatId, msg.message_id, {
                    disable_notification: false,
                });
            } catch (e: any) {
                console.warn(`[TG] Pin message failed: ${e.message}`);
            }
            return msg.message_id;
        } catch (e: any) {
            console.error(`[TG] Send+pin failed: ${e.message}`);
            return null;
        }
    }

    /**
     * 取消置顶消息
     */
    async unpinMessage(messageId: number): Promise<void> {
        if (!this.enabled || !this.bot) return;
        try {
            await this.bot.unpinChatMessage(this.chatId, { message_id: messageId });
        } catch (e: any) {
            console.warn(`[TG] Unpin failed: ${e.message}`);
        }
    }

    // ============================================================================
    // Private Methods
    // ============================================================================

    private async send(message: string): Promise<void> {
        if (!this.enabled || !this.bot) {
            console.log('[TG] (disabled)', message.slice(0, 100));
            return;
        }

        this.messageQueue.push(message);
        await this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.isSending || this.messageQueue.length === 0) return;

        this.isSending = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift()!;
            let retries = 0;
            const maxRetries = 3;

            while (retries < maxRetries) {
                try {
                    await this.bot!.sendMessage(this.chatId, message.trim(), {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                    });
                    // Rate limit: max 30 messages per second
                    await this.sleep(100);
                    break; // 成功则跳出重试循环
                } catch (error: any) {
                    // 检查是否是 429 Too Many Requests
                    if (error?.response?.statusCode === 429 || error?.code === 'ETELEGRAM' && error?.message?.includes('429')) {
                        // 从错误响应中提取 retry_after
                        let retryAfter = 30; // 默认 30 秒
                        try {
                            if (error?.response?.body?.parameters?.retry_after) {
                                retryAfter = error.response.body.parameters.retry_after;
                            }
                        } catch { }
                        console.warn(`[TG] 429 Too Many Requests, waiting ${retryAfter}s before retry...`);
                        await this.sleep(retryAfter * 1000);
                        retries++;
                        continue;
                    }
                    console.error('[TG] Failed to send message:', error?.message || error);
                    break; // 其他错误不重试
                }
            }
        }

        this.isSending = false;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private getOrderEmoji(type: OrderAlert['type']): string {
        switch (type) {
            case 'PLACED': return '📝';
            case 'CANCELLED': return '❌';
            case 'FILLED': return '✅';
            case 'PARTIAL_FILL': return '🔄';
            case 'FAILED': return '🚨';
            default: return '📋';
        }
    }

    private getOrderStatusText(type: OrderAlert['type']): string {
        switch (type) {
            case 'PLACED': return '已挂单';
            case 'CANCELLED': return '已取消';
            case 'FILLED': return '已成交';
            case 'PARTIAL_FILL': return '部分成交';
            case 'FAILED': return '失败';
            default: return '更新';
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Factory function
export function createTelegramNotifier(config: TelegramConfig): TelegramNotifier {
    return new TelegramNotifier(config);
}
