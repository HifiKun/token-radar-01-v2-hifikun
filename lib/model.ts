// Token Radar v3 — the ranking model.
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol in the
// snapshot that records no token and is not a wrapped, staked or bridged product of a
// token that already trades. Live-token protocols are kept apart: the dashboard shows
// them in their own tab at the market's own value, never mixed into the ranks.
//
// The headline difference from a flat multiple: the base multiple is not a magic
// number. For each category it is the market's own answer — the median market-cap
// per TVL dollar of the live-token protocols in that same category, read from this
// very snapshot. A category with fewer than three live comparables falls back to the
// median across all live-token protocols, and every multiple is clamped to 0.05..1.00
// so one thinly-traded outlier cannot set the price. Nothing is hardcoded by name.
//
// Implied value, for a protocol with TVL T, seven-day change g and age a (days since
// listed_at):
//
//   multiple   = market multiple of its category (median mcap/TVL of live peers)
//   growth     = clamp(g, -40, +60)      a week of +4448% is a data quirk, not a trend
//   growthMult = 1 + growth/100 x 0.50
//   maturity   = 0.80 + min(a, 540)/540 x 0.20   proven for 18 months: 0.80 .. 1.00
//                (age unknown: the median age of the rankable board, from the snapshot)
//   implied    = round(T x multiple x growthMult x maturity), at least $1
//
// Farm plans are built from the same record: the protocol's category picks the action,
// its chains pick where it happens, its TVL picks the capital, its age picks the hold,
// and whether the house watchlist names it picks the caution — a protocol below the
// floor is early, so it gets half the capital, a longer hold and a warning to watch
// its TVL before adding more.

/** One protocol as the sealed snapshot carries it: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can check the math. */
export interface ModelConstants {
  min_live_comps: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
}

export const MODEL: ModelConstants = {
  min_live_comps: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 540,
};

export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the dashboard's Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * One category's market multiple: the median mcap/TVL of its live-token peers, how
 * many peers set it, and whether it is the category's own number or the fallback.
 */
export interface CategoryMultiple {
  multiple: number;
  comps: number;
  fallback: boolean;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  on_watchlist: boolean;
  readiness: number;
  implied_value_usd: number;
  model: {
    market_multiple: number;
    multiple_comps: number;
    multiple_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row as the dashboard reads it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  readiness: number;
  implied_value_usd: number;
  market_multiple: number;
  multiple_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: Record<string, CategoryMultiple>;
  global_multiple: number;
  median_age_days: number;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not list of numbers; null when it holds none. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name: the exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether the board may rank a protocol: it records no token, and it is not a wrapped,
 * staked or bridged product, not a versioned pool, and not an exchange's own product.
 * The same rule the house drew the watchlist with, minus the TVL floor — so the board
 * holds the whole watchlist plus the early pre-token protocols below it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/**
 * The market multiples, computed from the snapshot itself: for every category, the
 * median mcap/TVL of its live-token protocols, used only when at least three of them
 * set it; every other category takes the median across all live-token protocols.
 * Each multiple is clamped to the model's floor and cap.
 */
export function marketMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Record<string, CategoryMultiple>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio)) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalRaw = median(all) ?? 0.2;
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const global = clamp(globalRaw);
  const out: Record<string, CategoryMultiple> = {};
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= model.min_live_comps) {
      const m = median(ratios);
      out[category] = { multiple: clamp(m ?? globalRaw), comps: ratios.length, fallback: false };
    }
  }
  return { byCategory: out, global };
}

/** The market multiple a protocol's category carries, with its provenance. */
export function multipleFor(
  category: string | null,
  multiples: { byCategory: Record<string, CategoryMultiple>; global: number },
): CategoryMultiple {
  if (category !== null) {
    const own = multiples.byCategory[category];
    if (own !== undefined) return own;
  }
  return { multiple: multiples.global, comps: 0, fallback: true };
}

