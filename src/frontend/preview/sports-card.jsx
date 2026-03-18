var Preview = window.Preview || (window.Preview = {});
var { useState, useRef, useEffect } = Preview.ReactHooks;

// ============================================================================
// 工具函数
// ============================================================================

const SPORT_ICONS = {
    nba: { emoji: '\u{1F3C0}', label: 'NBA' },
    nhl: { emoji: '\u{1F3D2}', label: 'NHL' },
    football: { emoji: '\u26BD', label: 'Football' },
    ncaa: { emoji: '\u{1F3C8}', label: 'NCAA' },
    lol: { emoji: '\u{1F3AE}', label: 'LoL' },
    cs2: { emoji: '\u{1F52B}', label: 'CS2' },
    dota2: { emoji: '\u{1F5E1}\uFE0F', label: 'Dota2' },
};

function formatPrice(price) {
    if (!Number.isFinite(price) || price <= 0 || price >= 1) return '--';
    return (price * 100).toFixed(1) + '\u00A2';
}

function formatDepth(depth) {
    if (!Number.isFinite(depth) || depth <= 0) return '';
    if (depth >= 1000) return `(${(depth / 1000).toFixed(1)}K)`;
    return `(${Math.round(depth)})`;
}

function formatVolume(vol) {
    if (!vol) return '$0';
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
    return `$${Math.round(vol)}`;
}

