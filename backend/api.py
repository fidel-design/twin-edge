from flask import Flask, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5
from datetime import datetime
import pandas as pd
import math


# ============================================================
# TWIN EDGE V5 — MULTI-MARKET + ALERT ENGINE
# ============================================================

app = Flask(__name__)
CORS(app)


# ============================================================
# CONFIG
# ============================================================

TIMEFRAME_M1 = mt5.TIMEFRAME_M1
TIMEFRAME_M15 = mt5.TIMEFRAME_M15

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

M1_BARS = 150
M15_BARS = 150


# ============================================================
# MT5 CONNECTION
# ============================================================

def connect_mt5():
    if mt5.initialize():
        return True

    print("MT5 initialize failed:", mt5.last_error())
    return False


# ============================================================
# SYMBOL FINDER
# ============================================================

def find_symbol(requested_symbol):
    requested_symbol = requested_symbol.upper().strip()

    # Exact match
    info = mt5.symbol_info(requested_symbol)

    if info is not None:
        if not info.visible:
            mt5.symbol_select(requested_symbol, True)
        return requested_symbol

    # Common broker suffixes
    suffixes = [
        "m",
        ".a",
        ".",
        "_",
        ".m",
        "m.a",
    ]

    for suffix in suffixes:
        candidate = requested_symbol + suffix
        info = mt5.symbol_info(candidate)

        if info is not None:
            if not info.visible:
                mt5.symbol_select(candidate, True)
            return candidate

    # Search all available symbols
    symbols = mt5.symbols_get()

    if symbols:
        for symbol in symbols:
            name = symbol.name.upper()

            if name == requested_symbol:
                if not symbol.visible:
                    mt5.symbol_select(symbol.name, True)
                return symbol.name

        for symbol in symbols:
            name = symbol.name.upper()

            if name.startswith(requested_symbol):
                if not symbol.visible:
                    mt5.symbol_select(symbol.name, True)
                return symbol.name

    return None


# ============================================================
# GET MARKET DATA
# ============================================================

def get_rates(symbol, timeframe, bars):
    rates = mt5.copy_rates_from_pos(
        symbol,
        timeframe,
        0,
        bars
    )

    if rates is None or len(rates) == 0:
        return None

    df = pd.DataFrame(rates)

    df["time"] = pd.to_datetime(
        df["time"],
        unit="s"
    )

    return df


# ============================================================
# EMA
# ============================================================

def calculate_ema(df, period=20):
    return df["close"].ewm(
        span=period,
        adjust=False
    ).mean()


# ============================================================
# RSI
# ============================================================

def calculate_rsi(df, period=14):
    delta = df["close"].diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    average_gain = gain.rolling(period).mean()
    average_loss = loss.rolling(period).mean()

    rs = average_gain / average_loss.replace(0, math.nan)

    rsi = 100 - (100 / (1 + rs))

    return rsi


# ============================================================
# SWING POINTS
# ============================================================

def find_swing_points(df, left=2, right=2):
    highs = []
    lows = []

    if len(df) < left + right + 1:
        return highs, lows

    for i in range(left, len(df) - right):

        current_high = df.iloc[i]["high"]
        current_low = df.iloc[i]["low"]

        left_highs = df.iloc[i-left:i]["high"]
        right_highs = df.iloc[i+1:i+1+right]["high"]

        left_lows = df.iloc[i-left:i]["low"]
        right_lows = df.iloc[i+1:i+1+right]["low"]

        if current_high >= left_highs.max() and current_high >= right_highs.max():
            highs.append({
                "index": i,
                "price": float(current_high)
            })

        if current_low <= left_lows.min() and current_low <= right_lows.min():
            lows.append({
                "index": i,
                "price": float(current_low)
            })

    return highs, lows


# ============================================================
# MARKET STRUCTURE
# ============================================================