/** The median age of the rankable protocols that carry a listed date. */
export function medianRankableAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return median(ages) ?? 365;
}

/** The multipliers and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Record<string, CategoryMultiple>; global: number },
  medianAge: number,
): {
  implied: number;
  mult: CategoryMultiple;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const mult = multipleFor(p.category, multiples);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? medianAge;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * mult.multiple * growthMult * maturityMult));
  return { implied, mult, growthPct, growthMult, maturityMult, age };
}

/**
 * Readiness, 0..100, from the same three figures the value uses: half TVL scale
 * (log scale, $1M to the board's largest TVL), three tenths growth (the clamped
 * weekly change), two tenths age (capped at the maturity horizon). A reader can
 * reproduce it from the row; it never moves the rank, which the value alone sets.
 */
export function readiness(
  p: SnapshotProtocol,
  age: number | null,
  growthPct: number,
  medianAge: number,
  maxTvl: number,
  model: ModelConstants,
): number {
  const tvlScore = Math.min(
    1,
    Math.max(0, (Math.log10(Math.max(p.tvl_usd, 1)) - 6) / (Math.log10(Math.max(maxTvl, 1_000_001)) - 6)),
  );
  const growthScore = (growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor);
  const ageForScore = age ?? medianAge;
  const ageScore = Math.min(Math.max(ageForScore, 0), model.maturity_days) / model.maturity_days;
  return Math.round(100 * (0.5 * tvlScore + 0.3 * growthScore + 0.2 * ageScore));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: action, cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol, early: boolean): number {
  let capital: number;
  if (p.tvl_usd >= 1_000_000_000) capital = 250;
  else if (p.tvl_usd >= 250_000_000) capital = 150;
  else if (p.tvl_usd >= 50_000_000) capital = 100;
  else capital = 50;
  if (early) capital = Math.max(25, Math.round(capital / 2));
  return capital;
}

/** How long to hold, from the protocol's age; early protocols get a longer window. */
function holdDaysFor(age: number | null, early: boolean): number {
  let hold: number;
  if (age === null) hold = 30;
  else if (age < 180) hold = 60;
  else if (age < 365) hold = 45;
  else hold = 30;
  if (early) hold += 30;
  return hold;
}

/** Gas for one transaction on a chain: Ethereum is dear, the rest are cheap. */
function gasFor(chain: string): string {
  return chain === 'Ethereum' ? 'about $8 of gas' : 'about $2 of gas';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator'))
    return `Put $${capital} of USDC into one ${name} vault on ${chain} and hold the vault shares in your wallet.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC on ${name} on ${chain} and leave the supply position open.`;
  if (c.includes('dex'))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP tokens.`;
  if (c.includes('yield'))
    return `Stake $${capital} of USDC in ${name}'s best-paying vault on ${chain} and keep the receipt tokens.`;
  if (c.includes('basis'))
    return `Enter ${name}'s basis trade on ${chain} with $${capital} of USDC and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Fund a ${name} account on ${chain} with $${capital} of USDC and open a single small hedged trade.`;
  if (c.includes('prediction'))
    return `Deposit $${capital} on ${name} on ${chain} and take one small position in an active market.`;
  if (c.includes('launchpad'))
    return `Lock $${capital} of the accepted asset on ${name} on ${chain} to qualify for its next allocations.`;
  if (c.includes('rwa'))
    return `Buy $${capital} of ${name}'s yield-bearing token on ${chain} and hold it in your wallet.`;
  if (c.includes('stable'))
    return `Mint or buy $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('restak'))
    return `Restake $${capital} through ${name} on ${chain} and keep the receipt token in your wallet.`;
  if (c.includes('payment'))
    return `Send $${capital} of payments through ${name} on ${chain} and keep using it every week.`;
  if (c.includes('farm'))
    return `Deposit $${capital} of USDC into ${name}'s main farm on ${chain} and keep it staked.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different action: depth on the same protocol, not a repeat. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(25, Math.round(capital / 4));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $${small} against the ${name} supply on ${chain}, use it once, and pay it back the same week.`;
  if (c.includes('dex'))
    return `Swap $${small} through ${name} on ${chain} once, in a pair the pool actually lists.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator'))
    return `Split $${small} into a second ${name} vault on ${chain} run by a different curator.`;
  if (c.includes('yield'))
    return `Claim ${name}'s vault yield on ${chain} once and put it straight back in the same day.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Close the first ${name} trade on ${chain} and open one more small trade in the other direction.`;
  if (c.includes('prediction'))
    return `Close the first ${name} position on ${chain} and open one more on a different market.`;
  if (c.includes('rwa') || c.includes('stable'))
    return `Redeem $${small} of the ${name} asset on ${chain} and mint it back the same week.`;
  return `Do one more qualifying action on ${name} on ${chain}: a swap, a vote or a deposit of $${small}.`;
}

