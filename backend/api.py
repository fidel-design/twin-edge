from flask import Flask, jsonify, request
from flask_cors import CORS
import MetaTrader5 as mt5
from datetime import datetime, timezone
import pandas as pd
import math
import threading


# ============================================================
# APP SETUP
# ============================================================

app = Flask(__name__)
CORS(app)

PORT = 5000

WATCHLIST = [
    "XAUUSD",
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
    "BTCUSD",
]

TIMEFRAME_M1 = mt5.TIMEFRAME_M1
TIMEFRAME_M15 = mt5.TIMEFRAME_M15


# ============================================================
# JOURNAL STORAGE
# ============================================================

journal_trades = []
journal_lock = threading.Lock()
next_trade_id = 1


# ============================================================
# MT5 CONNECTION
# ============================================================

def connect_mt5():
    """
    Connect to the currently installed/open MetaTrader 5 terminal.
    """
    if mt5.initialize():
        return True

    return False


def ensure_mt5():
    """
    Make sure MT5 is connected.
    """
    terminal_info = mt5.terminal_info()

    if terminal_info is not None:
        return True

    return connect_mt5()


# ============================================================
# SYMBOL HELPERS
# ============================================================

def find_symbol(requested_symbol):
    """
    Find a broker symbol even if the broker uses a suffix.
    Example:
        EURUSD
        EURUSDm
        EURUSD.a
    """

    requested_symbol = requested_symbol.upper().strip()

    if not ensure_mt5():
        return None

    # Exact match first
    info = mt5.symbol_info(requested_symbol)

    if info is not None:
        return requested_symbol

    symbols = mt5.symbols_get()

    if symbols is None:
        return None

    # Starts-with match
    for symbol in symbols:
        name = symbol.name.upper()

        if name.startswith(requested_symbol):
            return symbol.name

    # Contains match
    for symbol in symbols:
        name = symbol.name.upper()

        if requested_symbol in name:
            return symbol.name

    return None


# ============================================================
# SAFE NUMBER HELPERS
# ============================================================

def safe_float(value, default=0.0):
    try:
        number = float(value)

        if math.isnan(number) or math.isinf(number):
            return default

        return number

    except (TypeError, ValueError):
        return default


def round_number(value, digits=5):
    return round(safe_float(value), digits)


# ============================================================
# MARKET DATA
# ============================================================

def get_rates(symbol, timeframe, count=200):
    """
    Get OHLC candle data from MT5.
    """

    if not ensure_mt5():
        return None

    broker_symbol = find_symbol(symbol)

    if broker_symbol is None:
        return None

    rates = mt5.copy_rates_from_pos(
        broker_symbol,
        timeframe,
        0,
        count,
    )

    if rates is None or len(rates) == 0:
        return None

    df = pd.DataFrame(rates)

    if df.empty:
        return None

    df["time"] = pd.to_datetime(
        df["time"],
        unit="s",
        utc=True,
    )

    return df


def get_tick(symbol):
    """
    Get current bid/ask.
    """

    if not ensure_mt5():
        return None

    broker_symbol = find_symbol(symbol)

    if broker_symbol is None:
        return None

    tick = mt5.symbol_info_tick(broker_symbol)

    if tick is None:
        return None

    return {
        "bid": safe_float(tick.bid),
        "ask": safe_float(tick.ask),
        "last": safe_float(tick.last),
        "time": int(tick.time),
    }


# ============================================================
# INDICATORS
# ============================================================

def calculate_ema(df, period=20):
    if df is None or df.empty:
        return None

    ema = df["close"].ewm(
        span=period,
        adjust=False,
    ).mean()

    return safe_float(ema.iloc[-1])


def calculate_rsi(df, period=14):
    if df is None or len(df) < period + 1:
        return None

    delta = df["close"].diff()

    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)

    average_gain = gains.ewm(
        alpha=1 / period,
        min_periods=period,
        adjust=False,
    ).mean()

    average_loss = losses.ewm(
        alpha=1 / period,
        min_periods=period,
        adjust=False,
    ).mean()

    if average_loss.iloc[-1] == 0:
        return 100.0

    rs = average_gain.iloc[-1] / average_loss.iloc[-1]

    rsi = 100 - (100 / (1 + rs))

    return safe_float(rsi)