def detect_market_structure(df):

    highs, lows = find_swing_points(df)

    recent_highs = highs[-3:]
    recent_lows = lows[-3:]

    bullish_points = 0
    bearish_points = 0

    description = "Mixed structure"
    trend = "sideways"
    confidence = 50

    if len(recent_highs) >= 2:
        previous_high = recent_highs[-2]["price"]
        latest_high = recent_highs[-1]["price"]

        if latest_high > previous_high:
            bullish_points += 1

        elif latest_high < previous_high:
            bearish_points += 1

    if len(recent_lows) >= 2:
        previous_low = recent_lows[-2]["price"]
        latest_low = recent_lows[-1]["price"]

        if latest_low > previous_low:
            bullish_points += 1

        elif latest_low < previous_low:
            bearish_points += 1

    if bullish_points >= 2:
        trend = "uptrend"
        description = "HH + HL"
        confidence = 90

    elif bearish_points >= 2:
        trend = "downtrend"
        description = "LH + LL"
        confidence = 90

    elif bullish_points > bearish_points:
        trend = "uptrend"
        description = "Partial bullish structure"
        confidence = 70

    elif bearish_points > bullish_points:
        trend = "downtrend"
        description = "Partial bearish structure"
        confidence = 70

    direction = "none"

    if trend == "uptrend":
        direction = "bullish"

    elif trend == "downtrend":
        direction = "bearish"

    return {
        "direction": direction,
        "trend": trend,
        "description": description,
        "confidence": confidence,
        "swing_highs": recent_highs,
        "swing_lows": recent_lows,
    }


# ============================================================
# SUPPORT / RESISTANCE
# ============================================================

def detect_support_resistance(df, lookback=30):

    recent = df.tail(lookback)

    support = float(recent["low"].min())
    resistance = float(recent["high"].max())

    return support, resistance


# ============================================================
# CANDLESTICK CONFIRMATION
# ============================================================

def detect_candlestick_confirmation(df):

    if len(df) < 3:
        return {
            "type": "none",
            "direction": "none",
            "strength": 0
        }

    previous = df.iloc[-2]
    current = df.iloc[-1]

    open_price = float(current["open"])
    close_price = float(current["close"])
    high = float(current["high"])
    low = float(current["low"])

    previous_open = float(previous["open"])
    previous_close = float(previous["close"])

    body = abs(close_price - open_price)

    candle_range = high - low

    if candle_range == 0:
        return {
            "type": "none",
            "direction": "none",
            "strength": 0
        }

    upper_wick = high - max(open_price, close_price)
    lower_wick = min(open_price, close_price) - low

    # Bullish engulfing
    if (
        previous_close < previous_open
        and close_price > open_price
        and close_price >= previous_open
        and open_price <= previous_close
    ):
        return {
            "type": "bullish engulfing",
            "direction": "bullish",
            "strength": 3
        }

    # Bearish engulfing
    if (
        previous_close > previous_open
        and close_price < open_price
        and close_price <= previous_open
        and open_price >= previous_close
    ):
        return {
            "type": "bearish engulfing",
            "direction": "bearish",
            "strength": 3
        }

    # Hammer
    if (
        lower_wick >= body * 2
        and upper_wick <= body
        and close_price > open_price
    ):
        return {
            "type": "hammer",
            "direction": "bullish",
            "strength": 2
        }

    # Shooting star
    if (
        upper_wick >= body * 2
        and lower_wick <= body
        and close_price < open_price
    ):
        return {
            "type": "shooting star",
            "direction": "bearish",
            "strength": 2
        }

    # Strong bullish candle
    if (
        close_price > open_price
        and body >= candle_range * 0.65
    ):
        return {
            "type": "strong bullish candle",
            "direction": "bullish",
            "strength": 1
        }

    # Strong bearish candle
    if (
        close_price < open_price
        and body >= candle_range * 0.65
    ):
        return {
            "type": "strong bearish candle",
            "direction": "bearish",
            "strength": 1
        }

    return {
        "type": "none",
        "direction": "none",
        "strength": 0
    }


# ============================================================
# TIMEFRAME ANALYSIS
# ============================================================

def analyze_timeframe(df):

    if df is None or len(df) < 30:
        return None

    ema = calculate_ema(df)
    rsi = calculate_rsi(df)

    structure = detect_market_structure(df)

    support, resistance = detect_support_resistance(df)

    candle = detect_candlestick_confirmation(df)

    price = float(df.iloc[-1]["close"])

    ema_value = float(ema.iloc[-1])
    rsi_value = float(rsi.iloc[-1])

    ema_direction = "bullish"

    if price < ema_value:
        ema_direction = "bearish"

    direction = structure["direction"]

    return {
        "direction": direction,
        "structure": direction,
        "structure_trend": structure["trend"],
        "structure_description": structure["description"],
        "structure_confidence": structure["confidence"],
        "ema20": ema_value,
        "ema_direction": ema_direction,
        "price": price,
        "support": support,
        "resistance": resistance,
        "rsi14": rsi_value,
        "candlestick": candle,
    }