/** The category's weekly action, the habit that keeps the wallet active. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Touch the ${name} position once a week: add a little supply, repay a little borrow, or claim rewards.`;
  if (c.includes('dex')) return `Swap a small amount through ${name} once a week, in a pair the pool lists.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open or close one small trade on ${name} once a week.`;
  if (c.includes('prediction')) return `Take one small position on a new ${name} market once a week.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator'))
    return `Look at the ${name} vault's allocation once a week and move a small amount between vaults.`;
  return `Do one qualifying action on ${name} once a week: a deposit, a swap, a vote or a claim.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, built
 * from the protocol's own record (category, chains, TVL, age, watchlist) — never from
 * a list of names. Early protocols, below the house floor, get half the capital, a
 * longer hold and a step that watches the TVL before any more goes in.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, early: boolean): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p, early);
  const hold = holdDaysFor(age, early);
  const gas = gasFor(chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
  ];
  if (second !== null) {
    steps.push({
      text: `Open a smaller $${Math.max(25, Math.round(capital / 2))} position on ${second} through ${p.name}, so the wallet is active on two of its chains.`,
      cost: `$${Math.max(25, Math.round(capital / 2))} of capital and ${gasFor(second)}`,
      time: '10 minutes',
    });
  } else {
    steps.push({ text: secondActionFor(p, capital, chain), cost: `$${Math.max(25, Math.round(capital / 4))} of capital and ${gas}`, time: '10 minutes' });
  }
  steps.push(
    { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: early
        ? `Watch ${p.name}'s TVL once a week: it is an early protocol below the house floor, so if its TVL falls by a third from where you entered, shrink the position before you add anything.`
        : `Watch ${p.name}'s TVL once a week: if it falls by a third from where you entered, shrink the position before you add anything.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay a fee to claim and never follow a link from a chat.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
  );
  return steps;
}

/** The board: every rankable protocol, strongest first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = marketMultiples(snapshot, model);
  const medianAge = medianRankableAge(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const maxTvl = Math.max(...[...chosen.values()].map((p) => p.tvl_usd), 1);
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, mult, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, multiples, medianAge);
    const early = !watchlist.has(p.slug);
    return { p, implied, mult, growthPct, growthMult, maturityMult, age, early };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    on_watchlist: !s.early,
    readiness: readiness(s.p, s.age, s.growthPct, medianAge, maxTvl, model),
    implied_value_usd: s.implied,
    model: {
      market_multiple: round4(s.mult.multiple),
      multiple_comps: s.mult.comps,
      multiple_fallback: s.mult.fallback,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.early).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = marketMultiples(snapshot, model);
  const medianAge = medianRankableAge(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples: multiples.byCategory,
    global_multiple: multiples.global,
    median_age_days: medianAge,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist].sort(),
    board_size: board.length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      readiness: r.readiness,
      implied_value_usd: r.implied_value_usd,
      market_multiple: r.model.market_multiple,
      multiple_comps: r.model.multiple_comps,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
