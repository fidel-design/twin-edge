"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
} from "lightweight-charts";

const API = "http://localhost:5000";

const WATCHLIST = [
  "XAUUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "BTCUSD",
];

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type TradeLevels = {
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  risk?: number;
  reward?: number;
  rr?: number;
};

type Analysis = {
  price?: number;
  ema20?: number;
  ema_direction?: string;
  rsi14?: number;
  structure?: string;
  structure_trend?: string;
  structure_description?: string;
  structure_confidence?: number;
  support?: number;
  resistance?: number;
  direction?: string;
  candlestick?: string;
};

type Setup = {
  direction?: string;
  score?: number;
  max_score?: number;
  status?: string;
  location?: string;
  chasing?: boolean;
  warnings_count?: number;
  reasons?: string[];
  warnings?: string[];
  trade_levels?: TradeLevels;
};

type Market = {
  symbol: string;
  requested_symbol?: string;
  available?: boolean;
  bid?: number;
  ask?: number;
  spread?: number;
  direction?: string;
  status?: string;
  score?: number;
  max_score?: number;
  timestamp?: string;
  m1?: Analysis;
  m15?: Analysis;
  setup?: Setup;
  candles?: Candle[];
};

type ScannerResponse = {
  available_markets?: number;
  total_markets?: number;
  watchlist?: string[];
  markets?: Market[];
  timestamp?: string;
};

type AlertsResponse = {
  counts?: {
    strong_setups?: number;
    possible_setups?: number;
    wait?: number;
    no_trade?: number;
  };
};

