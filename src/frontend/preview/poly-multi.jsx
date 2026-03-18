/**
 * poly-multi: 多账户 Polymarket 对冲管理面板
 *
 * 组件结构:
 * PolyMultiTab
 * +-- UnlockGate (未解锁时显示)
 * +-- WalletsSection (已解锁)
 * |   +-- MatchedPairingsPanel
 * |   |   +-- WalletDataRow x N
 * |   +-- UnmatchedWalletsPanel
 * |   |   +-- WalletDataRow x N
 * |   +-- BatchImportForm
 * +-- HedgeHistoryPanel
 */

const { useState, useEffect, useCallback } = React;

// ============================================================
// API 调用
// ============================================================

const polyMultiApi = {
    async getStatus(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/status`);
        return r.json();
    },
    async unlock(baseUrl, masterPassword) {
        const r = await fetch(`${baseUrl}/api/poly-multi/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterPassword }),
        });
        return r.json();
    },
    async lock(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return r.json();
    },
    async getWallets(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets`);
        return r.json();
    },
    async addWallet(baseUrl, privateKey, label, masterPassword) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ privateKey, label, masterPassword }),
        });
        return r.json();
    },
    async deleteWallet(baseUrl, id) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets/${id}`, { method: 'DELETE' });
        return r.json();
    },
    async updateWalletLabel(baseUrl, id, label) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label }),
        });
        return r.json();
    },
    async getPairings(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings`);
        return r.json();
    },
    async createPairing(baseUrl, name, masterWalletId, hedgeWalletIds) {
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, masterWalletId, hedgeWalletIds }),
        });
        return r.json();
    },
    async deletePairing(baseUrl, id) {
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings/${id}`, { method: 'DELETE' });
        return r.json();
    },
    async activatePairing(baseUrl, id) {
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings/${id}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return r.json();
    },
    async deactivatePairing(baseUrl, id) {
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings/${id}/deactivate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return r.json();
    },
    async getHedgeHistory(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/hedge-history`);
        return r.json();
    },
    async batchAddWallets(baseUrl, wallets, masterPassword) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallets, masterPassword }),
        });
        return r.json();
    },
    async autoMatch(baseUrl, masterWalletId, hedgeWalletId) {
        const body = { masterWalletId };
        if (hedgeWalletId) body.hedgeWalletId = hedgeWalletId;
        const r = await fetch(`${baseUrl}/api/poly-multi/pairings/auto-match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return r.json();
    },
    async getUnmatchedWallets(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets/unmatched`);
        return r.json();
    },
    async refreshWalletQuery(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallet-query/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return r.json();
    },
    async getWalletQueryStatus(baseUrl) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallet-query/status`);
        return r.json();
    },
    async redeemWallet(baseUrl, walletId) {
        const r = await fetch(`${baseUrl}/api/poly-multi/wallets/${walletId}/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return r.json();
    },
};

// ============================================================
// 辅助函数
// ============================================================

function shortAddr(addr) {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatActiveDays(lastTradeTime) {
    if (!lastTradeTime) return '---';
    const days = Math.floor((Date.now() / 1000 - lastTradeTime) / 86400);
    if (days === 0) return '今天';
    return `${days}天前`;
}

function formatUsd(value) {
    if (value == null) return '---';
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value.toFixed(2)}`;
}

function StatusDot({ active }) {
    return React.createElement('span', {
        className: `inline-block w-2 h-2 rounded-full ${active ? 'bg-secondary shadow-[0_0_6px_rgba(76,175,80,0.5)]' : 'bg-gray-600'}`,
    });
}

// ============================================================
// EditableLabel — 点击编辑钱包名称
// ============================================================

function EditableLabel({ walletId, label, baseUrl, onRenamed }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(label);

    const save = async () => {
        const trimmed = value.trim();
        if (!trimmed || trimmed === label) {
            setValue(label);
            setEditing(false);
            return;
        }
        try {
            await polyMultiApi.updateWalletLabel(baseUrl, walletId, trimmed);
            setEditing(false);
            onRenamed();
        } catch (e) {
            setValue(label);
            setEditing(false);
        }
    };

    if (editing) {
        return React.createElement('input', {
            autoFocus: true,
            value: value,
            onChange: (e) => setValue(e.target.value),
            onBlur: save,
            onKeyDown: (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(label); setEditing(false); } },
            className: 'text-xs font-medium text-foreground bg-muted border border-primary/50 rounded px-1 py-0.5 outline-none w-24',
        });
    }

    return React.createElement('span', {
        className: 'text-xs font-medium text-foreground cursor-pointer hover:text-secondary transition-colors',
        title: '点击改名',
        onClick: () => setEditing(true),
    }, label);
}

