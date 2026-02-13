const RECIPE_API = "/api/recipes";
const PRICE_API = "/api/prices";
const PRICE_CACHE_KEY = "albionCraftPriceCacheV1";
const NORMAL_QUALITY = 1;
const SELL_AVERAGE_DAYS = 1;
const BLACK_MARKET_SELL_AVERAGE_DAYS = 7;
const SELL_VOLUME_AVERAGE_DAYS = 30;

const ui = {
  city: document.getElementById("city"),
  useBlackMarketSell: document.getElementById("useBlackMarketSell"),
  marginThreshold: document.getElementById("marginThreshold"),
  craftTax: document.getElementById("craftTax"),
  premiumEnabled: document.getElementById("premiumEnabled"),
  premiumRate: document.getElementById("premiumRate"),
  cityBonusEnabled: document.getElementById("cityBonusEnabled"),
  cityBonusRate: document.getElementById("cityBonusRate"),
  focusEnabled: document.getElementById("focusEnabled"),
  focusRate: document.getElementById("focusRate"),
  refreshBtn: document.getElementById("refreshBtn"),
  forceRefreshBtn: document.getElementById("forceRefreshBtn"),
  status: document.getElementById("status"),

  tabCalculator: document.getElementById("tabCalculator"),
  tabPrices: document.getElementById("tabPrices"),
  panelCalculator: document.getElementById("panelCalculator"),
  panelPrices: document.getElementById("panelPrices"),

  rows: document.getElementById("rows"),
  search: document.getElementById("search"),
  filterTier: document.getElementById("filterTier"),
  filterCategory: document.getElementById("filterCategory"),
  filterEnchant: document.getElementById("filterEnchant"),

  refreshPricesBtn: document.getElementById("refreshPricesBtn"),
  forceRefreshPricesBtn: document.getElementById("forceRefreshPricesBtn"),
  priceSearch: document.getElementById("priceSearch"),
  priceFilterTier: document.getElementById("priceFilterTier"),
  priceFilterCategory: document.getElementById("priceFilterCategory"),
  priceFilterEnchant: document.getElementById("priceFilterEnchant"),
  commonMaterialRows: document.getElementById("commonMaterialRows"),
  artifactRows: document.getElementById("artifactRows"),
  itemPriceRows: document.getElementById("itemPriceRows"),
};

let recipeData = [];
let lastComputedRows = [];
let lastMaterialPriceMap = null;
let lastCityAverageSellPriceMap = null;
let lastBlackMarketAverageSellPriceMap = null;
let lastCitySellVolumeMap = null;
let lastBlackMarketSellVolumeMap = null;
let lastPriceMap = null;
let lastScope = null;
let priceCache = loadPriceCache();

const priceCatalog = {
  craftItemIds: [],
  craftItemIdSet: new Set(),
  commonMaterialIds: [],
  artifactIds: [],
  nameById: new Map(),
  metaById: new Map(),
};

function setStatus(text) {
  ui.status.textContent = text;
}

function createEmptyPriceCache() {
  return {
    cities: {},
    blackMarket: {
      buy: {},
      sellAvg7: {},
      sellVol30: {},
    },
  };
}

function loadPriceCache() {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return createEmptyPriceCache();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return createEmptyPriceCache();

    if (!parsed.cities || typeof parsed.cities !== "object") {
      parsed.cities = {};
    }
    if (!parsed.blackMarket || typeof parsed.blackMarket !== "object") {
      parsed.blackMarket = { buy: {}, sellAvg7: {}, sellVol30: {} };
    }
    if (!parsed.blackMarket.buy || typeof parsed.blackMarket.buy !== "object") {
      parsed.blackMarket.buy = {};
    }
    if (
      !parsed.blackMarket.sellAvg7 ||
      typeof parsed.blackMarket.sellAvg7 !== "object"
    ) {
      parsed.blackMarket.sellAvg7 = {};
    }
    if (
      !parsed.blackMarket.sellVol30 ||
      typeof parsed.blackMarket.sellVol30 !== "object"
    ) {
      parsed.blackMarket.sellVol30 = {};
    }
    return parsed;
  } catch {
    return createEmptyPriceCache();
  }
}

function savePriceCache() {
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(priceCache));
}

function getCityCache(city) {
  if (!priceCache.cities[city] || typeof priceCache.cities[city] !== "object") {
    priceCache.cities[city] = { material: {}, sellAvg: {}, sellVol30: {} };
  }
  const entry = priceCache.cities[city];
  if (!entry.material || typeof entry.material !== "object") {
    entry.material = {};
  }
  if (!entry.sellAvg || typeof entry.sellAvg !== "object") {
    entry.sellAvg = {};
  }
  if (!entry.sellVol30 || typeof entry.sellVol30 !== "object") {
    entry.sellVol30 = {};
  }
  return entry;
}

function getSourceCacheObject(city, source) {
  if (source === "material") return getCityCache(city).material;
  if (source === "sell_avg") return getCityCache(city).sellAvg;
  if (source === "sell_volume_avg30") return getCityCache(city).sellVol30;
  if (source === "black_market_buy") return priceCache.blackMarket.buy;
  if (source === "black_market_sell_avg7") return priceCache.blackMarket.sellAvg7;
  if (source === "black_market_sell_volume_avg30")
    return priceCache.blackMarket.sellVol30;
  return {};
}

