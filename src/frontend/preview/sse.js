var Preview = window.Preview || (window.Preview = {});
var { useState, useEffect, useRef, useCallback } = Preview.ReactHooks;

// --- SSE Configuration ---
const appConfig = window.PolySportsAppConfig || {};
const isFileOrigin = window.location.protocol === 'file:' || !window.location.hostname;
const API_BASE_URL = typeof appConfig.apiBaseUrl === 'string'
    ? appConfig.apiBaseUrl
    : (isFileOrigin ? (appConfig.fileApiBaseUrl || 'http://localhost:4020') : '');

// --- Sports Data Hook ---
const useSportsStream = (addToast) => {
    const [markets, setMarkets] = useState([]);
    const [stats, setStats] = useState({ total: 0, bySport: {} });
    const [taskStats, setTaskStats] = useState({ total: 0, active: 0, live: 0, completed: 0, cancelled: 0, failed: 0, partial: 0 });
    const [tasks, setTasks] = useState([]);
    const [balance, setBalance] = useState(0);
    const [isConnected, setIsConnected] = useState(false);
    const [tradeEnabled, setTradeEnabled] = useState(false);
    const [polyMultiReady, setPolyMultiReady] = useState(false);
    const [pairings, setPairings] = useState([]);
    const eventSourceRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const marketsRef = useRef(new Map()); // conditionId -> market

    const connectSSE = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }
        marketsRef.current.clear();

        const es = new EventSource(`${API_BASE_URL}/api/stream`);
        eventSourceRef.current = es;

        es.onopen = () => {
            setIsConnected(true);
        };

        es.onerror = () => {
            setIsConnected(false);
            es.close();
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connectSSE, 3000);
        };

        es.addEventListener('sports', (e) => {
            try {
                const data = JSON.parse(e.data);
                const cache = marketsRef.current;

                if (data.snapshot) {
                    cache.clear();
                    for (const m of data.updated) {
                        cache.set(m.conditionId, m);
                    }
                } else {
                    for (const m of (data.updated || [])) {
                        cache.set(m.conditionId, m);
                    }
                    for (const id of (data.removed || [])) {
                        cache.delete(id);
                    }
                }

                setMarkets(Array.from(cache.values()));
                if (data.stats) setStats(data.stats);
                if (data.balance !== undefined) setBalance(data.balance);
            } catch (err) {
                console.error('SSE sports parse error:', err);
            }
        });

        es.addEventListener('balance', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.balance !== undefined) setBalance(data.balance);
            } catch {}
        });

        es.addEventListener('tasks', (e) => {
            try {
                const data = JSON.parse(e.data);
                setTasks(Array.isArray(data.tasks) ? data.tasks : []);
                if (data.stats) setTaskStats(data.stats);
            } catch (err) {
                console.error('SSE tasks parse error:', err);
            }
        });
    }, []);

    // 鑾峰彇璐︽埛淇℃伅
    useEffect(() => {
        fetch(`${API_BASE_URL}/api/account`)
            .then(r => r.json())
            .then(d => {
                setBalance(d.balance || 0);
                setTradeEnabled(Boolean(d.tradeEnabled || d.polyMultiReady));
                setPolyMultiReady(Boolean(d.polyMultiReady));
                if (d.taskStats) setTaskStats(d.taskStats);
            })
            .catch(() => {});

        fetch(`${API_BASE_URL}/api/poly-multi/pairings`)
            .then(r => r.json())
            .then(d => {
                if (Array.isArray(d)) setPairings(d);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        connectSSE();
        return () => {
            if (eventSourceRef.current) eventSourceRef.current.close();
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        };
    }, [connectSSE]);

    const placeOrder = useCallback(async (orderParams) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderParams),
            });
            const data = await res.json();
            if (data.success) {
                addToast('success', `涓嬪崟鎴愬姛: ${data.orderId?.slice(0, 8)}...`);
            } else {
                addToast('error', `涓嬪崟澶辫触: ${data.error}`);
            }
            return data;
        } catch (err) {
            addToast('error', `涓嬪崟寮傚父: ${err.message}`);
            return { success: false, error: err.message };
        }
    }, [addToast]);

    const cancelOrder = useCallback(async (orderId, options) => {
        try {
            const query = new URLSearchParams();
            if (options?.walletId) query.set('walletId', String(options.walletId));
            if (options?.pairingId) query.set('pairingId', String(options.pairingId));
            if (options?.masterWalletId) query.set('masterWalletId', String(options.masterWalletId));
            const suffix = query.toString() ? `?${query.toString()}` : '';

            const res = await fetch(`${API_BASE_URL}/api/order/${orderId}${suffix}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                addToast('success', '鎾ゅ崟鎴愬姛');
            } else {
                addToast('error', '鎾ゅ崟澶辫触');
            }
            return data.success;
        } catch {
            addToast('error', '鎾ゅ崟寮傚父');
            return false;
        }
    }, [addToast]);

    const createTask = useCallback(async (taskParams) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...taskParams, autoStart: true }),
            });
            const data = await res.json();
            if (data.success) {
                addToast('success', `任务已创建: ${data.data?.id?.slice(0, 8) || 'task'}...`);
            } else {
                addToast('error', `任务创建失败: ${data.error}`);
            }
            return data;
        } catch (err) {
            addToast('error', `任务创建异常: ${err.message}`);
            return { success: false, error: err.message };
        }
    }, [addToast]);

    const cancelTask = useCallback(async (taskId) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                addToast('success', '任务已取消');
            } else {
                addToast('error', `任务取消失败: ${data.error || 'unknown error'}`);
            }
            return data;
        } catch (err) {
            addToast('error', `任务取消异常: ${err.message}`);
            return { success: false, error: err.message };
        }
    }, [addToast]);

    const cancelAllTasks = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/tasks/all`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                addToast('success', `已取消 ${data.cancelledTasks} 个任务，清除 ${data.cancelledWallets?.length || 0} 个钱包挂单`);
            } else {
                addToast('error', `全部取消失败: ${data.error || 'unknown error'}`);
            }
            return data;
        } catch (err) {
            addToast('error', `全部取消异常: ${err.message}`);
            return { success: false, error: err.message };
        }
    }, [addToast]);

    const fetchTimeline = useCallback(async (taskId) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/logs/tasks/${encodeURIComponent(taskId)}/timeline`);
            const data = await res.json();
            if (data.success) {
                return data.data;
            }
            return null;
        } catch {
            return null;
        }
    }, []);

    return {
        markets,
        stats,
        taskStats,
        tasks,
        balance,
        isConnected,
        tradeEnabled,
        polyMultiReady,
        pairings,
        placeOrder,
        cancelOrder,
        createTask,
        cancelTask,
        cancelAllTasks,
        fetchTimeline,
    };
};

Preview.useSportsStream = useSportsStream;
Preview.API_BASE_URL = API_BASE_URL;
