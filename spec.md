# Albion Crafting Calculator - System Spec

## 1. Purpose
- Local web app to evaluate Albion crafting profitability per city.
- Estimates:
  - craft cost
  - sell price
  - profit / margin
  - estimated sell volume per day
- Supports cache-first pricing, manual overrides, and craft planning.

## 2. Runtime Architecture
- Frontend (static):
  - `index.html`
  - `src/app.js`
  - `src/styles.css`
- Backend (Node HTTP server):
  - `server.mjs`
  - serves static assets
  - proxies Albion Data API for prices/history
  - builds/serves recipe cache
- Server recipe cache:
  - `data/recipes-cache.json`
  - guarded by `cacheVersion` (current code uses version `5`)
- Browser price cache:
  - localStorage key `albionCraftPriceCacheV1`

## 3. Data Sources
- Recipe/name sources:
  - ao-data and broderickhyman dumps (JSON + XML)
  - local `data/` fallbacks when present
- Market sources (through backend):
  - `stats/prices` (live order-book values)
  - `stats/history` (daily averages and volumes)

## 4. Backend API
- `GET /api/recipes`
  - loads cached recipes or rebuilds from sources
  - supports `?force=1` to force rebuild
  - returns normalized recipes and metadata (`cacheVersion`, `generatedAt`, `source`, `recipeCount`)
- `POST /api/prices`
  - input:
    - `city`
    - `itemIds[]`
    - `mode`: `material | sell | buy | sell_avg | volume_avg`
    - `quality` (frontend always sends normal `1`)
    - `averageDays` (history modes)
    - `fallbackToLive` (optional for `sell_avg`)
  - output:
    - `prices` map keyed by item id
- `GET /api/health`
  - basic health check

## 5. Price Rules Used by UI
- Quality:
  - always normal quality (`1`)
- Material prices:
  - city-local `material` fetch
  - backend picks `sell_price_min` with `buy_price_max` fallback
- Sell price source:
  - city mode: `sell_avg` with `averageDays=1`
  - Black Market mode: `sell_avg` with `averageDays=7`
- Sell volume estimate:
  - `volume_avg` with `averageDays=30`
  - weighted by recency
- Material fallback:
  - if material live price is still missing, frontend fetches `sell_avg` (1 day) for those missing material ids and stores as material cache

## 6. Recipe Payload Schema (normalized)
- Each recipe entry:
  - `itemId`
  - `name`
  - optional `tier`, `enchantment`, `category`
  - `ingredients[]`
- Ingredient entry:
  - `itemId`
  - `amount`
  - optional `maxReturnAmount`
    - `null`/missing means normal return-rate behavior
    - `0` means non-returnable ingredient for RRR purposes
    - positive values cap returned amount per craft

## 7. Browser Price Cache Schema
- localStorage key: `albionCraftPriceCacheV1`
- structure:

```json
{
  "cities": {
    "<CityName>": {
      "material": { "<ITEM_ID>": { "p": 1234, "ts": 1739500000000 } },
      "sellAvg": { "<ITEM_ID>": { "p": 2345, "ts": 1739500000000 } },
      "sellVol30": { "<ITEM_ID>": { "p": 78, "ts": 1739500000000 } }
    }
  },
  "blackMarket": {
    "sellAvg7": { "<ITEM_ID>": { "p": 3456, "ts": 1739500000000 } },
    "sellVol30": { "<ITEM_ID>": { "p": 65, "ts": 1739500000000 } },
    "buy": {}
  }
}
```

Notes:
- `p` is rounded numeric value.
- `ts` is epoch ms update timestamp.
- Missing entry = effective zero.
- Legacy numeric cache entries are accepted and treated as stale.
- Prices are isolated by city (no cross-city override).

## 8. Fetch Policy
- Prices are not auto-fetched on load.
- User triggers fetch with buttons:
  - `Fetch Prices`: cache-first
  - `Force Fetch API`: bypass freshness for current scope
- Cache-first request rule:
  - API call only if value is missing/zero or stale (>= 1 hour old)
- Freshness threshold:
  - `60 * 60 * 1000` ms

## 9. Request Scope
- Scope is computed from current Calculator filters:
  - name text, tier, category, enchantment
- No filters = full recipe scope.
- For scoped recipes:
  - crafted item ids: sell + sell-volume fetches
  - ingredient ids: material fetches
- No cross-city material routing (city-local modeling only).

## 10. UI Features
- Tabs:
  - Calculator
  - Price Editor
- Calculator table:
  - columns:
    - Item
    - Tier / Category (merged, e.g. `4.1 Weapons`)
    - Sell Price
    - Est. Sell/Day (30d)
    - Craft Cost
    - Profit
    - Margin
    - Plan (`+` button)
  - sortable by clicking column headers
  - row highlight when margin >= threshold
  - item name expands ingredient detail table
  - ingredient detail supports inline price save/clear
- Craft Plan:
  - add items from calculator
  - edit plan quantities inside plan table
  - derived “Materials To Buy” aggregation
  - totals summary:
    - material buy cost
    - craft cost
    - sell value
    - estimated profit
    - margin
    - incomplete planned item count (when applicable)
- Price Editor:
  - sections:
    - Common Materials
    - Artifacts
    - Crafted Items
  - per-section filters by text/tier/category/enchant
  - direct cache editing (save/clear)
  - collapsible sections (`<details>`)
- Mobile:
  - responsive card-style layout for calculator rows

## 11. Calculation Model
- Total return rate (`rrr`):
  - sum of enabled premium + city bonus + focus
  - capped to `95%`
- Effective ingredient amount (per ingredient):
  - `base = ingredient.amount * craftQuantity`
  - `rawReturned = base * rrr`
  - if `maxReturnAmount` exists:
    - `returned = min(rawReturned, maxReturnAmount * craftQuantity)`
  - else:
    - `returned = rawReturned`
  - `effective = max(0, base - returned)`
- Craft cost:
  - `sum(effectiveIngredientAmount * ingredientPrice) * (1 + taxRate)`
- Profit:
  - `sellPrice - craftCost`
- Margin:
  - `profit / craftCost`
- Incomplete items:
  - if any ingredient price missing or sell price missing, row metrics show `-`

## 12. Classification & Naming Notes
- Human-readable names shown in UI.
- Enchant variants (`.0` to `.4`) are represented explicitly.
- Category inference is item-id based; artifact detection is prioritized to reduce misclassification into weapon/armor groups.

## 13. Operational Notes
- Run:
  - `node server.mjs`
  - open `http://localhost:5173`
- First recipe build may take time.
- Known failure classes:
  - Albion Data API rate limit (`429`)
  - temporary network/CORS/proxy failures
  - upstream source/schema changes
- Backend has retry/backoff for rate limits.

## 14. Validation Checklist
- Core files:
  - `server.mjs`
  - `src/app.js`
  - `src/styles.css`
  - `index.html`
- Recipe cache can be generated:
  - `data/recipes-cache.json`
- Price cache key remains:
  - `albionCraftPriceCacheV1`
- Optional syntax checks:
  - `node --check server.mjs`
  - `node --check src/app.js`
