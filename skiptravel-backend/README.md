# SkipTravel — Site + Backend de Busca Mundial ✈️

Site completo da SkipTravel com buscador de voos **nacionais e internacionais**
(padrão visual do Brand Book 2025) e backend Node pronto para API real.

## Estrutura

```
skiptravel-backend/
├── server.js        → servidor Express (site + API de busca)
├── airports.js      → base mundial de aeroportos (autocomplete, ~200 cidades)
├── public/
│   └── index.html   → o site completo (Home, Como Funciona, Passagens, Sobre)
├── .env.example     → modelo de configuração
└── package.json
```

## Como rodar

Sem dependências — não precisa de `npm install`. Só Node 18+:

```bash
node server.js
# abre http://localhost:3000
```

O site já funciona 100% sem nenhuma chave: o autocomplete mundial responde
da base local e a busca direciona o cliente para cotação no WhatsApp.

## ⚙️ Configurar a busca em tempo real

### Opção 1 — Google Flights via SerpApi (recomendado pra começar AGORA)

Mostra os resultados **reais do Google Flights** (LATAM, GOL, Azul, TAP,
internacionais...) com preço em reais, horários e paradas.

1. Crie conta em **https://serpapi.com** (grátis, sem CNPJ, confirma e-mail)
2. Copie sua **API Key** (aparece no painel)
3. Copie `.env.example` para `.env` e preencha:

```
SERPAPI_KEY=sua_chave_aqui
```

4. Reinicie (`node server.js`) — vai aparecer `busca real: GOOGLE FLIGHTS ✓`

O plano gratuito tem um limite mensal de buscas (confira em
serpapi.com/pricing) — suficiente pra demonstração e início de operação.

### Opção 2 — API de consolidadora brasileira (produção definitiva)

Quando a SkipTravel contratar a API da consolidadora (BRT, Confiança, BWT,
Moblix etc.), é só adicionar uma função `searchConsolidadora()` no
`server.js` seguindo o mesmo padrão das existentes — o site não muda nada.

### Outras já suportadas

- **Duffel** (`DUFFEL_API_KEY`) — ótima API, mas não aceita empresa
  registrada no Brasil.
- **Amadeus** (`AMADEUS_API_KEY`/`SECRET`) — legado; portal Self-Service
  será desativado em 17/07/2026.

Prioridade quando há mais de uma chave: SerpApi → Duffel → Amadeus.

## ⚙️ Configurar o WhatsApp

No `public/index.html`, no topo do `<script>`:

```js
const SKIP_CONFIG = {
  whatsappNumber: "5592900000000",  // ← número oficial da SkipTravel
  ...
};
```

## Endpoints da API

| Endpoint | Descrição |
|---|---|
| `GET /api/airports?q=lis` | Autocomplete mundial (base local, custo zero) |
| `GET /api/flights?origin=MAO&destination=LIS&date=2026-07-10[&returnDate=...][&adults=2]` | Busca de voos (SerpApi/Google → Duffel → Amadeus) |

Sem chave configurada, `/api/flights` devolve `{ "configured": false }` e o
front-end mostra automaticamente o fluxo de cotação via WhatsApp — o site
nunca quebra.

## Deploy

Qualquer host Node 18+ funciona: Render, Railway, Fly.io, VPS etc.
Suba a pasta, configure as variáveis de ambiente e rode `node server.js`.
