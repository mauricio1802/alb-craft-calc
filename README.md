# Albion Crafting Calculator (MVP)

Local web interface to estimate crafting profitability per city in Albion Online.

## What it does

- Computes crafting cost from material prices and resource return bonuses.
- Pulls live prices from `albion-online-data.com`.
- Uses one selected city for both materials and crafted item prices (no cross-city routing).
- Highlights items where margin is above a configurable threshold (default `20%`).
- Lets you toggle bonuses on/off (premium, city bonus, focus) and adjust each percentage.
- Shows human-readable item names.
- Supports filtering by search text, Tier, Category, and Enchantment.
- Optional checkbox to use Black Market price for crafted output items.
- Shows estimated sell volume per day for crafted items (30-day weighted average).
- Includes a `Price Editor` tab with common materials, artifacts, and crafted items.
- `Price Editor` supports filters by search text, Tier, Category, and Enchantment.
- `Price Editor` sections are collapsible/expandable.
- Prices are stored in a local browser cache (default `0` when missing).
- `Fetch Prices` is cache-first: it loads cached prices and only calls API for prices that are missing (`0`) or older than 1 hour in current filter scope.
- `Force Fetch API` refreshes scoped prices from API even when already cached.
- Manual edits in `Price Editor` write directly to the same cache used by calculations.
- Prices are fetched only when you click `Fetch Prices`.
- Price fetch scope follows current Calculator filters (text, tier, category, enchant).

## Run locally

From this folder:

```bash
node server.mjs
```

Then open:

- [http://localhost:5173](http://localhost:5173)

## Notes

- Recipe source: item/crafting dumps (`ao-data` / `broderickhyman`) parsed by local backend.
- Optional manual sources: `/Users/mauricio/PersonalProgramming/albion-craft-calc/data/recipes.json`, `/Users/mauricio/PersonalProgramming/albion-craft-calc/data/items.json`, `/Users/mauricio/PersonalProgramming/albion-craft-calc/data/craftingrequirements.json`, `/Users/mauricio/PersonalProgramming/albion-craft-calc/data/items.xml`.
- Price source: Albion Online Data API (`/api/v2/stats/prices` + `/api/v2/stats/history`) via local backend proxy (`/api/prices`).
- Quality is fixed to `Normal` (`1`) for all feed lookups.
- Material cost uses current city `sell_price_min` (fallback `buy_price_max`).
- Crafted-item sell price uses city 1-day average sell history (fallback to live sell when history is missing).
- Black Market mode uses Black Market 7-day average sell history for crafted-item sell price.
- Sell volume estimate uses 30-day weighted daily average from market history.
- Crafting tax is modeled as a flat % over effective material cost.
- Resource return is modeled as the sum of enabled bonus percentages (capped at `95%`).
- First startup loads/parses recipe sources and caches the result.
- Cache file: `/Users/mauricio/PersonalProgramming/albion-craft-calc/data/recipes-cache.json`.
- Recipes are reused from cache on next runs (unless cache file is deleted or force-refresh is requested).

## Do I need to feed data manually?

No. You only need to click `Fetch Prices` when you want market data.

The app auto-loads:

- Recipes + item names from dump sources (through local backend)
- Cached prices from browser local storage
- Market prices from Albion Online Data API (on demand, via `Fetch Prices` / `Force Fetch API`)

If the table is empty, check the status text in the UI. Typical causes:

- No internet connectivity.
- Running with `python -m http.server` instead of `node server.mjs`.
- Temporary API issue/rate-limit.
- Upstream dump schema/source changed.
- JSON dumps unavailable but XML dump still available (backend now has XML fallback parsing).

Use **Fetch Prices** after connectivity is back.

## Next improvements

- Add proper focus math per item category/spec.
- Add item name localization (instead of raw item IDs).
- Add station usage/food fees and artifact-specific handling.
