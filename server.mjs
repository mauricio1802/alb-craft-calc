import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);

const CACHE_FILE = path.join(ROOT, "data", "recipes-cache.json");
const CACHE_FILE_TMP = path.join(ROOT, "data", "recipes-cache.tmp.json");
const CACHE_VERSION = 2;

const MARKET_PRICE_API = "https://www.albion-online-data.com/api/v2/stats/prices";
const MARKET_HISTORY_API = "https://www.albion-online-data.com/api/v2/stats/history";
const PRICE_BATCH_SIZE = 150;
const PRICE_REQUEST_SPACING_MS = 250;
const HISTORY_BATCH_SIZE = 80;
const HISTORY_REQUEST_SPACING_MS = 250;
const PRICE_RETRY_LIMIT = 6;
const PRICE_RETRY_BASE_MS = 1200;
const DEFAULT_QUALITY = 1;
const DEFAULT_AVERAGE_DAYS = 1;

const NAME_SOURCES = [
  {
    type: "url",
    label: "ao-data formatted items",
    value:
      "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json",
  },
  {
    type: "url",
    label: "ao-data items",
    value: "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json",
  },
  {
    type: "url",
    label: "broderickhyman formatted items",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/formatted/items.json",
  },
  {
    type: "url",
    label: "broderickhyman items",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/items.json",
  },
];

const RECIPE_SOURCES = [
  {
    type: "file",
    label: "local manual recipes",
    value: path.join(ROOT, "data", "recipes.json"),
  },
  {
    type: "file",
    label: "local items dump",
    value: path.join(ROOT, "data", "items.json"),
  },
  {
    type: "file",
    label: "local craftingrequirements dump",
    value: path.join(ROOT, "data", "craftingrequirements.json"),
  },
  {
    type: "file",
    format: "xml",
    label: "local items xml",
    value: path.join(ROOT, "data", "items.xml"),
  },
  {
    type: "url",
    label: "ao-data formatted craftingrequirements",
    value:
      "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/craftingrequirements.json",
  },
  {
    type: "url",
    label: "ao-data craftingrequirements",
    value:
      "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/craftingrequirements.json",
  },
  {
    type: "url",
    label: "broderickhyman formatted craftingrequirements",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/formatted/craftingrequirements.json",
  },
  {
    type: "url",
    label: "broderickhyman craftingrequirements",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/craftingrequirements.json",
  },
  {
    type: "url",
    format: "xml",
    label: "ao-data items.xml",
    value: "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.xml",
  },
  {
    type: "url",
    format: "xml",
    label: "broderickhyman items.xml",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/items.xml",
  },
  {
    type: "url",
    label: "ao-data formatted items",
    value:
      "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json",
  },
  {
    type: "url",
    label: "ao-data items",
    value: "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json",
  },
  {
    type: "url",
    label: "broderickhyman formatted items",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/formatted/items.json",
  },
  {
    type: "url",
    label: "broderickhyman items",
    value:
      "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/items.json",
  },
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

let buildPromise = null;
let memoryRecipeCache = null;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getStringField(obj, candidates) {
  for (const key of candidates) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function getNumberField(obj, candidates) {
  for (const key of candidates) {
    const raw = obj?.[key];
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return null;
}

function getItemId(entry) {
  return getStringField(entry, [
    "@uniquename",
    "@uniqueName",
    "@itemtype",
    "@itemid",
    "@item",
    "UniqueName",
    "uniqueName",
    "ItemType",
    "itemType",
    "itemtype",
    "itemId",
    "item_id",
    "id",
  ]);
}

function getLocalizedName(entry, fallbackId) {
  const localized =
    entry?.LocalizedNames || entry?.localizedNames || entry?.localized_names;

  if (localized && typeof localized === "object") {
    for (const key of ["EN-US", "en-US", "EN", "en"]) {
      const value = localized[key];
      if (typeof value === "string" && value.trim().length) {
        return value.trim();
      }
    }

    for (const value of Object.values(localized)) {
      if (typeof value === "string" && value.trim().length) {
        return value.trim();
      }
    }
  }

  return (
    getStringField(entry, ["@name", "Name", "name", "localizedName"]) ||
    fallbackId
  );
}

function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  for (const key of [
    "items",
    "Items",
    "data",
    "Data",
    "list",
    "List",
    "values",
    "Values",
  ]) {
    if (Array.isArray(raw[key])) {
      return raw[key];
    }
  }

  const values = Object.values(raw);
  if (values.length && values.every((v) => v && typeof v === "object")) {
    return values;
  }

  return [];
}

function collectItemEntries(node, out = [], depth = 0) {
  if (!node || depth > 12) return out;

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectItemEntries(entry, out, depth + 1);
    }
    return out;
  }

  if (typeof node !== "object") return out;

  if (getItemId(node)) {
    out.push(node);
  }

  for (const value of Object.values(node)) {
    collectItemEntries(value, out, depth + 1);
  }

  return out;
}

