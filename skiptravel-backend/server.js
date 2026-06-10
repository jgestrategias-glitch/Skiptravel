/**
 * ============================================================
 *  SKIPTRAVEL — Backend de busca de voos (ZERO dependências)
 *  Node 18+ · sem npm install · Integração Amadeus Self-Service
 *
 *  COMO RODAR:        node server.js
 *  COMO CONFIGURAR A API REAL (um só lugar, igual ao WhatsApp):
 *    1. Conta gratuita em https://developers.amadeus.com
 *    2. Crie um app e copie a API Key e o API Secret
 *    3. Copie .env.example para .env e cole as chaves
 *    4. Reinicie: node server.js
 *
 *  Sem chave configurada o site continua 100% funcional:
 *  a busca cai no fluxo de cotação via WhatsApp.
 * ============================================================
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const AIRPORTS = require("./airports");

/* ---- Carrega .env manualmente (sem dependência dotenv) -------------------- */
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const PORT = Number(process.env.PORT) || 3000;

/* PROVEDORES (ordem de prioridade):
   1. SerpApi  → resultados reais do GOOGLE FLIGHTS. Ideal pra demo/lançamento.
                 Cadastro simples em https://serpapi.com (plano gratuito).
   2. Duffel   → busca+emissão, mas NÃO aceita empresa registrada no Brasil.
   3. Amadeus  → legado (portal Self-Service desativa em 17/07/2026).
   Futuro: API de consolidadora brasileira (BRT, Confiança, BWT, Moblix...) —
   é só adicionar uma função search<Nome>() no mesmo padrão das abaixo. */
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const DUFFEL_KEY = process.env.DUFFEL_API_KEY || "";
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || "";
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || "";
const AMADEUS_BASE =
  process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

/* ---- Util ------------------------------------------------------------------ */
const norm = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const json = (res, code, data) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webp": "image/webp", ".json": "application/json",
};

/* ============================================================
   Autocomplete mundial — base local, resposta instantânea
   ============================================================ */
function apiAirports(query, res) {
  const q = norm((query.get("q") || "").trim());
  if (q.length < 2) return json(res, 200, []);
  const results = AIRPORTS.filter(
    (a) =>
      norm(a.city).includes(q) ||
      a.iata.toLowerCase() === q ||
      norm(a.country).includes(q)
  ).slice(0, 8);
  json(res, 200, results);
}

/* ============================================================
   Token OAuth2 Amadeus com cache em memória
   ============================================================ */
let _token = null;
let _tokenExp = 0;

async function getAmadeusToken() {
  if (_token && Date.now() < _tokenExp - 60_000) return _token;
  const r = await fetch(AMADEUS_BASE + "/v1/security/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: AMADEUS_KEY,
      client_secret: AMADEUS_SECRET,
    }),
  });
  if (!r.ok) throw new Error("Autenticação Amadeus falhou (status " + r.status + ")");
  const d = await r.json();
  _token = d.access_token;
  _tokenExp = Date.now() + d.expires_in * 1000;
  return _token;
}

/* ============================================================
   PROVEDOR 1 — SERPAPI (Google Flights real)
   Cadastro: https://serpapi.com → API Key no painel
   ============================================================ */
/* Cidades com vários aeroportos → busca todos juntos (igual ao Google) */
const METRO = {
  SAO: "GRU,CGH,VCP",  RIO: "GIG,SDU",      BUE: "EZE,AEP",
  NYC: "JFK,EWR,LGA",  LON: "LHR,LGW,STN",  PAR: "CDG,ORY",
  TYO: "NRT,HND",      MIL: "MXP,LIN",
};
const expandMetro = (code) => METRO[code] || code;

async function searchSerpApi({ origin, destination, date, returnDate, adults }) {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: expandMetro(origin),
    arrival_id: expandMetro(destination),
    outbound_date: date,
    adults: adults,
    currency: "BRL",
    hl: "pt-br",
    gl: "br",
    type: returnDate ? "1" : "2",   // 1 = ida e volta · 2 = só ida
    api_key: SERPAPI_KEY,
  });
  if (returnDate) params.set("return_date", returnDate);

  const r = await fetch("https://serpapi.com/search.json?" + params.toString());
  const d = await r.json();
  if (!r.ok || d.error) {
    const err = new Error(d.error || "Erro na API SerpApi");
    err.status = 502; err.details = d;
    throw err;
  }
  const list = [...(d.best_flights || []), ...(d.other_flights || [])].slice(0, 10);
  return list.map((o) => {
    const segs = o.flights || [];
    const f0 = segs[0] || {};
    const fN = segs[segs.length - 1] || {};
    const totalMin = o.total_duration || 0;
    return {
      price: o.price,
      currency: "BRL",
      carrier: f0.airline || "",
      departure: (f0.departure_airport && f0.departure_airport.time) || "",
      arrival: (fN.arrival_airport && fN.arrival_airport.time) || "",
      duration: "PT" + Math.floor(totalMin / 60) + "H" + (totalMin % 60) + "M",
      stops: Math.max(segs.length - 1, 0),
      hasReturn: !!returnDate,   // preço do Google já é o total ida+volta
    };
  });
}

/* ============================================================
   PROVEDOR 2 — DUFFEL (não aceita empresa do Brasil)
   Cadastro: https://duffel.com → Access Token (test ou live)
   ============================================================ */