# ============================================================
# PRICE DISTANCE
# ============================================================

def percentage_distance(price, level):

    if level == 0:
        return 0

    return abs(price - level) / level * 100


# ============================================================
# LOCATION
# ============================================================

def determine_location(price, support, resistance):

    if resistance <= support:
        return "unknown"

    total_range = resistance - support

    position = (price - support) / total_range

    if position <= 0.30:
        return "near support"

    if position >= 0.70:
        return "near resistance"

    return "middle"


# ============================================================
# CHASING DETECTION
# ============================================================

def detect_chasing(price, direction, support, resistance):

    location = determine_location(
        price,
        support,
        resistance
    )

    if direction == "bullish" and location == "near resistance":
        return True

    if direction == "bearish" and location == "near support":
        return True

    return False


# ============================================================
# TRADE LEVELS
# ============================================================

def calculate_trade_levels(
    direction,
    price,
    support,
    resistance
):

    if direction not in ["bullish", "bearish"]:
        return None

    buffer = max(
        price * 0.0003,
        0.50
    )

    if direction == "bullish":

        entry = price

        stop_loss = support - buffer

        risk = entry - stop_loss

        if risk <= 0:
            return None

        take_profit = entry + (risk * 2)

    else:

        entry = price

        stop_loss = resistance + buffer

        risk = stop_loss - entry

        if risk <= 0:
            return None

        take_profit = entry - (risk * 2)

    return {
        "direction": direction,
        "entry": round(entry, 5),
        "stop_loss": round(stop_loss, 5),
        "take_profit": round(take_profit, 5),
        "risk_reward": "1:2"
    }


# ============================================================
# SETUP CALCULATOR
# ============================================================

def calculate_setup(
    m15,
    m1,
    df_m1
):

    reasons = []
    warnings = []

    score = 0
    max_score = 10

    if not m15 or not m1:
        return {
            "direction": "none",
            "score": 0,
            "max_score": max_score,
            "status": "NO TRADE",
            "reasons": ["Insufficient market data"],
            "warnings": [],
            "trade_levels": None,
        }

    m15_direction = m15["direction"]
    m1_direction = m1["direction"]

    # --------------------------------------------------------
    # M15 TREND
    # --------------------------------------------------------

    if m15_direction in ["bullish", "bearish"]:

        score += 2

        reasons.append(
            f"M15 direction is {m15_direction}"
        )

    else:

        warnings.append(
            "M15 market structure is sideways"
        )

    # --------------------------------------------------------
    # STRUCTURE CONFIDENCE
    # --------------------------------------------------------

    if m15["structure_confidence"] >= 70:

        score += 1

        reasons.append(
            "M15 structure has clear confirmation"
        )

    # --------------------------------------------------------
    # M1 ALIGNMENT
    # --------------------------------------------------------

    if (
        m15_direction != "none"
        and m1_direction == m15_direction
    ):

        score += 2

        reasons.append(
            "M1 structure aligns with M15"
        )

    elif m1_direction != "none":

        warnings.append(
            "M1 and M15 directions are conflicting"
        )

    # --------------------------------------------------------
    # EMA
    # --------------------------------------------------------

    if (
        m15_direction != "none"
        and m15["ema_direction"] == m15_direction
    ):

        score += 1

        reasons.append(
            "M15 EMA20 agrees with direction"
        )

    else:

        warnings.append(
            "EMA20 does not fully confirm direction"
        )

    # --------------------------------------------------------
    # RSI
    # --------------------------------------------------------

    rsi = m1["rsi14"]

    if m15_direction == "bullish":

        if 40 <= rsi <= 65:

            score += 1

            reasons.append(
                "M1 RSI is in a healthy bullish range"
            )

        elif rsi > 65:

            warnings.append(
                "M1 RSI is elevated"
            )

        else:

            warnings.append(
                "M1 RSI is weak for bullish setup"
            )

    elif m15_direction == "bearish":

        if 35 <= rsi <= 60:

            score += 1

            reasons.append(
                "M1 RSI is in a healthy bearish range"
            )

        elif rsi < 35:

            warnings.append(
                "M1 RSI is deeply oversold"
            )

        else:

            warnings.append(
                "M1 RSI is weak for bearish setup"
            )

    # --------------------------------------------------------
    # LOCATION
    # --------------------------------------------------------

    location = determine_location(
        m1["price"],
        m1["support"],
        m1["resistance"]
    )

    if location == "near support" and m15_direction == "bullish":

        score += 1

        reasons.append(
            "Price is near support"
        )

    elif location == "near resistance" and m15_direction == "bearish":

        score += 1

        reasons.append(
            "Price is near resistance"
        )

    elif location == "middle":

        warnings.append(
            "Price is in the middle of the range"
        )

    # --------------------------------------------------------
    # CANDLESTICK
    # --------------------------------------------------------

    candle = m1["candlestick"]

    if (
        candle["direction"] == m15_direction
        and candle["type"] != "none"
    ):

        score += 1

        reasons.append(
            f"Candlestick confirmation: {candle['type']}"
        )

    # --------------------------------------------------------
    # CHASING
    # --------------------------------------------------------

    chasing = detect_chasing(
        m1["price"],
        m15_direction,
        m1["support"],
        m1["resistance"]
    )

    if chasing:

        warnings.append(
            "Possible price chasing detected"
        )

    # --------------------------------------------------------
    # FINAL DIRECTION
    # --------------------------------------------------------

    direction = m15_direction

    if direction not in ["bullish", "bearish"]:
        direction = "none"

    # --------------------------------------------------------
    # TRADE LEVELS
    # --------------------------------------------------------

    trade_levels = None

    if direction in ["bullish", "bearish"]:

        trade_levels = calculate_trade_levels(
            direction,
            m1["price"],
            m1["support"],
            m1["resistance"]
        )

    # --------------------------------------------------------
    # STATUS
    # --------------------------------------------------------

    if m15_direction == "none":

        status = "NO TRADE"

        score = 0

        trade_levels = None

    elif score >= 8 and len(warnings) <= 1:

        status = "STRONG SETUP"

    elif score >= 6:

        status = "POSSIBLE SETUP"

    else:

        status = "WAIT"

    return {
        "direction": direction,
        "score": score,
        "max_score": max_score,
        "status": status,
        "reasons": reasons,
        "warnings": warnings,
        "warnings_count": len(warnings),
        "location": location,
        "chasing": chasing,
        "trade_levels": trade_levels,
    }