function safeNumber(value: unknown, fallback = 0): number {
  const number =
    typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function formatPrice(
  value: unknown,
  symbol: string
): string {
  const number = safeNumber(value, NaN);

  if (!Number.isFinite(number)) {
    return "-";
  }

  if (symbol === "USDJPY") {
    return number.toFixed(3);
  }

  if (symbol === "XAUUSD" || symbol === "BTCUSD") {
    return number.toFixed(2);
  }

  return number.toFixed(5);
}

function formatNumber(
  value: unknown,
  decimals = 2
): string {
  const number = safeNumber(value, NaN);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toFixed(decimals);
}

function safeText(
  value: unknown,
  fallback = "-"
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

function statusClass(status?: string) {
  const value = String(status || "").toUpperCase();

  if (value === "STRONG SETUP") {
    return "status strong";
  }

  if (value === "POSSIBLE SETUP") {
    return "status possible";
  }

  if (value === "NO TRADE") {
    return "status danger";
  }

  return "status wait";
}

function directionClass(direction?: string) {
  const value = String(direction || "").toLowerCase();

  if (value === "bullish") {
    return "bullish";
  }

  if (value === "bearish") {
    return "bearish";
  }

  return "neutral";
}

export default function Home() {
  const [scanner, setScanner] =
    useState<ScannerResponse | null>(null);

  const [selectedSymbol, setSelectedSymbol] =
    useState("XAUUSD");

  const [selectedMarket, setSelectedMarket] =
    useState<Market | null>(null);

  const [alerts, setAlerts] =
    useState<AlertsResponse | null>(null);

  const [loadingScanner, setLoadingScanner] =
    useState(true);

  const [loadingMarket, setLoadingMarket] =
    useState(true);

  const [scannerError, setScannerError] =
    useState("");

  const [marketError, setMarketError] =
    useState("");

  const [lastRefresh, setLastRefresh] =
    useState("");

  const chartContainerRef =
    useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<any>(null);

  const previousStrongCount =
    useRef(0);

  const firstAlertLoad =
    useRef(true);

  /*
   * =====================================================
   * SCANNER
   * =====================================================
   */

  async function fetchScanner() {
    try {
      setScannerError("");

      const response = await fetch(
        `${API}/api/scanner`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Scanner HTTP ${response.status}`
        );
      }

      const data: ScannerResponse =
        await response.json();

      /*
       * IMPORTANT:
       * Only replace the current scanner data when
       * the backend actually returned markets.
       *
       * This prevents a temporary empty response
       * from making all market cards disappear.
       */

      if (
        Array.isArray(data.markets) &&
        data.markets.length > 0
      ) {
        setScanner(data);
        setLastRefresh(
          new Date().toLocaleTimeString()
        );
      }
    } catch (error) {
      console.error(
        "Scanner error:",
        error
      );

      /*
       * Do NOT clear the existing scanner.
       * Keep the last successful data visible.
       */

      setScannerError(
        "Scanner refresh failed. Keeping the last successful data."
      );
    } finally {
      setLoadingScanner(false);
    }
  }

  /*
   * =====================================================
   * SELECTED MARKET
   * =====================================================
   */

  async function fetchSelectedMarket(
    symbol: string
  ) {
    try {
      setLoadingMarket(true);
      setMarketError("");

      const response = await fetch(
        `${API}/api/market/${symbol}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Market HTTP ${response.status}`
        );
      }

      const data: Market =
        await response.json();

      setSelectedMarket(data);
    } catch (error) {
      console.error(
        "Selected market error:",
        error
      );

      setMarketError(
        `Unable to load ${symbol} details.`
      );
    } finally {
      setLoadingMarket(false);
    }
  }

  /*
   * =====================================================
   * ALERTS
   * =====================================================
   */

  async function fetchAlerts() {
    try {
      const response = await fetch(
        `${API}/api/alerts`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        return;
      }

      const data: AlertsResponse =
        await response.json();

      setAlerts(data);

      const strongCount =
        safeNumber(
          data.counts?.strong_setups,
          0
        );

      if (
        !firstAlertLoad.current &&
        strongCount >
          previousStrongCount.current
      ) {
        try {
          if (
            "Notification" in window &&
            Notification.permission ===
              "granted"
          ) {
            new Notification(
              "Twin Edge Alert",
              {
                body: `${strongCount} strong setup(s) detected.`,
              }
            );
          }
        } catch {
          // Ignore notification errors.
        }
      }

      previousStrongCount.current =
        strongCount;

      firstAlertLoad.current = false;
    } catch (error) {
      console.error(
        "Alerts error:",
        error
      );
    }
  }

  /*
   * =====================================================
   * INITIAL LOAD
   * =====================================================
   */

  useEffect(() => {
    fetchScanner();
    fetchAlerts();
    fetchSelectedMarket(
      selectedSymbol
    );

    /*
     * Scanner refresh is intentionally 10 seconds.
     * We also keep the previous successful scanner
     * whenever a refresh returns empty data.
     */

    const interval = setInterval(() => {
      fetchScanner();
      fetchAlerts();
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  /*
   * =====================================================
   * SELECTED SYMBOL CHANGED
   * =====================================================
   */

  useEffect(() => {
    fetchSelectedMarket(
      selectedSymbol
    );
  }, [selectedSymbol]);

  /*
   * =====================================================
   * NOTIFICATIONS
   * =====================================================
   */

  useEffect(() => {
    if ("Notification" in window) {
      if (
        Notification.permission ===
        "default"
      ) {
        Notification.requestPermission().catch(
          () => {}
        );
      }
    }
  }, []);

  /*
   * =====================================================
   * MARKETS
   * =====================================================
   */

  const markets = useMemo(() => {
    if (
      !scanner ||
      !Array.isArray(scanner.markets)
    ) {
      return [];
    }

    /*
     * Preserve the exact watchlist order.
     */

    return WATCHLIST.map((symbol) => {
      const found =
        scanner.markets?.find(
          (market) =>
            String(
              market.symbol || ""
            ).toUpperCase() ===
              symbol.toUpperCase() ||
            String(
              market.requested_symbol || ""
            ).toUpperCase() ===
              symbol.toUpperCase()
        );

      return (
        found || {
          symbol,
          requested_symbol: symbol,
          available: false,
          status: "UNAVAILABLE",
          score: 0,
          max_score: 10,
        }
      );
    });
  }, [scanner]);

  /*
   * =====================================================
   * CHART
   * =====================================================
   */

  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    if (
      !selectedMarket?.candles ||
      selectedMarket.candles.length === 0
    ) {
      return;
    }

    const container =
      chartContainerRef.current;

    container.innerHTML = "";

    const chart = createChart(
      container,
      {
        width:
          container.clientWidth,
        height: 430,

        layout: {
          background: {
            type: ColorType.Solid,
            color: "#09090b",
          },
          textColor: "#a1a1aa",
        },

        grid: {
          vertLines: {
            color: "#18181b",
          },
          horzLines: {
            color: "#18181b",
          },
        },

        crosshair: {
          mode: 1,
        },

        rightPriceScale: {
          borderColor: "#27272a",
        },

        timeScale: {
          borderColor: "#27272a",
          timeVisible: true,
          secondsVisible: false,
        },
      }
    );

    chartRef.current = chart;

    const candleSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderVisible: false,
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        }
      );

    const candles = [
      ...selectedMarket.candles,
    ].sort(
      (a, b) => a.time - b.time
    );

    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }))
    );

    /*
     * EMA20
     */

    const emaPeriod = 20;

    const multiplier =
      2 / (emaPeriod + 1);

    let ema: number | null = null;

    const emaData: {
      time: any;
      value: number;
    }[] = [];

    candles.forEach(
      (candle, index) => {
        if (index === 0) {
          ema = candle.close;
        } else {
          ema =
            (candle.close -
              (ema ?? candle.close)) *
              multiplier +
            (ema ?? candle.close);
        }

        if (ema !== null) {
          emaData.push({
            time:
              candle.time as any,
            value: ema,
          });
        }
      }
    );

    const emaSeries =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 2,
          title: "EMA20",
        }
      );

    emaSeries.setData(
      emaData
    );

    /*
     * Horizontal price level helper
     */

    function addLevel(
      value: unknown,
      title: string
    ) {
      const price =
        safeNumber(value, NaN);

      if (!Number.isFinite(price)) {
        return;
      }

      const lineSeries =
        chart.addSeries(
          LineSeries,
          {
            lineWidth: 1,
            title,
          }
        );

      lineSeries.setData([
        {
          time:
            candles[0].time as any,
          value: price,
        },
        {
          time:
            candles[
              candles.length - 1
            ].time as any,
          value: price,
        },
      ]);
    }

    addLevel(
      selectedMarket.m1?.support,
      "Support"
    );

    addLevel(
      selectedMarket.m1?.resistance,
      "Resistance"
    );

    addLevel(
      selectedMarket.setup
        ?.trade_levels?.entry,
      "Entry"
    );

    addLevel(
      selectedMarket.setup
        ?.trade_levels?.stop_loss,
      "SL"
    );

    addLevel(
      selectedMarket.setup
        ?.trade_levels?.take_profit,
      "TP"
    );

    chart.timeScale().fitContent();

    const resizeObserver =
      new ResizeObserver(() => {
        if (
          !chartContainerRef.current
        ) {
          return;
        }

        chart.applyOptions({
          width:
            chartContainerRef.current
              .clientWidth,
        });
      });

    resizeObserver.observe(
      container
    );

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [selectedMarket]);

  /*
   * =====================================================
   * COUNTS
   * =====================================================
   */

  const strongCount =
    safeNumber(
      alerts?.counts
        ?.strong_setups,
      markets.filter(
        (market) =>
          String(
            market.status
          ).toUpperCase() ===
          "STRONG SETUP"
      ).length
    );

  const possibleCount =
    safeNumber(
      alerts?.counts
        ?.possible_setups,
      markets.filter(
        (market) =>
          String(
            market.status
          ).toUpperCase() ===
          "POSSIBLE SETUP"
      ).length
    );

  const waitCount =
    safeNumber(
      alerts?.counts?.wait,
      markets.filter(
        (market) =>
          String(
            market.status
          ).toUpperCase() ===
          "WAIT"
      ).length
    );

  const noTradeCount =
    safeNumber(
      alerts?.counts?.no_trade,
      markets.filter(
        (market) =>
          String(
            market.status
          ).toUpperCase() ===
          "NO TRADE"
      ).length
    );

  /*
   * =====================================================
   * RENDER
   * =====================================================
   */

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">

        {/* HEADER */}

        <header className="mb-6 flex flex-col gap-4 border-b border-zinc-800 pb-5 lg:flex-row lg:items-center lg:justify-between">

          <div>
            <div className="flex items-center gap-3">

              <h1 className="text-3xl font-black tracking-tight">
                TWIN EDGE
              </h1>

              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                V5
              </span>

            </div>

            <p className="mt-1 text-sm text-zinc-400">
              Multi-market trading analysis
              dashboard
            </p>
          </div>

          <div className="flex items-center gap-4">

            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              LIVE
            </div>

            <div className="text-xs text-zinc-500">
              Updated{" "}
              {lastRefresh || "-"}
            </div>

          </div>

        </header>

        {/* SCANNER ERROR */}

        {scannerError && (
          <div className="mb-5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-300">
            {scannerError}
          </div>
        )}

        {/* SUMMARY */}

        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Strong setups
            </div>

            <div className="mt-2 text-3xl font-black text-emerald-400">
              {strongCount}
            </div>
          </div>

          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Possible setups
            </div>

            <div className="mt-2 text-3xl font-black text-yellow-400">
              {possibleCount}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Waiting
            </div>

            <div className="mt-2 text-3xl font-black text-zinc-300">
              {waitCount}
            </div>
          </div>

          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              No trade
            </div>

            <div className="mt-2 text-3xl font-black text-red-400">
              {noTradeCount}
            </div>
          </div>

        </section>

        {/* MARKET SCANNER */}

        <section className="mb-6">

          <div className="mb-3 flex items-center justify-between">

            <div>
              <h2 className="text-xl font-bold">
                Market Scanner
              </h2>

              <p className="text-sm text-zinc-500">
                {loadingScanner
                  ? "Scanning markets..."
                  : `${markets.length} markets loaded`}
              </p>
            </div>

            <div className="text-xs text-zinc-500">
              {scanner?.available_markets ??
                0}
              /
              {scanner?.total_markets ??
                WATCHLIST.length}{" "}
              available
            </div>

          </div>

          {loadingScanner &&
          markets.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

              {WATCHLIST.map(
                (symbol) => (
                  <div
                    key={symbol}
                    className="h-40 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50"
                  />
                )
              )}

            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

              {markets.map(
                (market) => {
                  const symbol =
                    market.requested_symbol ||
                    market.symbol ||
                    "UNKNOWN";

                  const isSelected =
                    selectedSymbol.toUpperCase() ===
                    symbol.toUpperCase();

                  const score =
                    safeNumber(
                      market.score,
                      0
                    );

                  const maxScore =
                    safeNumber(
                      market.max_score,
                      10
                    );

                  return (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() =>
                        setSelectedSymbol(
                          symbol
                        )
                      }
                      className={`text-left transition ${
                        isSelected
                          ? "scale-[1.01]"
                          : "hover:scale-[1.01]"
                      }`}
                    >

                      <div
                        className={`rounded-2xl border p-4 ${
                          isSelected
                            ? "border-white/30 bg-zinc-800"
                            : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                        }`}
                      >

                        <div className="flex items-start justify-between gap-3">

                          <div>
                            <div className="text-lg font-black">
                              {symbol}
                            </div>

                            <div className="mt-1 text-xs text-zinc-500">
                              {market.available
                                ? "Market available"
                                : "Unavailable"}
                            </div>
                          </div>

                          <span
                            className={statusClass(
                              market.status
                            )}
                          >
                            {safeText(
                              market.status,
                              "WAIT"
                            )}
                          </span>

                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3">

                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                              Bid
                            </div>

                            <div className="mt-1 font-mono text-sm">
                              {formatPrice(
                                market.bid,
                                symbol
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                              Ask
                            </div>

                            <div className="mt-1 font-mono text-sm">
                              {formatPrice(
                                market.ask,
                                symbol
                              )}
                            </div>
                          </div>

                        </div>

                        <div className="mt-4 flex items-center justify-between">

                          <span className="text-xs text-zinc-500">
                            Score
                          </span>

                          <span
                            className={`font-bold ${
                              score >= 8
                                ? "text-emerald-400"
                                : score >= 6
                                ? "text-yellow-400"
                                : "text-zinc-300"
                            }`}
                          >
                            {score}/
                            {maxScore}
                          </span>

                        </div>

                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">

                          <div
                            className="h-full rounded-full bg-white transition-all"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(
                                  0,
                                  (score /
                                    maxScore) *
                                    100
                                )
                              )}%`,
                            }}
                          />

                        </div>

                      </div>

                    </button>
                  );
                }
              )}

            </div>
          )}

        </section>

        {/* SELECTED MARKET */}

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">

          {/* CHART */}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <div className="flex items-center gap-3">

                  <h2 className="text-2xl font-black">
                    {selectedSymbol}
                  </h2>

                  {selectedMarket && (
                    <span
                      className={statusClass(
                        selectedMarket.status
                      )}
                    >
                      {safeText(
                        selectedMarket.status,
                        "WAIT"
                      )}
                    </span>
                  )}

                </div>

                <div className="mt-1 text-xs text-zinc-500">
                  M1 execution chart
                </div>

              </div>

              {selectedMarket && (
                <div className="flex gap-5 text-right">

                  <div>
                    <div className="text-[10px] uppercase text-zinc-500">
                      Bid
                    </div>

                    <div className="font-mono text-sm">
                      {formatPrice(
                        selectedMarket.bid,
                        selectedSymbol
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase text-zinc-500">
                      Ask
                    </div>

                    <div className="font-mono text-sm">
                      {formatPrice(
                        selectedMarket.ask,
                        selectedSymbol
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase text-zinc-500">
                      Spread
                    </div>

                    <div className="font-mono text-sm">
                      {formatNumber(
                        selectedMarket.spread,
                        5
                      )}
                    </div>
                  </div>

                </div>
              )}

            </div>

            {marketError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {marketError}
              </div>
            )}

            <div
              ref={chartContainerRef}
              className="min-h-[430px] overflow-hidden rounded-xl border border-zinc-800"
            />

            {loadingMarket && (
              <div className="mt-3 text-xs text-zinc-500">
                Updating{" "}
                {selectedSymbol}...
              </div>
            )}

          </div>

          {/* ANALYSIS */}

          <div className="space-y-6">

            {/* M15 */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">

              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Higher timeframe
                </div>

                <h3 className="mt-1 text-xl font-black">
                  M15 Context
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">

                <div>
                  <div className="text-xs text-zinc-500">
                    Direction
                  </div>

                  <div
                    className={`mt-1 font-bold ${directionClass(
                      selectedMarket
                        ?.m15?.direction
                    )}`}
                  >
                    {safeText(
                      selectedMarket
                        ?.m15?.direction
                    ).toUpperCase()}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Structure
                  </div>

                  <div className="mt-1 font-bold">
                    {safeText(
                      selectedMarket
                        ?.m15
                        ?.structure_description
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    EMA20
                  </div>

                  <div className="mt-1 font-mono">
                    {formatPrice(
                      selectedMarket
                        ?.m15?.ema20,
                      selectedSymbol
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    RSI14
                  </div>

                  <div className="mt-1 font-mono">
                    {formatNumber(
                      selectedMarket
                        ?.m15?.rsi14
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Structure confidence
                  </div>

                  <div className="mt-1 font-bold">
                    {formatNumber(
                      selectedMarket
                        ?.m15
                        ?.structure_confidence
                    )}
                    %
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Trend
                  </div>

                  <div className="mt-1 font-bold">
                    {safeText(
                      selectedMarket
                        ?.m15
                        ?.structure_trend
                    )}
                  </div>
                </div>

              </div>

            </div>

            {/* M1 */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">

              <div className="mb-4">

                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Execution timeframe
                </div>

                <h3 className="mt-1 text-xl font-black">
                  M1 Execution
                </h3>

              </div>

              <div className="grid grid-cols-2 gap-4">

                <div>
                  <div className="text-xs text-zinc-500">
                    Direction
                  </div>

                  <div
                    className={`mt-1 font-bold ${directionClass(
                      selectedMarket
                        ?.m1?.direction
                    )}`}
                  >
                    {safeText(
                      selectedMarket
                        ?.m1?.direction
                    ).toUpperCase()}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Structure
                  </div>

                  <div className="mt-1 font-bold">
                    {safeText(
                      selectedMarket
                        ?.m1
                        ?.structure_description
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    EMA20
                  </div>

                  <div className="mt-1 font-mono">
                    {formatPrice(
                      selectedMarket
                        ?.m1?.ema20,
                      selectedSymbol
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    RSI14
                  </div>

                  <div className="mt-1 font-mono">
                    {formatNumber(
                      selectedMarket
                        ?.m1?.rsi14
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Support
                  </div>

                  <div className="mt-1 font-mono">
                    {formatPrice(
                      selectedMarket
                        ?.m1?.support,
                      selectedSymbol
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Resistance
                  </div>

                  <div className="mt-1 font-mono">
                    {formatPrice(
                      selectedMarket
                        ?.m1?.resistance,
                      selectedSymbol
                    )}
                  </div>
                </div>

              </div>

            </div>

            {/* SETUP */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">

              <div className="mb-4 flex items-center justify-between">

                <div>

                  <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Twin Edge decision engine
                  </div>

                  <h3 className="mt-1 text-xl font-black">
                    Setup
                  </h3>

                </div>

                <div className="text-right">

                  <div className="text-2xl font-black">
                    {safeNumber(
                      selectedMarket
                        ?.setup?.score,
                      safeNumber(
                        selectedMarket?.score,
                        0
                      )
                    )}
                    /10
                  </div>

                </div>

              </div>

              <div className="mb-4">

                <span
                  className={statusClass(
                    selectedMarket
                      ?.setup?.status ||
                      selectedMarket?.status
                  )}
                >
                  {safeText(
                    selectedMarket
                      ?.setup?.status ||
                      selectedMarket?.status
                  )}
                </span>

              </div>

              <div className="grid grid-cols-2 gap-4">

                <div>
                  <div className="text-xs text-zinc-500">
                    Direction
                  </div>

                  <div
                    className={`mt-1 font-bold ${directionClass(
                      selectedMarket
                        ?.setup?.direction
                    )}`}
                  >
                    {safeText(
                      selectedMarket
                        ?.setup?.direction
                    ).toUpperCase()}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Location
                  </div>

                  <div className="mt-1 font-bold">
                    {safeText(
                      selectedMarket
                        ?.setup?.location
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Chasing
                  </div>

                  <div className="mt-1 font-bold">
                    {selectedMarket
                      ?.setup?.chasing
                      ? "YES"
                      : "NO"}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-zinc-500">
                    Warnings
                  </div>

                  <div className="mt-1 font-bold">
                    {safeNumber(
                      selectedMarket
                        ?.setup
                        ?.warnings_count,
                      0
                    )}
                  </div>
                </div>

              </div>

              {!!selectedMarket
                ?.setup
                ?.reasons
                ?.length && (
                <div className="mt-5">

                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Reasons
                  </div>

                  <div className="space-y-2">

                    {selectedMarket.setup.reasons.map(
                      (reason, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-sm text-zinc-300"
                        >
                          ✓ {reason}
                        </div>
                      )
                    )}

                  </div>

                </div>
              )}

              {!!selectedMarket
                ?.setup
                ?.warnings
                ?.length && (
                <div className="mt-5">

                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Warnings
                  </div>

                  <div className="space-y-2">

                    {selectedMarket.setup.warnings.map(
                      (warning, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-yellow-500/10 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-200"
                        >
                          ⚠ {warning}
                        </div>
                      )
                    )}

                  </div>

                </div>
              )}

            </div>

            {/* TRADE LEVELS */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">

              <div className="mb-4">

                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Risk framework
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Trade Levels
                </h3>

              </div>

              <div className="grid grid-cols-3 gap-3">

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">

                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Entry
                  </div>

                  <div className="mt-2 font-mono text-sm font-bold">
                    {formatPrice(
                      selectedMarket
                        ?.setup
                        ?.trade_levels
                        ?.entry,
                      selectedSymbol
                    )}
                  </div>

                </div>

                <div className="rounded-xl border border-red-500/10 bg-red-500/5 p-3">

                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Stop Loss
                  </div>

                  <div className="mt-2 font-mono text-sm font-bold text-red-300">
                    {formatPrice(
                      selectedMarket
                        ?.setup
                        ?.trade_levels
                        ?.stop_loss,
                      selectedSymbol
                    )}
                  </div>

                </div>

                <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3">

                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Take Profit
                  </div>

                  <div className="mt-2 font-mono text-sm font-bold text-emerald-300">
                    {formatPrice(
                      selectedMarket
                        ?.setup
                        ?.trade_levels
                        ?.take_profit,
                      selectedSymbol
                    )}
                  </div>

                </div>

              </div>

              <div className="mt-4 flex justify-between text-xs text-zinc-500">

                <span>
                  Risk:{" "}
                  {formatNumber(
                    selectedMarket
                      ?.setup
                      ?.trade_levels
                      ?.risk
                  )}
                </span>

                <span>
                  Reward:{" "}
                  {formatNumber(
                    selectedMarket
                      ?.setup
                      ?.trade_levels
                      ?.reward
                  )}
                </span>

                <span>
                  RR:{" "}
                  {formatNumber(
                    selectedMarket
                      ?.setup
                      ?.trade_levels
                      ?.rr
                  )}
                </span>

              </div>

            </div>

            {/* CANDLESTICK */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">

              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Candlestick confirmation
              </div>

              <div className="mt-2 text-lg font-bold">
                {safeText(
                  selectedMarket
                    ?.m1?.candlestick,
                  "No confirmation"
                )}
              </div>

            </div>

          </div>

        </section>

        {/* FOOTER */}

        <footer className="mt-8 border-t border-zinc-800 pt-5 text-center text-xs text-zinc-600">
          Twin Edge V5 • Analysis engine only • Automatic trading is disabled
        </footer>

      </div>

      <style jsx global>{`
        .status {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 4px 9px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .status.strong {
          color: #4ade80;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .status.possible {
          color: #facc15;
          background: rgba(250, 204, 21, 0.1);
          border: 1px solid rgba(250, 204, 21, 0.2);
        }

        .status.wait {
          color: #a1a1aa;
          background: rgba(161, 161, 170, 0.08);
          border: 1px solid rgba(161, 161, 170, 0.15);
        }

        .status.danger {
          color: #f87171;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.2);
        }

        .bullish {
          color: #4ade80;
        }

        .bearish {
          color: #f87171;
        }

        .neutral {
          color: #a1a1aa;
        }
      `}</style>
    </main>
  );
}