# ============================================================
# SWING / MARKET STRUCTURE
# ============================================================

def find_swing_highs(df, lookback=2):
    highs = []

    if df is None or len(df) < lookback * 2 + 1:
        return highs

    for i in range(
        lookback,
        len(df) - lookback,
    ):
        current = df["high"].iloc[i]

        left = df["high"].iloc[
            i - lookback:i
        ]

        right = df["high"].iloc[
            i + 1:i + lookback + 1
        ]

        if current >= left.max() and current >= right.max():
            highs.append(
                {
                    "index": i,
                    "price": safe_float(current),
                }
            )

    return highs


def find_swing_lows(df, lookback=2):
    lows = []

    if df is None or len(df) < lookback * 2 + 1:
        return lows

    for i in range(
        lookback,
        len(df) - lookback,
    ):
        current = df["low"].iloc[i]

        left = df["low"].iloc[
            i - lookback:i
        ]

        right = df["low"].iloc[
            i + 1:i + lookback + 1
        ]

        if current <= left.min() and current <= right.min():
            lows.append(
                {
                    "index": i,
                    "price": safe_float(current),
                }
            )

    return lows


def detect_market_structure(df):
    """
    Determine HH/HL or LH/LL structure.
    """

    if df is None or len(df) < 20:
        return {
            "direction": "sideways",
            "description": "Not enough data",
            "confidence": 0,
            "highs": [],
            "lows": [],
        }

    highs = find_swing_highs(df)
    lows = find_swing_lows(df)

    recent_highs = highs[-3:]
    recent_lows = lows[-3:]

    if len(recent_highs) < 2 or len(recent_lows) < 2:
        return {
            "direction": "sideways",
            "description": "No clear structure",
            "confidence": 20,
            "highs": recent_highs,
            "lows": recent_lows,
        }

    previous_high = recent_highs[-2]["price"]
    latest_high = recent_highs[-1]["price"]

    previous_low = recent_lows[-2]["price"]
    latest_low = recent_lows[-1]["price"]

    higher_high = latest_high > previous_high
    higher_low = latest_low > previous_low

    lower_high = latest_high < previous_high
    lower_low = latest_low < previous_low

    if higher_high and higher_low:
        return {
            "direction": "bullish",
            "description": "HH + HL",
            "confidence": 90,
            "highs": recent_highs,
            "lows": recent_lows,
        }

    if lower_high and lower_low:
        return {
            "direction": "bearish",
            "description": "LH + LL",
            "confidence": 90,
            "highs": recent_highs,
            "lows": recent_lows,
        }

    return {
        "direction": "sideways",
        "description": "Mixed / sideways",
        "confidence": 30,
        "highs": recent_highs,
        "lows": recent_lows,
    }


# ============================================================
# SUPPORT / RESISTANCE
# ============================================================

def detect_support_resistance(df, lookback=30):
    if df is None or df.empty:
        return {
            "support": None,
            "resistance": None,
        }

    recent = df.tail(lookback)

    support = safe_float(recent["low"].min())
    resistance = safe_float(recent["high"].max())

    return {
        "support": support,
        "resistance": resistance,
    }


# ============================================================
# CANDLESTICK CONFIRMATION
# ============================================================