# ============================================================
# CANDLE FORMATTER
# ============================================================

def rates_to_candles(df):

    candles = []

    if df is None:
        return candles

    for _, row in df.tail(100).iterrows():

        candles.append({
            "time": int(row["time"].timestamp()),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
        })

    return candles


# ============================================================
# MARKET ANALYSIS
# ============================================================

def analyze_market(requested_symbol):

    symbol = find_symbol(requested_symbol)

    if symbol is None:

        return {
            "requested_symbol": requested_symbol,
            "symbol": None,
            "available": False,
            "error": "Symbol not available on MT5"
        }

    tick = mt5.symbol_info_tick(symbol)

    if tick is None:

        return {
            "requested_symbol": requested_symbol,
            "symbol": symbol,
            "available": False,
            "error": "No tick data available"
        }

    df_m1 = get_rates(
        symbol,
        TIMEFRAME_M1,
        M1_BARS
    )

    df_m15 = get_rates(
        symbol,
        TIMEFRAME_M15,
        M15_BARS
    )

    if df_m1 is None or df_m15 is None:

        return {
            "requested_symbol": requested_symbol,
            "symbol": symbol,
            "available": False,
            "error": "Unable to retrieve candle data"
        }

    m1 = analyze_timeframe(df_m1)
    m15 = analyze_timeframe(df_m15)

    setup = calculate_setup(
        m15,
        m1,
        df_m1
    )

    return {
        "requested_symbol": requested_symbol,
        "symbol": symbol,
        "available": True,

        "timestamp": datetime.now().isoformat(),

        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "spread": round(
            float(tick.ask - tick.bid),
            5
        ),

        "direction": setup["direction"],
        "score": setup["score"],
        "max_score": setup["max_score"],
        "status": setup["status"],

        "m1": m1,
        "m15": m15,

        "setup": setup,

        "candles": rates_to_candles(df_m1)
    }


# ============================================================
# ALERT ENGINE
# ============================================================

