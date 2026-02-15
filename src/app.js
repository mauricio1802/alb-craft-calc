const RECIPE_API = "/api/recipes";
const PRICE_API = "/api/prices";
const PRICE_CACHE_KEY = "albionCraftPriceCacheV1";
const NORMAL_QUALITY = 1;
const SELL_AVERAGE_DAYS = 1;
const BLACK_MARKET_SELL_AVERAGE_DAYS = 7;
const SELL_VOLUME_AVERAGE_DAYS = 30;
const PRICE_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

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
  calculatorHead: document.querySelector("#panelCalculator thead"),

  rows: document.getElementById("rows"),
  search: document.getElementById("search"),
  filterTier: document.getElementById("filterTier"),
  filterCategory: document.getElementById("filterCategory"),
  filterEnchant: document.getElementById("filterEnchant"),
  clearPlanBtn: document.getElementById("clearPlanBtn"),
  planRows: document.getElementById("planRows"),
  planMaterialRows: document.getElementById("planMaterialRows"),
  planTotals: document.getElementById("planTotals"),

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
const recipeById = new Map();
const expandedCraftRows = new Set();
const craftPlan = new Map();
const sortState = {
  key: "margin",
  direction: "desc",
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

function canonicalizeItemId(itemId) {
  const id = String(itemId || "").trim();
  if (!id) return "";
  if (id.endsWith("@0")) {
    return id.slice(0, -2);
  }
  if (id.endsWith("_LEVEL0")) {
    return id.slice(0, -7);
  }
  return id;
}

function getItemIdAliases(itemId) {
  const aliases = [];
  const add = (value) => {
    if (!value) return;
    if (!aliases.includes(value)) aliases.push(value);
  };

  const raw = String(itemId || "").trim();
  const canonical = canonicalizeItemId(raw);

  add(raw);
  add(canonical);
  if (canonical && !canonical.includes("@")) add(`${canonical}@0`);
  if (canonical && !canonical.endsWith("_LEVEL0")) add(`${canonical}_LEVEL0`);

  return aliases;
}

function normalizeCacheTimestamp(raw) {
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function normalizeCachePrice(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function parseCacheEntry(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const price = normalizeCachePrice(raw.p ?? raw.price ?? raw.value ?? 0);
    const timestamp = normalizeCacheTimestamp(raw.ts ?? raw.t ?? raw.updatedAt ?? 0);
    return { price, timestamp };
  }

  // Legacy format was a plain number without timestamp.
  return {
    price: normalizeCachePrice(raw),
    timestamp: 0,
  };
}

function getCachedEntry(city, source, itemId) {
  const sourceObj = getSourceCacheObject(city, source);
  const aliases = getItemIdAliases(itemId);
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(sourceObj, alias)) {
      return parseCacheEntry(sourceObj[alias]);
    }
  }
  return { price: 0, timestamp: 0 };
}