// ============================================================
// UnlockGate
// ============================================================

function UnlockGate({ baseUrl, onUnlocked }) {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleUnlock = async () => {
        if (!password) return;
        setLoading(true);
        setError('');
        try {
            const result = await polyMultiApi.unlock(baseUrl, password);
            if (result.success) {
                onUnlocked();
            } else {
                setError(result.error || '解锁失败');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return React.createElement('div', { className: 'flex flex-col items-center justify-center py-24' },
        React.createElement('div', { className: 'bg-surface rounded-2xl p-8 border border-border w-full max-w-md' },
            React.createElement('div', { className: 'text-center mb-6' },
                React.createElement(Icon, { name: 'lock', size: 32, className: 'text-primary mx-auto mb-3' }),
                React.createElement('h3', { className: 'text-lg font-bold text-foreground' }, '多账户对冲管理'),
                React.createElement('p', { className: 'text-sm text-gray-400 mt-1' }, '输入主密码解锁钱包凭证'),
            ),
            React.createElement('div', { className: 'space-y-3' },
                React.createElement('input', {
                    type: 'password',
                    value: password,
                    onChange: (e) => setPassword(e.target.value),
                    onKeyDown: (e) => e.key === 'Enter' && handleUnlock(),
                    placeholder: 'Master Password',
                    className: 'w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground text-sm focus:outline-none focus:border-primary',
                }),
                error && React.createElement('p', { className: 'text-red-400 text-xs' }, error),
                React.createElement('button', {
                    onClick: handleUnlock,
                    disabled: loading || !password,
                    className: 'w-full py-3 rounded-xl bg-primary text-white font-medium text-sm hover:bg-green-700 disabled:opacity-50 transition-all',
                }, loading ? '解锁中...' : '解锁'),
            ),
        ),
    );
}

// ============================================================
// WalletDataRow
// ============================================================

function WalletDataRow({ wallet }) {
    return React.createElement('div', { className: 'flex items-center gap-3 text-[10px] text-zinc-400 mt-1' },
        React.createElement('span', null, `Cash: ${formatUsd(wallet.cash)}`),
        React.createElement('span', null, `持仓: ${formatUsd(wallet.positionValue)}`),
        React.createElement('span', null, `Vol: ${formatUsd(wallet.volume)}`),
        React.createElement('span', null, `活跃: ${formatActiveDays(wallet.lastTradeTime)}`),
    );
}

// ============================================================
// BatchImportForm — 批量导入钱包 (一行一个私钥)
// ============================================================

function BatchImportForm({ baseUrl, onImported, existingCount = 0 }) {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [results, setResults] = useState(null);

    const parsed = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    const handleImport = async () => {
        setError('');
        setResults(null);

        if (parsed.length === 0) {
            setError('未检测到有效输入');
            return;
        }

        const wallets = parsed.map((line, i) => ({
            label: `钱包${existingCount + i + 1}`,
            privateKey: line,
        }));

        setLoading(true);
        try {
            const result = await polyMultiApi.batchAddWallets(baseUrl, wallets);
            if (result.error) {
                setError(result.error);
            } else {
                setResults(result);
                if (result.successCount > 0) {
                    setText('');
                    onImported();
                }
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return React.createElement('div', { className: 'bg-surface rounded-2xl p-4 border border-dashed border-primary/30 space-y-3' },
        React.createElement('div', { className: 'text-xs font-medium text-secondary flex items-center gap-1' },
            React.createElement(Icon, { name: 'upload', size: 14 }),
            '批量导入钱包',
        ),

        React.createElement('div', { className: 'text-[10px] text-gray-400 bg-muted rounded-lg p-2 font-mono whitespace-pre-wrap' },
            '一行一个私钥 (自动派生凭证，每个约30s)\n# 以 # 开头的行会被忽略',
        ),

        React.createElement('textarea', {
            value: text,
            onChange: (e) => { setText(e.target.value); setResults(null); },
            placeholder: '0xprivatekey1...\n0xprivatekey2...\n0xprivatekey3...',
            rows: 5,
            className: 'w-full px-3 py-2 rounded-xl bg-muted border border-border text-foreground text-xs font-mono focus:outline-none focus:border-primary resize-y',
        }),

        parsed.length > 0 && React.createElement('div', { className: 'text-[10px] text-gray-400' },
            `已识别 ${parsed.length} 个钱包 (预计 ${parsed.length * 30}s)`,
        ),

        error && React.createElement('p', { className: 'text-red-400 text-xs' }, error),
        loading && React.createElement('p', { className: 'text-secondary text-xs animate-pulse' }, `正在导入 ${parsed.length} 个钱包...`),

        results && React.createElement('div', { className: 'space-y-1' },
            React.createElement('div', { className: 'text-xs text-zinc-400' },
                `完成: ${results.successCount}/${results.total} 成功`,
            ),
            ...(results.results || []).map((r, i) =>
                React.createElement('div', {
                    key: i,
                    className: `text-[10px] px-2 py-1 rounded ${r.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`,
                }, `${r.label}: ${r.success ? '成功' : r.error}`),
            ),
        ),

        React.createElement('button', {
            onClick: handleImport,
            disabled: loading || parsed.length === 0,
            className: 'w-full py-2 rounded-xl bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 disabled:opacity-50 transition-all',
        }, loading ? '导入中...' : `批量导入 (${parsed.length})`),
    );
}

// ============================================================
// MatchedPairingsPanel
// ============================================================

function MatchedPairingsPanel({ pairings, onUnmatch, onActivate, onDeactivate, baseUrl, onRenamed, onDeleteWallet, onRedeemWallet, redeemingWallets }) {
    if (pairings.length === 0) {
        return React.createElement('div', { className: 'text-center py-8 text-gray-400 text-sm' }, '暂无匹配');
    }
    return React.createElement('div', { className: 'space-y-2' },
        ...pairings.map(p => {
            const master = p.masterWallet;
            const hedge = p.hedgeWallet;
            return React.createElement('div', {
                key: p.id,
                className: `rounded-2xl p-4 transition-all duration-200 hover:scale-[1.005] ${p.isActive ? 'bg-surface border border-primary' : 'bg-muted border border-transparent'}`,
            },
                React.createElement('div', { className: 'flex items-center justify-between mb-2' },
                    React.createElement('div', { className: 'flex items-center gap-2' },
                        React.createElement(StatusDot, { active: p.isActive }),
                        React.createElement('span', { className: 'text-sm font-bold text-foreground' }, p.name),
                    ),
                    React.createElement('div', { className: 'flex items-center gap-1' },
                        !p.isActive && React.createElement('button', {
                            onClick: () => onActivate(p.id),
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl bg-primary text-white hover:bg-green-700',
                        }, '激活'),
                        p.isActive && React.createElement('button', {
                            onClick: () => onDeactivate(p.id),
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl bg-muted text-gray-300 hover:bg-surface-hover',
                        }, '停用'),
                        React.createElement('button', {
                            onClick: () => onUnmatch(p.id),
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl border border-red-400 text-red-500 hover:bg-red-500 hover:text-white',
                        }, '解除'),
                    ),
                ),
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement('div', { className: 'rounded-2xl bg-green-500/10 border border-primary p-4' },
                        React.createElement('div', { className: 'flex items-center justify-between mb-1' },
                            React.createElement('div', { className: 'flex items-center gap-1' },
                                React.createElement('span', { className: 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-xl bg-primary text-white' }, 'Master'),
                                master ? React.createElement(EditableLabel, { walletId: master.id, label: master.label, baseUrl, onRenamed }) : React.createElement('span', { className: 'text-[11px] text-white' }, '?'),
                            ),
                            master && React.createElement('div', { className: 'flex items-center gap-1' },
                                React.createElement('button', {
                                    onClick: () => onRedeemWallet(master.id),
                                    disabled: redeemingWallets?.[master.id],
                                    className: 'text-[10px] px-1.5 py-0.5 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50',
                                }, redeemingWallets?.[master.id] ? 'Redeeming...' : 'Redeem'),
                                React.createElement('button', {
                                    onClick: () => onDeleteWallet(master.id),
                                    className: 'text-[10px] px-1.5 py-0.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20',
                                }, '删除'),
                            ),
                        ),
                        React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                            'EOA: ', master?.address || '---',
                        ),
                        master?.proxyAddress && React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                            'Proxy: ', master.proxyAddress,
                        ),
                        master && React.createElement(WalletDataRow, { wallet: master }),
                    ),
                    React.createElement('div', { className: 'rounded-2xl bg-red-500/10 border border-red-500/20 p-4' },
                        React.createElement('div', { className: 'flex items-center justify-between mb-1' },
                            React.createElement('div', { className: 'flex items-center gap-1' },
                                React.createElement('span', { className: 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-xl bg-red-500 text-white' }, 'Hedge'),
                                hedge ? React.createElement(EditableLabel, { walletId: hedge.id, label: hedge.label, baseUrl, onRenamed }) : React.createElement('span', { className: 'text-[11px] text-white' }, '?'),
                            ),
                            hedge && React.createElement('div', { className: 'flex items-center gap-1' },
                                React.createElement('button', {
                                    onClick: () => onRedeemWallet(hedge.id),
                                    disabled: redeemingWallets?.[hedge.id],
                                    className: 'text-[10px] px-1.5 py-0.5 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50',
                                }, redeemingWallets?.[hedge.id] ? 'Redeeming...' : 'Redeem'),
                                React.createElement('button', {
                                    onClick: () => onDeleteWallet(hedge.id),
                                    className: 'text-[10px] px-1.5 py-0.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20',
                                }, '删除'),
                            ),
                        ),
                        React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                            'EOA: ', hedge?.address || '---',
                        ),
                        hedge?.proxyAddress && React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                            'Proxy: ', hedge.proxyAddress,
                        ),
                        hedge && React.createElement(WalletDataRow, { wallet: hedge }),
                    ),
                ),
            );
        }),
    );
}

// ============================================================
// UnmatchedWalletsPanel
// ============================================================

function UnmatchedWalletsPanel({ wallets, onAutoMatch, onDelete, baseUrl, onRenamed, onRedeemWallet, redeemingWallets }) {
    const [selectedHedge, setSelectedHedge] = useState({});

    if (wallets.length === 0) {
        return React.createElement('div', { className: 'text-center py-8 text-gray-400 text-sm' }, '所有钱包已匹配');
    }
    return React.createElement('div', { className: 'space-y-2' },
        ...wallets.map((w, wIdx) => {
            const otherWallets = wallets.filter(ow => ow.id !== w.id);
            const hedgeId = selectedHedge[w.id] || '';
            return React.createElement('div', {
                key: w.id,
                className: 'bg-muted rounded-2xl p-4 transition-colors duration-200 relative',
                style: { zIndex: wallets.length - wIdx },
            },
                React.createElement('div', { className: 'flex items-center justify-between mb-1' },
                    React.createElement(EditableLabel, { walletId: w.id, label: w.label, baseUrl, onRenamed }),
                    React.createElement('div', { className: 'flex items-center gap-1 ml-2 flex-shrink-0' },
                        otherWallets.length > 0 && React.createElement(Preview.CustomDropdown, {
                            options: [
                                { value: '', label: '随机' },
                                ...otherWallets.map(ow => ({ value: String(ow.id), label: ow.label })),
                            ],
                            value: hedgeId,
                            onChange: (v) => setSelectedHedge(prev => ({ ...prev, [w.id]: v })),
                            placeholder: '随机',
                            size: 'sm',
                        }),
                        React.createElement('button', {
                            onClick: () => onAutoMatch(w.id, hedgeId ? Number(hedgeId) : undefined),
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl bg-primary text-white hover:bg-green-700',
                        }, '设为Master'),
                        React.createElement('button', {
                            onClick: () => onRedeemWallet(w.id),
                            disabled: redeemingWallets?.[w.id],
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl border border-yellow-400 text-yellow-400 hover:bg-yellow-500 hover:text-white disabled:opacity-50',
                        }, redeemingWallets?.[w.id] ? 'Redeeming...' : 'Redeem'),
                        React.createElement('button', {
                            onClick: () => onDelete(w.id),
                            className: 'text-xs font-semibold px-3 py-1.5 rounded-xl border border-red-400 text-red-500 hover:bg-red-500 hover:text-white',
                        }, '删除'),
                    ),
                ),
                React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                    'EOA: ', w.address || '---',
                ),
                w.proxyAddress && React.createElement('div', { className: 'text-[11px] font-mono text-gray-400 truncate select-all mb-1' },
                    'Proxy: ', w.proxyAddress,
                ),
                React.createElement(WalletDataRow, { wallet: w }),
            );
        }),
    );
}

// ============================================================
// HedgeHistoryPanel
// ============================================================

function HedgeHistoryPanel({ history }) {
    if (!history || history.length === 0) {
        return React.createElement('div', { className: 'text-center py-8 text-gray-400 text-sm' }, '暂无对冲记录');
    }

    return React.createElement('div', { className: 'space-y-2' },
        ...history.slice(0, 20).map(exec =>
            React.createElement('div', {
                key: exec.id,
                className: 'bg-muted rounded-2xl p-4 transition-all duration-200 hover:scale-[1.003]',
            },
                React.createElement('div', { className: 'flex items-center justify-between mb-2' },
                    React.createElement('div', { className: 'flex items-center gap-2' },
                        React.createElement('span', {
                            className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                exec.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-400' :
                                exec.status === 'PARTIAL' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-red-500/20 text-red-400'
                            }`,
                        }, exec.status),
                        React.createElement('span', { className: 'text-xs font-bold font-mono text-foreground' },
                            `${exec.predictFillQty.toFixed(2)} shares @ ${exec.predictFillPrice.toFixed(3)}`),
                    ),
                    React.createElement('span', { className: 'text-[11px] font-mono text-gray-400' }, exec.createdAt?.slice(0, 19)),
                ),
                React.createElement('div', { className: 'flex flex-wrap gap-1' },
                    ...(exec.distribution || []).map((d, i) =>
                        React.createElement('span', {
                            key: i,
                            className: `text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                d.status === 'FILLED' ? 'bg-emerald-500/10 text-emerald-400' :
                                d.status === 'PARTIAL' ? 'bg-amber-500/10 text-amber-400' :
                                'bg-red-500/10 text-red-400'
                            }`,
                        }, `${d.walletLabel}: ${d.filledQty.toFixed(2)}/${d.quantity.toFixed(2)}`),
                    ),
                ),
            ),
        ),
    );
}

// ============================================================
// PolyMultiTab (主组件)
// ============================================================

function PolyMultiTab({ apiBaseUrl }) {
    const baseUrl = apiBaseUrl;
    const [status, setStatus] = useState(null);
    const [wallets, setWallets] = useState([]);
    const [pairings, setPairings] = useState([]);
    const [history, setHistory] = useState([]);
    const [unmatchedWallets, setUnmatchedWallets] = useState([]);
    const [section, setSection] = useState('wallets'); // wallets | history

    const refreshAll = useCallback(async () => {
        try {
            const [s, w, p, h, u] = await Promise.all([
                polyMultiApi.getStatus(baseUrl),
                polyMultiApi.getWallets(baseUrl),
                polyMultiApi.getPairings(baseUrl),
                polyMultiApi.getHedgeHistory(baseUrl),
                polyMultiApi.getUnmatchedWallets(baseUrl),
            ]);
            setStatus(s);
            setWallets(Array.isArray(w) ? w : []);
            setPairings(Array.isArray(p) ? p : []);
            setHistory(Array.isArray(h) ? h : []);
            setUnmatchedWallets(Array.isArray(u) ? u : []);
        } catch (e) {
            console.warn('[PolyMulti] refresh failed:', e);
        }
    }, [baseUrl]);

    useEffect(() => {
        refreshAll();
        const interval = setInterval(refreshAll, 5000);
        return () => clearInterval(interval);
    }, [refreshAll]);

    const handleDeleteWallet = async (id) => {
        if (!confirm('确认删除此钱包？相关配对和对冲记录将一并删除。')) return;
        await polyMultiApi.deleteWallet(baseUrl, id);
        refreshAll();
    };

    const handleActivate = async (id) => {
        await polyMultiApi.activatePairing(baseUrl, id);
        refreshAll();
    };

    const handleDeactivate = async (id) => {
        await polyMultiApi.deactivatePairing(baseUrl, id);
        refreshAll();
    };

    const handleAutoMatch = async (masterWalletId, hedgeWalletId) => {
        try {
            const result = await polyMultiApi.autoMatch(baseUrl, masterWalletId, hedgeWalletId);
            if (result.error) alert(result.error);
            refreshAll();
        } catch (e) {
            alert(e.message);
        }
    };

    const handleUnmatch = async (pairingId) => {
        if (!confirm('确认解除此匹配?')) return;
        await polyMultiApi.deletePairing(baseUrl, pairingId);
        refreshAll();
    };

    const handleRefreshQuery = async () => {
        try {
            await polyMultiApi.refreshWalletQuery(baseUrl);
            refreshAll();
        } catch (e) {
            console.warn('Refresh failed:', e);
        }
    };

    const [redeemingWallets, setRedeemingWallets] = useState({});

    const handleRedeemWallet = async (walletId) => {
        const wallet = wallets.find(w => w.id === walletId);
        const label = wallet ? wallet.label : `钱包${walletId}`;
        if (!confirm(`确认对 ${label} 执行一键 Redeem？将赎回所有已结算仓位。`)) return;
        setRedeemingWallets(prev => ({ ...prev, [walletId]: true }));
        try {
            const result = await polyMultiApi.redeemWallet(baseUrl, walletId);
            if (result.success) {
                const msg = result.total === 0
                    ? `${label}: 没有可赎回的仓位`
                    : `${label}: ${result.succeeded}/${result.total} 赎回成功` + (result.failed > 0 ? ` (${result.failed} 失败)` : '');
                alert(msg);
                refreshAll();
            } else {
                alert(`Redeem 失败: ${result.error}`);
            }
        } catch (e) {
            alert(`Redeem 异常: ${e.message}`);
        } finally {
            setRedeemingWallets(prev => ({ ...prev, [walletId]: false }));
        }
    };

    const sections = ['wallets', 'history'];
    const sectionLabels = { wallets: '钱包管理', history: '对冲记录' };

    return React.createElement('div', { className: 'space-y-4' },
        // Header
        React.createElement('div', { className: 'flex items-center gap-3' },
            React.createElement(Icon, { name: 'layers', size: 18, className: 'text-primary' }),
            React.createElement('h3', { className: 'text-sm font-bold text-foreground' }, '多账户对冲'),
            status && React.createElement('span', { className: 'text-[10px] text-gray-400 font-mono' },
                `${wallets.length} 钱包 | ${pairings.length} 匹配 | ${unmatchedWallets.length} 未匹配`,
            ),
        ),

        // Sub-tabs
        React.createElement('div', { className: 'flex gap-1 bg-muted rounded-2xl p-1 w-fit' },
            ...sections.map(s =>
                React.createElement('button', {
                    key: s,
                    onClick: () => setSection(s),
                    className: `flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 ${section === s ? 'bg-surface text-foreground' : 'text-gray-400 hover:text-foreground'}`,
                },
                    sectionLabels[s],
                ),
            ),
        ),

        // Content
        section === 'wallets' && React.createElement('div', { className: 'space-y-4' },
            // 刷新按钮
            React.createElement('div', { className: 'flex items-center justify-end' },
                React.createElement('button', {
                    onClick: handleRefreshQuery,
                    className: 'text-[10px] px-2 py-1 rounded-xl bg-muted text-gray-400 hover:text-foreground hover:bg-surface-hover flex items-center gap-1',
                },
                    React.createElement(Icon, { name: 'refresh-cw', size: 10 }),
                    '刷新数据',
                ),
            ),

            // 已匹配
            React.createElement('div', null,
                React.createElement('div', { className: 'text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3' },
                    `已匹配 (${pairings.length})`,
                ),
                React.createElement(MatchedPairingsPanel, {
                    pairings,
                    onUnmatch: handleUnmatch,
                    onActivate: handleActivate,
                    onDeactivate: handleDeactivate,
                    baseUrl,
                    onRenamed: refreshAll,
                    onDeleteWallet: handleDeleteWallet,
                    onRedeemWallet: handleRedeemWallet,
                    redeemingWallets,
                }),
            ),

            // 未匹配
            React.createElement('div', null,
                React.createElement('div', { className: 'text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3' },
                    `未匹配 (${unmatchedWallets.length})`,
                ),
                React.createElement(UnmatchedWalletsPanel, {
                    wallets: unmatchedWallets,
                    onAutoMatch: handleAutoMatch,
                    onDelete: handleDeleteWallet,
                    baseUrl,
                    onRenamed: refreshAll,
                    onRedeemWallet: handleRedeemWallet,
                    redeemingWallets,
                }),
            ),

            // 批量导入
            React.createElement(BatchImportForm, { baseUrl, onImported: refreshAll, existingCount: wallets.length }),
        ),

        section === 'history' && React.createElement(HedgeHistoryPanel, { history }),
    );
}

window.PolyMultiTab = PolyMultiTab;
Preview.PolyMultiTab = PolyMultiTab;