function getCachedPrice(city, source, itemId) {
  const value = Number(getSourceCacheObject(city, source)?.[itemId]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function setCachedPrice(city, source, itemId, price, persist = true) {
  const target = getSourceCacheObject(city, source);
  const rounded = Math.round(Number(price) || 0);
  if (rounded > 0) {
    target[itemId] = rounded;
  } else {
    delete target[itemId];
  }
  if (persist) {
    savePriceCache();
  }
}

function mergeFetchedPricesIntoCache(city, source, priceMap) {
  if (!(priceMap instanceof Map) || !priceMap.size) {
    return;
  }
  for (const [itemId, price] of priceMap.entries()) {
    if (!itemId) continue;
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    setCachedPrice(city, source, itemId, numeric, false);
  }
  savePriceCache();
}

function buildMapFromCache(city, source, itemIds) {
  const out = new Map();
  for (const itemId of itemIds) {
    const price = getCachedPrice(city, source, itemId);
    if (price > 0) {
      out.set(itemId, price);
    }
  }
  return out;
}

function collectMissingPriceIds(city, source, itemIds) {
  return itemIds.filter((itemId) => getCachedPrice(city, source, itemId) <= 0);
}

function readBonusRate(enabledEl, rateEl) {
  if (!enabledEl.checked) {
    return 0;
  }
  const value = Number.parseFloat(rateEl.value);
  return Number.isFinite(value) ? Math.max(0, value) / 100 : 0;
}

function getTotalReturnRate() {
  const total =
    readBonusRate(ui.premiumEnabled, ui.premiumRate) +
    readBonusRate(ui.cityBonusEnabled, ui.cityBonusRate) +
    readBonusRate(ui.focusEnabled, ui.focusRate);
  return Math.max(0, Math.min(0.95, total));
}

function formatSilver(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTitleCase(token) {
  return token
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function parseTierFromItemId(itemId) {
  if (typeof itemId !== "string") return null;
  const match = itemId.match(/^T(\d+)/i) || itemId.match(/\bT(\d+)_/i);
  if (!match) return null;
  const tier = Number(match[1]);
  return Number.isFinite(tier) ? tier : null;
}

function parseEnchantmentFromItemId(itemId) {
  if (typeof itemId !== "string") return 0;
  const match = itemId.match(/@(\d+)$/);
  if (!match) return 0;
  const enchantment = Number(match[1]);
  return Number.isFinite(enchantment) ? enchantment : 0;
}

function inferCategoryFromItemId(itemId) {
  const id = String(itemId || "").toUpperCase();

  // Artifact IDs can include weapon/off-hand tokens, so classify them first.
  if (
    id.includes("ARTEFACT") ||
    id.includes("_RUNE") ||
    id.includes("_SOUL") ||
    id.includes("_RELIC") ||
    id.includes("TOKEN_FAVOR")
  ) {
    return "Artifacts";
  }

  if (id.includes("_MAIN_") || id.includes("_2H_")) return "Weapons";
  if (
    id.includes("_OFF_") ||
    id.includes("_SHIELD") ||
    id.includes("_TORCH") ||
    id.includes("_BOOK") ||
    id.includes("_ORB") ||
    id.includes("_TOTEM") ||
    id.includes("_MUISAK")
  ) {
    return "Off-hands";
  }
  if (
    id.includes("_HEAD_") ||
    id.includes("_ARMOR_") ||
    id.includes("_SHOES_") ||
    id.includes("_ROBE_") ||
    id.includes("_JACKET_") ||
    id.includes("_HELMET_")
  ) {
    return "Armor";
  }
  if (id.includes("_CAPE")) return "Capes";
  if (id.includes("_BAG")) return "Bags";
  if (id.includes("_POTION")) return "Potions";
  if (id.includes("_MEAL") || id.includes("_FOOD")) return "Food";
  if (id.includes("_MOUNT") || id.includes("_OX") || id.includes("_HORSE")) {
    return "Mounts";
  }
  if (/(?:_|^)(ORE|FIBER|HIDE|WOOD|ROCK|STONE)(?:_|$)/.test(id)) {
    return "Raw Resources";
  }
  if (/(?:_|^)(METALBAR|CLOTH|LEATHER|PLANKS|STONEBLOCK)(?:_|$)/.test(id)) {
    return "Refined Resources";
  }
  if (id.includes("_SEED") || id.includes("_FARM_")) return "Farming";
  if (id.includes("_TOOL_")) return "Tools";

  return "Other";
}

function normalizeCategory(rawCategory, itemId) {
  if (isArtifactItemId(itemId)) {
    return "Artifacts";
  }

  if (typeof rawCategory === "string" && rawCategory.trim().length > 0) {
    const normalized = toTitleCase(rawCategory);
    if (normalized.toLowerCase().includes("artifact")) {
      return "Artifacts";
    }
    return normalized;
  }
  return inferCategoryFromItemId(itemId);
}

function prettyNameFromItemId(itemId) {
  if (typeof itemId !== "string" || !itemId.length) return "Unknown";
  const enchant = parseEnchantmentFromItemId(itemId);
  const base = itemId.split("@")[0];
  const name = toTitleCase(base);
  return enchant > 0 ? `${name} .${enchant}` : name;
}

function displayName(name, itemId) {
  const enchant = parseEnchantmentFromItemId(itemId);
  if (enchant > 0 && !String(name).includes(`.${enchant}`)) {
    return `${name} .${enchant}`;
  }
  return name;
}

function isArtifactItemId(itemId) {
  const id = String(itemId || "").toUpperCase();
  return (
    id.includes("ARTEFACT") ||
    id.includes("_RUNE") ||
    id.includes("_SOUL") ||
    id.includes("_RELIC") ||
    id.includes("TOKEN_FAVOR")
  );
}

function normalizeRecipes(rawRecipes) {
  if (!Array.isArray(rawRecipes)) return [];

  const normalized = [];
  for (const recipe of rawRecipes) {
    const itemId = typeof recipe?.itemId === "string" ? recipe.itemId.trim() : "";
    if (!itemId) continue;

    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients
          .map((ingredient) => ({
            itemId:
              typeof ingredient?.itemId === "string"
                ? ingredient.itemId.trim()
                : "",
            amount: Number(ingredient?.amount),
          }))
          .filter(
            (ingredient) =>
              ingredient.itemId.length > 0 &&
              Number.isFinite(ingredient.amount) &&
              ingredient.amount > 0
          )
      : [];

    if (!ingredients.length) continue;

    const tierRaw = Number(recipe?.tier);
    const enchantRaw = Number(recipe?.enchantment);

    const tier =
      Number.isFinite(tierRaw) && tierRaw > 0
        ? tierRaw
        : parseTierFromItemId(itemId);

    const enchantment =
      Number.isFinite(enchantRaw) && enchantRaw >= 0
        ? enchantRaw
        : parseEnchantmentFromItemId(itemId);

    const baseName =
      typeof recipe?.name === "string" && recipe.name.trim().length > 0
        ? recipe.name.trim()
        : prettyNameFromItemId(itemId);

    normalized.push({
      itemId,
      name: displayName(baseName, itemId),
      tier,
      enchantment,
      category: normalizeCategory(recipe?.category, itemId),
      ingredients,
    });
  }

  return normalized;
}

function populateCategoryFilter(recipes) {
  const previous = ui.filterCategory.value;
  const categories = [...new Set(recipes.map((recipe) => recipe.category))]
    .filter((category) => typeof category === "string" && category.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const options = [
    '<option value="">All Categories</option>',
    ...categories.map(
      (category) =>
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ),
  ];
  ui.filterCategory.innerHTML = options.join("");

  if (categories.includes(previous)) {
    ui.filterCategory.value = previous;
  }
}

function sortIdsByName(ids) {
  return [...ids].sort((a, b) => {
    const nameA = priceCatalog.nameById.get(a) || prettyNameFromItemId(a);
    const nameB = priceCatalog.nameById.get(b) || prettyNameFromItemId(b);
    return nameA.localeCompare(nameB);
  });
}

function buildPriceCatalog(recipes) {
  const ingredientIds = new Set();
  const craftItemIds = new Set();
  const nameById = new Map();
  const metaById = new Map();

  for (const recipe of recipes) {
    craftItemIds.add(recipe.itemId);
    nameById.set(recipe.itemId, recipe.name || prettyNameFromItemId(recipe.itemId));
    metaById.set(recipe.itemId, {
      tier: recipe.tier ?? parseTierFromItemId(recipe.itemId),
      enchantment: recipe.enchantment ?? parseEnchantmentFromItemId(recipe.itemId),
      category: recipe.category || inferCategoryFromItemId(recipe.itemId),
    });

    for (const ingredient of recipe.ingredients || []) {
      ingredientIds.add(ingredient.itemId);
      if (!nameById.has(ingredient.itemId)) {
        nameById.set(ingredient.itemId, prettyNameFromItemId(ingredient.itemId));
      }
      if (!metaById.has(ingredient.itemId)) {
        metaById.set(ingredient.itemId, {
          tier: parseTierFromItemId(ingredient.itemId),
          enchantment: parseEnchantmentFromItemId(ingredient.itemId),
          category: inferCategoryFromItemId(ingredient.itemId),
        });
      }
    }
  }

  const commonMaterialIds = [];
  const artifactIds = [];

  for (const itemId of ingredientIds) {
    if (isArtifactItemId(itemId)) {
      artifactIds.push(itemId);
    } else {
      commonMaterialIds.push(itemId);
    }
  }

  priceCatalog.craftItemIds = sortIdsByName(craftItemIds);
  priceCatalog.craftItemIdSet = new Set(priceCatalog.craftItemIds);
  priceCatalog.commonMaterialIds = sortIdsByName(commonMaterialIds);
  priceCatalog.artifactIds = sortIdsByName(artifactIds);
  priceCatalog.nameById = nameById;
  priceCatalog.metaById = metaById;
  populatePriceEditorCategoryFilter(metaById);
}

function populatePriceEditorCategoryFilter(metaById) {
  const previous = ui.priceFilterCategory?.value || "";
  const categories = [...new Set([...metaById.values()].map((m) => m.category))]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const options = [
    '<option value="">All Categories</option>',
    ...categories.map(
      (category) =>
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ),
  ];
  if (ui.priceFilterCategory) {
    ui.priceFilterCategory.innerHTML = options.join("");
    if (categories.includes(previous)) {
      ui.priceFilterCategory.value = previous;
    }
  }
}

function getPriceEditorFilters() {
  return {
    search: ui.priceSearch?.value?.trim().toLowerCase() || "",
    tier: ui.priceFilterTier?.value || "",
    category: ui.priceFilterCategory?.value || "",
    enchant: ui.priceFilterEnchant?.value || "",
  };
}

function getCalculatorFilters() {
  return {
    search: ui.search.value.trim().toLowerCase(),
    tier: ui.filterTier.value,
    category: ui.filterCategory.value,
    enchant: ui.filterEnchant.value,
  };
}

function hasAnyCalculatorFilter(filters) {
  return Boolean(filters.search || filters.tier || filters.category || filters.enchant);
}

function matchesCalculatorFilters(recipeOrRow, filters) {
  if (filters.search && !String(recipeOrRow?.name || "").toLowerCase().includes(filters.search)) {
    return false;
  }
  if (filters.tier && String(recipeOrRow?.tier || "") !== filters.tier) {
    return false;
  }
  if (filters.category && recipeOrRow?.category !== filters.category) {
    return false;
  }
  if (
    filters.enchant &&
    String(recipeOrRow?.enchantment ?? 0) !== filters.enchant
  ) {
    return false;
  }
  return true;
}

function getRecipesForFetch(recipes) {
  const filters = getCalculatorFilters();
  if (!hasAnyCalculatorFilter(filters)) {
    return recipes;
  }
  return recipes.filter((recipe) => matchesCalculatorFilters(recipe, filters));
}

function matchesPriceEditorFilters(itemId, name, filters) {
  const meta = priceCatalog.metaById.get(itemId) || {
    tier: parseTierFromItemId(itemId),
    enchantment: parseEnchantmentFromItemId(itemId),
    category: inferCategoryFromItemId(itemId),
  };
  if (filters.search && !String(name).toLowerCase().includes(filters.search)) {
    return false;
  }
  if (filters.tier && String(meta.tier || "") !== filters.tier) {
    return false;
  }
  if (filters.category && meta.category !== filters.category) {
    return false;
  }
  if (filters.enchant && String(meta.enchantment || 0) !== filters.enchant) {
    return false;
  }
  return true;
}

function buildEffectivePriceMap(materialPriceMap, city, useBlackMarketSell = false) {
  const effective = new Map(materialPriceMap ? [...materialPriceMap.entries()] : []);

  const sellSource = useBlackMarketSell
    ? lastBlackMarketAverageSellPriceMap
    : lastCityAverageSellPriceMap;
  for (const itemId of priceCatalog.craftItemIds) {
    const sellPrice = Number(sellSource?.get(itemId) || 0);
    if (Number.isFinite(sellPrice) && sellPrice > 0) {
      effective.set(itemId, sellPrice);
    }
  }
  return effective;
}

function applyCurrentCacheAndRender() {
  rebuildScopedMapsFromCache(lastScope);
  if (lastPriceMap) {
    recomputeAndRender();
  }
  renderPriceEditor();
}

function setActiveTab(tab) {
  const calculatorActive = tab === "calculator";
  ui.tabCalculator.classList.toggle("active", calculatorActive);
  ui.tabPrices.classList.toggle("active", !calculatorActive);
  ui.panelCalculator.classList.toggle("hidden", !calculatorActive);
  ui.panelPrices.classList.toggle("hidden", calculatorActive);
}

function renderPriceRows(itemIds, container, filters, source) {
  const city = ui.city.value;

  const filtered = itemIds.filter((itemId) => {
    const name = priceCatalog.nameById.get(itemId) || itemId;
    return matchesPriceEditorFilters(itemId, name, filters);
  });

  const limited = filtered.slice(0, 400);

  if (!limited.length) {
    container.innerHTML =
      '<tr><td colspan="5" class="soft">No prices match current filter.</td></tr>';
    return;
  }

  const rows = limited
    .map((itemId) => {
      const name = priceCatalog.nameById.get(itemId) || prettyNameFromItemId(itemId);
      const cachedPrice = getCachedPrice(city, source, itemId);

      return `
        <tr data-item-id="${escapeHtml(itemId)}" data-source="${escapeHtml(source)}">
          <td>${escapeHtml(name)}</td>
          <td class="num">${formatSilver(cachedPrice)}</td>
          <td>
            <input
              class="price-input"
              type="number"
              min="0"
              step="1"
              value="${cachedPrice > 0 ? String(Math.round(cachedPrice)) : ""}"
              data-role="price-input"
            />
          </td>
          <td class="num">${formatSilver(cachedPrice)}</td>
          <td>
            <span class="action-row">
              <button class="action-btn" type="button" data-action="save">Save</button>
              <button class="action-btn secondary" type="button" data-action="clear">Clear</button>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = rows;
}

function renderPriceEditor() {
  if (!recipeData.length) {
    const placeholder =
      '<tr><td colspan="5" class="soft">Load recipes to edit cached prices.</td></tr>';
    ui.commonMaterialRows.innerHTML = placeholder;
    ui.artifactRows.innerHTML = placeholder;
    ui.itemPriceRows.innerHTML = placeholder;
    return;
  }

  const filters = getPriceEditorFilters();
  renderPriceRows(priceCatalog.commonMaterialIds, ui.commonMaterialRows, filters, "material");
  renderPriceRows(priceCatalog.artifactIds, ui.artifactRows, filters, "material");
  renderPriceRows(
    priceCatalog.craftItemIds,
    ui.itemPriceRows,
    filters,
    ui.useBlackMarketSell.checked ? "black_market_sell_avg7" : "sell_avg"
  );
}

function handlePriceAction(button) {
  const row = button.closest("tr[data-item-id]");
  if (!row) return;

  const itemId = row.getAttribute("data-item-id");
  const source = row.getAttribute("data-source");
  if (!itemId) return;
  if (!source) return;

  const input = row.querySelector('input[data-role="price-input"]');
  const action = button.getAttribute("data-action");
  const city = ui.city.value;

  if (action === "clear") {
    setCachedPrice(city, source, itemId, 0);
    applyCurrentCacheAndRender();
    setStatus(`Cleared cached price for ${itemId} (${source}) in ${city}.`);
    return;
  }

  if (action === "save") {
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value <= 0) {
      setStatus("Override must be a positive number.");
      return;
    }

    setCachedPrice(city, source, itemId, Math.round(value));
    applyCurrentCacheAndRender();
    setStatus(`Saved cached price for ${itemId} (${source}) in ${city}.`);
  }
}

async function loadRecipes() {
  setStatus("Loading recipes from local backend...");

  const res = await fetch(RECIPE_API);
  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok) {
    throw new Error(
      payload?.error ||
        `Recipe API failed (${res.status}). Start with: node server.mjs`
    );
  }

  const recipes = normalizeRecipes(payload?.recipes);
  if (!recipes.length) {
    throw new Error(payload?.error || "Recipe API returned 0 recipes.");
  }

  populateCategoryFilter(recipes);
  buildPriceCatalog(recipes);

  const generatedAt = payload.generatedAt || "unknown time";
  setStatus(
    `Loaded ${recipes.length.toLocaleString()} craftable items (cache: ${generatedAt}).`
  );
  return recipes;
}

async function fetchPricesForCity(city, itemIds, options = {}) {
  const {
    mode = "material",
    quality = NORMAL_QUALITY,
    averageDays,
    fallbackToLive = false,
    statusText = `Fetching market prices for ${city}...`,
  } = options;
  setStatus(statusText);

  const res = await fetch(PRICE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      city,
      itemIds,
      mode,
      quality,
      averageDays,
      fallbackToLive,
    }),
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok) {
    throw new Error(payload?.error || `Price API proxy failed (${res.status}).`);
  }

  const rawPrices = payload?.prices || {};
  const allPrices = new Map();
  for (const [itemId, priceRaw] of Object.entries(rawPrices)) {
    const price = Number(priceRaw);
    if (!itemId || !Number.isFinite(price) || price <= 0) continue;
    allPrices.set(itemId, price);
  }
  return allPrices;
}

function collectIngredientIds(recipes) {
  const ids = new Set();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients || []) {
      ids.add(ingredient.itemId);
    }
  }
  return [...ids];
}

function collectCraftIds(recipes) {
  const ids = new Set();
  for (const recipe of recipes) {
    ids.add(recipe.itemId);
  }
  return [...ids];
}

function getActiveSellVolumeMap() {
  return ui.useBlackMarketSell.checked
    ? lastBlackMarketSellVolumeMap
    : lastCitySellVolumeMap;
}

function calculateRows(recipes, priceMap) {
  const rrr = getTotalReturnRate();
  const taxRate = Math.max(0, Number.parseFloat(ui.craftTax.value) || 0) / 100;

  const rows = [];
  for (const recipe of recipes) {
    const itemPrice = priceMap.get(recipe.itemId) || 0;
    if (itemPrice <= 0) continue;

    let materialsCost = 0;
    let missingCount = 0;

    for (const ingredient of recipe.ingredients || []) {
      const ingredientPrice = priceMap.get(ingredient.itemId) || 0;
      if (ingredientPrice <= 0) {
        missingCount += 1;
        continue;
      }

      const effectiveAmount = Number(ingredient.amount || 0) * (1 - rrr);
      if (effectiveAmount > 0) {
        materialsCost += ingredientPrice * effectiveAmount;
      }
    }

    const taxCost = materialsCost * taxRate;
    const craftCost = materialsCost + taxCost;
    const hasCompleteCost = missingCount === 0 && craftCost > 0;
    const profit = hasCompleteCost ? itemPrice - craftCost : Number.NaN;
    const margin = hasCompleteCost ? profit / craftCost : Number.NaN;

    rows.push({
      itemId: recipe.itemId,
      name: recipe.name,
      tier: recipe.tier,
      category: recipe.category,
      enchantment: recipe.enchantment,
      sellPrice: itemPrice,
      sellVolume: Number(getActiveSellVolumeMap()?.get(recipe.itemId) || 0),
      craftCost,
      profit,
      margin,
      missingCount,
      isComplete: hasCompleteCost,
    });
  }

  rows.sort((a, b) => {
    if (a.isComplete !== b.isComplete) {
      return a.isComplete ? -1 : 1;
    }
    if (!a.isComplete && !b.isComplete) {
      if (a.missingCount !== b.missingCount) {
        return a.missingCount - b.missingCount;
      }
      return b.sellPrice - a.sellPrice;
    }
    return (b.margin || 0) - (a.margin || 0);
  });
  return rows;
}

function renderRows(rows) {
  if (!lastPriceMap) {
    ui.rows.innerHTML =
      '<tr><td colspan="10" class="soft">No prices loaded yet. Click Fetch Prices.</td></tr>';
    return;
  }

  const filters = getCalculatorFilters();

  const threshold =
    Math.max(0, Number.parseFloat(ui.marginThreshold.value) || 0) / 100;

  const out = rows
    .filter((row) => matchesCalculatorFilters(row, filters))
    .map((row) => {
      const profitable = row.isComplete && row.margin >= threshold;
      const marginPct = row.isComplete ? row.margin * 100 : Number.NaN;
      const profitClass = row.isComplete && row.profit >= 0 ? "pos" : "neg";

      return `
        <tr class="${profitable ? "profitable" : ""}">
          <td><span class="item-name">${escapeHtml(row.name)}</span></td>
          <td class="num">${row.tier ? `T${row.tier}` : "-"}</td>
          <td>${escapeHtml(row.category || "Other")}</td>
          <td class="num">.${Number(row.enchantment || 0)}</td>
          <td class="num">${formatSilver(row.sellPrice)}</td>
          <td class="num">${row.sellVolume > 0 ? formatSilver(row.sellVolume) : "-"}</td>
          <td class="num">${row.isComplete ? formatSilver(row.craftCost) : "-"}</td>
          <td class="num ${profitClass}">${row.isComplete ? formatSilver(row.profit) : "-"}</td>
          <td class="num ${profitClass}">${row.isComplete ? `${marginPct.toFixed(1)}%` : "-"}</td>
          <td class="num soft">${row.missingCount}</td>
        </tr>
      `;
    })
    .join("");

  ui.rows.innerHTML =
    out || '<tr><td colspan="10">No items match current filters.</td></tr>';
}

function recomputeAndRender() {
  if (!recipeData.length || !lastPriceMap) return;
  lastComputedRows = calculateRows(recipeData, lastPriceMap);
  renderRows(lastComputedRows);
}

function rebuildScopedMapsFromCache(scope) {
  if (!scope) {
    lastMaterialPriceMap = null;
    lastCityAverageSellPriceMap = null;
    lastBlackMarketAverageSellPriceMap = null;
    lastCitySellVolumeMap = null;
    lastBlackMarketSellVolumeMap = null;
    lastPriceMap = null;
    return;
  }

  const { city, ingredientIds, craftIds } = scope;
  lastMaterialPriceMap = buildMapFromCache(city, "material", ingredientIds);
  lastCityAverageSellPriceMap = buildMapFromCache(city, "sell_avg", craftIds);
  lastCitySellVolumeMap = buildMapFromCache(
    city,
    "sell_volume_avg30",
    craftIds
  );
  if (ui.useBlackMarketSell.checked) {
    lastBlackMarketAverageSellPriceMap = buildMapFromCache(
      city,
      "black_market_sell_avg7",
      craftIds
    );
    lastBlackMarketSellVolumeMap = buildMapFromCache(
      city,
      "black_market_sell_volume_avg30",
      craftIds
    );
  } else {
    lastBlackMarketAverageSellPriceMap = null;
    lastBlackMarketSellVolumeMap = null;
  }
  lastPriceMap = buildEffectivePriceMap(
    lastMaterialPriceMap,
    city,
    ui.useBlackMarketSell.checked
  );
}

async function refreshPriceFeedWithOptions(options = {}) {
  const { forceApi = false } = options;
  if (!recipeData.length) {
    recipeData = await loadRecipes();
  }

  const scopedRecipes = getRecipesForFetch(recipeData);
  if (!scopedRecipes.length) {
    throw new Error("No items match current calculator filters.");
  }

  const city = ui.city.value;
  const ingredientIds = collectIngredientIds(scopedRecipes);
  const craftIds = collectCraftIds(scopedRecipes);

  const scope = { city, ingredientIds, craftIds };
  const missingMaterialIds = forceApi
    ? ingredientIds
    : collectMissingPriceIds(city, "material", ingredientIds);
  const missingSellAvgIds = forceApi
    ? craftIds
    : collectMissingPriceIds(city, "sell_avg", craftIds);
  const missingSellVolumeIds =
    !ui.useBlackMarketSell.checked
      ? forceApi
        ? craftIds
        : collectMissingPriceIds(city, "sell_volume_avg30", craftIds)
      : [];
  const missingBlackMarketIds =
    ui.useBlackMarketSell.checked
      ? forceApi
        ? craftIds
        : collectMissingPriceIds(city, "black_market_sell_avg7", craftIds)
      : [];
  const missingBlackMarketVolumeIds =
    ui.useBlackMarketSell.checked
      ? forceApi
        ? craftIds
        : collectMissingPriceIds(city, "black_market_sell_volume_avg30", craftIds)
      : [];

  let fetchedMaterialCount = 0;
  let fetchedMaterialFallbackCount = 0;
  let fetchedSellCount = 0;
  let fetchedSellVolumeCount = 0;
  let fetchedBlackMarketCount = 0;
  let fetchedBlackMarketVolumeCount = 0;

  if (missingMaterialIds.length) {
    const fetched = await fetchPricesForCity(city, missingMaterialIds, {
      mode: "material",
      quality: NORMAL_QUALITY,
      statusText: forceApi
        ? `Force fetching material prices for ${city}...`
        : `Fetching missing material prices for ${city}...`,
    });
    mergeFetchedPricesIntoCache(city, "material", fetched);
    fetchedMaterialCount = fetched.size;

    const stillMissingMaterials = collectMissingPriceIds(
      city,
      "material",
      missingMaterialIds
    );
    if (stillMissingMaterials.length) {
      const fallbackFetched = await fetchPricesForCity(city, stillMissingMaterials, {
        mode: "sell_avg",
        quality: NORMAL_QUALITY,
        averageDays: SELL_AVERAGE_DAYS,
        fallbackToLive: true,
        statusText: `Filling missing material prices with ${SELL_AVERAGE_DAYS}-day averages for ${city}...`,
      });
      mergeFetchedPricesIntoCache(city, "material", fallbackFetched);
      fetchedMaterialFallbackCount = fallbackFetched.size;
    }
  }

  if (missingSellAvgIds.length) {
    const fetched = await fetchPricesForCity(city, missingSellAvgIds, {
      mode: "sell_avg",
      quality: NORMAL_QUALITY,
      averageDays: SELL_AVERAGE_DAYS,
      fallbackToLive: true,
      statusText: forceApi
        ? `Force fetching ${SELL_AVERAGE_DAYS}-day sell averages for ${city}...`
        : `Fetching missing ${SELL_AVERAGE_DAYS}-day sell averages for ${city}...`,
    });
    mergeFetchedPricesIntoCache(city, "sell_avg", fetched);
    fetchedSellCount = fetched.size;
  }

  if (missingSellVolumeIds.length) {
    const fetched = await fetchSellVolumeEstimates(city, missingSellVolumeIds, forceApi);
    mergeFetchedPricesIntoCache(city, "sell_volume_avg30", fetched);
    fetchedSellVolumeCount = fetched.size;
  }

  if (missingBlackMarketIds.length) {
    const fetched = await fetchBlackMarketSellAveragePrices(
      missingBlackMarketIds,
      forceApi
    );
    mergeFetchedPricesIntoCache(city, "black_market_sell_avg7", fetched);
    fetchedBlackMarketCount = fetched.size;
  }

  if (missingBlackMarketVolumeIds.length) {
    const fetched = await fetchBlackMarketSellVolumeEstimates(
      missingBlackMarketVolumeIds,
      forceApi
    );
    mergeFetchedPricesIntoCache(city, "black_market_sell_volume_avg30", fetched);
    fetchedBlackMarketVolumeCount = fetched.size;
  }

  lastScope = scope;
  rebuildScopedMapsFromCache(scope);

  return {
    scopedRecipeCount: scopedRecipes.length,
    scopedItemCount: new Set([...ingredientIds, ...craftIds]).size,
    ingredientCount: ingredientIds.length,
    scopedCraftCount: craftIds.length,
    usedFilters: hasAnyCalculatorFilter(getCalculatorFilters()),
    apiFetched:
      fetchedMaterialCount +
      fetchedMaterialFallbackCount +
      fetchedSellCount +
      fetchedSellVolumeCount +
      fetchedBlackMarketCount +
      fetchedBlackMarketVolumeCount,
    missingRequested:
      missingMaterialIds.length +
      missingSellAvgIds.length +
      missingSellVolumeIds.length +
      missingBlackMarketIds.length +
      missingBlackMarketVolumeIds.length,
    materialFallbackFetched: fetchedMaterialFallbackCount,
    sellVolumeFetched: fetchedSellVolumeCount + fetchedBlackMarketVolumeCount,
  };
}

async function fetchBlackMarketSellAveragePrices(craftIds, forceApi = false) {
  const requestedIds = Array.isArray(craftIds) && craftIds.length
    ? [...new Set(craftIds)]
    : [...priceCatalog.craftItemIds];
  const bmPriceMap = await fetchPricesForCity("Black Market", requestedIds, {
    mode: "sell_avg",
    quality: NORMAL_QUALITY,
    averageDays: BLACK_MARKET_SELL_AVERAGE_DAYS,
    fallbackToLive: false,
    statusText: forceApi
      ? `Force fetching Black Market ${BLACK_MARKET_SELL_AVERAGE_DAYS}-day average sell prices...`
      : `Fetching missing Black Market ${BLACK_MARKET_SELL_AVERAGE_DAYS}-day average sell prices...`,
  });
  return bmPriceMap;
}

async function fetchSellVolumeEstimates(city, craftIds, forceApi = false) {
  const requestedIds =
    Array.isArray(craftIds) && craftIds.length
      ? [...new Set(craftIds)]
      : [...priceCatalog.craftItemIds];
  return fetchPricesForCity(city, requestedIds, {
    mode: "volume_avg",
    quality: NORMAL_QUALITY,
    averageDays: SELL_VOLUME_AVERAGE_DAYS,
    statusText: forceApi
      ? `Force fetching ${SELL_VOLUME_AVERAGE_DAYS}-day weighted sell volume/day for ${city}...`
      : `Fetching missing ${SELL_VOLUME_AVERAGE_DAYS}-day weighted sell volume/day for ${city}...`,
  });
}

async function fetchBlackMarketSellVolumeEstimates(craftIds, forceApi = false) {
  const requestedIds =
    Array.isArray(craftIds) && craftIds.length
      ? [...new Set(craftIds)]
      : [...priceCatalog.craftItemIds];
  return fetchPricesForCity("Black Market", requestedIds, {
    mode: "volume_avg",
    quality: NORMAL_QUALITY,
    averageDays: SELL_VOLUME_AVERAGE_DAYS,
    statusText: forceApi
      ? `Force fetching Black Market ${SELL_VOLUME_AVERAGE_DAYS}-day weighted sell volume/day...`
      : `Fetching missing Black Market ${SELL_VOLUME_AVERAGE_DAYS}-day weighted sell volume/day...`,
  });
}

function getSellSourceLabel() {
  if (ui.useBlackMarketSell.checked) {
    return `Black Market ${BLACK_MARKET_SELL_AVERAGE_DAYS}-day average sell`;
  }
  return `${SELL_AVERAGE_DAYS}-day average sell`;
}

async function refresh(options = {}) {
  const { forceApi = false } = options;
  try {
    ui.refreshBtn.disabled = true;
    if (ui.forceRefreshBtn) {
      ui.forceRefreshBtn.disabled = true;
    }
    if (ui.refreshPricesBtn) {
      ui.refreshPricesBtn.disabled = true;
    }
    if (ui.forceRefreshPricesBtn) {
      ui.forceRefreshPricesBtn.disabled = true;
    }

    const scope = await refreshPriceFeedWithOptions({ forceApi });

    setStatus("Computing profitability...");
    recomputeAndRender();
    renderPriceEditor();

    setStatus(
      `Ready: ${lastComputedRows.length.toLocaleString()} rows for ${ui.city.value}. Scope: ${scope.scopedRecipeCount.toLocaleString()} recipes, ${scope.scopedItemCount.toLocaleString()} items${scope.usedFilters ? " (filtered)" : " (all)"} | API fetched: ${scope.apiFetched.toLocaleString()} / requested: ${scope.missingRequested.toLocaleString()}${forceApi ? " (force)" : ""}${scope.materialFallbackFetched ? ` | material fallback(avg): ${scope.materialFallbackFetched.toLocaleString()}` : ""}${scope.sellVolumeFetched ? ` | sell-volume fetched: ${scope.sellVolumeFetched.toLocaleString()}` : ""} | quality: Normal | sell: ${getSellSourceLabel()}.`
    );
  } catch (error) {
    const details =
      error?.name === "TypeError"
        ? "Could not reach local backend. Make sure `node server.mjs` is running."
        : error.message;
    setStatus(`Error: ${details}`);
  } finally {
    ui.refreshBtn.disabled = false;
    if (ui.forceRefreshBtn) {
      ui.forceRefreshBtn.disabled = false;
    }
    if (ui.refreshPricesBtn) {
      ui.refreshPricesBtn.disabled = false;
    }
    if (ui.forceRefreshPricesBtn) {
      ui.forceRefreshPricesBtn.disabled = false;
    }
  }
}

ui.refreshBtn.addEventListener("click", () => refresh({ forceApi: false }));
ui.forceRefreshBtn?.addEventListener("click", () => refresh({ forceApi: true }));
ui.city.addEventListener("change", async () => {
  lastScope = null;
  rebuildScopedMapsFromCache(null);
  lastComputedRows = [];
  renderRows(lastComputedRows);
  renderPriceEditor();
  setStatus(`City changed to ${ui.city.value}. Click Fetch Prices to load data.`);
});
ui.useBlackMarketSell.addEventListener("change", async () => {
  try {
    ui.useBlackMarketSell.disabled = true;

    if (!lastScope) {
      renderPriceEditor();
      setStatus(
        `Sell source set to ${getSellSourceLabel()}. Click Fetch Prices to load scoped prices.`
      );
      return;
    }

    rebuildScopedMapsFromCache(lastScope);
    recomputeAndRender();
    renderPriceEditor();
    setStatus(
      `Ready: ${lastComputedRows.length.toLocaleString()} items priced for ${ui.city.value}. Quality: Normal | sell: ${getSellSourceLabel()}.`
    );
  } catch (error) {
    const details =
      error?.name === "TypeError"
        ? "Could not reach local backend. Make sure `node server.mjs` is running."
        : error.message;
    setStatus(`Error: ${details}`);
  } finally {
    ui.useBlackMarketSell.disabled = false;
  }
});

ui.search.addEventListener("input", () => renderRows(lastComputedRows));
ui.filterTier.addEventListener("change", () => renderRows(lastComputedRows));
ui.filterCategory.addEventListener("change", () => renderRows(lastComputedRows));
ui.filterEnchant.addEventListener("change", () => renderRows(lastComputedRows));

ui.tabCalculator.addEventListener("click", () => setActiveTab("calculator"));
ui.tabPrices.addEventListener("click", () => {
  setActiveTab("prices");
  renderPriceEditor();
});

[
  ui.priceSearch,
  ui.priceFilterTier,
  ui.priceFilterCategory,
  ui.priceFilterEnchant,
].forEach((el) => {
  el?.addEventListener("input", () => renderPriceEditor());
  el?.addEventListener("change", () => renderPriceEditor());
});

ui.refreshPricesBtn.addEventListener("click", () => refresh({ forceApi: false }));
ui.forceRefreshPricesBtn?.addEventListener("click", () => refresh({ forceApi: true }));

ui.panelPrices.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  handlePriceAction(button);
});

[
  ui.marginThreshold,
  ui.craftTax,
  ui.premiumEnabled,
  ui.premiumRate,
  ui.cityBonusEnabled,
  ui.cityBonusRate,
  ui.focusEnabled,
  ui.focusRate,
].forEach((el) => {
  el.addEventListener("input", () => {
    recomputeAndRender();
  });
});

setActiveTab("calculator");
loadRecipes()
  .then((recipes) => {
    recipeData = recipes;
    renderRows(lastComputedRows);
    renderPriceEditor();
    setStatus(
      `Loaded ${recipeData.length.toLocaleString()} recipes. Set filters and click Fetch Prices.`
    );
  })
  .catch((error) => {
    const details =
      error?.name === "TypeError"
        ? "Could not reach local backend. Make sure `node server.mjs` is running."
        : error.message;
    setStatus(`Error: ${details}`);
  });
