const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// ── T212 PROXY ──
app.get("/api/t212/portfolio", async (req, res) => {
  const key = req.headers["x-t212-key"];
  if (!key) return res.status(400).json({ error: "No T212 key provided" });
  try {
    const r = await fetch("https://live.trading212.com/api/v0/equity/portfolio", {
      headers: { Authorization: key }
    });
    if (!r.ok) return res.status(r.status).json({ error: "T212 error: " + r.status });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/t212/cash", async (req, res) => {
  const key = req.headers["x-t212-key"];
  if (!key) return res.status(400).json({ error: "No T212 key provided" });
  try {
    const r = await fetch("https://live.trading212.com/api/v0/equity/account/cash", {
      headers: { Authorization: key }
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