async function fetchJsonUrl(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "albion-craft-calc/1.0" },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

async function fetchTextUrl(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "albion-craft-calc/1.0" },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

async function readSourceJson(source) {
  if (source.type === "file") {
    if (!fssync.existsSync(source.value)) {
      throw new Error("file not found");
    }
    const raw = await fs.readFile(source.value, "utf8");
    return JSON.parse(raw);
  }

  if (source.type === "url") {
    return fetchJsonUrl(source.value);
  }

  throw new Error("unsupported source type");
}

async function readSourceData(source) {
  const format = source.format || "json";

  if (source.type === "file") {
    if (!fssync.existsSync(source.value)) {
      throw new Error("file not found");
    }
    const raw = await fs.readFile(source.value, "utf8");
    if (format === "xml") {
      return { format: "xml", data: raw };
    }
    return { format: "json", data: JSON.parse(raw) };
  }

  if (source.type === "url") {
    if (format === "xml") {
      return { format: "xml", data: await fetchTextUrl(source.value) };
    }
    return { format: "json", data: await fetchJsonUrl(source.value) };
  }

  throw new Error("unsupported source type");
}

function parseResourceObjects(node) {
  if (!node || typeof node !== "object") return [];

  const out = [];

  // XML-like: @uniquename, @count, @uniquename1, @count1, ...
  for (const [key, value] of Object.entries(node)) {
    const match = key.match(/^@?(?:uniquename|itemtype|itemid|item|identifier)(\d*)$/i);
    if (!match) continue;

    const suffix = match[1] || "";
    const itemId = typeof value === "string" ? value.trim() : null;
    const amount = getNumberField(node, [
      `@count${suffix}`,
      `count${suffix}`,
      `@amount${suffix}`,
      `amount${suffix}`,
      `@quantity${suffix}`,
      `quantity${suffix}`,
      `@value${suffix}`,
      `value${suffix}`,
    ]);

    if (itemId && amount) {
      out.push({ itemId, amount });
    }
  }

  if (out.length) {
    return out;
  }

  const itemId = getStringField(node, [
    "identifier",
    "itemType",
    "itemtype",
    "itemId",
    "item_id",
    "uniqueName",
    "UniqueName",
    "@uniquename",
    "@itemtype",
    "@item",
  ]);

  const amount = getNumberField(node, [
    "value",
    "count",
    "amount",
    "quantity",
    "@count",
    "@amount",
    "@value",
  ]);

  if (itemId && amount) {
    return [{ itemId, amount }];
  }

  return [];
}

function looksLikeIngredientObject(node) {
  return parseResourceObjects(node).length > 0;
}

function findIngredientOptions(node, depth = 0, parentKey = "") {
  if (!node || depth > 12) return [];

  if (Array.isArray(node)) {
    if (node.length > 0 && node.every(looksLikeIngredientObject)) {
      return [node.flatMap((entry) => parseResourceObjects(entry))];
    }

    return node.flatMap((entry) => findIngredientOptions(entry, depth + 1, parentKey));
  }

  if (typeof node !== "object") return [];

  const out = [];
  const direct = parseResourceObjects(node);
  if (direct.length > 1 || /resource|ingredient|material|craft/i.test(parentKey)) {
    out.push(direct);
  }

  for (const [key, value] of Object.entries(node)) {
    if (/craft|requirement|recipe|ingredient|resource|material|component|enchant/i.test(key)) {
      out.push(...findIngredientOptions(value, depth + 1, key));
    }
  }

  if (!out.length) {
    for (const [key, value] of Object.entries(node)) {
      out.push(...findIngredientOptions(value, depth + 1, key));
    }
  }

  return out;
}

function normalizeOption(itemId, option) {
  const folded = new Map();
  for (const ingredient of option) {
    const ingId = typeof ingredient?.itemId === "string" ? ingredient.itemId : null;
    const amount = Number(ingredient?.amount);
    if (!ingId || !Number.isFinite(amount) || amount <= 0) continue;
    if (ingId === itemId || ingId.startsWith("@")) continue;
    folded.set(ingId, (folded.get(ingId) || 0) + amount);
  }

  return [...folded.entries()].map(([ingId, amount]) => ({ itemId: ingId, amount }));
}

function extractRecipesFromEntries(entries, itemNames = new Map()) {
  const recipes = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const itemId = getItemId(entry);
    if (!itemId || itemId.startsWith("@")) continue;

    const roots = [entry];
    for (const [key, value] of Object.entries(entry)) {
      if (/craft|requirement|recipe|ingredient|resource|material|component|enchant/i.test(key)) {
        roots.push(value);
      }
    }

    const rawOptions = roots.flatMap((root) => findIngredientOptions(root));
    const normalizedOptions = rawOptions
      .map((option) => normalizeOption(itemId, option))
      .filter((option) => option.length > 0);

    if (!normalizedOptions.length) continue;

    normalizedOptions.sort((a, b) => a.length - b.length);

    recipes.push({
      itemId,
      name: itemNames.get(itemId) || getLocalizedName(entry, itemId),
      ingredients: normalizedOptions[0],
    });
  }

  const byId = new Map();
  for (const recipe of recipes) {
    const existing = byId.get(recipe.itemId);
    if (!existing || recipe.ingredients.length < existing.ingredients.length) {
      byId.set(recipe.itemId, recipe);
    }
  }

  return [...byId.values()].filter((recipe) => recipe.ingredients.length > 0);
}

function parseXmlAttributes(attrText) {
  const out = {};
  if (!attrText || typeof attrText !== "string") return out;

  const regex = /([a-zA-Z0-9_:-]+)\s*=\s*["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrText)) !== null) {
    out[match[1].toLowerCase()] = match[2];
  }
  return out;
}

function extractResourceListFromAttributes(attrs) {
  const out = [];
  for (const [key, value] of Object.entries(attrs)) {
    const match = key.match(/^(?:uniquename|itemtype|itemid|item|identifier)(\d*)$/i);
    if (!match) continue;

    const suffix = match[1] || "";
    const itemId = typeof value === "string" ? value.trim() : null;
    const countRaw =
      attrs[`count${suffix}`] ??
      attrs[`amount${suffix}`] ??
      attrs[`quantity${suffix}`] ??
      attrs[`value${suffix}`];
    const amount = Number(countRaw);
    const enchantmentRaw =
      attrs[`enchantmentlevel${suffix}`] ?? attrs.enchantmentlevel;
    const enchantmentLevel = Number(enchantmentRaw);

    if (itemId && Number.isFinite(amount) && amount > 0) {
      out.push({
        itemId,
        amount,
        enchantmentLevel:
          Number.isFinite(enchantmentLevel) && enchantmentLevel >= 0
            ? enchantmentLevel
            : null,
      });
    }
  }
  return out;
}

function parseRecipesFromXml(xmlText, itemNames = new Map()) {
  if (typeof xmlText !== "string" || !xmlText.includes("<")) {
    return [];
  }

  const tagRegex = /<\s*(\/?)\s*([a-zA-Z0-9_:-]+)\b([^>]*)>/g;
  const recipes = [];
  const itemStack = [];
  const reqStack = [];
  const enchantmentStack = [];

  function parseEnchantment(attrs) {
    const level = Number(attrs?.enchantmentlevel);
    return Number.isFinite(level) && level >= 0 ? level : null;
  }

  function asItemIdWithEnchant(baseItemId, enchantment) {
    if (!baseItemId) return baseItemId;
    if (baseItemId.includes("@")) return baseItemId;
    return enchantment > 0 ? `${baseItemId}@${enchantment}` : baseItemId;
  }

  function currentItemContext() {
    return itemStack.length ? itemStack[itemStack.length - 1] : null;
  }

  function currentEnchantment() {
    return enchantmentStack.length
      ? enchantmentStack[enchantmentStack.length - 1]
      : null;
  }

  function finalizeRequirement(ctx) {
    if (!ctx?.itemCtx || !ctx.resources?.length) return;
    let enchantment =
      Number.isFinite(ctx.enchantment) && ctx.enchantment >= 0
        ? ctx.enchantment
        : null;

    if (enchantment === null) {
      const fromResource = ctx.resources
        .map((resource) => Number(resource.enchantmentLevel))
        .find((value) => Number.isFinite(value) && value >= 0);
      enchantment =
        Number.isFinite(fromResource) && fromResource >= 0
          ? fromResource
          : ctx.itemCtx.baseEnchantment;
    }

    ctx.itemCtx.options.push({
      enchantment,
      resources: ctx.resources,
    });
  }

  function finalizeItem(ctx) {
    if (!ctx?.itemId || !ctx.options?.length) return;

    const byEnchantment = new Map();
    for (const option of ctx.options) {
      const enchantment =
        Number.isFinite(option?.enchantment) && option.enchantment >= 0
          ? option.enchantment
          : ctx.baseEnchantment;
      const normalized = normalizeOption(ctx.itemId, option.resources);
      if (!normalized.length) continue;

      const existing = byEnchantment.get(enchantment);
      if (!existing || normalized.length < existing.length) {
        byEnchantment.set(enchantment, normalized);
      }
    }

    for (const [enchantment, ingredients] of byEnchantment.entries()) {
      recipes.push({
        itemId: asItemIdWithEnchant(ctx.itemId, enchantment),
        baseItemId: ctx.itemId,
        name: itemNames.get(ctx.itemId) || ctx.itemId,
        tier: ctx.tier,
        enchantment,
        ingredients,
      });
    }
  }

  let match;
  while ((match = tagRegex.exec(xmlText)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2].toLowerCase();
    const rawAttrs = match[3] || "";
    const isSelfClosing = /\/\s*$/.test(rawAttrs);
    const attrs = parseXmlAttributes(rawAttrs);

    if (!isClosing) {
      if (tagName === "enchantment") {
        const enchantment = parseEnchantment(attrs);
        enchantmentStack.push(
          Number.isFinite(enchantment) && enchantment >= 0 ? enchantment : 0
        );
        if (isSelfClosing) {
          enchantmentStack.pop();
        }
        continue;
      }

      if (tagName === "craftingrequirements") {
        const ctx = {
          itemCtx: currentItemContext(),
          resources: extractResourceListFromAttributes(attrs),
          enchantment: parseEnchantment(attrs) ?? currentEnchantment(),
        };
        reqStack.push(ctx);
        if (isSelfClosing) {
          reqStack.pop();
          finalizeRequirement(ctx);
        }
        continue;
      }

      if (tagName === "craftresource") {
        const resources = extractResourceListFromAttributes(attrs);
        if (resources.length && reqStack.length) {
          reqStack[reqStack.length - 1].resources.push(...resources);
        }
        continue;
      }

      const itemId =
        attrs.uniquename ||
        attrs.uniquename0 ||
        attrs.itemtype ||
        attrs.itemid ||
        attrs.id;

      if (itemId) {
        const tierRaw = Number(attrs.tier);
        const ctx = {
          tagName,
          itemId,
          tier: Number.isFinite(tierRaw) && tierRaw > 0 ? tierRaw : null,
          baseEnchantment: parseEnchantment(attrs) ?? 0,
          options: [],
        };

        if (isSelfClosing) {
          finalizeItem(ctx);
        } else {
          itemStack.push(ctx);
        }
      }
      continue;
    }

    if (tagName === "craftingrequirements") {
      const ctx = reqStack.pop();
      finalizeRequirement(ctx);
      continue;
    }

    if (tagName === "enchantment") {
      if (enchantmentStack.length) {
        enchantmentStack.pop();
      }
      continue;
    }

    if (itemStack.length && itemStack[itemStack.length - 1].tagName === tagName) {
      const ctx = itemStack.pop();
      finalizeItem(ctx);
    }
  }

  while (reqStack.length) {
    finalizeRequirement(reqStack.pop());
  }
  while (enchantmentStack.length) {
    enchantmentStack.pop();
  }
  while (itemStack.length) {
    finalizeItem(itemStack.pop());
  }

  const byId = new Map();
  for (const recipe of recipes) {
    const existing = byId.get(recipe.itemId);
    if (!existing || recipe.ingredients.length < existing.ingredients.length) {
      byId.set(recipe.itemId, recipe);
    }
  }

  return [...byId.values()].filter((recipe) => recipe.ingredients.length > 0);
}

function validateManualRecipes(raw) {
  if (!raw || typeof raw !== "object") return null;
  const list = Array.isArray(raw?.recipes) ? raw.recipes : Array.isArray(raw) ? raw : null;
  if (!list || !list.length) return null;

  const recipes = [];
  for (const row of list) {
    const itemId = typeof row?.itemId === "string" ? row.itemId : null;
    const name = typeof row?.name === "string" ? row.name : itemId;
    const ingredients = Array.isArray(row?.ingredients)
      ? row.ingredients
          .map((i) => ({
            itemId: typeof i?.itemId === "string" ? i.itemId : null,
            amount: Number(i?.amount),
          }))
          .filter((i) => i.itemId && Number.isFinite(i.amount) && i.amount > 0)
      : [];

    if (itemId && ingredients.length) {
      recipes.push({ itemId, name: name || itemId, ingredients });
    }
  }

  return recipes.length ? recipes : null;
}

async function loadItemNames() {
  const nameMap = new Map();

  for (const source of NAME_SOURCES) {
    try {
      const raw = await readSourceJson(source);
      const asArray = toArray(raw);
      const entries = asArray.length ? asArray : collectItemEntries(raw);

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const itemId = getItemId(entry);
        if (!itemId || itemId.startsWith("@") || nameMap.has(itemId)) continue;
        nameMap.set(itemId, getLocalizedName(entry, itemId));
      }

      if (nameMap.size > 0) {
        break;
      }
    } catch {
      // Best effort.
    }
  }

  return nameMap;
}

async function loadRecipesFromSources(itemNames) {
  const errors = [];

  for (const source of RECIPE_SOURCES) {
    try {
      const loaded = await readSourceData(source);
      const raw = loaded.data;

      if (loaded.format === "xml") {
        const recipes = parseRecipesFromXml(raw, itemNames);
        if (!recipes.length) {
          errors.push(`${source.label} -> parsed 0 recipes from XML`);
          continue;
        }

        return {
          source: source.label,
          recipes,
        };
      }

      const manual = validateManualRecipes(raw);
      if (manual && manual.length) {
        return {
          source: source.label,
          recipes: manual,
        };
      }

      const asArray = toArray(raw);
      const entries = asArray.length ? asArray : collectItemEntries(raw);
      if (!entries.length) {
        errors.push(`${source.label} -> parsed 0 entries`);
        continue;
      }

      const recipes = extractRecipesFromEntries(entries, itemNames);
      if (!recipes.length) {
        errors.push(`${source.label} -> parsed 0 recipes from ${entries.length} entries`);
        continue;
      }

      return {
        source: source.label,
        recipes,
      };
    } catch (error) {
      errors.push(`${source.label} -> ${error.message}`);
    }
  }

  throw new Error(`No usable recipe source. ${errors.join(" | ")}`);
}

async function buildRecipePayload() {
  const itemNames = await loadItemNames();
  const { source, recipes } = await loadRecipesFromSources(itemNames);

  if (!recipes.length) {
    throw new Error("Recipe build produced 0 recipes");
  }

  const payload = {
    cacheVersion: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    recipeCount: recipes.length,
    recipes,
  };

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE_TMP, JSON.stringify(payload), "utf8");
  await fs.rename(CACHE_FILE_TMP, CACHE_FILE);
  memoryRecipeCache = payload;

  return payload;
}

async function readCachedRecipes() {
  if (
    memoryRecipeCache &&
    Array.isArray(memoryRecipeCache.recipes) &&
    memoryRecipeCache.recipes.length > 0
  ) {
    return memoryRecipeCache;
  }

  if (!fssync.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Number(parsed?.cacheVersion || 0) !== CACHE_VERSION) {
      return null;
    }
    if (!Array.isArray(parsed?.recipes) || !parsed.recipes.length) {
      return null;
    }
    memoryRecipeCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function ensureRecipeBuild(force = false) {
  if (!force) {
    const cached = await readCachedRecipes();
    if (cached) return cached;
  }

  if (!buildPromise) {
    buildPromise = buildRecipePayload().finally(() => {
      buildPromise = null;
    });
  }

  return buildPromise;
}

function uniqueItemIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];

  const out = [];
  const seen = new Set();

  for (const raw of rawIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

function parseQuality(raw) {
  const numeric = Number.parseInt(String(raw ?? DEFAULT_QUALITY), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_QUALITY;
  if (numeric < 1 || numeric > 5) return DEFAULT_QUALITY;
  return numeric;
}

function parseAverageDays(raw) {
  const numeric = Number.parseInt(String(raw ?? DEFAULT_AVERAGE_DAYS), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_AVERAGE_DAYS;
  if (numeric < 1) return 1;
  if (numeric > 120) return 120;
  return numeric;
}

function parseMode(raw) {
  const mode = String(raw || "material").trim().toLowerCase();
  if (mode === "material") return "material";
  if (mode === "sell") return "sell";
  if (mode === "buy") return "buy";
  if (mode === "sell_avg") return "sell_avg";
  if (mode === "volume_avg") return "volume_avg";
  return "material";
}

function splitChunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const numeric = Number(headerValue);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function formatAlbionDate(date) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

function parseTimeMs(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function pickLivePrice(row, mode) {
  const sell = Number(row?.sell_price_min || 0);
  const buy = Number(row?.buy_price_max || 0);

  if (mode === "buy") {
    return buy > 0 ? buy : 0;
  }
  if (mode === "sell") {
    return sell > 0 ? sell : 0;
  }
  return sell > 0 ? sell : buy > 0 ? buy : 0;
}

function aggregateHistoryRows(rows, sinceMs) {
  const byId = new Map();
  if (!Array.isArray(rows)) return byId;

  for (const row of rows) {
    const itemId = getStringField(row, ["item_id", "itemId", "item", "id"]);
    if (!itemId) continue;

    const points = Array.isArray(row?.data)
      ? row.data
      : Array.isArray(row?.prices)
        ? row.prices
        : [];
    if (!points.length) continue;

    let bucket = byId.get(itemId);
    if (!bucket) {
      bucket = { weighted: 0, weight: 0 };
      byId.set(itemId, bucket);
    }

    for (const point of points) {
      const timestampMs = parseTimeMs(
        point?.timestamp ?? point?.date ?? point?.time ?? null
      );
      if (Number.isFinite(sinceMs) && Number.isFinite(timestampMs) && timestampMs < sinceMs) {
        continue;
      }

      const avgPrice = Number(point?.avg_price ?? point?.avgPrice ?? 0);
      if (!(avgPrice > 0)) continue;

      const sampleSize = Number(
        point?.item_count ?? point?.itemCount ?? point?.count ?? 0
      );
      const weight = sampleSize > 0 ? sampleSize : 1;

      bucket.weighted += avgPrice * weight;
      bucket.weight += weight;
    }
  }

  const prices = new Map();
  for (const [itemId, bucket] of byId.entries()) {
    if (bucket.weight > 0) {
      prices.set(itemId, Math.round(bucket.weighted / bucket.weight));
    }
  }
  return prices;
}

function aggregateHistoryVolumesWeighted(rows, sinceMs, averageDays) {
  const byId = new Map();
  if (!Array.isArray(rows)) return byId;

  const nowMs = Date.now();
  const windowDays = Math.max(1, Number(averageDays) || 1);

  for (const row of rows) {
    const itemId = getStringField(row, ["item_id", "itemId", "item", "id"]);
    if (!itemId) continue;

    const points = Array.isArray(row?.data)
      ? row.data
      : Array.isArray(row?.prices)
        ? row.prices
        : [];
    if (!points.length) continue;

    let bucket = byId.get(itemId);
    if (!bucket) {
      bucket = { weighted: 0, weight: 0 };
      byId.set(itemId, bucket);
    }

    for (const point of points) {
      const timestampMs = parseTimeMs(
        point?.timestamp ?? point?.date ?? point?.time ?? null
      );
      if (
        Number.isFinite(sinceMs) &&
        Number.isFinite(timestampMs) &&
        timestampMs < sinceMs
      ) {
        continue;
      }

      const dailyVolume = Number(
        point?.item_count ?? point?.itemCount ?? point?.count ?? 0
      );
      if (!(dailyVolume > 0)) continue;

      const daysAgo = Number.isFinite(timestampMs)
        ? Math.max(0, (nowMs - timestampMs) / (24 * 60 * 60 * 1000))
        : windowDays - 1;
      const recencyWeight = Math.max(1, windowDays - daysAgo);

      bucket.weighted += dailyVolume * recencyWeight;
      bucket.weight += recencyWeight;
    }
  }

  const volumes = new Map();
  for (const [itemId, bucket] of byId.entries()) {
    if (bucket.weight > 0) {
      volumes.set(itemId, Math.round(bucket.weighted / bucket.weight));
    }
  }
  return volumes;
}

async function fetchPriceBatch(city, ids, quality, attempt = 0) {
  const params = new URLSearchParams({
    locations: city,
    qualities: String(quality),
  });
  const url = `${MARKET_PRICE_API}/${ids.join(",")}.json?${params.toString()}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: {
      "User-Agent": "albion-craft-calc/1.0",
    },
  });

  if (!res.ok) {
    if (res.status === 429 && attempt < PRICE_RETRY_LIMIT) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      const backoffMs =
        retryAfterMs ??
        Math.min(
          15000,
          PRICE_RETRY_BASE_MS * Math.max(1, 2 ** attempt)
        );
      await sleep(backoffMs);
      return fetchPriceBatch(city, ids, attempt + 1);
    }
    throw new Error(`Albion Data API HTTP ${res.status}`);
  }

  return res.json();
}

async function fetchHistoryBatch(city, ids, quality, averageDays, attempt = 0) {
  const end = new Date();
  const start = new Date(end.getTime() - averageDays * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    locations: city,
    qualities: String(quality),
    "time-scale": "24",
    date: formatAlbionDate(start),
    end_date: formatAlbionDate(end),
  });
  const url = `${MARKET_HISTORY_API}/${ids.join(",")}.json?${params.toString()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "User-Agent": "albion-craft-calc/1.0",
    },
  });

  if (!res.ok) {
    if (res.status === 429 && attempt < PRICE_RETRY_LIMIT) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      const backoffMs =
        retryAfterMs ??
        Math.min(15000, PRICE_RETRY_BASE_MS * Math.max(1, 2 ** attempt));
      await sleep(backoffMs);
      return fetchHistoryBatch(city, ids, quality, averageDays, attempt + 1);
    }
    throw new Error(`Albion Data API HTTP ${res.status}`);
  }

  return res.json();
}

async function handleRecipesApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const force = url.searchParams.get("force") === "1";

  try {
    const payload = await ensureRecipeBuild(force);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: `Recipe build failed: ${error.message}` });
  }
}

async function handlePricesApi(req, res) {
  try {
    const body = await readJsonBody(req);
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const itemIds = uniqueItemIds(body?.itemIds);
    const mode = parseMode(body?.mode);
    const quality = parseQuality(body?.quality);
    const averageDays = parseAverageDays(body?.averageDays);
    const fallbackToLive = body?.fallbackToLive === true;

    if (!city) {
      sendJson(res, 400, { error: "Missing required field: city" });
      return;
    }

    if (!itemIds.length) {
      sendJson(res, 400, { error: "Missing required field: itemIds[]" });
      return;
    }

    if (itemIds.length > 50000) {
      sendJson(res, 400, { error: "Too many itemIds requested." });
      return;
    }

    const byId = new Map();
    if (mode === "sell_avg" || mode === "volume_avg") {
      const historyBatches = splitChunks(itemIds, HISTORY_BATCH_SIZE);
      const sinceMs = Date.now() - averageDays * 24 * 60 * 60 * 1000;

      for (let i = 0; i < historyBatches.length; i += 1) {
        if (i > 0 && HISTORY_REQUEST_SPACING_MS > 0) {
          await sleep(HISTORY_REQUEST_SPACING_MS);
        }
        const data = await fetchHistoryBatch(
          city,
          historyBatches[i],
          quality,
          averageDays
        );
        const metricValues =
          mode === "volume_avg"
            ? aggregateHistoryVolumesWeighted(data, sinceMs, averageDays)
            : aggregateHistoryRows(data, sinceMs);
        for (const [itemId, value] of metricValues.entries()) {
          if (value > 0) {
            byId.set(itemId, value);
          }
        }
      }

      if (mode === "sell_avg" && fallbackToLive && byId.size < itemIds.length) {
        const missingIds = itemIds.filter((id) => !byId.has(id));
        const liveBatches = splitChunks(missingIds, PRICE_BATCH_SIZE);
        for (let i = 0; i < liveBatches.length; i += 1) {
          if (i > 0 && PRICE_REQUEST_SPACING_MS > 0) {
            await sleep(PRICE_REQUEST_SPACING_MS);
          }
          const data = await fetchPriceBatch(city, liveBatches[i], quality);
          for (const row of data) {
            const itemId =
              typeof row?.item_id === "string" ? row.item_id.trim() : "";
            if (!itemId || byId.has(itemId)) continue;

            const rowQuality = Number(row?.quality || 0);
            if (rowQuality > 0 && rowQuality !== quality) continue;

            const price = pickLivePrice(row, "sell");
            if (price > 0) {
              byId.set(itemId, price);
            }
          }
        }
      }
    } else {
      const batches = splitChunks(itemIds, PRICE_BATCH_SIZE);
      for (let i = 0; i < batches.length; i += 1) {
        if (i > 0 && PRICE_REQUEST_SPACING_MS > 0) {
          await sleep(PRICE_REQUEST_SPACING_MS);
        }
        const data = await fetchPriceBatch(city, batches[i], quality);
        for (const row of data) {
          const itemId = typeof row?.item_id === "string" ? row.item_id.trim() : "";
          if (!itemId) continue;

          const rowQuality = Number(row?.quality || 0);
          if (rowQuality > 0 && rowQuality !== quality) continue;

          const price = pickLivePrice(row, mode);
          if (price > 0) {
            byId.set(itemId, price);
          }
        }
      }
    }

    sendJson(res, 200, {
      city,
      mode,
      quality,
      averageDays:
        mode === "sell_avg" || mode === "volume_avg" ? averageDays : null,
      count: byId.size,
      prices: Object.fromEntries(byId),
    });
  } catch (error) {
    sendJson(res, 502, { error: `Price proxy failed: ${error.message}` });
  }
}

async function serveStatic(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === "/") {
      pathname = "/index.html";
    }

    const normalized = path.normalize(pathname).replace(/^[/\\]+/, "");
    const safePath = normalized.replace(/^([.][.][/\\])+/, "");
    const filePath = path.resolve(ROOT, safePath);

    if (!(filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`))) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(filePath);

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/recipes")) {
    await handleRecipesApi(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/prices")) {
    await handlePricesApi(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/health")) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Albion craft calc running on http://localhost:${PORT}`);
  console.log("Recipes load from dump sources and are cached in data/recipes-cache.json.");
});