def detect_candlestick_confirmation(df):
    if df is None or len(df) < 3:
        return {
            "pattern": "none",
            "direction": "neutral",
            "strength": 0,
        }

    candle = df.iloc[-1]
    previous = df.iloc[-2]

    open_price = safe_float(candle["open"])
    close_price = safe_float(candle["close"])
    high = safe_float(candle["high"])
    low = safe_float(candle["low"])

    previous_open = safe_float(previous["open"])
    previous_close = safe_float(previous["close"])

    body = abs(close_price - open_price)

    upper_wick = high - max(
        open_price,
        close_price,
    )

    lower_wick = min(
        open_price,
        close_price,
    ) - low

    candle_range = high - low

    if candle_range <= 0:
        return {
            "pattern": "none",
            "direction": "neutral",
            "strength": 0,
        }

    # Bullish engulfing
    bullish_engulfing = (
        previous_close < previous_open
        and close_price > open_price
        and open_price <= previous_close
        and close_price >= previous_open
    )

    if bullish_engulfing:
        return {
            "pattern": "bullish engulfing",
            "direction": "bullish",
            "strength": 3,
        }

    # Bearish engulfing
    bearish_engulfing = (
        previous_close > previous_open
        and close_price < open_price
        and open_price >= previous_close
        and close_price <= previous_open
    )

    if bearish_engulfing:
        return {
            "pattern": "bearish engulfing",
            "direction": "bearish",
            "strength": 3,
        }

    # Hammer
    if (
        lower_wick >= body * 2
        and upper_wick <= max(body, candle_range * 0.15)
    ):
        return {
            "pattern": "hammer",
            "direction": "bullish",
            "strength": 2,
        }

    # Shooting star
    if (
        upper_wick >= body * 2
        and lower_wick <= max(body, candle_range * 0.15)
    ):
        return {
            "pattern": "shooting star",
            "direction": "bearish",
            "strength": 2,
        }

    # Strong bullish candle
    if (
        close_price > open_price
        and body >= candle_range * 0.65
    ):
        return {
            "pattern": "strong bullish candle",
            "direction": "bullish",
            "strength": 1,
        }

    # Strong bearish candle
    if (
        close_price < open_price
        and body >= candle_range * 0.65
    ):
        return {
            "pattern": "strong bearish candle",
            "direction": "bearish",
            "strength": 1,
        }

    # Doji
    if body <= candle_range * 0.10:
        return {
            "pattern": "doji",
            "direction": "neutral",
            "strength": 0,
        }

    return {
        "pattern": "none",
        "direction": "neutral",
        "strength": 0,
    }


# ============================================================
# TIMEFRAME ANALYSIS
# ============================================================

def analyze_timeframe(symbol, timeframe, label):
    df = get_rates(
        symbol,
        timeframe,
        200,
    )

    if df is None or df.empty:
        return {
            "timeframe": label,
            "available": False,
            "direction": "unknown",
            "structure": "unknown",
            "confidence": 0,
            "ema20": None,
            "rsi14": None,
            "support": None,
            "resistance": None,
            "candlestick": {
                "pattern": "none",
                "direction": "neutral",
                "strength": 0,
            },
            "description": "Market data unavailable",
        }

    ema20 = calculate_ema(df, 20)
    rsi14 = calculate_rsi(df, 14)

    structure = detect_market_structure(df)

    levels = detect_support_resistance(
        df,
        30,
    )

    candlestick = detect_candlestick_confirmation(df)

    current_price = safe_float(
        df["close"].iloc[-1]
    )

    if ema20 is None:
        ema_direction = "unknown"
    elif current_price > ema20:
        ema_direction = "bullish"
    elif current_price < ema20:
        ema_direction = "bearish"
    else:
        ema_direction = "neutral"

    direction = structure["direction"]

    if direction == "sideways":
        direction = ema_direction

    return {
        "timeframe": label,
        "available": True,
        "direction": direction,
        "structure": structure["direction"],
        "structure_description": structure["description"],
        "confidence": structure["confidence"],
        "ema20": round_number(ema20, 6),
        "ema_direction": ema_direction,
        "rsi14": round_number(rsi14, 2),
        "support": round_number(
            levels["support"],
            6,
        ),
        "resistance": round_number(
            levels["resistance"],
            6,
        ),
        "candlestick": candlestick,
        "description": structure["description"],
    }


# ============================================================
# CANDLE DATA FOR FRONTEND CHART
# ============================================================

def rates_to_candles(symbol, timeframe, count=150):
    df = get_rates(
        symbol,
        timeframe,
        count,
    )

    if df is None or df.empty:
        return []

    candles = []

    for _, row in df.iterrows():
        candles.append(
            {
                "time": int(
                    row["time"].timestamp()
                ),
                "open": safe_float(row["open"]),
                "high": safe_float(row["high"]),
                "low": safe_float(row["low"]),
                "close": safe_float(row["close"]),
            }
        )

    return candles


def calculate_ema_series(df, period=20):
    if df is None or df.empty:
        return []

    ema = df["close"].ewm(
        span=period,
        adjust=False,
    ).mean()

    result = []

    for index, value in enumerate(ema):
        result.append(
            {
                "time": int(
                    df["time"].iloc[index].timestamp()
                ),
                "value": safe_float(value),
            }
        )

    return result