function formatDatetime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.toLocaleString('en', { month: 'short' });
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}`;
}

function computeCountdown(dateStr) {
    if (!dateStr) return { isLive: false, text: '' };
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff < 0) return { isLive: true, text: 'LIVE' };
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 48) return { isLive: false, text: `starts in ${Math.floor(h / 24)}d ${h % 24}h` };
    if (h > 0) return { isLive: false, text: `starts in ${h}h ${m}min` };
    return { isLive: false, text: `starts in ${m}min` };
}

/** Live-updating countdown hook (ticks every 30s) */
function useCountdown(dateStr) {
    const [cd, setCd] = useState(() => computeCountdown(dateStr));
    useEffect(() => {
        setCd(computeCountdown(dateStr));
        const id = setInterval(() => setCd(computeCountdown(dateStr)), 30000);
        return () => clearInterval(id);
    }, [dateStr]);
    return cd;
}

// ============================================================================
// FlashValue
// ============================================================================

const FlashValue = ({ value, format = formatPrice, className = '', children }) => {
    const prevRef = useRef(value);
    const [flash, setFlash] = useState('');
    const keyRef = useRef(0);

    useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = value;
        if (Math.abs(value - prev) > 0.0001) {
            setFlash(value > prev ? 'flash-up' : 'flash-down');
            keyRef.current++;
            const timer = setTimeout(() => setFlash(''), 1500);
            return () => clearTimeout(timer);
        }
    }, [value]);

    return (
        <span key={keyRef.current} className={`${className} ${flash}`.trim()}>
            {children || format(value)}
        </span>
    );
};

function flashValueSafe(price) {
    return Math.round(Number(price || 0) * 10000);
}

function getDepthTone(depth) {
    if (!Number.isFinite(depth) || depth <= 0) {
        return 'text-muted/50 border-border bg-background/30';
    }
    if (depth >= 1000) {
        return 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
    }
    if (depth >= 250) {
        return 'text-sky-300 border-sky-500/20 bg-sky-500/10';
    }
    return 'text-amber-300 border-amber-500/20 bg-amber-500/10';
}

const DepthChip = ({ depth }) => (
    <span className={`depth-chip ${getDepthTone(depth)}`}>
        {formatDepth(depth)}
    </span>
);

const QuoteLine = ({ label, labelClassName, price }) => (
    <div className="quote-line">
        <span className={`quote-label ${labelClassName}`}>{label}</span>
        <FlashValue
            value={flashValueSafe(price)}
            className="quote-price"
            format={() => formatPrice(price)}
        />
    </div>
);

function createTaskButtonClass(disabled) {
    if (disabled) {
        return 'flex-1 px-2 py-1.5 rounded-lg bg-card text-muted border border-border transition opacity-40 cursor-not-allowed text-[11px]';
    }

    return 'flex-1 px-2 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20 transition text-[11px]';
}

function resolveTradablePrice(primaryPrice, fallbackPrice) {
    const resolved = Number(primaryPrice || 0) > 0 ? Number(primaryPrice) : Number(fallbackPrice || 0);
    if (!Number.isFinite(resolved) || resolved <= 0 || resolved >= 1) {
        return 0;
    }
    return resolved;
}

// ============================================================================
// BinaryCard — 二元赛事卡片 (moneyline)
// ============================================================================

const BinaryCard = ({ market, onOpenTaskModal, taskEnabled, tradeEnabled }) => {
    const sport = SPORT_ICONS[market.sport] || { emoji: '\u{1F3AF}', label: market.sport };
    const ob = market.orderbook || {};
    const datetime = formatDatetime(market.gameStartTime);
    const { isLive, text: countdownText } = useCountdown(market.gameStartTime);
    const awayPrice = resolveTradablePrice(ob.awayBid, market.awayPrice);
    const homePrice = resolveTradablePrice(ob.homeBid, market.homePrice);
    const awayDisabled = !taskEnabled || !market.awayTokenId || awayPrice <= 0;
    const homeDisabled = !taskEnabled || !market.homeTokenId || homePrice <= 0;

    const openTaskModal = (selection) => {
        if (!onOpenTaskModal) return;

        if (selection === 'away') {
            onOpenTaskModal({
                tokenId: market.awayTokenId,
                conditionId: market.conditionId,
                side: 'BUY',
                price: awayPrice,
                quantity: ob.homeAskDepth || 0,
                negRisk: market.negRisk,
                orderType: 'GTC',
                eventTitle: market.eventTitle || market.question,
                marketQuestion: market.question || market.eventTitle,
                selectionLabel: market.awayTeam,
                sport: market.sport,
                marketType: market.marketType,
                hedgeTokenId: market.homeTokenId,
                hedgeSide: 'BUY',
                hedgeSelectionLabel: market.homeTeam,
                gameStartTime: market.gameStartTime,
                maxQuantity: ob.homeAskDepth || 0,
            });
            return;
        }

        onOpenTaskModal({
            tokenId: market.homeTokenId,
            conditionId: market.conditionId,
            side: 'BUY',
            price: homePrice,
            quantity: ob.awayAskDepth || 0,
            negRisk: market.negRisk,
            orderType: 'GTC',
            eventTitle: market.eventTitle || market.question,
            marketQuestion: market.question || market.eventTitle,
            selectionLabel: market.homeTeam,
            sport: market.sport,
            marketType: market.marketType,
            hedgeTokenId: market.awayTokenId,
            hedgeSide: 'BUY',
            hedgeSelectionLabel: market.awayTeam,
            gameStartTime: market.gameStartTime,
            maxQuantity: ob.awayAskDepth || 0,
        });
    };

    return (
        <div className="bg-surface rounded-2xl p-5 border border-border transition-all duration-200 hover:scale-[1.01] hover:border-primary relative">
            {/* Header: sport + time */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{sport.emoji}</span>
                    <span className="text-sm font-medium text-gray-400">{sport.label}</span>
                    {market.rewardsDailyRate > 0 && (
                        <span style={{color: '#facc15', fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em'}}>
                            REWARDS: ${Math.round(market.rewardsDailyRate)} USDC
                        </span>
                    )}
                </div>
                <div className="text-right">
                    {isLive ? (
                        <div className="text-xs font-mono text-red-400 font-semibold flex items-center justify-end gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-blink-slow" />
                            LIVE
                        </div>
                    ) : countdownText && (
                        <div className="text-[11px] font-mono text-amber-400 font-medium">{countdownText}</div>
                    )}
                    {datetime && (
                        <div className="text-[10px] text-foreground font-mono">{datetime}</div>
                    )}
                </div>
            </div>

            {/* Teams */}
            <div className="text-center mb-3">
                <span className="text-base font-medium text-foreground">{market.awayTeam}</span>
                <span className="text-sm text-foreground mx-2">vs</span>
                <span className="text-base font-medium text-foreground">{market.homeTeam}</span>
            </div>

            {/* Orderbook — 2 column */}
            <div className="grid grid-cols-2 gap-4 mb-3">
                {/* Away */}
                <div className="quote-panel">
                    <div className="text-xs text-muted mb-1 truncate">{market.awayTeam}</div>
                    <div className="space-y-1">
                        <QuoteLine
                            label="Bid"
                            labelClassName="text-emerald-400/90"
                            price={ob.awayBid || 0}
                            depth={ob.awayBidDepth || 0}
                        />
                        <QuoteLine
                            label="Ask"
                            labelClassName="text-rose-400/90"
                            price={ob.awayAsk || 0}
                            depth={ob.awayAskDepth || 0}
                        />
                    </div>
                    {ob.awayAsk > 0 && ob.awayBid > 0 && (
                        <div className="quote-spread">
                            Spr: {((ob.awayAsk - ob.awayBid) * 100).toFixed(1) + '\u00A2'}
                        </div>
                    )}
                </div>

                {/* Home */}
                <div className="quote-panel">
                    <div className="text-xs text-muted mb-1 truncate">{market.homeTeam}</div>
                    <div className="space-y-1">
                        <QuoteLine
                            label="Bid"
                            labelClassName="text-emerald-400/90"
                            price={ob.homeBid || 0}
                            depth={ob.homeBidDepth || 0}
                        />
                        <QuoteLine
                            label="Ask"
                            labelClassName="text-rose-400/90"
                            price={ob.homeAsk || 0}
                            depth={ob.homeAskDepth || 0}
                        />
                    </div>
                    {ob.homeAsk > 0 && ob.homeBid > 0 && (
                        <div className="quote-spread">
                            Spr: {((ob.homeAsk - ob.homeBid) * 100).toFixed(1) + '\u00A2'}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="border-t-2 border-border pt-3">
                <div className="text-[10px] font-medium text-gray-400 mb-3">
                    Vol: <span className="font-bold text-foreground">{formatVolume(market.volume)}</span>
                    {market.liquidity > 0 && <span> | Liq: <span className="font-bold text-foreground">{formatVolume(market.liquidity)}</span></span>}
                </div>
                {tradeEnabled && (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => openTaskModal('away')}
                            disabled={awayDisabled}
                            className={`py-2.5 rounded-xl text-white text-xs font-bold transition-all duration-200 ${awayDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                            style={{ background: awayDisabled ? '#374151' : 'rgba(37, 99, 235, 0.4)' }}
                        >
                            <div>{market.awayTeam}</div>
                            <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                {formatPrice(awayPrice)}
                                {(ob.homeAskDepth > 0) && ` · ${formatDepth(ob.homeAskDepth)}`}
                            </div>
                        </button>
                        <button
                            onClick={() => openTaskModal('home')}
                            disabled={homeDisabled}
                            className={`py-2.5 rounded-xl text-white text-xs font-bold transition-all duration-200 ${homeDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                            style={{ background: homeDisabled ? '#374151' : 'rgba(220, 38, 96, 0.4)' }}
                        >
                            <div>{market.homeTeam}</div>
                            <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                {formatPrice(homePrice)}
                                {(ob.awayAskDepth > 0) && ` · ${formatDepth(ob.awayAskDepth)}`}
                            </div>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ============================================================================
// ThreeWayCard — 足球三方卡片
// ============================================================================

const ThreeWayCard = ({ market, onOpenTaskModal, taskEnabled, tradeEnabled }) => {
    const sport = SPORT_ICONS[market.sport] || { emoji: '\u26BD', label: 'Football' };
    const datetime = formatDatetime(market.gameStartTime);
    const { isLive, text: countdownText } = useCountdown(market.gameStartTime);
    const rawSelections = market.selections || [];
    // Sort: away first, draw middle, home last — matching title "awayTeam vs homeTeam"
    const selections = [...rawSelections].sort((a, b) => {
        const order = (s) => s.label === market.awayTeam ? 0 : (s.label === 'Draw' || s.label.startsWith('Draw')) ? 1 : s.label === market.homeTeam ? 2 : 1;
        return order(a) - order(b);
    });

    return (
        <div className="bg-surface rounded-2xl p-5 border border-border transition-all duration-200 hover:scale-[1.01] hover:border-secondary relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{sport.emoji}</span>
                    <span className="text-sm font-medium text-gray-400">{sport.label}</span>
                    {market.rewardsDailyRate > 0 && (
                        <span style={{color: '#facc15', fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em'}}>
                            REWARDS: ${Math.round(market.rewardsDailyRate)} USDC
                        </span>
                    )}
                </div>
                <div className="text-right">
                    {isLive ? (
                        <div className="text-xs font-mono text-red-400 font-semibold flex items-center justify-end gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-blink-slow" />
                            LIVE
                        </div>
                    ) : countdownText && (
                        <div className="text-[11px] font-mono text-amber-400 font-medium">{countdownText}</div>
                    )}
                    {datetime && (
                        <div className="text-[10px] text-foreground font-mono">{datetime}</div>
                    )}
                </div>
            </div>

            {/* Teams */}
            <div className="text-center mb-3">
                <span className="text-base font-medium text-foreground">{market.awayTeam}</span>
                <span className="text-sm text-foreground mx-2">vs</span>
                <span className="text-base font-medium text-foreground">{market.homeTeam}</span>
            </div>

            {/* 3-way selections — always 3 columns */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                {selections.map((sel, idx) => (
                    <div key={idx} className="quote-panel">
                        <div className="text-xs text-muted mb-1 truncate">{sel.label}</div>
                        <div className="text-sm font-mono font-medium text-foreground">
                            <FlashValue
                                value={flashValueSafe(sel.ask > 0 && sel.ask < 1 ? sel.ask : sel.price)}
                                className="quote-price"
                                format={() => formatPrice(sel.ask > 0 && sel.ask < 1 ? sel.ask : sel.price)}
                            />
                        </div>
                        <div className="text-[10px] text-muted/70 font-mono mt-1 flex items-center justify-center gap-1 flex-wrap">
                            {sel.ask > 0 && sel.ask < 1 ? (
                                <>
                                    <FlashValue
                                        value={flashValueSafe(sel.bid || 0)}
                                        className="text-sky-300"
                                        format={() => `Bid ${formatPrice(sel.bid)}`}
                                    />
                                    <DepthChip depth={sel.askDepth} />
                                </>
                            ) : (
                                <span>--</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="border-t-2 border-border pt-3">
                <div className="text-[10px] font-medium text-gray-400 mb-3">
                    Vol: <span className="font-bold text-foreground">{formatVolume(market.volume)}</span>
                </div>
                {tradeEnabled && (
                    <div className="grid grid-cols-3 gap-2">
                        {selections.map((sel, idx) => {
                            const selDisabled = !taskEnabled || !sel.tokenId || resolveTradablePrice(sel.bid, sel.price) <= 0;
                            const isDraw = sel.label === 'Draw' || sel.label.startsWith('Draw');
                            const isHome = sel.label === market.homeTeam;
                            const bg = selDisabled ? '#374151' : isDraw ? '#808898' : isHome ? 'rgba(220, 38, 96, 0.4)' : 'rgba(37, 99, 235, 0.4)';
                            // Hedge depth: No askDepth = Yes bidDepth
                            const hedgeDepth = sel.bidDepth || 0;
                            return (
                                <button
                                    key={idx}
                                    onClick={() => onOpenTaskModal && onOpenTaskModal({
                                        tokenId: sel.tokenId,
                                        conditionId: sel.conditionId || market.conditionId,
                                        side: 'BUY',
                                        price: resolveTradablePrice(sel.bid, sel.price),
                                        quantity: hedgeDepth,
                                        negRisk: market.negRisk,
                                        orderType: 'GTC',
                                        eventTitle: market.eventTitle || market.question,
                                        marketQuestion: market.question || market.eventTitle,
                                        selectionLabel: sel.label,
                                        sport: market.sport,
                                        marketType: market.marketType,
                                        hedgeTokenId: sel.noTokenId || '',
                                        hedgeSide: 'BUY',
                                        hedgeSelectionLabel: sel.label + ' No',
                                        gameStartTime: market.gameStartTime,
                                        maxQuantity: hedgeDepth,
                                    })}
                                    disabled={selDisabled}
                                    className={`py-2 rounded-xl text-white text-xs font-bold transition-all duration-200 ${selDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                                    style={{ background: bg }}
                                >
                                    <div>{isDraw ? 'Draw' : sel.label}</div>
                                    <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                        {formatPrice(resolveTradablePrice(sel.bid, sel.price))}
                                        {(hedgeDepth > 0) && ` · ${formatDepth(hedgeDepth)}`}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ============================================================================
// SportsCard — dispatch
// ============================================================================

const SportsCard = (props) => {
    const mt = props.market.marketType;
    if (mt === 'three-way' || props.market.isThreeWay) {
        return <ThreeWayCard {...props} />;
    }
    if (mt === 'moneyline') {
        return <BinaryCard {...props} />;
    }
    // futures/outright — 暂不显示，后续可添加 FuturesCard
    return null;
};

Preview.SportsCard = SportsCard;
Preview.SPORT_ICONS = SPORT_ICONS;