def build_alerts(markets):

    strong_setups = []
    possible_setups = []
    wait_markets = []
    no_trade_markets = []

    for market in markets:

        if not market.get("available"):
            continue

        status = market.get("status", "WAIT")

        alert = {
            "symbol": market.get("symbol"),
            "requested_symbol": market.get("requested_symbol"),
            "direction": market.get("direction", "none"),
            "score": market.get("score", 0),
            "max_score": market.get("max_score", 10),
            "status": status,
            "price": market.get("bid"),
            "warnings_count": market.get(
                "setup",
                {}
            ).get(
                "warnings_count",
                0
            ),
        }

        if status == "STRONG SETUP":

            strong_setups.append(alert)

        elif status == "POSSIBLE SETUP":

            possible_setups.append(alert)

        elif status == "WAIT":

            wait_markets.append(alert)

        elif status == "NO TRADE":

            no_trade_markets.append(alert)

    return {
        "strong_setups": strong_setups,
        "possible_setups": possible_setups,
        "wait": wait_markets,
        "no_trade": no_trade_markets,

        "counts": {
            "strong_setups": len(strong_setups),
            "possible_setups": len(possible_setups),
            "wait": len(wait_markets),
            "no_trade": len(no_trade_markets),
        }
    }


# ============================================================
# HEALTH
# ============================================================

@app.route("/api/health")
def health():

    connected = mt5.terminal_info() is not None

    return jsonify({
        "status": "online",
        "mt5_connected": connected,
        "timestamp": datetime.now().isoformat()
    })


# ============================================================
# ACCOUNT
# ============================================================

@app.route("/api/account")
def account():

    info = mt5.account_info()

    if info is None:

        return jsonify({
            "error": "Unable to retrieve MT5 account"
        }), 500

    return jsonify({
        "login": info.login,
        "balance": float(info.balance),
        "equity": float(info.equity),
        "profit": float(info.profit),
        "currency": info.currency,
        "server": info.server,
        "trade_allowed": bool(info.trade_allowed)
    })


# ============================================================
# SINGLE MARKET
# ============================================================

@app.route("/api/market/<symbol>")
def market(symbol):

    result = analyze_market(symbol.upper())

    return jsonify(result)


# ============================================================
# XAUUSD SHORTCUT
# ============================================================

@app.route("/api/market/xauusd")
def xauusd():

    result = analyze_market("XAUUSD")

    return jsonify(result)


# ============================================================
# MULTI-MARKET SCANNER
# ============================================================

@app.route("/api/scanner")
def scanner():

    markets = []

    for symbol in WATCHLIST:

        try:

            result = analyze_market(symbol)

            markets.append(result)

        except Exception as error:

            print(
                f"Scanner error for {symbol}:",
                error
            )

            markets.append({
                "requested_symbol": symbol,
                "symbol": None,
                "available": False,
                "error": str(error)
            })

    available_markets = [
        market
        for market in markets
        if market.get("available")
    ]

    alerts = build_alerts(
        available_markets
    )

    return jsonify({

        "timestamp": datetime.now().isoformat(),

        "watchlist": WATCHLIST,

        "total_markets": len(markets),

        "available_markets": len(
            available_markets
        ),

        "markets": markets,

        "alerts": alerts,

        "alert_engine": {
            "active": True,
            "automatic_trading": False
        }
    })


# ============================================================
# ALERTS ONLY
# ============================================================

@app.route("/api/alerts")
def alerts():

    markets = []

    for symbol in WATCHLIST:

        try:

            result = analyze_market(symbol)

            if result.get("available"):

                markets.append(result)

        except Exception as error:

            print(
                f"Alert engine error for {symbol}:",
                error
            )

    alert_data = build_alerts(
        markets
    )

    return jsonify({

        "timestamp": datetime.now().isoformat(),

        "engine": "Twin Edge Alert Engine",

        "active": True,

        "automatic_trading": False,

        "alerts": alert_data
    })


# ============================================================
# AVAILABLE SYMBOLS
# ============================================================

@app.route("/api/symbols")
def symbols():

    symbols = mt5.symbols_get()

    if symbols is None:

        return jsonify({
            "symbols": []
        })

    names = [
        symbol.name
        for symbol in symbols
    ]

    return jsonify({
        "count": len(names),
        "symbols": names
    })


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print("")
    print("=" * 60)
    print("          TWIN EDGE V5 BACKEND")
    print("=" * 60)
    print("")
    print("Multi-Market Scanner: ACTIVE")
    print("Alert Engine: ACTIVE")
    print("Automatic Trading: DISABLED")
    print("")
    print("Server: http://localhost:5000")
    print("Scanner: http://localhost:5000/api/scanner")
    print("Alerts:  http://localhost:5000/api/alerts")
    print("")
    print("=" * 60)
    print("")

    if not connect_mt5():

        print("WARNING: MT5 connection failed.")

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )