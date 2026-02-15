# Albion Crafting Calculator - System Spec

## 1. Purpose
- Provide a local web app to evaluate Albion crafting profitability by city.
- Use market data + recipe data to estimate:
  - craft cost
  - sell price
  - profit and margin
  - estimated sell volume/day
- Support cache-first operation with manual price editing.

## 2. Runtime Architecture
- Frontend: static HTML/CSS/JS
  - `index.html`
  - `src/app.js`
  - `src/styles.css`
- Backend: Node HTTP server
  - `server.mjs`
  - Serves static files and proxies/aggregates market endpoints.
- Recipe cache (server-side file):
  - `data/recipes-cache.json`
- Price cache (client-side browser localStorage):
  - key: `albionCraftPriceCacheV1`

## 3. Data Sources
- Recipe/name sources:
  - ao-data / broderickhyman JSON + XML dumps
  - local fallbacks in `data/` if present
- Market sources (via backend proxy):
  - `stats/prices` for live order-book values
  - `stats/history` for average price and volume metrics

## 4. API Surface (local backend)
- `GET /api/recipes`
  - Builds/loads recipe cache and returns normalized craftable recipes.
- `POST /api/prices`
  - Inputs:
    - `city`, `itemIds[]`
    - `mode`: `material | sell | buy | sell_avg | volume_avg`
    - `quality` (fixed from frontend to normal=1)
    - `averageDays` (for history modes)
    - `fallbackToLive` (used for `sell_avg`)
  - Output:
    - `prices` map keyed by item id.

## 5. Pricing Rules Used by Calculator
- Quality:
  - always normal quality (`1`).
- Materials:
  - `material` mode from selected city
  - backend picks `sell_price_min`, fallback `buy_price_max`.
- Sell price (normal city mode):
  - `sell_avg` with `averageDays=1`.
- Sell price (Black Market mode):
  - `sell_avg` with `averageDays=7`.
- Sell volume estimate/day:
  - `volume_avg` with `averageDays=30`
  - weighted by recency (more recent days contribute more).
- Material fallback:
  - when material live price is still missing, frontend requests `sell_avg` (1 day) for those missing material ids and stores it as material price.

## 6. Cache Schema (browser localStorage)
- Storage key: `albionCraftPriceCacheV1`
- Structure:

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
- `p`: integer price/metric.
- `ts`: epoch milliseconds (last update time).
- Missing entry means price=0.
- Legacy numeric entries are accepted and treated as stale.
- `blackMarket.buy` is legacy and not used by current calculator logic.

## 7. Fetch Policy
- `Fetch Prices`:
  - cache-first.
  - API request only when scoped entry is:
    - missing/zero, or
    - stale (>= 1 hour old).
- `Force Fetch API`:
  - bypasses freshness and fetches full scoped set.
- Freshness threshold:
  - 1 hour (`60 * 60 * 1000` ms).

## 8. Scope of Requests
- Scope derives from current Calculator filters:
  - text, tier, category, enchant.
- If no filters are set:
  - full recipe scope.
- For scoped recipes:
  - fetches crafted item ids (sell + volume)
  - fetches ingredient ids (material prices)
  - no cross-city material routing.

## 9. UI/UX Features
- Tabs:
  - Calculator
  - Price Editor
- Calculator:
  - columns: item, tier, category, enchant, sell price, est sell/day, craft cost, profit, margin, missing prices.
  - item name click expands ingredient breakdown row.
  - expanded breakdown shows per-ingredient qty, effective qty, source, unit price, total cost.
  - expanded breakdown supports inline save/clear of ingredient prices into cache.
  - craft plan supports adding target output items with quantities.
  - craft plan computes aggregated material buy quantities and estimated buy cost.
  - highlight threshold (default 20%).
  - bonus toggles/inputs: premium, city bonus, focus.
  - optional Black Market sell source toggle.
- Price Editor:
  - sections: common materials, artifacts, crafted items.
  - filter by text/tier/category/enchant.
  - direct cache editing (save/clear).
  - collapsible sections.
- Mobile:
  - dedicated card-style calculator rows at small width.

## 10. Calculation Model
- Effective material amount:
  - `required_amount * (1 - total_return_rate)`.
- Total return rate:
  - sum of enabled bonus rates, capped at 95%.
- Craft tax:
  - flat percent over effective material cost.
- Profit:
  - `sellPrice - craftCost`.
- Margin:
  - `profit / craftCost`.
- Missing ingredient prices:
  - tracked per row; incomplete rows show missing count.

## 11. Category/Item Classification Notes
- Item names are human-readable, enchant suffix included.
- Category inference is item-id based with safeguards:
  - artifact detection is prioritized to avoid weapon misclassification.
- Enchant variants (`.0`-`.4`) are represented explicitly.

## 12. Operational Notes
- Start:
  - `node server.mjs`
  - open `http://localhost:5173`
- First run:
  - recipe cache build can take time.
- Common failure classes:
  - API 429/rate-limits
  - temporary connectivity
  - upstream dump schema/source changes
- Backend includes retry/backoff for 429.

## 13. Restart Checklist
- Ensure these files exist:
  - `server.mjs`
  - `src/app.js`
  - `index.html`
  - `src/styles.css`
- Ensure recipe cache can be rebuilt:
  - `data/recipes-cache.json`
- Verify localStorage key migration behavior:
  - `albionCraftPriceCacheV1`
- Run syntax checks if needed:
  - `node --check server.mjs`
  - `node --check src/app.js`
