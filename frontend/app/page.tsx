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
  available: boolean;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  risk_distance: number | null;
  reward_distance: number | null;
  risk_reward: string;
};

type Candlestick = {
  pattern: string;
  direction: string;
  strength: number;
};

type Analysis = {
  available: boolean;
  timeframe: string;
  direction: string;
  structure: string;
  structure_description?: string;
  confidence: number;
  ema20: number | null;
  ema_direction?: string;
  rsi14: number | null;
  support: number | null;
  resistance: number | null;
  candlestick: Candlestick;
  description?: string;
};

type Setup = {
  direction: string;
  status: string;
  score: number;
  max_score: number;
  reasons: string[];
  warnings: string[];
  location: string;
  chasing: boolean;
};

type Market = {
  symbol: string;
  available: boolean;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  price: number | null;
  direction: string;
  status: string;
  score: number;
  max_score: number;
  m15_direction?: string;
  m1_direction?: string;
};

type MarketDetail = {
  symbol: string;
  requested_symbol: string;
  broker_symbol?: string;
  available: boolean;
  bid: number;
  ask: number;
  spread: number;
  price: number;
  direction: string;
  status: string;
  score: number;
  max_score: number;
  m15: Analysis;
  m1: Analysis;
  setup: Setup;
  trade_levels: TradeLevels;
  chart: {
    timeframe: string;
    candles: Candle[];
    ema20: {
      time: number;
      value: number;
    }[];
  };
  updated_at?: string;
};

type ScannerResponse = {
  watchlist: string[];
  total_markets: number;
  available_markets: number;
  markets: Market[];
  updated_at?: string;
};

type AlertsResponse = {
  alerts: {
    symbol: string;
    status: string;
    direction: string;
    score: number;
    max_score: number;
  }[];
};

type JournalTrade = {
  id: number;
  symbol: string;
  direction: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  exit_price: number;
  risk_percent: number;
  pnl: number;
  result: string;
  notes: string;
  created_at: string;
};

type JournalStats = {
  total_trades: number;
  completed_trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;
  total_pnl: number;
  average_pnl: number;
};

type JournalResponse = {
  stats: JournalStats;
  trades: JournalTrade[];
};

function safeNumber(
  value: number | null | undefined,
  fallback = 0
) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function formatPrice(
  value: number | null | undefined,
  decimals = 5
) {
  if (value === null || value === undefined) return "—";

  return safeNumber(value).toFixed(decimals);
}

function formatNumber(
  value: number | null | undefined,
  decimals = 2
) {
  if (value === null || value === undefined) return "—";

  return safeNumber(value).toFixed(decimals);
}