# ============================================================
# TRADE LEVELS
# ============================================================

def calculate_trade_levels(
    symbol,
    direction,
    price,
    support,
    resistance,
):
    if price is None:
        return {
            "available": False,
            "entry": None,
            "stop_loss": None,
            "take_profit": None,
            "risk_distance": None,
            "reward_distance": None,
            "risk_reward": "1:2",
        }

    price = safe_float(price)
    support = safe_float(support)
    resistance = safe_float(resistance)

    if price <= 0:
        return {
            "available": False,
            "entry": None,
            "stop_loss": None,
            "take_profit": None,
            "risk_distance": None,
            "reward_distance": None,
            "risk_reward": "1:2",
        }

    buffer = max(
        price * 0.0003,
        0.50 if symbol.upper() == "XAUUSD" else price * 0.0001,
    )

    if direction == "bullish":
        entry = price

        if support > 0 and support < entry:
            stop_loss = support - buffer
        else:
            stop_loss = entry - buffer

        risk_distance = entry - stop_loss

        if risk_distance <= 0:
            return {
                "available": False,
                "entry": entry,
                "stop_loss": None,
                "take_profit": None,
                "risk_distance": None,
                "reward_distance": None,
                "risk_reward": "1:2",
            }

        take_profit = entry + (
            risk_distance * 2
        )

    elif direction == "bearish":
        entry = price

        if resistance > entry:
            stop_loss = resistance + buffer
        else:
            stop_loss = entry + buffer

        risk_distance = stop_loss - entry

        if risk_distance <= 0:
            return {
                "available": False,
                "entry": entry,
                "stop_loss": None,
                "take_profit": None,
                "risk_distance": None,
                "reward_distance": None,
                "risk_reward": "1:2",
            }

        take_profit = entry - (
            risk_distance * 2
        )

    else:
        return {
            "available": False,
            "entry": price,
            "stop_loss": None,
            "take_profit": None,
            "risk_distance": None,
            "reward_distance": None,
            "risk_reward": "1:2",
        }

    return {
        "available": True,
        "entry": round_number(entry, 6),
        "stop_loss": round_number(stop_loss, 6),
        "take_profit": round_number(take_profit, 6),
        "risk_distance": round_number(
            risk_distance,
            6,
        ),
        "reward_distance": round_number(
            risk_distance * 2,
            6,
        ),
        "risk_reward": "1:2",
    }


# ============================================================
# SETUP ANALYSIS
# ============================================================