function getMapPriceByAliases(map, itemId) {
  if (!(map instanceof Map)) return 0;
  for (const alias of getItemIdAliases(itemId)) {
    const value = Number(map.get(alias) || 0);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function getCachedPrice(city, source, itemId) {
  return getCachedEntry(city, source, itemId).price;
}

function isCachedEntryStale(entry, nowMs = Date.now()) {
  if (!entry || entry.price <= 0) return true;
  if (entry.timestamp <= 0) return true;
  return nowMs - entry.timestamp >= PRICE_CACHE_MAX_AGE_MS;
}

function setCachedPrice(city, source, itemId, price, persist = true) {
  const target = getSourceCacheObject(city, source);
  const rounded = normalizeCachePrice(price);
  if (rounded > 0) {
    target[itemId] = {
      p: rounded,
      ts: Date.now(),
    };
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
  const nowMs = Date.now();
  return itemIds.filter((itemId) =>
    isCachedEntryStale(getCachedEntry(city, source, itemId), nowMs)
  );
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
  renderCraftPlan();
}

function formatQty(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "0";
  if (Math.abs(num - Math.round(num)) < 0.00001) {
    return String(Math.round(num));
  }
  return num.toFixed(2);
}

function getPlanMaterialUnitPrice(itemId) {
  const fromMap = getMapPriceByAliases(lastMaterialPriceMap, itemId);
  if (fromMap > 0) return fromMap;
  return getCachedPrice(ui.city.value, "material", itemId);
}

function getPlanSellUnitPrice(itemId) {
  const fromMap = getMapPriceByAliases(lastPriceMap, itemId);
  if (fromMap > 0) return fromMap;
  const source = getCalculatorPriceSourceForItem(itemId);
  return getCachedPrice(ui.city.value, source, itemId);
}

function computePlanMaterials() {
  const byId = new Map();
  const rrr = getTotalReturnRate();

  for (const [craftItemId, qtyRaw] of craftPlan.entries()) {
    const quantity = Number(qtyRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const recipe = recipeById.get(craftItemId);
    if (!recipe) continue;

    for (const ingredient of recipe.ingredients || []) {
      const ingredientId = ingredient.itemId;
      const baseAmount = Number(ingredient.amount || 0) * quantity;
      if (!(baseAmount > 0)) continue;

      const effectiveAmount = baseAmount * (1 - rrr);
      let item = byId.get(ingredientId);
      if (!item) {
        item = {
          itemId: ingredientId,
          name:
            priceCatalog.nameById.get(ingredientId) ||
            prettyNameFromItemId(ingredientId),
          requiredQty: 0,
          buyQty: 0,
          unitPrice: 0,
          estCost: 0,
        };
        byId.set(ingredientId, item);
      }
      item.requiredQty += baseAmount;
      item.buyQty += effectiveAmount;
    }
  }

  for (const item of byId.values()) {
    item.unitPrice = getPlanMaterialUnitPrice(item.itemId);
    item.estCost = item.unitPrice > 0 ? item.buyQty * item.unitPrice : 0;
  }

  return [...byId.values()].sort((a, b) => b.estCost - a.estCost);
}

function computePlanEconomics(planEntries) {
  const rrr = getTotalReturnRate();
  const taxRate = Math.max(0, Number.parseFloat(ui.craftTax.value) || 0) / 100;

  let totalSell = 0;
  let totalCraftCost = 0;
  let incompleteItems = 0;

  for (const entry of planEntries) {
    const recipe = recipeById.get(entry.itemId);
    if (!recipe) continue;

    let materialsCostPerUnit = 0;
    let missingIngredients = 0;

    for (const ingredient of recipe.ingredients || []) {
      const unitPrice = getPlanMaterialUnitPrice(ingredient.itemId);
      if (!(unitPrice > 0)) {
        missingIngredients += 1;
        continue;
      }
      const effectiveAmount = Number(ingredient.amount || 0) * (1 - rrr);
      if (effectiveAmount > 0) {
        materialsCostPerUnit += unitPrice * effectiveAmount;
      }
    }

    const craftCostPerUnit = materialsCostPerUnit * (1 + taxRate);
    const sellPricePerUnit = getPlanSellUnitPrice(entry.itemId);

    if (missingIngredients > 0 || !(sellPricePerUnit > 0)) {
      incompleteItems += 1;
      continue;
    }

    totalCraftCost += craftCostPerUnit * entry.qty;
    totalSell += sellPricePerUnit * entry.qty;
  }

  const profit = totalSell - totalCraftCost;
  const margin = totalCraftCost > 0 ? profit / totalCraftCost : Number.NaN;

  return {
    totalSell,
    totalCraftCost,
    profit,
    margin,
    incompleteItems,
  };
}

function renderCraftPlan() {
  if (!ui.planRows || !ui.planMaterialRows || !ui.planTotals) return;

  const planEntries = [...craftPlan.entries()]
    .map(([itemId, qty]) => ({
      itemId,
      qty: Number(qty),
      name: priceCatalog.nameById.get(itemId) || prettyNameFromItemId(itemId),
    }))
    .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!planEntries.length) {
    ui.planRows.innerHTML =
      '<tr><td colspan="3" class="soft">No items selected yet.</td></tr>';
    ui.planMaterialRows.innerHTML =
      '<tr><td colspan="5" class="soft">Add items to build your buy list.</td></tr>';
    ui.planTotals.textContent = "";
    return;
  }

  ui.planRows.innerHTML = planEntries
    .map(
      (entry) => `
        <tr data-plan-item-id="${escapeHtml(entry.itemId)}">
          <td>${escapeHtml(entry.name)}</td>
          <td>
            <input
              class="price-input"
              type="number"
              min="1"
              step="1"
              value="${String(Math.round(entry.qty))}"
              data-role="plan-qty-input"
            />
          </td>
          <td>
            <span class="action-row">
              <button class="action-btn" type="button" data-action="save-plan-qty">Save</button>
              <button class="action-btn secondary" type="button" data-action="remove-plan-item">Remove</button>
            </span>
          </td>
        </tr>
      `
    )
    .join("");

  const materials = computePlanMaterials();
  if (!materials.length) {
    ui.planMaterialRows.innerHTML =
      '<tr><td colspan="5" class="soft">No materials derived from current plan.</td></tr>';
    ui.planTotals.textContent = "";
    return;
  }

  ui.planMaterialRows.innerHTML = materials
    .map(
      (mat) => `
        <tr>
          <td>${escapeHtml(mat.name)}</td>
          <td class="num">${formatQty(mat.requiredQty)}</td>
          <td class="num">${formatQty(mat.buyQty)}</td>
          <td class="num">${mat.unitPrice > 0 ? formatSilver(mat.unitPrice) : "-"}</td>
          <td class="num">${mat.estCost > 0 ? formatSilver(mat.estCost) : "-"}</td>
        </tr>
      `
    )
    .join("");

  const totalEstimatedCost = materials.reduce((sum, mat) => sum + mat.estCost, 0);
  const economics = computePlanEconomics(planEntries);
  const marginText = Number.isFinite(economics.margin)
    ? `${(economics.margin * 100).toFixed(1)}%`
    : "-";
  const incompleteText =
    economics.incompleteItems > 0
      ? ` | incomplete planned items: ${economics.incompleteItems}`
      : "";
  ui.planTotals.textContent =
    `Material buy cost: ${formatSilver(totalEstimatedCost)} | Craft cost: ${formatSilver(economics.totalCraftCost)} | Sell value: ${formatSilver(economics.totalSell)} | Est. Profit: ${formatSilver(economics.profit)} | Margin: ${marginText}${incompleteText}`;
}

function getCalculatorPriceSourceForItem(itemId) {
  if (priceCatalog.craftItemIdSet.has(itemId)) {
    return ui.useBlackMarketSell.checked ? "black_market_sell_avg7" : "sell_avg";
  }
  return "material";
}

function getCalculatorPriceSourceLabel(source) {
  if (source === "material") return "Material";
  if (source === "sell_avg") return `City Sell Avg (${SELL_AVERAGE_DAYS}d)`;
  if (source === "black_market_sell_avg7") {
    return `Black Market Sell Avg (${BLACK_MARKET_SELL_AVERAGE_DAYS}d)`;
  }
  return source;
}

function renderIngredientDetailsRow(craftItemId) {
  const recipe = recipeById.get(craftItemId);
  if (!recipe) {
    return `
      <tr class="ingredient-detail-row">
        <td colspan="8" class="soft">Recipe details unavailable.</td>
      </tr>
    `;
  }

  const city = ui.city.value;
  const rrr = getTotalReturnRate();
  const ingredientRows = (recipe.ingredients || [])
    .map((ingredient) => {
      const ingredientId = ingredient.itemId;
      const source = "material";
      const sourceLabel = getCalculatorPriceSourceLabel(source);
      const name =
        priceCatalog.nameById.get(ingredientId) || prettyNameFromItemId(ingredientId);
      const baseAmount = Number(ingredient.amount || 0);
      const effectiveAmount = Math.max(0, baseAmount * (1 - rrr));
      const unitPrice =
        getMapPriceByAliases(lastMaterialPriceMap, ingredientId) ||
        getCachedPrice(city, source, ingredientId);
      const totalCost = unitPrice > 0 ? unitPrice * effectiveAmount : 0;

      return `
        <tr data-ingredient-row="1" data-item-id="${escapeHtml(ingredientId)}" data-source="${escapeHtml(source)}">
          <td>${escapeHtml(name)}</td>
          <td class="num">${baseAmount.toFixed(baseAmount % 1 === 0 ? 0 : 2)}</td>
          <td class="num">${effectiveAmount.toFixed(2)}</td>
          <td>${escapeHtml(sourceLabel)}</td>
          <td class="num">${unitPrice > 0 ? formatSilver(unitPrice) : "-"}</td>
          <td class="num">${totalCost > 0 ? formatSilver(totalCost) : "-"}</td>
          <td>
            <input
              class="price-input ingredient-price-input"
              type="number"
              min="0"
              step="1"
              value="${unitPrice > 0 ? String(Math.round(unitPrice)) : ""}"
              data-role="ingredient-price-input"
            />
          </td>
          <td>
            <span class="action-row">
              <button class="action-btn" type="button" data-action="save-ingredient-price">Save</button>
              <button class="action-btn secondary" type="button" data-action="clear-ingredient-price">Clear</button>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <tr class="ingredient-detail-row">
      <td colspan="8">
        <div class="ingredient-detail">
          <div class="ingredient-detail-title">Ingredients</div>
          <div class="ingredient-table-wrap">
            <table class="ingredient-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Base Qty</th>
                  <th>Eff. Qty</th>
                  <th>Price Source</th>
                  <th>Unit Price</th>
                  <th>Total Cost</th>
                  <th>Edit Price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${ingredientRows || '<tr><td colspan="8" class="soft">No ingredients.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  `;
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

function handleCalculatorAction(button) {
  const action = button.getAttribute("data-action");
  if (!action) return;

  if (action === "add-plan-item") {
    const itemId = button.getAttribute("data-item-id");
    if (!itemId) return;

    const current = Number(craftPlan.get(itemId) || 0);
    craftPlan.set(itemId, Math.round(current + 1));
    renderCraftPlan();
    const name = priceCatalog.nameById.get(itemId) || prettyNameFromItemId(itemId);
    setStatus(
      current > 0
        ? `Added 1x ${name} to craft plan (now ${Math.round(current + 1)}).`
        : `Added 1x ${name} to craft plan.`
    );
    return;
  }

  if (action === "toggle-ingredients") {
    const itemId = button.getAttribute("data-item-id");
    if (!itemId) return;
    if (expandedCraftRows.has(itemId)) {
      expandedCraftRows.delete(itemId);
    } else {
      expandedCraftRows.add(itemId);
    }
    renderRows(lastComputedRows);
    return;
  }

  if (action === "save-ingredient-price" || action === "clear-ingredient-price") {
    const row = button.closest('tr[data-ingredient-row="1"]');
    if (!row) return;

    const itemId = row.getAttribute("data-item-id");
    const source = row.getAttribute("data-source");
    if (!itemId || !source) return;

    if (action === "clear-ingredient-price") {
      setCachedPrice(ui.city.value, source, itemId, 0);
      applyCurrentCacheAndRender();
      setStatus(`Cleared ingredient price for ${itemId}.`);
      return;
    }

    const input = row.querySelector('input[data-role="ingredient-price-input"]');
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value <= 0) {
      setStatus("Ingredient price must be a positive number.");
      return;
    }

    setCachedPrice(ui.city.value, source, itemId, Math.round(value));
    applyCurrentCacheAndRender();
    setStatus(`Saved ingredient price for ${itemId}.`);
  }
}

function handlePlanAction(button) {
  const action = button.getAttribute("data-action");
  if (!action) return;

  if (action === "clear-plan") {
    clearCraftPlan();
    return;
  }

  const row = button.closest("tr[data-plan-item-id]");
  const itemId = row?.getAttribute("data-plan-item-id");
  if (!itemId) return;

  if (action === "remove-plan-item") {
    craftPlan.delete(itemId);
    renderCraftPlan();
    setStatus("Removed item from craft plan.");
    return;
  }

  if (action === "save-plan-qty") {
    const input = row.querySelector('input[data-role="plan-qty-input"]');
    const qty = Number(input?.value);
    if (!Number.isFinite(qty) || qty <= 0) {
      setStatus("Plan quantity must be a positive number.");
      return;
    }
    craftPlan.set(itemId, Math.round(qty));
    renderCraftPlan();
    setStatus("Updated plan quantity.");
  }
}

function clearCraftPlan() {
  craftPlan.clear();
  renderCraftPlan();
  setStatus("Craft plan cleared.");
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
  recipeById.clear();
  for (const recipe of recipes) {
    recipeById.set(recipe.itemId, recipe);
  }
  expandedCraftRows.clear();

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

function calculateRows(recipes, outputPriceMap, materialPriceMap) {
  const rrr = getTotalReturnRate();
  const taxRate = Math.max(0, Number.parseFloat(ui.craftTax.value) || 0) / 100;
  const materialMap = materialPriceMap || outputPriceMap;

  const rows = [];
  for (const recipe of recipes) {
    const itemPrice = getMapPriceByAliases(outputPriceMap, recipe.itemId);
    if (itemPrice <= 0) continue;

    let materialsCost = 0;
    let missingCount = 0;

    for (const ingredient of recipe.ingredients || []) {
      const ingredientPrice = getMapPriceByAliases(materialMap, ingredient.itemId);
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
      typeText: `${recipe.tier || "-"}.${
        Number.isFinite(recipe.enchantment) ? recipe.enchantment : 0
      } ${recipe.category || "Other"}`,
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

function updateSortIndicators() {
  const buttons = ui.calculatorHead?.querySelectorAll("button[data-sort-key]") || [];
  for (const button of buttons) {
    const key = button.getAttribute("data-sort-key");
    const indicator = button.querySelector(".sort-indicator");
    if (!key || !indicator) continue;
    if (key === sortState.key) {
      indicator.textContent = sortState.direction === "asc" ? "▲" : "▼";
      button.classList.add("active");
    } else {
      indicator.textContent = "";
      button.classList.remove("active");
    }
  }
}

function toSortableNumber(value) {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function compareRowsBySort(a, b) {
  const dir = sortState.direction === "asc" ? 1 : -1;
  const key = sortState.key;

  if (key === "name") {
    return a.name.localeCompare(b.name) * dir;
  }
  if (key === "type") {
    const tierCmp = (Number(a.tier || 0) - Number(b.tier || 0)) * dir;
    if (tierCmp !== 0) return tierCmp;
    const enchCmp =
      (Number(a.enchantment || 0) - Number(b.enchantment || 0)) * dir;
    if (enchCmp !== 0) return enchCmp;
    return String(a.category || "").localeCompare(String(b.category || "")) * dir;
  }

  const numA =
    key === "sellPrice"
      ? toSortableNumber(a.sellPrice)
      : key === "sellVolume"
        ? toSortableNumber(a.sellVolume)
        : key === "craftCost"
          ? toSortableNumber(a.craftCost)
          : key === "profit"
            ? toSortableNumber(a.profit)
            : toSortableNumber(a.margin);
  const numB =
    key === "sellPrice"
      ? toSortableNumber(b.sellPrice)
      : key === "sellVolume"
        ? toSortableNumber(b.sellVolume)
        : key === "craftCost"
          ? toSortableNumber(b.craftCost)
          : key === "profit"
            ? toSortableNumber(b.profit)
            : toSortableNumber(b.margin);

  if (numA === numB) {
    return a.name.localeCompare(b.name);
  }
  return (numA - numB) * dir;
}

function setSortKey(key) {
  if (!key) return;
  if (sortState.key === key) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.key = key;
    sortState.direction = key === "name" || key === "type" ? "asc" : "desc";
  }
  updateSortIndicators();
  renderRows(lastComputedRows);
}

function renderRows(rows) {
  if (!lastPriceMap) {
    ui.rows.innerHTML =
      '<tr><td colspan="8" class="soft">No prices loaded yet. Click Fetch Prices.</td></tr>';
    return;
  }

  const filters = getCalculatorFilters();

  const threshold =
    Math.max(0, Number.parseFloat(ui.marginThreshold.value) || 0) / 100;

  const visibleRows = rows
    .filter((row) => matchesCalculatorFilters(row, filters))
    .sort(compareRowsBySort);

  const out = visibleRows
    .map((row) => {
      const profitable = row.isComplete && row.margin >= threshold;
      const marginPct = row.isComplete ? row.margin * 100 : Number.NaN;
      const profitClass = row.isComplete && row.profit >= 0 ? "pos" : "neg";
      const isExpanded = expandedCraftRows.has(row.itemId);
      const toggleSymbol = isExpanded ? "▾" : "▸";

      return `
        <tr class="${profitable ? "profitable" : ""}">
          <td data-label="Item">
            <button
              type="button"
              class="item-toggle-btn"
              data-action="toggle-ingredients"
              data-item-id="${escapeHtml(row.itemId)}"
              aria-expanded="${isExpanded ? "true" : "false"}"
            >
              <span class="toggle-symbol">${toggleSymbol}</span>
              <span class="item-name">${escapeHtml(row.name)}</span>
            </button>
          </td>
          <td data-label="Tier / Category">${escapeHtml(row.typeText)}</td>
          <td data-label="Sell Price" class="num">${formatSilver(row.sellPrice)}</td>
          <td data-label="Est. Sell/Day (30d)" class="num">${row.sellVolume > 0 ? formatSilver(row.sellVolume) : "-"}</td>
          <td data-label="Craft Cost" class="num">${row.isComplete ? formatSilver(row.craftCost) : "-"}</td>
          <td data-label="Profit" class="num ${profitClass}">${row.isComplete ? formatSilver(row.profit) : "-"}</td>
          <td data-label="Margin" class="num ${profitClass}">${row.isComplete ? `${marginPct.toFixed(1)}%` : "-"}</td>
          <td data-label="Plan">
            <span class="plan-inline">
              <button
                type="button"
                class="action-btn plus-btn"
                data-action="add-plan-item"
                data-item-id="${escapeHtml(row.itemId)}"
                aria-label="Add to craft plan"
              >
                +
              </button>
            </span>
          </td>
        </tr>
        ${isExpanded ? renderIngredientDetailsRow(row.itemId) : ""}
      `;
    })
    .join("");

  ui.rows.innerHTML =
    out || '<tr><td colspan="8">No items match current filters.</td></tr>';
}

function recomputeAndRender() {
  if (recipeData.length && lastPriceMap) {
    lastComputedRows = calculateRows(recipeData, lastPriceMap, lastMaterialPriceMap);
    renderRows(lastComputedRows);
  }
  renderCraftPlan();
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
  renderCraftPlan();
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

ui.calculatorHead?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort-key]");
  if (!button) return;
  const key = button.getAttribute("data-sort-key");
  setSortKey(key);
});

ui.rows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  handleCalculatorAction(button);
});

ui.planRows?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  handlePlanAction(button);
});

ui.clearPlanBtn?.addEventListener("click", () => {
  clearCraftPlan();
});

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
updateSortIndicators();
loadRecipes()
  .then((recipes) => {
    recipeData = recipes;
    renderRows(lastComputedRows);
    renderPriceEditor();
    renderCraftPlan();
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
