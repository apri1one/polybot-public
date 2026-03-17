var Preview = window.Preview || (window.Preview = {});
var { useState, useMemo, useCallback, useEffect, useRef } = Preview.ReactHooks;
var { SportsCard } = Preview;
var { useSportsStream } = Preview;
var { useToasts, ToastContainer } = Preview;
var APP_CONFIG = window.PolySportsAppConfig || {};
var APP_TITLE = APP_CONFIG.title || 'Polymarket Sports';
var ACTIVE_TASK_STATUSES = ['PENDING', 'LIVE', 'HEDGE_PENDING'];
var TERMINAL_TASK_STATUSES = ['PARTIAL', 'COMPLETED', 'CANCELLED', 'FAILED'];
var DEFAULT_TASK_SHARES = 100;

// ============================================================
// Lucide Icon helper (CDN)
// ============================================================
function Icon({ name, size = 16, className = '', strokeWidth = 2 }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const pk = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        const iconChildren = lucide.icons[pk] || lucide.icons[name];
        if (!iconChildren) { ref.current.innerHTML = ''; return; }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const svgAttrs = { xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        Object.entries(svgAttrs).forEach(([k, v]) => svg.setAttribute(k, String(v)));
        className.split(' ').filter(Boolean).forEach(c => svg.classList.add(c));
        iconChildren.forEach(([tag, childAttrs]) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(childAttrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
            svg.appendChild(el);
        });
        ref.current.innerHTML = '';
        ref.current.appendChild(svg);
    }, [name, size, className, strokeWidth]);
    return <span ref={ref} className="inline-flex items-center justify-center" />;
}
Preview.Icon = Icon;

