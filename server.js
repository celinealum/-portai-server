const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// ── T212 PROXY ──
function t212Auth(key) {
  // New T212 API uses Basic Auth with "apiKeyId:secretKey"
  // If key contains a colon, it's the new format — encode as Basic Auth
  // If not, try as Bearer token (old format)
  if (key.includes(":")) {
    const encoded = Buffer.from(key).toString("base64");
    return "Basic " + encoded;
  }
  return key; // old format — send as-is
}

// T212 internal ticker -> real ticker map
const T212_TICKERS = {
  // Tickers from Celine's ISA account
  "IPOE_US_EQ": "SOFI",   "IPOE": "SOFI",
  "TWND_US_EQ": "BURU",   "TWND": "BURU",
  "ALUS_US_EQ": "ASTS",   "ALUS": "ASTS",
  "VACQ_US_EQ": "RKLB",   "VACQ": "RKLB",
  "SRFM_US_EQ": "SRFM",   "SRFM": "SRFM",
  "APLD_US_EQ": "APLD",   "APLD": "APLD",
  "AGC_US_EQ":  "ASTS",   "AGC":  "ASTS",
  "YNDX_US_EQ": "YANDX",  "YNDX": "YANDX",
  "NPA_US_EQ":  "ASTS",   "NPA":  "ASTS",
  "CNDB_US_EQ": "CNDB",   "CNDB": "CNDB",
  "GIG_US_EQ":  "GIG",    "GIG":  "GIG",
  // Additional SPACs and special cases
  "GIG_US_EQ":  "GIG",    "GIG":  "GIG",
  "YNDX_US_EQ": "YNDX",  "YNDX": "YNDX",
  // Standard remaps
  "FB_US_EQ": "META",    "FB": "META",
  "GOOG_US_EQ": "GOOGL", "GOOG": "GOOGL",
};

function fixTicker(t212Ticker) {
  if (T212_TICKERS[t212Ticker]) return T212_TICKERS[t212Ticker];
  // Strip _US_EQ, _EQ suffixes
  return t212Ticker.replace(/_US_EQ$|_EQ$|_US$/, "");
}

app.get("/api/t212/portfolio", async (req, res) => {
  const key = req.headers["x-t212-key"];
  if (!key) return res.status(400).json({ error: "No T212 key provided" });
  try {
    const r = await fetch("https://live.trading212.com/api/v0/equity/portfolio", {
      headers: { Authorization: t212Auth(key) }
    });
    if (!r.ok) return res.status(r.status).json({ error: "T212 error: " + r.status });
    const data = await r.json();
    // Fix tickers, preserve T212 name, filter out dust positions
    const fixed = data.map ? data.map(p => ({
      ...p,
      ticker: fixTicker(p.ticker),
      t212Ticker: p.ticker
    })).filter(p => (p.currentPrice * p.quantity) >= 1) : data;
    res.json(fixed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/t212/cash", async (req, res) => {
  const key = req.headers["x-t212-key"];
  if (!key) return res.status(400).json({ error: "No T212 key provided" });
  try {
    const r = await fetch("https://live.trading212.com/api/v0/equity/account/cash", {
      headers: { Authorization: t212Auth(key) }
    });
    if (!r.ok) return res.status(r.status).json({ error: "T212 error: " + r.status });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ANTHROPIC PROXY ──
app.post("/api/claude", async (req, res) => {
  const key = req.headers["x-ant-key"];
  if (!key) return res.status(400).json({ error: "No Anthropic key provided" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── FINNHUB PROXY (analyst targets) ──
app.get("/api/analyst/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const key = process.env.FINNHUB_KEY || req.headers["x-finnhub-key"];
  if (!key) return res.status(400).json({ error: "No Finnhub key" });
  try {
    const [ratingRes, targetRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${key}`),
      fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${key}`)
    ]);
    const ratings = await ratingRes.json();
    const targets = await targetRes.json();
    res.json({ ratings, targets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── YAHOO FINANCE PROXY (price history) ──
app.get("/api/chart/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const range = req.query.range || "6mo";
  const interval = req.query.interval || "1wk";
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── REDDIT / APEWISDOM PROXY ──
app.get("/api/reddit", async (req, res) => {
  const page = req.query.page || 1;
  try {
    const r = await fetch(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`);
    if (!r.ok) throw new Error("ApeWisdom error: " + r.status);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONGRESS TRADES ──
app.get("/api/congress-trades", async (req, res) => {
  const key = process.env.FINNHUB_KEY || req.headers["x-finnhub-key"];
  if (!key) return res.status(400).json({ error: "No Finnhub key" });
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/congressional-trading?token=${key}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ──
app.get("/", (req, res) => {
  res.json({ status: "PORT.AI server running", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("PORT.AI server on port " + PORT));

// ── STOCKTWITS PROXY ──
app.get("/api/stocktwits/:ticker", async (req, res) => {
  const { ticker } = req.params;
  try {
    const r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${ticker}.json`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── FINNHUB FUNDAMENTALS ──
app.get("/api/fundamentals/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const key = process.env.FINNHUB_KEY || req.headers["x-finnhub-key"];
  if (!key) return res.status(400).json({ error: "No Finnhub key" });
  try {
    const [metricRes, profileRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${key}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${key}`)
    ]);
    const metrics = await metricRes.json();
    const profile = await profileRes.json();
    res.json({ metrics, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── T212 PIES ──
app.get("/api/t212/pies", async (req, res) => {
  const key = req.headers["x-t212-key"];
  if (!key) return res.status(400).json({ error: "No T212 key" });
  try {
    // Get all pies list
    const r = await fetch("https://live.trading212.com/api/v0/equity/pies", {
      headers: { "Authorization": t212Auth(key) }
    });
    if (!r.ok) return res.status(r.status).json({ error: `T212 error ${r.status}` });
    const pies = await r.json();

    // Get details for each pie (holdings + allocation)
    const detailed = await Promise.all(pies.map(async pie => {
      try {
        const dr = await fetch(`https://live.trading212.com/api/v0/equity/pies/${pie.id}`, {
          headers: { "Authorization": t212Auth(key) }
        });
        if (!dr.ok) return pie;
        const d = await dr.json();
        // Fix tickers in instruments
        if (d.instruments) {
          d.instruments = d.instruments.map(inst => ({
            ...inst,
            ticker: fixTicker(inst.ticker || inst.code || ""),
          }));
        }
        return { ...pie, ...d };
      } catch(e) {
        return pie;
      }
    }));

    res.json(detailed);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