def calculate_setup(
    symbol,
    m15,
    m1,
    current_price,
):
    score = 0
    max_score = 10

    reasons = []
    warnings = []

    if not m15.get("available") or not m1.get("available"):
        return {
            "direction": "unknown",
            "status": "NO TRADE",
            "score": 0,
            "max_score": max_score,
            "reasons": [],
            "warnings": [
                "Market data unavailable",
            ],
            "location": "unknown",
            "chasing": False,
        }

    m15_direction = m15.get(
        "direction",
        "sideways",
    )

    m1_direction = m1.get(
        "direction",
        "sideways",
    )

    direction = m15_direction

    # --------------------------------------------------------
    # 1. Higher timeframe direction
    # --------------------------------------------------------

    if m15_direction in (
        "bullish",
        "bearish",
    ):
        score += 2

        reasons.append(
            f"M15 direction is {m15_direction}"
        )
    else:
        warnings.append(
            "M15 structure is sideways"
        )

    # --------------------------------------------------------
    # 2. M1 alignment
    # --------------------------------------------------------

    if (
        m1_direction == m15_direction
        and m15_direction in (
            "bullish",
            "bearish",
        )
    ):
        score += 2

        reasons.append(
            "M1 aligns with M15 direction"
        )
    else:
        warnings.append(
            "M1 does not clearly align with M15"
        )

    # --------------------------------------------------------
    # 3. EMA agreement
    # --------------------------------------------------------

    if (
        m15.get("ema_direction")
        == m15_direction
        and m15_direction in (
            "bullish",
            "bearish",
        )
    ):
        score += 1

        reasons.append(
            "M15 EMA20 agrees with direction"
        )
    else:
        warnings.append(
            "M15 EMA20 is not fully aligned"
        )

    if (
        m1.get("ema_direction")
        == m1_direction
        and m1_direction in (
            "bullish",
            "bearish",
        )
    ):
        score += 1

        reasons.append(
            "M1 EMA20 agrees with direction"
        )

    # --------------------------------------------------------
    # 4. RSI
    # --------------------------------------------------------

    rsi = safe_float(
        m1.get("rsi14"),
        50,
    )

    if m15_direction == "bullish":
        if 40 <= rsi <= 65:
            score += 1
            reasons.append(
                "M1 RSI is in a healthy bullish zone"
            )
        elif rsi > 70:
            warnings.append(
                "M1 RSI is overbought"
            )
        elif rsi < 30:
            warnings.append(
                "M1 RSI is oversold"
            )

    elif m15_direction == "bearish":
        if 35 <= rsi <= 60:
            score += 1
            reasons.append(
                "M1 RSI is in a healthy bearish zone"
            )
        elif rsi < 30:
            warnings.append(
                "M1 RSI is oversold"
            )
        elif rsi > 70:
            warnings.append(
                "M1 RSI is overbought"
            )

    # --------------------------------------------------------
    # 5. Location
    # --------------------------------------------------------

    support = safe_float(
        m1.get("support")
    )

    resistance = safe_float(
        m1.get("resistance")
    )

    location = "middle"

    if support > 0 and resistance > support:
        range_size = resistance - support

        if range_size > 0:
            position = (
                current_price - support
            ) / range_size

            if position <= 0.30:
                location = "near support"

            elif position >= 0.70:
                location = "near resistance"

            else:
                location = "middle"

    if m15_direction == "bullish":
        if location == "near support":
            score += 2
            reasons.append(
                "Price is near support"
            )
        elif location == "middle":
            warnings.append(
                "Price is in the middle of the range"
            )
        elif location == "near resistance":
            warnings.append(
                "Price is near resistance"
            )

    elif m15_direction == "bearish":
        if location == "near resistance":
            score += 2
            reasons.append(
                "Price is near resistance"
            )
        elif location == "middle":
            warnings.append(
                "Price is in the middle of the range"
            )
        elif location == "near support":
            warnings.append(
                "Price is near support"
            )

    # --------------------------------------------------------
    # 6. Candlestick confirmation
    # --------------------------------------------------------

    candle = m1.get(
        "candlestick",
        {},
    )

    candle_direction = candle.get(
        "direction",
        "neutral",
    )

    if candle_direction == m15_direction:
        score += 1

        reasons.append(
            f"Candlestick confirmation: "
            f"{candle.get('pattern', 'none')}"
        )
    elif candle_direction != "neutral":
        warnings.append(
            "Candlestick does not confirm direction"
        )
    else:
        warnings.append(
            "No strong candlestick confirmation"
        )

    # --------------------------------------------------------
    # Chasing
    # --------------------------------------------------------

    chasing = False

    if m15_direction == "bullish":
        if resistance > 0:
            distance_to_resistance = (
                resistance - current_price
            )

            if distance_to_resistance <= (
                current_price * 0.0005
            ):
                chasing = True
                warnings.append(
                    "Price is close to resistance — "
                    "avoid chasing"
                )

    elif m15_direction == "bearish":
        if support > 0:
            distance_to_support = (
                current_price - support
            )

            if distance_to_support <= (
                current_price * 0.0005
            ):
                chasing = True
                warnings.append(
                    "Price is close to support — "
                    "avoid chasing"
                )

    # --------------------------------------------------------
    # Status
    # --------------------------------------------------------

    if direction not in (
        "bullish",
        "bearish",
    ):
        status = "NO TRADE"

    elif chasing:
        status = "WAIT"

    elif score >= 8:
        status = "STRONG SETUP"

    elif score >= 6:
        status = "POSSIBLE SETUP"

    else:
        status = "WAIT"

    return {
        "direction": direction,
        "status": status,
        "score": score,
        "max_score": max_score,
        "reasons": reasons,
        "warnings": warnings,
        "location": location,
        "chasing": chasing,
    }


# ============================================================
# COMPLETE MARKET ANALYSIS
# ============================================================

def build_market_analysis(symbol):
    requested_symbol = symbol.upper().strip()

    broker_symbol = find_symbol(
        requested_symbol
    )

    if broker_symbol is None:
        return {
            "symbol": requested_symbol,
            "requested_symbol": requested_symbol,
            "available": False,
            "status": "UNAVAILABLE",
            "error": "Symbol not available in MT5",
        }

    tick = get_tick(
        broker_symbol
    )

    if tick is None:
        return {
            "symbol": requested_symbol,
            "requested_symbol": requested_symbol,
            "broker_symbol": broker_symbol,
            "available": False,
            "status": "UNAVAILABLE",
            "error": "Unable to read market price",
        }

    bid = safe_float(tick["bid"])
    ask = safe_float(tick["ask"])

    if ask > 0 and bid > 0:
        spread = ask - bid
    else:
        spread = 0

    current_price = (
        (bid + ask) / 2
        if bid > 0 and ask > 0
        else bid or ask
    )

    m15 = analyze_timeframe(
        requested_symbol,
        TIMEFRAME_M15,
        "M15",
    )

    m1 = analyze_timeframe(
        requested_symbol,
        TIMEFRAME_M1,
        "M1",
    )

    setup = calculate_setup(
        requested_symbol,
        m15,
        m1,
        current_price,
    )

    levels = calculate_trade_levels(
        requested_symbol,
        setup["direction"],
        current_price,
        m1.get("support"),
        m1.get("resistance"),
    )

    candles = rates_to_candles(
        requested_symbol,
        TIMEFRAME_M1,
        150,
    )

    df_m1 = get_rates(
        requested_symbol,
        TIMEFRAME_M1,
        150,
    )

    ema_series = calculate_ema_series(
        df_m1,
        20,
    )

    return {
        "symbol": requested_symbol,
        "requested_symbol": requested_symbol,
        "broker_symbol": broker_symbol,
        "available": True,

        "bid": round_number(bid, 6),
        "ask": round_number(ask, 6),
        "spread": round_number(spread, 6),
        "price": round_number(current_price, 6),

        "direction": setup["direction"],
        "status": setup["status"],
        "score": setup["score"],
        "max_score": setup["max_score"],

        "m15": m15,
        "m1": m1,

        "setup": setup,

        "trade_levels": levels,

        "chart": {
            "timeframe": "M1",
            "candles": candles,
            "ema20": ema_series,
        },

        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ============================================================
# SCANNER
# ============================================================

def build_scanner():
    markets = []

    for symbol in WATCHLIST:
        try:
            analysis = build_market_analysis(
                symbol
            )

            if analysis.get("available"):
                markets.append(
                    {
                        "symbol": symbol,
                        "available": True,
                        "bid": analysis.get("bid"),
                        "ask": analysis.get("ask"),
                        "spread": analysis.get("spread"),
                        "price": analysis.get("price"),
                        "direction": analysis.get(
                            "direction"
                        ),
                        "status": analysis.get(
                            "status"
                        ),
                        "score": analysis.get(
                            "score",
                            0,
                        ),
                        "max_score": analysis.get(
                            "max_score",
                            10,
                        ),
                        "m15_direction": analysis.get(
                            "m15",
                            {}
                        ).get(
                            "direction",
                            "unknown",
                        ),
                        "m1_direction": analysis.get(
                            "m1",
                            {}
                        ).get(
                            "direction",
                            "unknown",
                        ),
                    }
                )

            else:
                markets.append(
                    {
                        "symbol": symbol,
                        "available": False,
                        "bid": None,
                        "ask": None,
                        "spread": None,
                        "price": None,
                        "direction": "unknown",
                        "status": "UNAVAILABLE",
                        "score": 0,
                        "max_score": 10,
                        "m15_direction": "unknown",
                        "m1_direction": "unknown",
                    }
                )

        except Exception as error:
            print(
                f"Scanner error for {symbol}: {error}"
            )

            markets.append(
                {
                    "symbol": symbol,
                    "available": False,
                    "bid": None,
                    "ask": None,
                    "spread": None,
                    "price": None,
                    "direction": "unknown",
                    "status": "UNAVAILABLE",
                    "score": 0,
                    "max_score": 10,
                    "m15_direction": "unknown",
                    "m1_direction": "unknown",
                }
            )

    available_markets = sum(
        1
        for market in markets
        if market.get("available")
    )

    return {
        "watchlist": WATCHLIST,
        "total_markets": len(WATCHLIST),
        "available_markets": available_markets,
        "markets": markets,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ============================================================
# ALERTS
# ============================================================

def build_alerts():
    scanner = build_scanner()

    alerts = []

    for market in scanner["markets"]:

        status = market.get(
            "status"
        )

        if status in (
            "STRONG SETUP",
            "POSSIBLE SETUP",
        ):
            alerts.append(
                {
                    "symbol": market.get(
                        "symbol"
                    ),
                    "status": status,
                    "direction": market.get(
                        "direction"
                    ),
                    "score": market.get(
                        "score",
                        0,
                    ),
                    "max_score": market.get(
                        "max_score",
                        10,
                    ),
                }
            )

    return {
        "alerts": alerts,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ============================================================
# JOURNAL
# ============================================================

def calculate_journal_stats():
    with journal_lock:
        trades = list(journal_trades)

    total_trades = len(trades)

    completed = [
        trade
        for trade in trades
        if trade.get("result") in (
            "win",
            "loss",
            "breakeven",
        )
    ]

    wins = sum(
        1
        for trade in completed
        if trade.get("result") == "win"
    )

    losses = sum(
        1
        for trade in completed
        if trade.get("result") == "loss"
    )

    breakeven = sum(
        1
        for trade in completed
        if trade.get("result") == "breakeven"
    )

    pnl_values = [
        safe_float(trade.get("pnl"))
        for trade in completed
    ]

    total_pnl = sum(pnl_values)

    average_pnl = (
        total_pnl / len(pnl_values)
        if pnl_values
        else 0
    )

    win_rate = (
        (wins / len(completed)) * 100
        if completed
        else 0
    )

    return {
        "total_trades": total_trades,
        "completed_trades": len(completed),
        "wins": wins,
        "losses": losses,
        "breakeven": breakeven,
        "win_rate": round(win_rate, 2),
        "total_pnl": round(
            total_pnl,
            2,
        ),
        "average_pnl": round(
            average_pnl,
            2,
        ),
    }


# ============================================================
# ROUTES
# ============================================================

@app.route("/api/health", methods=["GET"])
def health():
    connected = ensure_mt5()

    return jsonify(
        {
            "status": "online",
            "mt5_connected": connected,
            "automatic_trading": False,
        }
    )


@app.route("/api/account", methods=["GET"])
def account():
    if not ensure_mt5():
        return jsonify(
            {
                "error": "MT5 is not connected"
            }
        ), 503

    account_info = mt5.account_info()

    if account_info is None:
        return jsonify(
            {
                "error": "Unable to read account"
            }
        ), 503

    return jsonify(
        {
            "login": account_info.login,
            "server": account_info.server,
            "currency": account_info.currency,
            "balance": safe_float(
                account_info.balance
            ),
            "equity": safe_float(
                account_info.equity
            ),
            "profit": safe_float(
                account_info.profit
            ),
            "trade_allowed": bool(
                account_info.trade_allowed
            ),
        }
    )


@app.route("/api/symbols", methods=["GET"])
def symbols():
    if not ensure_mt5():
        return jsonify(
            {
                "symbols": [],
                "error": "MT5 not connected",
            }
        ), 503

    result = []

    for requested in WATCHLIST:
        broker_symbol = find_symbol(
            requested
        )

        result.append(
            {
                "requested_symbol": requested,
                "broker_symbol": broker_symbol,
                "available": broker_symbol is not None,
            }
        )

    return jsonify(
        {
            "symbols": result
        }
    )


@app.route("/api/market/<symbol>", methods=["GET"])
def market(symbol):
    try:
        result = build_market_analysis(
            symbol
        )

        if not result.get("available"):
            return jsonify(result), 404

        return jsonify(result)

    except Exception as error:
        print(
            f"Market analysis error: {error}"
        )

        return jsonify(
            {
                "error": str(error),
                "symbol": symbol.upper(),
            }
        ), 500


@app.route("/api/market/xauusd", methods=["GET"])
def market_xauusd():
    return market("XAUUSD")


@app.route("/api/scanner", methods=["GET"])
def scanner():
    try:
        return jsonify(
            build_scanner()
        )

    except Exception as error:
        print(
            f"Scanner error: {error}"
        )

        return jsonify(
            {
                "error": str(error),
                "watchlist": WATCHLIST,
                "total_markets": len(
                    WATCHLIST
                ),
                "available_markets": 0,
                "markets": [],
            }
        ), 500


@app.route("/api/alerts", methods=["GET"])
def alerts():
    try:
        return jsonify(
            build_alerts()
        )

    except Exception as error:
        print(
            f"Alerts error: {error}"
        )

        return jsonify(
            {
                "alerts": [],
                "error": str(error),
            }
        ), 500


@app.route("/api/journal", methods=["GET"])
def get_journal():
    with journal_lock:
        trades = list(journal_trades)

    return jsonify(
        {
            "stats": calculate_journal_stats(),
            "trades": trades,
        }
    )


@app.route("/api/journal", methods=["POST"])
def add_journal_trade():
    global next_trade_id

    data = request.get_json(
        silent=True
    )

    if not data:
        return jsonify(
            {
                "error": "Request body is required"
            }
        ), 400

    symbol = str(
        data.get("symbol", "")
    ).upper().strip()

    if not symbol:
        return jsonify(
            {
                "error": "Symbol is required"
            }
        ), 400

    direction = str(
        data.get(
            "direction",
            "unknown",
        )
    ).lower()

    result = str(
        data.get(
            "result",
            "open",
        )
    ).lower()

    allowed_results = {
        "open",
        "win",
        "loss",
        "breakeven",
    }

    if result not in allowed_results:
        return jsonify(
            {
                "error": (
                    "Result must be open, "
                    "win, loss, or breakeven"
                )
            }
        ), 400

    trade = {
        "id": next_trade_id,
        "symbol": symbol,
        "direction": direction,
        "entry": safe_float(
            data.get("entry")
        ),
        "stop_loss": safe_float(
            data.get("stop_loss")
        ),
        "take_profit": safe_float(
            data.get("take_profit")
        ),
        "exit_price": safe_float(
            data.get("exit_price")
        ),
        "risk_percent": safe_float(
            data.get("risk_percent")
        ),
        "pnl": safe_float(
            data.get("pnl")
        ),
        "result": result,
        "notes": str(
            data.get(
                "notes",
                "",
            )
        ),
        "created_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }

    with journal_lock:
        journal_trades.append(
            trade
        )
        next_trade_id += 1

    return jsonify(
        {
            "message": "Trade added to journal",
            "trade": trade,
            "stats": calculate_journal_stats(),
        }
    ), 201


@app.route("/api/journal/<int:trade_id>", methods=["DELETE"])
def delete_journal_trade(trade_id):
    with journal_lock:
        for index, trade in enumerate(
            journal_trades
        ):
            if trade.get("id") == trade_id:
                deleted = journal_trades.pop(
                    index
                )

                return jsonify(
                    {
                        "message": "Trade deleted",
                        "trade": deleted,
                        "stats": calculate_journal_stats(),
                    }
                )

    return jsonify(
        {
            "error": "Trade not found"
        }
    ), 404


# ============================================================
# ERROR HANDLER
# ============================================================

@app.errorhandler(Exception)
def handle_exception(error):
    print(
        f"Unhandled server error: {error}"
    )

    return jsonify(
        {
            "error": str(error)
        }
    ), 500


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print("=" * 60)
    print("TWIN EDGE BACKEND")
    print("=" * 60)

    if connect_mt5():
        print("MT5: CONNECTED")

        terminal = mt5.terminal_info()

        if terminal is not None:
            print(
                f"Terminal: {terminal.name}"
            )

        account_info = mt5.account_info()

        if account_info is not None:
            print(
                f"Account: {account_info.login}"
            )
            print(
                f"Server: {account_info.server}"
            )
            print(
                f"Balance: {account_info.balance}"
            )

    else:
        print("MT5: NOT CONNECTED")
        print(
            "Make sure MetaTrader 5 is open."
        )

    print(
        f"Watchlist: {len(WATCHLIST)} markets"
    )

    print(
        "Automatic trading: DISABLED"
    )

    print(
        f"Server: http://localhost:{PORT}"
    )

    print("=" * 60)

    app.run(
        host="0.0.0.0",
        port=PORT,
        debug=False,
        use_reloader=False,
    )