// ============================================================
// Custom Dropdown (replaces native <select>)
// ============================================================
function CustomDropdown({ options, value, onChange, placeholder = '请选择', className = '', size = 'md' }) {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const containerRef = useRef(null);

    const selected = options.find(o => o.value === value);

    useEffect(() => {
        if (!open) return;
        function handleClick(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setClosing(true);
                setTimeout(() => { setOpen(false); setClosing(false); }, 150);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    function toggle() {
        if (open) {
            setClosing(true);
            setTimeout(() => { setOpen(false); setClosing(false); }, 150);
        } else {
            setOpen(true);
        }
    }

    function select(opt) {
        onChange(opt.value);
        setClosing(true);
        setTimeout(() => { setOpen(false); setClosing(false); }, 150);
    }

    const sizeClasses = size === 'sm'
        ? 'text-xs px-2 py-1.5'
        : 'text-sm px-3 py-2.5';

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={toggle}
                className={`w-full ${sizeClasses} rounded-xl bg-muted border border-transparent text-left font-medium text-foreground outline-none transition-colors flex items-center justify-between gap-2 hover:border-primary/40 ${open ? 'border-primary bg-surface' : ''}`}
            >
                <span className={selected ? 'text-foreground' : 'text-gray-400'}>{selected ? selected.label : placeholder}</span>
                <span className={`dropdown-chevron ${open ? 'dropdown-chevron-open' : ''}`}>
                    <Icon name="chevron-down" size={size === 'sm' ? 14 : 16} />
                </span>
            </button>
            {open && (
                <div className={`absolute z-50 mt-1 w-full min-w-[180px] rounded-xl bg-surface border border-border shadow-xl shadow-black/40 overflow-hidden ${closing ? 'dropdown-menu-close' : 'dropdown-menu-open'}`}>
                    <div className="py-1 max-h-48 overflow-y-auto">
                        {options.map((opt, i) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => select(opt)}
                                className="dropdown-item-stagger w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors hover:bg-surface-hover"
                                style={{ animationDelay: (i * 30) + 'ms' }}
                            >
                                <span className={`${size === 'sm' ? 'text-xs' : 'text-sm'} font-medium ${opt.value === value ? 'text-secondary' : 'text-foreground'}`}>{opt.label}</span>
                                {opt.value === value && <Icon name="check" size={14} className="text-secondary" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
Preview.CustomDropdown = CustomDropdown;

// ============================================================
// Side Dock Navigation
// ============================================================
const DOCK_ITEMS = [
    { key: 'markets', icon: 'trophy', label: 'Markets', color: '#4CAF50', bg: 'rgba(76,175,80,0.15)' },
    { key: 'tasks', icon: 'list-checks', label: 'Tasks', color: '#FFB300', bg: 'rgba(255,179,0,0.15)' },
    { key: 'accounts', icon: 'wallet', label: 'Accounts', color: '#87CEEB', bg: 'rgba(135,206,235,0.15)' },
];

function DockNav({ activeView, setActiveView, taskCount }) {
    const sidebarRef = useRef(null);
    const itemRefs = useRef([]);
    const rafRef = useRef(null);

    const handleMouseMove = useCallback((e) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            const mouseY = e.clientY;
            itemRefs.current.forEach((el) => {
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const centerY = rect.top + rect.height / 2;
                const dist = Math.abs(mouseY - centerY);
                const maxDist = 120;
                const scale = dist > maxDist ? 1 : 1 + 0.35 * (1 - dist / maxDist);
                el.style.transform = `scale(${scale})`;
            });
        });
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        itemRefs.current.forEach((el) => {
            if (!el) return;
            el.style.transform = 'scale(1)';
        });
    }, []);

    useEffect(() => {
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, []);

    return (
        <nav
            ref={sidebarRef}
            className="dock-sidebar"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {DOCK_ITEMS.map((item, i) => {
                const isActive = activeView === item.key;
                const displayLabel = item.key === 'tasks' && taskCount > 0
                    ? `${taskCount}`
                    : '';
                return (
                    <div
                        key={item.key}
                        ref={el => itemRefs.current[i] = el}
                        className={`dock-item ${isActive ? 'active' : ''}`}
                        onClick={() => setActiveView(item.key)}
                    >
                        <div
                            className="dock-icon-wrapper"
                            style={{
                                backgroundColor: isActive ? item.bg : 'transparent',
                                color: isActive ? item.color : '#9CA3AF',
                            }}
                        >
                            <Icon name={item.icon} size={22} strokeWidth={isActive ? 2.5 : 2} />
                            {displayLabel && (
                                <span style={{
                                    position: 'absolute', top: 0, right: 2,
                                    fontSize: '9px', fontWeight: 800, color: 'white',
                                    backgroundColor: '#FFB300', borderRadius: '6px',
                                    padding: '0 4px', lineHeight: '14px',
                                    minWidth: '14px', textAlign: 'center',
                                }}>{displayLabel}</span>
                            )}
                        </div>
                        <span className="dock-label" style={{ color: isActive ? item.color : '#9CA3AF' }}>
                            {item.label}
                        </span>
                        <div className="dock-dot" style={{ backgroundColor: item.color }} />
                    </div>
                );
            })}
        </nav>
    );
}

// ============================================================
// Animated View wrapper — staggered slide-in from top
// ============================================================
function AnimatedView({ viewKey, children }) {
    const containerRef = useRef(null);

    useEffect(() => {
        var node = containerRef.current;
        if (!node) return;
        var els = node.children;
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            el.style.opacity = '0';
            el.style.transform = 'translateY(-24px)';
            el.style.transition = 'none';
        }
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                for (var j = 0; j < els.length; j++) {
                    var el2 = els[j];
                    el2.style.transition = 'opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1)';
                    el2.style.transitionDelay = (j * 60) + 'ms';
                    el2.style.opacity = '1';
                    el2.style.transform = 'translateY(0)';
                }
            });
        });
    }, [viewKey]);

    return (
        <div ref={containerRef} key={viewKey}>
            {children}
        </div>
    );
}

const SPORT_TABS = [
    { key: 'all', label: 'All', emoji: '\u{1F3C6}' },
    { key: 'nba', label: 'NBA', emoji: '\u{1F3C0}' },
    { key: 'nhl', label: 'NHL', emoji: '\u{1F3D2}' },
    { key: 'football', label: 'Football', emoji: '\u26BD' },
    { key: 'lol', label: 'LoL', emoji: '\u{1F3AE}' },
    { key: 'cs2', label: 'CS2', emoji: '\u{1F52B}' },
    { key: 'dota2', label: 'Dota2', emoji: '\u{1F5E1}\uFE0F' },
];

const SORT_OPTIONS = [
    { key: 'time', label: 'Start Time' },
    { key: 'volume', label: 'Volume' },
    { key: 'liquidity', label: 'Liquidity' },
];

const TASK_STATUS_STYLES = {
    PENDING: { bg: 'bg-muted', text: 'text-gray-300', label: 'PENDING' },
    LIVE: { bg: 'bg-primary', text: 'text-white', label: 'LIVE' },
    HEDGE_PENDING: { bg: 'bg-accent', text: 'text-white', label: 'HEDGE' },
    PARTIAL: { bg: 'bg-accent', text: 'text-white', label: 'PARTIAL' },
    COMPLETED: { bg: 'bg-secondary', text: 'text-white', label: 'DONE' },
    CANCELLED: { bg: 'bg-muted', text: 'text-gray-400', label: 'CANCEL' },
    FAILED: { bg: 'bg-red-500', text: 'text-white', label: 'FAIL' },
};

function pad(value) {
    return String(value).padStart(2, '0');
}

function formatPriceCents(price) {
    if (!Number.isFinite(price) || price <= 0 || price >= 1) return '--';
    return `${(price * 100).toFixed(1)}c`;
}

function formatDateTime(value) {
    const timestamp = typeof value === 'number' ? value : new Date(value || '').getTime();
    if (!Number.isFinite(timestamp)) return '--';
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function toDateTimeLocalValue(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveDefaultQuantity(maxQuantity) {
    if (Number.isFinite(maxQuantity) && maxQuantity > 0) {
        return Math.max(1, Math.min(DEFAULT_TASK_SHARES, Math.floor(maxQuantity)));
    }
    return DEFAULT_TASK_SHARES;
}

function computeDefaultExpiryAt(gameStartTime) {
    const gameStartTs = new Date(gameStartTime || '').getTime();
    if (!Number.isFinite(gameStartTs)) return null;
    const expiresAt = gameStartTs - (3 * 60 * 1000);
    return expiresAt > Date.now() ? expiresAt : null;
}

const ExpiryCountdown = ({ expiresAt, compact = false }) => {
    const [remaining, setRemaining] = useState('');

    useEffect(() => {
        if (!expiresAt) {
            setRemaining('');
            return;
        }

        const update = () => {
            const diff = expiresAt - Date.now();
            if (diff <= 0) {
                setRemaining('00:00:00');
                return;
            }

            const hours = Math.floor(diff / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            setRemaining(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
        };

        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [expiresAt]);

    if (!expiresAt) return null;

    const isExpiring = expiresAt - Date.now() < (10 * 60 * 1000);
    return (
        <span className={`font-mono ${compact ? 'text-[10px]' : 'text-xs'} ${isExpiring ? 'text-rose-400' : 'text-amber-300'}`}>
            {remaining}
        </span>
    );
};

var TIMELINE_EVENT_STYLES = {
    TASK_CREATED: 'text-gray-400',
    TASK_STARTED: 'text-primary',
    ORDER_SUBMITTED: 'text-primary',
    ORDER_PARTIAL_FILL: 'text-accent',
    ORDER_FILLED: 'text-secondary',
    ORDER_CANCELLED: 'text-gray-400',
    ORDER_FAILED: 'text-red-400',
    HEDGE_STARTED: 'text-sky',
    MULTI_HEDGE: 'text-sky',
    HEDGE_PARTIAL: 'text-accent',
    HEDGE_COMPLETED: 'text-secondary',
    HEDGE_FAILED: 'text-red-400',
    TASK_COMPLETED: 'text-secondary',
    TASK_FAILED: 'text-red-400',
    TASK_CANCELLED: 'text-gray-400',
};

var TIMELINE_DOT_STYLES = {
    TASK_CREATED: 'bg-gray-500',
    TASK_STARTED: 'bg-primary',
    ORDER_SUBMITTED: 'bg-primary',
    ORDER_PARTIAL_FILL: 'bg-accent',
    ORDER_FILLED: 'bg-secondary',
    ORDER_CANCELLED: 'bg-gray-500',
    ORDER_FAILED: 'bg-red-500',
    HEDGE_STARTED: 'bg-accent',
    MULTI_HEDGE: 'bg-accent',
    HEDGE_PARTIAL: 'bg-accent',
    HEDGE_COMPLETED: 'bg-secondary',
    HEDGE_FAILED: 'bg-red-500',
    TASK_COMPLETED: 'bg-secondary',
    TASK_FAILED: 'bg-red-500',
    TASK_CANCELLED: 'bg-gray-500',
};

function formatTimelineTime(timestamp) {
    if (!timestamp) return '--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const TaskTimeline = ({ taskId, fetchTimeline }) => {
    const [timeline, setTimeline] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!taskId || !fetchTimeline) return;
        setLoading(true);
        fetchTimeline(taskId).then(data => {
            setTimeline(data);
            setLoading(false);
        });
    }, [taskId, fetchTimeline]);

    if (loading) {
        return (
            <div className="mt-3 rounded-xl border border-border bg-background/30 px-3 py-3 text-[11px] text-muted text-center">
                Loading timeline...
            </div>
        );
    }

    if (!timeline || !timeline.events || timeline.events.length === 0) {
        return (
            <div className="mt-3 rounded-xl border border-border bg-background/30 px-3 py-2 text-[11px] text-muted text-center">
                No timeline data
            </div>
        );
    }

    return (
        <div className="mt-3 border-l-2 border-border pl-4 space-y-2">
            {timeline.events.map((evt, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TIMELINE_DOT_STYLES[evt.type] || 'bg-gray-500'}`} />
                    <span className="font-mono text-gray-400 shrink-0">{formatTimelineTime(evt.timestamp)}</span>
                    <span className={`font-semibold ${TIMELINE_EVENT_STYLES[evt.type] || 'text-gray-400'}`}>{evt.type}</span>
                    {evt.detail && <span className="text-gray-400 truncate" title={evt.detail}>{evt.detail}</span>}
                </div>
            ))}
        </div>
    );
};

const TasksTab = ({ tasks, onCancelTask, onCancelAll, cancellingTaskId, fetchTimeline, pairings = [], onDeleteTask }) => {
    const [expandedTaskId, setExpandedTaskId] = useState(null);

    const activeTasks = tasks.filter(task => !TERMINAL_TASK_STATUSES.includes(task.status));
    const historicalTasks = tasks.filter(task => TERMINAL_TASK_STATUSES.includes(task.status)).slice(0, 30);

    const toggleTimeline = (taskId) => {
        setExpandedTaskId(prev => prev === taskId ? null : taskId);
    };

    const renderPairingTag = (task) => {
        const pid = task.resolvedPairingId || task.polyMultiPairingId;
        const p = pid && pairings.find(x => x.id === pid);
        if (p) {
            return (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-xl bg-green-500/10 text-primary font-mono">
                    {p.masterWallet?.label || `M#${p.masterWalletId}`} ↔ {p.hedgeWallet?.label || `H#${p.hedgeWalletId}`}
                </span>
            );
        }
        if (task.resolvedMasterWalletId) {
            return (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-xl bg-muted text-gray-400 font-mono">
                    钱包 #{task.resolvedMasterWalletId}
                </span>
            );
        }
        return null;
    };

    const renderTaskCard = (task, historical = false) => {
        const eventTitle = task.eventTitle || task.marketQuestion || 'Untitled event';
        const isExpanded = expandedTaskId === task.id;
        const style = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.PENDING;
        const progress = Number(task.quantity || 0) > 0
            ? (Number(task.filledQty || 0) / Number(task.quantity || 0)) * 100
            : 0;

        return (
            <div
                key={task.id}
                className={`rounded-2xl p-4 transition-all duration-200 hover:scale-[1.003] ${
                    historical
                        ? 'bg-muted'
                        : 'bg-surface border border-border'
                }`}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-xl ${style.bg} ${style.text}`}>
                                {style.label}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">#{String(task.id).slice(0, 8)}</span>
                            {renderPairingTag(task)}
                        </div>
                        <h3 className="text-sm font-bold text-foreground truncate" title={eventTitle}>{eventTitle}</h3>
                        <div className="grid grid-cols-4 gap-4 mt-3">
                            <div>
                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Outcome</div>
                                <div className="text-xs font-semibold text-foreground mt-1">{task.selectionLabel || '--'}</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Entry</div>
                                <div className="text-xs font-bold font-mono text-foreground mt-1">
                                    {task.side} {(Number(task.price || 0) * 100).toFixed(1)}c × {Number(task.quantity || 0).toFixed(0)}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Progress</div>
                                <div className="mt-1">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${Math.min(progress, 100)}%` }} />
                                        </div>
                                        <span className="text-[10px] font-bold font-mono text-foreground">{Number(task.filledQty || 0).toFixed(0)}/{Number(task.quantity || 0).toFixed(0)}</span>
                                    </div>
                                    <div className="text-[10px] font-mono text-gray-400 mt-0.5">H {Number(task.hedgedQty || 0).toFixed(0)}</div>
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Expiry</div>
                                {task.expiresAt ? (
                                    <div className="mt-1">
                                        <ExpiryCountdown expiresAt={task.expiresAt} />
                                    </div>
                                ) : (
                                    <div className="text-xs font-mono text-foreground mt-1">--</div>
                                )}
                            </div>
                        </div>
                        {task.error && (
                            <div className="mt-3 bg-red-500/10 rounded-xl px-3 py-2 text-xs font-medium text-red-400">
                                {task.error}
                            </div>
                        )}
                        <div className={`log-panel-wrapper ${isExpanded ? 'open' : ''}`}>
                            <div className="log-panel-inner">
                                {isExpanded && (
                                    <TaskTimeline taskId={task.id} fetchTimeline={fetchTimeline} />
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col gap-1.5">
                        <button
                            onClick={() => toggleTimeline(task.id)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-muted text-gray-300 transition-all duration-200 hover:bg-surface-hover hover:scale-105 whitespace-nowrap"
                        >
                            {isExpanded ? '收起日志' : '查看日志'}
                        </button>
                        {!historical && (
                            <button
                                onClick={() => onCancelTask(task.id)}
                                disabled={cancellingTaskId === task.id}
                                className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-red-400 text-red-500 transition-all duration-200 hover:bg-red-500 hover:text-white hover:scale-105 whitespace-nowrap disabled:opacity-50"
                            >
                                {cancellingTaskId === task.id ? '取消中...' : '取消任务'}
                            </button>
                        )}
                        {historical && onDeleteTask && (
                            <button
                                onClick={() => onDeleteTask(task.id)}
                                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-muted text-gray-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-500 hover:scale-105 whitespace-nowrap"
                            >
                                删除
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div>
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">活跃任务</span>
                    <span className="text-[11px] font-bold text-primary bg-green-500/10 px-2 py-0.5 rounded-xl">{activeTasks.length}</span>
                    {activeTasks.length > 0 && onCancelAll && (
                        <button
                            onClick={onCancelAll}
                            className="ml-auto text-[11px] font-bold px-3 py-1 rounded-xl border border-red-400/50 text-red-400 transition-all duration-200 hover:bg-red-500 hover:text-white hover:scale-105"
                        >
                            全部取消
                        </button>
                    )}
                </div>
                {activeTasks.length === 0 ? (
                    <div className="bg-muted rounded-2xl px-4 py-10 text-center">
                        <div className="text-sm font-medium text-gray-400">暂无活跃任务</div>
                        <div className="text-xs text-gray-300 mt-1">从赛事卡片创建任务后显示在此处</div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {activeTasks.map(task => renderTaskCard(task))}
                    </div>
                )}
            </div>

            {historicalTasks.length > 0 && (
                <div className="mt-8">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">历史任务</span>
                        <span className="text-[11px] font-bold text-gray-400 bg-muted px-2 py-0.5 rounded-xl">{historicalTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                        {historicalTasks.map(task => renderTaskCard(task, true))}
                    </div>
                </div>
            )}
        </div>
    );
};

const PAIRING_STORAGE_KEY = 'poly-multi-selected-pairing';

const TaskCreateModal = ({ draft, submitting, onClose, onSubmit, pairings = [] }) => {
    const [quantity, setQuantity] = useState(String(DEFAULT_TASK_SHARES));
    const [priceCents, setPriceCents] = useState('');
    const [expiryInput, setExpiryInput] = useState('');
    const [confirmStep, setConfirmStep] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [selectedPairingId, setSelectedPairingId] = useState(() => {
        const saved = localStorage.getItem(PAIRING_STORAGE_KEY);
        return saved ? Number(saved) : 0;
    });

    useEffect(() => {
        if (!draft) return;
        setQuantity(String(resolveDefaultQuantity(draft.maxQuantity)));
        setPriceCents((Math.round(Number(draft.price || 0) * 1000) / 10).toFixed(1));
        setExpiryInput(toDateTimeLocalValue(computeDefaultExpiryAt(draft.gameStartTime)));
        setConfirmStep(false);
        setSubmitError('');
    }, [draft]);

    // 自动修正: 如果记忆的配对不在活跃列表中，清除选择
    useEffect(() => {
        const activePairings = pairings.filter(p => p.isActive);
        if (activePairings.length > 0 && selectedPairingId && !activePairings.find(p => p.id === selectedPairingId)) {
            setSelectedPairingId(0);
            localStorage.removeItem(PAIRING_STORAGE_KEY);
        }
    }, [pairings, selectedPairingId]);

    useEffect(() => {
        if (!confirmStep) return undefined;
        const timer = setTimeout(() => setConfirmStep(false), 3000);
        return () => clearTimeout(timer);
    }, [confirmStep]);

    if (!draft) return null;

    const modalEventTitle = draft.eventTitle || draft.marketQuestion || 'Untitled event';
    const parsedQuantity = Number.parseFloat(quantity || '0');
    const parsedPrice = Number.parseFloat(priceCents || '0') / 100;
    const parsedExpiry = parseDateTimeLocalValue(expiryInput);
    const gameStartTs = new Date(draft.gameStartTime || '').getTime();
    const cost = Number.isFinite(parsedQuantity) && Number.isFinite(parsedPrice)
        ? parsedQuantity * parsedPrice
        : 0;
    const hedgeEnabled = Boolean(draft.hedgeTokenId && draft.hedgeSelectionLabel);
    const minOrderValid = cost >= 1;
    const expiryPast = parsedExpiry !== null && parsedExpiry <= Date.now();
    const expiryAfterGameStart = Number.isFinite(gameStartTs) && parsedExpiry !== null && parsedExpiry >= gameStartTs;
    const canSubmit = Number.isFinite(parsedQuantity)
        && parsedQuantity > 0
        && Number.isFinite(parsedPrice)
        && parsedPrice > 0
        && parsedPrice < 1
        && minOrderValid
        && !expiryPast
        && !expiryAfterGameStart;

    const handleConfirm = async () => {
        if (submitting) return;

        if (!canSubmit) {
            if (!minOrderValid) {
                setSubmitError('Polymarket minimum order notional is $1. Increase price or quantity.');
            } else if (expiryPast) {
                setSubmitError('Task expiry must be later than the current time.');
            } else if (expiryAfterGameStart) {
                setSubmitError('Task expiry must be earlier than the game start time.');
            } else {
                setSubmitError('Check the task price and quantity.');
            }
            setConfirmStep(false);
            return;
        }

        if (!confirmStep) {
            setSubmitError('');
            setConfirmStep(true);
            return;
        }

        const {
            maxQuantity,
            gameStartTime,
            ...taskPayload
        } = draft;

        const result = await onSubmit({
            ...taskPayload,
            quantity: parsedQuantity,
            price: parsedPrice,
            expiresAt: parsedExpiry ?? undefined,
            ...(selectedPairingId ? { polyMultiPairingId: selectedPairingId } : {}),
        });

        if (!result?.success) {
            setSubmitError(result?.error || 'Task creation failed');
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-modal-backdrop"
            role="dialog"
            aria-modal="true"
        >
            <div className="w-full max-w-md bg-surface rounded-2xl border border-border overflow-hidden animate-modal-content">
                <div className="bg-primary px-5 py-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">Create Task</div>
                    <h2 className="text-lg font-bold text-white mt-1">{modalEventTitle}</h2>
                    <div className="text-xs font-medium text-white/80 mt-0.5">{draft.selectionLabel || 'Selection'}</div>
                </div>

                <div className="px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted rounded-xl p-3">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Game Start</div>
                            <div className="text-sm font-bold font-mono text-foreground mt-1">{formatDateTime(draft.gameStartTime)}</div>
                        </div>
                        <div className="bg-muted rounded-xl p-3">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Hedge Leg</div>
                            <div className="text-sm font-bold font-mono text-foreground mt-1">{hedgeEnabled ? `BUY ${draft.hedgeSelectionLabel}` : 'Disabled'}</div>
                        </div>
                    </div>

                    {pairings.filter(p => p.isActive).length > 0 && (() => {
                        const pairingOptions = [
                            { value: 0, label: '自动选择' },
                            ...pairings.filter(p => p.isActive).map(p => ({
                                value: p.id,
                                label: `${p.name} — ${p.masterWallet?.label || `#${p.masterWalletId}`} ↔ ${p.hedgeWallet?.label || `#${p.hedgeWalletId}`}`,
                            })),
                        ];
                        return (
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">交易配对</label>
                                <CustomDropdown
                                    options={pairingOptions}
                                    value={selectedPairingId}
                                    onChange={(val) => {
                                        setSelectedPairingId(val);
                                        if (val) {
                                            localStorage.setItem(PAIRING_STORAGE_KEY, String(val));
                                        } else {
                                            localStorage.removeItem(PAIRING_STORAGE_KEY);
                                        }
                                    }}
                                    placeholder="自动选择"
                                />
                            </div>
                        );
                    })()}

                    <div>
                        <label htmlFor="task-price-cents" className="block text-xs font-semibold text-gray-400 mb-1">Task Price (cents)</label>
                        <div className="flex items-center gap-2">
                            <input
                                id="task-price-cents"
                                name="task-price-cents"
                                type="number"
                                min="1"
                                max="99"
                                step="0.1"
                                value={priceCents}
                                onChange={(event) => setPriceCents(event.target.value)}
                                className="flex-1 rounded-xl bg-muted border border-transparent px-3 py-2.5 text-sm font-mono text-foreground focus:border-primary focus:bg-surface outline-none transition-colors"
                            />
                            <span className="text-xs text-accent font-mono">¢</span>
                        </div>
                        <div className="text-[10px] text-muted mt-1">
                            Current bid: {formatPriceCents(draft.price)}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="task-quantity" className="block text-xs font-semibold text-gray-400 mb-1">Quantity (shares)</label>
                        <input
                            id="task-quantity"
                            name="task-quantity"
                            type="number"
                            min="1"
                            step="1"
                            value={quantity}
                            onChange={(event) => setQuantity(event.target.value)}
                            className="w-full rounded-xl bg-muted border border-transparent px-3 py-2.5 text-sm font-mono text-foreground focus:border-primary focus:bg-surface outline-none transition-colors"
                        />
                        <div className="text-[10px] text-muted mt-1">
                            Visible bid depth: {Number.isFinite(draft.maxQuantity) && draft.maxQuantity > 0 ? Math.round(draft.maxQuantity) : '--'} shares
                        </div>
                    </div>

                    <div>
                        <label htmlFor="task-expiry" className="block text-xs font-semibold text-gray-400 mb-1">Task Expiry</label>
                        <input
                            id="task-expiry"
                            name="task-expiry"
                            type="datetime-local"
                            value={expiryInput}
                            onChange={(event) => setExpiryInput(event.target.value)}
                            className="w-full rounded-xl bg-muted border border-transparent px-3 py-2.5 text-sm font-mono text-foreground focus:border-primary focus:bg-surface outline-none transition-colors"
                        />
                        <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                            <span>Default: game start - 3 minutes</span>
                            {expiryInput ? (
                                <button
                                    onClick={() => setExpiryInput('')}
                                    className="text-muted hover:text-foreground"
                                >
                                    Clear
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="bg-muted rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400">Route</span>
                            <span className="font-semibold text-foreground">{hedgeEnabled ? 'Main + Hedge' : 'Main leg only'}</span>
                        </div>
                        {selectedPairingId > 0 && (() => {
                            const p = pairings.find(x => x.id === selectedPairingId);
                            return p ? (
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-400">配对</span>
                                    <span className="font-semibold font-mono text-foreground">{p.masterWallet?.label || `#${p.masterWalletId}`} ↔ {p.hedgeWallet?.label || `#${p.hedgeWalletId}`}</span>
                                </div>
                            ) : null;
                        })()}
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400">Notional</span>
                            <span className={`font-bold font-mono ${minOrderValid ? 'text-foreground' : 'text-red-400'}`}>${cost.toFixed(2)}</span>
                        </div>
                        {parsedExpiry && (
                            <div className="flex items-center justify-between">
                                <span>Task expires</span>
                                <span className={`${expiryPast || expiryAfterGameStart ? 'text-rose-300' : 'text-amber-300'} font-mono`}>
                                    {formatDateTime(parsedExpiry)}
                                </span>
                            </div>
                        )}
                    </div>

                    {submitError && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            {submitError}
                        </div>
                    )}
                </div>

                <div className="flex gap-2 px-5 py-4 border-t-2 border-border">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 py-2.5 rounded-xl bg-muted text-gray-300 text-xs font-bold transition-all duration-200 hover:bg-surface-hover hover:scale-105 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={submitting}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 hover:scale-105 disabled:opacity-50 ${
                            confirmStep
                                ? 'bg-secondary text-white hover:bg-green-600'
                                : 'bg-primary text-white hover:bg-green-700'
                        }`}
                    >
                        {submitting ? 'Starting...' : confirmStep ? 'Confirm & Start' : 'Review & Start'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const App = () => {
    const { toasts, addToast, dismissToast } = useToasts();
    const {
        markets,
        stats,
        taskStats,
        tasks,
        balance,
        isConnected,
        tradeEnabled,
        polyMultiReady,
        createTask,
        cancelTask,
        cancelAllTasks,
        fetchTimeline,
        pairings,
    } = useSportsStream(addToast);

    const [activeView, setActiveView] = useState('markets'); // 'markets' | 'tasks' | 'accounts'
    const [activeSport, setActiveSport] = useState('all');
    const [sortBy, setSortBy] = useState('time');
    const [search, setSearch] = useState('');
    const [taskDraft, setTaskDraft] = useState(null);
    const [taskSubmitting, setTaskSubmitting] = useState(false);
    const [cancellingTaskId, setCancellingTaskId] = useState(null);

    const displayMarkets = useMemo(() => {
        let filtered = markets;

        if (activeSport !== 'all') {
            filtered = filtered.filter(m => m.sport === activeSport);
        }

        if (search.trim()) {
            const query = search.trim().toLowerCase();
            filtered = filtered.filter(m =>
                (m.homeTeam || '').toLowerCase().includes(query) ||
                (m.awayTeam || '').toLowerCase().includes(query) ||
                (m.question || '').toLowerCase().includes(query) ||
                (m.eventTitle || '').toLowerCase().includes(query) ||
                (m.selections || []).some(selection => (selection.label || '').toLowerCase().includes(query))
            );
        }

        filtered = [...filtered].sort((left, right) => {
            if (sortBy === 'volume') return (right.volume || 0) - (left.volume || 0);
            if (sortBy === 'liquidity') return (right.liquidity || 0) - (left.liquidity || 0);
            const leftTime = left.gameStartTime ? new Date(left.gameStartTime).getTime() : Infinity;
            const rightTime = right.gameStartTime ? new Date(right.gameStartTime).getTime() : Infinity;
            return leftTime - rightTime;
        });

        return filtered;
    }, [markets, activeSport, sortBy, search]);

    const activeTasks = useMemo(
        () => tasks.filter(task => ACTIVE_TASK_STATUSES.includes(task.status)),
        [tasks]
    );

    const openTaskModal = useCallback((draft) => {
        setTaskDraft(draft);
    }, []);

    const closeTaskModal = useCallback(() => {
        if (taskSubmitting) return;
        setTaskDraft(null);
    }, [taskSubmitting]);

    const submitTaskDraft = useCallback(async (payload) => {
        setTaskSubmitting(true);
        try {
            const result = await createTask(payload);
            if (result?.success) {
                setTaskDraft(null);
            }
            return result;
        } finally {
            setTaskSubmitting(false);
        }
    }, [createTask]);

    const handleCancelTask = useCallback(async (taskId) => {
        setCancellingTaskId(taskId);
        try {
            return await cancelTask(taskId);
        } finally {
            setCancellingTaskId(current => current === taskId ? null : current);
        }
    }, [cancelTask]);

    const handleDeleteTask = useCallback(async (taskId) => {
        try {
            const res = await fetch(`${Preview.API_BASE_URL}/api/tasks/${taskId}`, { method: 'DELETE' });
            await res.json();
        } catch {}
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground font-sans relative overflow-hidden" style={{ paddingLeft: 72 }}>
            {/* Background decoration — soft ambient glows */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
                <div className="absolute" style={{
                    top: '-10%', right: '-5%', width: '600px', height: '600px',
                    background: 'radial-gradient(ellipse at center, rgba(135,206,235,0.08) 0%, rgba(135,206,235,0.03) 40%, transparent 70%)',
                    borderRadius: '40% 60% 55% 45% / 55% 40% 60% 45%',
                    filter: 'blur(60px)',
                }} />
                <div className="absolute" style={{
                    bottom: '-5%', left: '-8%', width: '500px', height: '500px',
                    background: 'radial-gradient(ellipse at center, rgba(255,179,0,0.06) 0%, rgba(139,69,19,0.03) 50%, transparent 70%)',
                    borderRadius: '55% 45% 60% 40% / 45% 55% 45% 55%',
                    filter: 'blur(60px)',
                }} />
                <div className="absolute" style={{
                    top: '40%', left: '15%', width: '400px', height: '400px',
                    background: 'radial-gradient(ellipse at center, rgba(76,175,80,0.05) 0%, transparent 60%)',
                    borderRadius: '50%',
                    filter: 'blur(50px)',
                }} />
            </div>

            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
            <DockNav activeView={activeView} setActiveView={setActiveView} taskCount={taskStats.active || activeTasks.length} />
            <TaskCreateModal
                draft={taskDraft}
                submitting={taskSubmitting}
                onClose={closeTaskModal}
                onSubmit={submitTaskDraft}
                pairings={pairings}
            />

            <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 flex items-center justify-center bg-primary" style={{ borderRadius: '30% 70% 60% 40% / 50% 40% 60% 50%' }}>
                                <Icon name="leaf" size={18} className="text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-foreground tracking-tight">
                                {APP_TITLE}
                            </h1>
                            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-leaf' : 'bg-red-400'} animate-pulse`} />
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                            <span className="text-muted">
                                Markets: <span className="text-foreground font-mono">{stats.total || 0}</span>
                            </span>
                            {tradeEnabled && (
                                <span className="text-muted">
                                    Balance: <span className="text-accent font-mono">${balance.toFixed(2)}</span>
                                </span>
                            )}
                            {!polyMultiReady && (
                                <span className="text-[11px] text-amber-300 border border-amber-500/20 bg-amber-500/10 px-2 py-1 rounded-lg">
                                    Pairing route not ready
                                </span>
                            )}
                        </div>
                    </div>

                    {activeView === 'markets' && (
                        <>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {SPORT_TABS.map(tab => {
                                    const isActive = activeSport === tab.key;
                                    const count = tab.key === 'all'
                                        ? (stats.total || 0)
                                        : (stats.bySport?.[tab.key] || 0);
                                    return (
                                        <button
                                            key={tab.key}
                                            onClick={() => setActiveSport(tab.key)}
                                            className={`px-3 py-1.5 text-xs rounded-xl border transition-all ${
                                                isActive
                                                    ? 'bg-primary border-primary text-white'
                                                    : 'bg-surface border-border text-gray-300 hover:border-primary hover:text-primary'
                                            }`}
                                        >
                                            <span className="mr-1">{tab.emoji}</span>
                                            {tab.label}
                                            {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-center gap-3 mt-2">
                                <div className="flex-1 relative">
                                    <input
                                        aria-label="Search teams"
                                        name="market-search"
                                        type="text"
                                        value={search}
                                        onChange={event => setSearch(event.target.value)}
                                        placeholder="Search teams..."
                                        className="w-full bg-muted border border-transparent rounded-xl px-3 py-1.5 text-sm text-foreground placeholder-muted focus:outline-none focus:border-primary focus:bg-surface"
                                    />
                                    {search && (
                                        <button
                                            onClick={() => setSearch('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground text-xs"
                                        >
                                            x
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    {SORT_OPTIONS.map(option => (
                                        <button
                                            key={option.key}
                                            onClick={() => setSortBy(option.key)}
                                            className={`px-2 py-1 text-xs rounded-xl border transition ${
                                                sortBy === option.key
                                                    ? 'bg-accent border-accent text-white'
                                                    : 'bg-surface border-border text-gray-400 hover:border-accent'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-6 relative">
                {activeView === 'accounts' && (
                    <AnimatedView viewKey="accounts">
                        <div>
                            <PolyMultiTab apiBaseUrl="" />
                        </div>
                    </AnimatedView>
                )}

                {activeView === 'tasks' && (
                    <AnimatedView viewKey="tasks">
                        <div>
                            <TasksTab
                                tasks={tasks}
                                onCancelTask={handleCancelTask}
                                onCancelAll={cancelAllTasks}
                                cancellingTaskId={cancellingTaskId}
                                fetchTimeline={fetchTimeline}
                                pairings={pairings}
                                onDeleteTask={handleDeleteTask}
                            />
                        </div>
                    </AnimatedView>
                )}

                {activeView === 'markets' && (
                    <AnimatedView viewKey={`markets-${activeSport}-${sortBy}`}>
                        {displayMarkets.length === 0 ? (
                            <div className="text-center py-20">
                                {isConnected ? (
                                    <div>
                                        <div className="text-gray-400 text-lg mb-2">
                                            {markets.length > 0 ? 'No matches for current filter' : 'Loading markets...'}
                                        </div>
                                        <div className="text-gray-300 text-sm">
                                            Polymarket sports markets will appear here when available.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-gray-400">Connecting...</div>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {displayMarkets.map(market => (
                                    <SportsCard
                                        key={market.conditionId}
                                        market={market}
                                        onOpenTaskModal={openTaskModal}
                                        taskEnabled={tradeEnabled}
                                        tradeEnabled={tradeEnabled}
                                    />
                                ))}
                            </div>
                        )}
                    </AnimatedView>
                )}
            </main>
        </div>
    );
};

ReactDOM.render(<App />, document.getElementById('root'));