function safeText(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function statusClass(status: string) {
  switch (status) {
    case "STRONG SETUP":
      return "status strong";

    case "POSSIBLE SETUP":
      return "status possible";

    case "WAIT":
      return "status wait";

    case "NO TRADE":
      return "status no-trade";

    case "UNAVAILABLE":
      return "status unavailable";

    default:
      return "status";
  }
}

function directionClass(direction: string) {
  if (direction === "bullish") return "bullish";
  if (direction === "bearish") return "bearish";

  return "neutral";
}

function resultClass(result: string) {
  if (result === "win") return "result win";
  if (result === "loss") return "result loss";
  if (result === "breakeven") return "result breakeven";

  return "result open";
}

export default function Home() {
  const [scanner, setScanner] = useState<ScannerResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("XAUUSD");
  const [selectedMarket, setSelectedMarket] =
    useState<MarketDetail | null>(null);

  const [alerts, setAlerts] = useState<AlertsResponse>({
    alerts: [],
  });

  const [journal, setJournal] = useState<JournalResponse>({
    stats: {
      total_trades: 0,
      completed_trades: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      win_rate: 0,
      total_pnl: 0,
      average_pnl: 0,
    },
    trades: [],
  });

  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(false);
  const [journalLoading, setJournalLoading] = useState(false);

  const [scannerError, setScannerError] = useState("");
  const [marketError, setMarketError] = useState("");
  const [journalError, setJournalError] = useState("");

  const [lastRefresh, setLastRefresh] = useState("");

  const [journalForm, setJournalForm] = useState({
    symbol: "XAUUSD",
    direction: "bullish",
    entry: "",
    stop_loss: "",
    take_profit: "",
    exit_price: "",
    risk_percent: "2",
    pnl: "",
    result: "open",
    notes: "",
  });

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);

  const previousStrongSetups = useRef<Set<string>>(new Set());

  // ============================================================
  // SCANNER
  // ============================================================

  async function fetchScanner() {
    try {
      const response = await fetch(
        `${API}/api/scanner`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Scanner request failed: ${response.status}`
        );
      }

      const data: ScannerResponse = await response.json();

      // IMPORTANT:
      // Never replace a working scanner with an empty response.
      if (
        Array.isArray(data.markets) &&
        data.markets.length > 0
      ) {
        setScanner(data);
        setScannerError("");
        setLastRefresh(
          new Date().toLocaleTimeString()
        );
      }
    } catch (error) {
      console.error("Scanner error:", error);

      setScannerError(
        "Scanner refresh failed. Keeping the last working data."
      );
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // SELECTED MARKET
  // ============================================================

  async function fetchSelectedMarket(
    symbol = selectedSymbol
  ) {
    try {
      setMarketLoading(true);
      setMarketError("");

      const response = await fetch(
        `${API}/api/market/${symbol}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Market request failed: ${response.status}`
        );
      }

      const data: MarketDetail =
        await response.json();

      setSelectedMarket(data);
    } catch (error) {
      console.error(
        "Selected market error:",
        error
      );

      setMarketError(
        "Could not load this market."
      );
    } finally {
      setMarketLoading(false);
    }
  }

  // ============================================================
  // ALERTS
  // ============================================================

  async function fetchAlerts() {
    try {
      const response = await fetch(
        `${API}/api/alerts`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) return;

      const data: AlertsResponse =
        await response.json();

      if (Array.isArray(data.alerts)) {
        setAlerts(data);
      }
    } catch (error) {
      console.error(
        "Alerts error:",
        error
      );
    }
  }

  // ============================================================
  // JOURNAL
  // ============================================================

  async function fetchJournal() {
    try {
      setJournalError("");

      const response = await fetch(
        `${API}/api/journal`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Journal request failed: ${response.status}`
        );
      }

      const data: JournalResponse =
        await response.json();

      if (
        data &&
        data.stats &&
        Array.isArray(data.trades)
      ) {
        setJournal(data);
      }
    } catch (error) {
      console.error(
        "Journal error:",
        error
      );

      setJournalError(
        "Journal could not be loaded."
      );
    }
  }

  async function submitJournalTrade(
    event: React.FormEvent
  ) {
    event.preventDefault();

    try {
      setJournalLoading(true);
      setJournalError("");

      const payload = {
        symbol: journalForm.symbol,
        direction: journalForm.direction,
        entry: Number(
          journalForm.entry || 0
        ),
        stop_loss: Number(
          journalForm.stop_loss || 0
        ),
        take_profit: Number(
          journalForm.take_profit || 0
        ),
        exit_price: Number(
          journalForm.exit_price || 0
        ),
        risk_percent: Number(
          journalForm.risk_percent || 0
        ),
        pnl: Number(
          journalForm.pnl || 0
        ),
        result: journalForm.result,
        notes: journalForm.notes,
      };

      const response = await fetch(
        `${API}/api/journal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Failed to add journal trade"
        );
      }

      setJournalForm({
        symbol: selectedSymbol,
        direction:
          selectedMarket?.direction ===
          "bearish"
            ? "bearish"
            : "bullish",
        entry: "",
        stop_loss: "",
        take_profit: "",
        exit_price: "",
        risk_percent: "2",
        pnl: "",
        result: "open",
        notes: "",
      });

      await fetchJournal();
    } catch (error) {
      console.error(
        "Journal submit error:",
        error
      );

      setJournalError(
        error instanceof Error
          ? error.message
          : "Failed to save trade."
      );
    } finally {
      setJournalLoading(false);
    }
  }

  async function deleteJournalTrade(
    tradeId: number
  ) {
    try {
      setJournalError("");

      const response = await fetch(
        `${API}/api/journal/${tradeId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to delete trade"
        );
      }

      await fetchJournal();
    } catch (error) {
      console.error(
        "Delete journal error:",
        error
      );

      setJournalError(
        "Could not delete that trade."
      );
    }
  }

  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    fetchScanner();
    fetchSelectedMarket("XAUUSD");
    fetchAlerts();
    fetchJournal();

    const scannerInterval =
      setInterval(
        fetchScanner,
        10000
      );

    const marketInterval =
      setInterval(
        () =>
          fetchSelectedMarket(
            selectedSymbol
          ),
        10000
      );

    const alertsInterval =
      setInterval(
        fetchAlerts,
        10000
      );

    const journalInterval =
      setInterval(
        fetchJournal,
        30000
      );

    return () => {
      clearInterval(
        scannerInterval
      );

      clearInterval(
        marketInterval
      );

      clearInterval(
        alertsInterval
      );

      clearInterval(
        journalInterval
      );
    };
  }, []);

  // ============================================================
  // ALERT NOTIFICATIONS
  // ============================================================

  useEffect(() => {
    const currentStrong =
      new Set<string>();

    alerts.alerts.forEach(
      (alert) => {
        if (
          alert.status ===
            "STRONG SETUP" ||
          alert.score >= 8
        ) {
          const key =
            `${alert.symbol}-${alert.direction}`;

          currentStrong.add(key);

          if (
            !previousStrongSetups.current.has(
              key
            ) &&
            typeof window !==
              "undefined" &&
            "Notification" in window &&
            Notification.permission ===
              "granted"
          ) {
            new Notification(
              `Twin Edge: ${alert.symbol}`,
              {
                body:
                  `${alert.status} — ` +
                  `${alert.direction} — ` +
                  `${alert.score}/${alert.max_score}`,
              }
            );
          }
        }
      }
    );

    previousStrongSetups.current =
      currentStrong;
  }, [alerts]);

  // ============================================================
  // NOTIFICATION PERMISSION
  // ============================================================

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission ===
        "default"
    ) {
      Notification.requestPermission().catch(
        () => {}
      );
    }
  }, []);

  // ============================================================
  // SCANNER MARKETS
  // ============================================================

  const markets = useMemo(() => {
    const source =
      scanner?.markets || [];

    return WATCHLIST.map(
      (symbol) => {
        const found =
          source.find(
            (market) =>
              market.symbol === symbol
          );

        if (found) return found;

        return {
          symbol,
          available: false,
          bid: null,
          ask: null,
          spread: null,
          price: null,
          direction: "unknown",
          status: "UNAVAILABLE",
          score: 0,
          max_score: 10,
        };
      }
    );
  }, [scanner]);

  const strongSetups =
    markets.filter(
      (market) =>
        market.status ===
        "STRONG SETUP"
    ).length;

  const possibleSetups =
    markets.filter(
      (market) =>
        market.status ===
        "POSSIBLE SETUP"
    ).length;

  const waitingMarkets =
    markets.filter(
      (market) =>
        market.status === "WAIT"
    ).length;

  const noTradeMarkets =
    markets.filter(
      (market) =>
        market.status ===
          "NO TRADE" ||
        market.status ===
          "UNAVAILABLE"
    ).length;

  // ============================================================
  // MARKET SELECTION
  // ============================================================

  async function selectMarket(
    symbol: string
  ) {
    setSelectedSymbol(symbol);

    setJournalForm(
      (previous) => ({
        ...previous,
        symbol,
      })
    );

    await fetchSelectedMarket(
      symbol
    );
  }

  // ============================================================
  // AUTO-FILL JOURNAL FROM SETUP
  // ============================================================

  function useCurrentSetup() {
    if (!selectedMarket) return;

    const levels =
      selectedMarket.trade_levels;

    setJournalForm({
      symbol:
        selectedMarket.symbol,

      direction:
        selectedMarket.direction ===
        "bearish"
          ? "bearish"
          : "bullish",

      entry:
        levels.entry !== null
          ? String(levels.entry)
          : "",

      stop_loss:
        levels.stop_loss !== null
          ? String(
              levels.stop_loss
            )
          : "",

      take_profit:
        levels.take_profit !== null
          ? String(
              levels.take_profit
            )
          : "",

      exit_price: "",

      risk_percent: "2",

      pnl: "",

      result: "open",

      notes:
        `Twin Edge setup — ` +
        `${selectedMarket.status} ` +
        `${selectedMarket.score}/` +
        `${selectedMarket.max_score}`,
    });
  }

  // ============================================================
  // CHART
  // ============================================================

  useEffect(() => {
    if (
      !chartContainerRef.current ||
      !selectedMarket ||
      selectedMarket.chart.candles
        .length === 0
    ) {
      return;
    }

    const container =
      chartContainerRef.current;

    container.innerHTML = "";

    const chart =
      createChart(container, {
        width:
          container.clientWidth,

        height: 430,

        layout: {
          background: {
            type: ColorType.Solid,
            color: "#0b1220",
          },

          textColor: "#cbd5e1",
        },

        grid: {
          vertLines: {
            color: "#182235",
          },

          horzLines: {
            color: "#182235",
          },
        },

        rightPriceScale: {
          borderColor:
            "#263247",
        },

        timeScale: {
          borderColor:
            "#263247",

          timeVisible: true,
          secondsVisible: false,
        },
      });

    chartRef.current =
      chart;

    const candleSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderVisible: false,
          wickUpColor:
            "#22c55e",
          wickDownColor:
            "#ef4444",
        }
      );

    candleSeries.setData(
      selectedMarket.chart.candles
    );

    const emaSeries =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 2,
        }
      );

    emaSeries.setData(
      selectedMarket.chart.ema20
    );

    function addPriceLine(
      price: number | null,
      title: string
    ) {
      if (
        price === null ||
        !Number.isFinite(price)
      ) {
        return;
      }

      candleSeries.createPriceLine(
        {
          price,
          title,
          lineWidth: 1,
          axisLabelVisible: true,
          lineVisible: true,
        }
      );
    }

    addPriceLine(
      selectedMarket.m1.support,
      "Support"
    );

    addPriceLine(
      selectedMarket.m1.resistance,
      "Resistance"
    );

    addPriceLine(
      selectedMarket.trade_levels
        .entry,
      "Entry"
    );

    addPriceLine(
      selectedMarket.trade_levels
        .stop_loss,
      "SL"
    );

    addPriceLine(
      selectedMarket.trade_levels
        .take_profit,
      "TP"
    );

    chart.timeScale().fitContent();

    const resizeObserver =
      new ResizeObserver(() => {
        if (
          chartContainerRef.current
        ) {
          chart.applyOptions({
            width:
              chartContainerRef
                .current
                .clientWidth,
          });
        }
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

  // ============================================================
  // UI
  // ============================================================

  return (
    <main className="page">
      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #050b16;
          color: #e5e7eb;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
        }

        button,
        input,
        select,
        textarea {
          font: inherit;
        }

        .page {
          min-height: 100vh;
          background:
            radial-gradient(
              circle at top right,
              rgba(37, 99, 235, 0.13),
              transparent 35%
            ),
            #050b16;
          padding: 24px;
        }

        .container {
          max-width: 1500px;
          margin: 0 auto;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          margin-bottom: 24px;
        }

        .brand h1 {
          margin: 0;
          font-size: 30px;
          letter-spacing: -1px;
        }

        .brand p {
          margin: 6px 0 0;
          color: #94a3b8;
        }

        .online {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #86efac;
          font-size: 14px;
        }

        .dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow:
            0 0 12px
            rgba(34, 197, 94, 0.7);
        }

        .summary {
          display: grid;
          grid-template-columns:
            repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 20px;
        }

        .summaryCard {
          background: #0b1220;
          border: 1px solid #1e293b;
          border-radius: 14px;
          padding: 18px;
        }

        .summaryCard span {
          display: block;
          color: #94a3b8;
          font-size: 13px;
          margin-bottom: 8px;
        }

        .summaryCard strong {
          font-size: 28px;
        }

        .scanner {
          background: #0b1220;
          border: 1px solid #1e293b;
          border-radius: 16px;
          padding: 18px;
          margin-bottom: 20px;
        }

        .sectionHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 15px;
          margin-bottom: 16px;
        }

        .sectionHeader h2 {
          margin: 0;
          font-size: 19px;
        }

        .refresh {
          color: #64748b;
          font-size: 12px;
        }

        .scannerGrid {
          display: grid;
          grid-template-columns:
            repeat(3, 1fr);
          gap: 12px;
        }

        .marketCard {
          border: 1px solid #1e293b;
          background: #080f1d;
          border-radius: 12px;
          padding: 15px;
          cursor: pointer;
          transition: 0.15s ease;
        }

        .marketCard:hover {
          border-color: #475569;
          transform: translateY(-1px);
        }

        .marketCard.selected {
          border-color: #60a5fa;
          box-shadow:
            0 0 0 1px
            rgba(96, 165, 250, 0.15);
        }

        .marketTop {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .symbol {
          font-weight: 800;
          font-size: 17px;
        }

        .price {
          font-size: 16px;
          font-weight: 700;
        }

        .marketBottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #94a3b8;
          font-size: 12px;
        }

        .direction {
          text-transform: uppercase;
          font-size: 11px;
          font-weight: 800;
        }

        .bullish {
          color: #4ade80;
        }

        .bearish {
          color: #f87171;
        }

        .neutral {
          color: #94a3b8;
        }

        .status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.2px;
          background: #1e293b;
          color: #cbd5e1;
        }

        .status.strong {
          background: rgba(
            34,
            197,
            94,
            0.12
          );
          color: #86efac;
        }

        .status.possible {
          background: rgba(
            59,
            130,
            246,
            0.12
          );
          color: #93c5fd;
        }

        .status.wait {
          background: rgba(
            234,
            179,
            8,
            0.12
          );
          color: #fde047;
        }

        .status.no-trade,
        .status.unavailable {
          background: rgba(
            148,
            163,
            184,
            0.1
          );
          color: #94a3b8;
        }

        .mainGrid {
          display: grid;
          grid-template-columns:
            minmax(0, 2fr)
            minmax(340px, 1fr);
          gap: 20px;
          margin-bottom: 20px;
        }

        .panel {
          background: #0b1220;
          border: 1px solid #1e293b;
          border-radius: 16px;
          padding: 18px;
        }

        .chartPanel {
          min-width: 0;
        }

        .marketTitle {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 15px;
          margin-bottom: 16px;
        }

        .marketTitle h2 {
          margin: 0;
          font-size: 23px;
        }

        .marketTitle p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 12px;
        }

        .chart {
          width: 100%;
          min-height: 430px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #172033;
        }

        .detailGrid {
          display: grid;
          grid-template-columns:
            repeat(2, 1fr);
          gap: 12px;
          margin-top: 15px;
        }

        .detailCard {
          background: #080f1d;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 14px;
        }

        .detailCard h3 {
          margin: 0 0 12px;
          font-size: 14px;
        }

        .detailRow {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 0;
          border-bottom: 1px solid
            rgba(30, 41, 59, 0.65);
          font-size: 12px;
        }

        .detailRow:last-child {
          border-bottom: none;
        }

        .detailRow span:first-child {
          color: #64748b;
        }

        .scoreBox {
          text-align: center;
          padding: 15px;
          background: #080f1d;
          border: 1px solid #1e293b;
          border-radius: 12px;
          margin-bottom: 12px;
        }

        .scoreBox strong {
          display: block;
          font-size: 34px;
        }

        .scoreBox span {
          color: #94a3b8;
          font-size: 12px;
        }

        .list {
          margin: 0;
          padding-left: 18px;
          color: #cbd5e1;
          font-size: 12px;
          line-height: 1.8;
        }

        .warning {
          color: #fbbf24;
        }

        .reason {
          color: #86efac;
        }

        .levels {
          display: grid;
          grid-template-columns:
            repeat(3, 1fr);
          gap: 8px;
          margin-top: 12px;
        }

        .level {
          background: #080f1d;
          border: 1px solid #1e293b;
          border-radius: 10px;
          padding: 10px;
        }

        .level span {
          display: block;
          color: #64748b;
          font-size: 10px;
          margin-bottom: 5px;
        }

        .level strong {
          font-size: 13px;
        }

        .journal {
          background: #0b1220;
          border: 1px solid #1e293b;
          border-radius: 16px;
          padding: 18px;
          margin-bottom: 20px;
        }

        .journalStats {
          display: grid;
          grid-template-columns:
            repeat(5, 1fr);
          gap: 10px;
          margin-bottom: 18px;
        }

        .journalStat {
          background: #080f1d;
          border: 1px solid #1e293b;
          border-radius: 11px;
          padding: 13px;
        }

        .journalStat span {
          display: block;
          color: #64748b;
          font-size: 10px;
          margin-bottom: 5px;
        }

        .journalStat strong {
          font-size: 20px;
        }

        .journalLayout {
          display: grid;
          grid-template-columns:
            360px
            minmax(0, 1fr);
          gap: 18px;
        }

        .form {
          background: #080f1d;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 15px;
        }

        .form h3 {
          margin: 0 0 15px;
          font-size: 15px;
        }

        .formGrid {
          display: grid;
          grid-template-columns:
            repeat(2, 1fr);
          gap: 10px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .field.full {
          grid-column: 1 / -1;
        }

        .field label {
          color: #64748b;
          font-size: 10px;
          text-transform: uppercase;
        }

        .field input,
        .field select,
        .field textarea {
          width: 100%;
          border: 1px solid #263247;
          background: #050b16;
          color: #e5e7eb;
          border-radius: 8px;
          padding: 9px;
          outline: none;
        }

        .field input:focus,
        .field select:focus,
        .field textarea:focus {
          border-color: #60a5fa;
        }

        .field textarea {
          min-height: 75px;
          resize: vertical;
        }

        .formButtons {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }

        .primaryButton,
        .secondaryButton,
        .deleteButton {
          border: none;
          border-radius: 8px;
          padding: 9px 12px;
          cursor: pointer;
          font-weight: 700;
        }

        .primaryButton {
          background: #2563eb;
          color: white;
          flex: 1;
        }

        .secondaryButton {
          background: #1e293b;
          color: #cbd5e1;
        }

        .deleteButton {
          background: rgba(
            239,
            68,
            68,
            0.1
          );
          color: #fca5a5;
          font-size: 11px;
        }

        .primaryButton:hover {
          background: #1d4ed8;
        }

        .secondaryButton:hover {
          background: #334155;
        }

        .trades {
          overflow-x: auto;
        }

        .tradeTable {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        .tradeTable th {
          text-align: left;
          color: #64748b;
          font-weight: 600;
          padding: 9px;
          border-bottom: 1px solid #1e293b;
        }

        .tradeTable td {
          padding: 10px 9px;
          border-bottom: 1px solid
            rgba(30, 41, 59, 0.7);
          white-space: nowrap;
        }

        .result {
          display: inline-block;
          border-radius: 999px;
          padding: 4px 8px;
          font-weight: 800;
          text-transform: uppercase;
          font-size: 9px;
        }

        .result.win {
          color: #86efac;
          background: rgba(
            34,
            197,
            94,
            0.1
          );
        }

        .result.loss {
          color: #fca5a5;
          background: rgba(
            239,
            68,
            68,
            0.1
          );
        }

        .result.breakeven {
          color: #fde68a;
          background: rgba(
            234,
            179,
            8,
            0.1
          );
        }

        .result.open {
          color: #93c5fd;
          background: rgba(
            59,
            130,
            246,
            0.1
          );
        }

        .positive {
          color: #86efac;
        }

        .negative {
          color: #fca5a5;
        }

        .error {
          color: #fca5a5;
          font-size: 12px;
          margin-top: 8px;
        }

        .empty {
          color: #64748b;
          text-align: center;
          padding: 30px;
          font-size: 12px;
        }

        .footer {
          text-align: center;
          color: #475569;
          font-size: 11px;
          padding: 10px;
        }

        @media (max-width: 1100px) {
          .mainGrid {
            grid-template-columns: 1fr;
          }

          .scannerGrid {
            grid-template-columns:
              repeat(2, 1fr);
          }

          .journalLayout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 700px) {
          .page {
            padding: 12px;
          }

          .header {
            align-items: flex-start;
            flex-direction: column;
          }

          .summary {
            grid-template-columns:
              repeat(2, 1fr);
          }

          .scannerGrid {
            grid-template-columns: 1fr;
          }

          .detailGrid {
            grid-template-columns: 1fr;
          }

          .levels {
            grid-template-columns: 1fr;
          }

          .journalStats {
            grid-template-columns:
              repeat(2, 1fr);
          }
        }
      `}</style>

      <div className="container">

        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

        <header className="header">
          <div className="brand">
            <h1>⚡ Twin Edge</h1>

            <p>
              Multi-market analysis &
              trade journal
            </p>
          </div>

          <div className="online">
            <span className="dot" />
            MT5 Analysis Online
          </div>
        </header>

        {/* ================================================== */}
        {/* SUMMARY */}
        {/* ================================================== */}

        <section className="summary">
          <div className="summaryCard">
            <span>
              Strong Setups
            </span>

            <strong>
              {strongSetups}
            </strong>
          </div>

          <div className="summaryCard">
            <span>
              Possible Setups
            </span>

            <strong>
              {possibleSetups}
            </strong>
          </div>

          <div className="summaryCard">
            <span>
              Waiting
            </span>

            <strong>
              {waitingMarkets}
            </strong>
          </div>

          <div className="summaryCard">
            <span>
              No Trade
            </span>

            <strong>
              {noTradeMarkets}
            </strong>
          </div>
        </section>

        {/* ================================================== */}
        {/* SCANNER */}
        {/* ================================================== */}

        <section className="scanner">
          <div className="sectionHeader">
            <h2>
              Market Scanner
            </h2>

            <div className="refresh">
              {loading
                ? "Loading..."
                : `Updated ${lastRefresh}`}
            </div>
          </div>

          {scannerError && (
            <div className="error">
              {scannerError}
            </div>
          )}

          <div className="scannerGrid">
            {markets.map(
              (market) => (
                <div
                  key={market.symbol}
                  className={
                    "marketCard " +
                    (selectedSymbol ===
                    market.symbol
                      ? "selected"
                      : "")
                  }
                  onClick={() =>
                    selectMarket(
                      market.symbol
                    )
                  }
                >
                  <div className="marketTop">
                    <div className="symbol">
                      {market.symbol}
                    </div>

                    <span
                      className={statusClass(
                        market.status
                      )}
                    >
                      {market.status}
                    </span>
                  </div>

                  <div
                    className={
                      "price " +
                      directionClass(
                        market.direction
                      )
                    }
                  >
                    {market.price !==
                    null
                      ? formatPrice(
                          market.price,
                          market.symbol ===
                            "USDJPY"
                            ? 3
                            : 5
                        )
                      : "—"}
                  </div>

                  <div className="marketBottom">
                    <span
                      className={
                        "direction " +
                        directionClass(
                          market.direction
                        )
                      }
                    >
                      {safeText(
                        market.direction
                      )}
                    </span>

                    <span>
                      Score{" "}
                      {market.score}/
                      {market.max_score}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        {/* ================================================== */}
        {/* MAIN MARKET AREA */}
        {/* ================================================== */}

        <section className="mainGrid">

          {/* CHART */}

          <div className="panel chartPanel">

            <div className="marketTitle">
              <div>
                <h2>
                  {selectedSymbol}
                </h2>

                <p>
                  M1 execution chart ·
                  EMA20 · S/R · Trade Levels
                </p>
              </div>

              {selectedMarket && (
                <span
                  className={statusClass(
                    selectedMarket.status
                  )}
                >
                  {selectedMarket.status}
                </span>
              )}
            </div>

            {marketLoading && (
              <div className="empty">
                Loading market...
              </div>
            )}

            {marketError && (
              <div className="error">
                {marketError}
              </div>
            )}

            <div
              ref={chartContainerRef}
              className="chart"
            />

            {selectedMarket && (
              <div className="levels">

                <div className="level">
                  <span>
                    ENTRY
                  </span>

                  <strong>
                    {formatPrice(
                      selectedMarket
                        .trade_levels
                        .entry
                    )}
                  </strong>
                </div>

                <div className="level">
                  <span>
                    STOP LOSS
                  </span>

                  <strong>
                    {formatPrice(
                      selectedMarket
                        .trade_levels
                        .stop_loss
                    )}
                  </strong>
                </div>

                <div className="level">
                  <span>
                    TAKE PROFIT
                  </span>

                  <strong>
                    {formatPrice(
                      selectedMarket
                        .trade_levels
                        .take_profit
                    )}
                  </strong>
                </div>

              </div>
            )}
          </div>

          {/* ANALYSIS */}

          <div className="panel">

            {selectedMarket ? (
              <>
                <div className="scoreBox">
                  <strong>
                    {
                      selectedMarket.score
                    }
                    /
                    {
                      selectedMarket
                        .max_score
                    }
                  </strong>

                  <span>
                    Twin Edge Setup Score
                  </span>
                </div>

                <div className="detailCard">
                  <h3>
                    M15 Context
                  </h3>

                  <div className="detailRow">
                    <span>
                      Direction
                    </span>

                    <strong
                      className={
                        directionClass(
                          selectedMarket
                            .m15
                            .direction
                        )
                      }
                    >
                      {safeText(
                        selectedMarket
                          .m15
                          .direction
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Structure
                    </span>

                    <strong>
                      {safeText(
                        selectedMarket
                          .m15
                          .structure_description ||
                          selectedMarket
                            .m15
                            .structure
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      EMA20
                    </span>

                    <strong>
                      {formatPrice(
                        selectedMarket
                          .m15
                          .ema20,
                        6
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      RSI14
                    </span>

                    <strong>
                      {formatNumber(
                        selectedMarket
                          .m15
                          .rsi14
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Confidence
                    </span>

                    <strong>
                      {
                        selectedMarket
                          .m15
                          .confidence
                      }
                      %
                    </strong>
                  </div>
                </div>

                <div
                  className="detailCard"
                  style={{
                    marginTop: 12,
                  }}
                >
                  <h3>
                    M1 Execution
                  </h3>

                  <div className="detailRow">
                    <span>
                      Direction
                    </span>

                    <strong
                      className={
                        directionClass(
                          selectedMarket
                            .m1
                            .direction
                        )
                      }
                    >
                      {safeText(
                        selectedMarket
                          .m1
                          .direction
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Location
                    </span>

                    <strong>
                      {
                        selectedMarket
                          .setup
                          .location
                      }
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      RSI14
                    </span>

                    <strong>
                      {formatNumber(
                        selectedMarket
                          .m1
                          .rsi14
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Candlestick
                    </span>

                    <strong>
                      {safeText(
                        selectedMarket
                          .m1
                          .candlestick
                          .pattern
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Support
                    </span>

                    <strong>
                      {formatPrice(
                        selectedMarket
                          .m1
                          .support
                      )}
                    </strong>
                  </div>

                  <div className="detailRow">
                    <span>
                      Resistance
                    </span>

                    <strong>
                      {formatPrice(
                        selectedMarket
                          .m1
                          .resistance
                      )}
                    </strong>
                  </div>
                </div>

                <div
                  className="detailCard"
                  style={{
                    marginTop: 12,
                  }}
                >
                  <h3>
                    Setup Reasons
                  </h3>

                  {selectedMarket
                    .setup
                    .reasons
                    .length > 0 ? (
                    <ul className="list">
                      {selectedMarket.setup.reasons.map(
                        (
                          reason,
                          index
                        ) => (
                          <li
                            className="reason"
                            key={
                              index
                            }
                          >
                            {reason}
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <div className="empty">
                      No confirmed reasons.
                    </div>
                  )}
                </div>

                <div
                  className="detailCard"
                  style={{
                    marginTop: 12,
                  }}
                >
                  <h3>
                    Warnings
                  </h3>

                  {selectedMarket
                    .setup
                    .warnings
                    .length > 0 ? (
                    <ul className="list">
                      {selectedMarket.setup.warnings.map(
                        (
                          warning,
                          index
                        ) => (
                          <li
                            className="warning"
                            key={
                              index
                            }
                          >
                            {warning}
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <div className="empty">
                      No major warnings.
                    </div>
                  )}
                </div>

                <button
                  className="primaryButton"
                  style={{
                    marginTop: 12,
                    width: "100%",
                  }}
                  onClick={
                    useCurrentSetup
                  }
                >
                  Use This Setup in Journal
                </button>
              </>
            ) : (
              <div className="empty">
                Select a market.
              </div>
            )}
          </div>
        </section>

        {/* ================================================== */}
        {/* JOURNAL */}
        {/* ================================================== */}

        <section className="journal">

          <div className="sectionHeader">
            <h2>
              📓 Trade Journal
            </h2>

            <div className="refresh">
              Track your setups,
              results and P/L
            </div>
          </div>

          {journalError && (
            <div className="error">
              {journalError}
            </div>
          )}

          {/* JOURNAL STATS */}

          <div className="journalStats">

            <div className="journalStat">
              <span>
                TOTAL TRADES
              </span>

              <strong>
                {
                  journal.stats
                    .total_trades
                }
              </strong>
            </div>

            <div className="journalStat">
              <span>
                WIN RATE
              </span>

              <strong>
                {
                  journal.stats
                    .win_rate
                }
                %
              </strong>
            </div>

            <div className="journalStat">
              <span>
                WINS
              </span>

              <strong className="positive">
                {
                  journal.stats
                    .wins
                }
              </strong>
            </div>

            <div className="journalStat">
              <span>
                LOSSES
              </span>

              <strong className="negative">
                {
                  journal.stats
                    .losses
                }
              </strong>
            </div>

            <div className="journalStat">
              <span>
                TOTAL P/L
              </span>

              <strong
                className={
                  journal.stats
                    .total_pnl >= 0
                    ? "positive"
                    : "negative"
                }
              >
                {journal.stats
                  .total_pnl >= 0
                  ? "+"
                  : ""}
                {formatNumber(
                  journal.stats
                    .total_pnl
                )}
              </strong>
            </div>

          </div>

          <div className="journalLayout">

            {/* FORM */}

            <form
              className="form"
              onSubmit={
                submitJournalTrade
              }
            >
              <h3>
                Add Trade
              </h3>

              <div className="formGrid">

                <div className="field">
                  <label>
                    Symbol
                  </label>

                  <select
                    value={
                      journalForm.symbol
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          symbol:
                            event.target
                              .value,
                        })
                      )
                    }
                  >
                    {WATCHLIST.map(
                      (symbol) => (
                        <option
                          key={symbol}
                          value={symbol}
                        >
                          {symbol}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="field">
                  <label>
                    Direction
                  </label>

                  <select
                    value={
                      journalForm.direction
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          direction:
                            event.target
                              .value,
                        })
                      )
                    }
                  >
                    <option value="bullish">
                      Bullish
                    </option>

                    <option value="bearish">
                      Bearish
                    </option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    Entry
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={
                      journalForm.entry
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          entry:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>
                    Stop Loss
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={
                      journalForm.stop_loss
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          stop_loss:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>
                    Take Profit
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={
                      journalForm.take_profit
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          take_profit:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>
                    Exit Price
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={
                      journalForm.exit_price
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          exit_price:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>
                    Risk %
                  </label>

                  <input
                    type="number"
                    step="0.1"
                    value={
                      journalForm.risk_percent
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          risk_percent:
                            event.target
                              .value,
                        })
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    P/L
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={
                      journalForm.pnl
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          pnl:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>
                    Result
                  </label>

                  <select
                    value={
                      journalForm.result
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          result:
                            event.target
                              .value,
                        })
                      )
                    }
                  >
                    <option value="open">
                      Open
                    </option>

                    <option value="win">
                      Win
                    </option>

                    <option value="loss">
                      Loss
                    </option>

                    <option value="breakeven">
                      Breakeven
                    </option>
                  </select>
                </div>

                <div className="field full">
                  <label>
                    Notes
                  </label>

                  <textarea
                    value={
                      journalForm.notes
                    }
                    onChange={(event) =>
                      setJournalForm(
                        (previous) => ({
                          ...previous,
                          notes:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="Why did you take this trade?"
                  />
                </div>

              </div>

              <div className="formButtons">
                <button
                  type="submit"
                  className="primaryButton"
                  disabled={
                    journalLoading
                  }
                >
                  {journalLoading
                    ? "Saving..."
                    : "Save Trade"}
                </button>

                <button
                  type="button"
                  className="secondaryButton"
                  onClick={
                    useCurrentSetup
                  }
                >
                  Use Setup
                </button>
              </div>
            </form>

            {/* TRADE HISTORY */}

            <div className="trades">

              {journal.trades.length ===
              0 ? (
                <div className="empty">
                  No trades in the journal
                  yet.
                  <br />
                  Add your first setup
                  using the form.
                </div>
              ) : (
                <table className="tradeTable">
                  <thead>
                    <tr>
                      <th>
                        Symbol
                      </th>

                      <th>
                        Direction
                      </th>

                      <th>
                        Entry
                      </th>

                      <th>
                        Exit
                      </th>

                      <th>
                        Result
                      </th>

                      <th>
                        P/L
                      </th>

                      <th>
                        Date
                      </th>

                      <th>
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {journal.trades
                      .slice()
                      .reverse()
                      .map(
                        (trade) => (
                          <tr
                            key={
                              trade.id
                            }
                          >
                            <td>
                              <strong>
                                {
                                  trade.symbol
                                }
                              </strong>
                            </td>

                            <td
                              className={
                                directionClass(
                                  trade.direction
                                )
                              }
                            >
                              {
                                trade.direction
                              }
                            </td>

                            <td>
                              {formatPrice(
                                trade.entry
                              )}
                            </td>

                            <td>
                              {trade.exit_price
                                ? formatPrice(
                                    trade.exit_price
                                  )
                                : "—"}
                            </td>

                            <td>
                              <span
                                className={resultClass(
                                  trade.result
                                )}
                              >
                                {
                                  trade.result
                                }
                              </span>
                            </td>

                            <td
                              className={
                                trade.pnl >=
                                0
                                  ? "positive"
                                  : "negative"
                              }
                            >
                              {trade.pnl >=
                              0
                                ? "+"
                                : ""}
                              {formatNumber(
                                trade.pnl
                              )}
                            </td>

                            <td>
                              {new Date(
                                trade.created_at
                              ).toLocaleDateString()}
                            </td>

                            <td>
                              <button
                                className="deleteButton"
                                onClick={() =>
                                  deleteJournalTrade(
                                    trade.id
                                  )
                                }
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              )}

            </div>
          </div>
        </section>

        <footer className="footer">
          Twin Edge · MT5 analysis only ·
          Automatic trading disabled
        </footer>

      </div>
    </main>
  );
}