async function searchDuffel({ origin, destination, date, returnDate, adults }) {
  const slices = [{ origin, destination, departure_date: date }];
  if (returnDate)
    slices.push({ origin: destination, destination: origin, departure_date: returnDate });
  const passengers = Array.from({ length: Number(adults) || 1 }, () => ({ type: "adult" }));

  const r = await fetch(
    "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + DUFFEL_KEY,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: { slices, passengers, cabin_class: "economy" } }),
    }
  );
  const d = await r.json();
  if (!r.ok) {
    const err = new Error("Erro na API Duffel");
    err.status = 502; err.details = d;
    throw err;
  }
  return ((d.data && d.data.offers) || [])
    .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
    .slice(0, 10)
    .map((o) => {
      const s0 = o.slices[0];
      const segs = s0.segments;
      return {
        price: o.total_amount,
        currency: o.total_currency,
        carrier: (o.owner && o.owner.name) || "",
        departure: segs[0].departing_at,
        arrival: segs[segs.length - 1].arriving_at,
        duration: s0.duration,
        stops: segs.length - 1,
        hasReturn: o.slices.length > 1,
      };
    });
}

/* ============================================================
   PROVEDOR 2 — AMADEUS (legado — portal Self-Service será
   desativado em 17/07/2026; mantido p/ quem já tem chave)
   ============================================================ */
async function searchAmadeus({ origin, destination, date, returnDate, adults }) {
  const token = await getAmadeusToken();
  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: date,
    adults,
    currencyCode: "BRL",
    max: "10",
  });
  if (returnDate) params.set("returnDate", returnDate);

  const r = await fetch(
    AMADEUS_BASE + "/v2/shopping/flight-offers?" + params.toString(),
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await r.json();
  if (!r.ok) {
    const err = new Error("Erro na API Amadeus");
    err.status = 502; err.details = data;
    throw err;
  }
  const carriers = (data.dictionaries && data.dictionaries.carriers) || {};
  return (data.data || []).map((o) => {
    const out = o.itineraries[0];
    const segs = out.segments;
    return {
      price: o.price.grandTotal,
      currency: o.price.currency,
      carrier: carriers[segs[0].carrierCode] || segs[0].carrierCode,
      departure: segs[0].departure.at,
      arrival: segs[segs.length - 1].arrival.at,
      duration: out.duration,
      stops: segs.length - 1,
      hasReturn: o.itineraries.length > 1,
    };
  });
}

/* ============================================================
   GET /api/flights?origin=MAO&destination=LIS&date=YYYY-MM-DD
                   [&returnDate=...][&adults=1]
   Usa Duffel se DUFFEL_API_KEY existir; senão Amadeus;
   senão devolve configured:false (front cai no WhatsApp).
   ============================================================ */
async function apiFlights(query, res) {
  const args = {
    origin: (query.get("origin") || "").toUpperCase(),
    destination: (query.get("destination") || "").toUpperCase(),
    date: query.get("date"),
    returnDate: query.get("returnDate"),
    adults: query.get("adults") || "1",
  };

  const provider = SERPAPI_KEY ? "serpapi"
    : DUFFEL_KEY ? "duffel"
    : (AMADEUS_KEY && AMADEUS_SECRET) ? "amadeus"
    : null;
  if (!provider) {
    return json(res, 200, {
      configured: false,
      message:
        "API de voos ainda não configurada. Defina SERPAPI_KEY (Google Flights) no arquivo .env",
    });
  }
  if (!args.origin || !args.destination || !args.date) {
    return json(res, 400, {
      error: "Parâmetros obrigatórios: origin, destination, date (YYYY-MM-DD)",
    });
  }

  try {
    const offers =
      provider === "serpapi" ? await searchSerpApi(args)
      : provider === "duffel" ? await searchDuffel(args)
      : await searchAmadeus(args);
    json(res, 200, { configured: true, provider, offers });
  } catch (e) {
    json(res, e.status || 500, { error: e.message, details: e.details });
  }
}

/* ============================================================
   Servidor HTTP — API + arquivos estáticos de /public
   ============================================================ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/airports") return apiAirports(url.searchParams, res);
  if (url.pathname === "/api/flights") return apiFlights(url.searchParams, res);

  // Estáticos (com proteção contra path traversal)
  let file = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, "");
  if (file === "/" || file === "\\") file = "/index.html";
  let full = path.join(__dirname, "public", file);
  if (!full.startsWith(path.join(__dirname, "public"))) full = "";

  fs.readFile(full || "?", (err, buf) => {
    if (err) {
      // SPA fallback: qualquer rota desconhecida devolve o site
      fs.readFile(path.join(__dirname, "public", "index.html"), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(idx);
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full)] || "application/octet-stream",
    });
    res.end(buf);
  });
});

const providerStatus = SERPAPI_KEY
  ? "busca real: GOOGLE FLIGHTS (SerpApi) ✓"
  : DUFFEL_KEY
    ? "busca real: DUFFEL ✓"
    : (AMADEUS_KEY && AMADEUS_SECRET)
      ? "busca real: AMADEUS (legado — desativa em 17/07/2026)"
      : "busca real: pendente — busca cai no WhatsApp";

server.listen(PORT, () =>
  console.log("✈  SkipTravel rodando em http://localhost:" + PORT + "  (" + providerStatus + ")")
);
