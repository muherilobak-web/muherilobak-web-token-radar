// lib/model.ts — the radar-2 model for token-radar-01.
//
// The snapshot is a sealed DefiLlama protocol index (as_of 2026-11-14). Every
// number below comes from its ten fields only: slug, name, category, chains,
// tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol. No protocol is
// named anywhere in the model; the same formula scores every row.
//
// Implied launch value:
//   implied = TVL x category multiple x growth multiplier
//                 x maturity multiplier x chain-breadth multiplier
//
//   category multiple — what a launch is worth per dollar of TVL depends on
//     what the protocol does. Flow businesses (DEXs, lending, derivatives)
//     monetise every dollar that passes through them, so they command more
//     than balance-sheet businesses (CDP, RWA, staking pools). The table is
//     the model's stated assumption, applied by category, never by name.
//   growth multiplier — 1 + clamp(change_7d, -60, +120) / 100 x 0.5. A
//     protocol growing 10% in a week is worth 5% more than a flat one.
//   maturity multiplier — 0.6 + min(age_days, 1095) / 1095 x 0.4. Three
//     years with no token is a full point; a month-old protocol is 0.63.
//     Unknown listing date counts as 365 days.
//   chain breadth — 1 + min(chains - 1, 4) x 0.03. Each extra chain up to
//     four adds 3%: wider distribution at launch.
//
// A protocol is rankable when the snapshot's own fields say it is a
// pre-token launch candidate: it records no token (mcap, gecko_id and symbol
// all null), it is not an exchange, a bridge, a liquid-staking product or a
// wrapped/staked product of one that trades, and its name is not a versioned
// copy. That is the house watchlist's own rule, applied to every row — so
// the board holds the 40 watchlist protocols plus the 157 more the same rule
// finds (19 above the $50M floor the house list does not name, 138 below
// it), and it leaves out the 145 pre-token records that would pollute it:
// exchanges with no token (Bybit, $13.8B), wrapped assets (WBTC, $7.9B),
// staked products (Binance staked ETH, $7.4B) and bridges.

export const MODEL_VERSION = 'radar-2';

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

export interface Factors {
  multiple: number;
  growth_mult: number;
  maturity_mult: number;
  chain_breadth: number;
  age_days: number | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** The full row the dashboard renders: the board row plus the figures behind it. */
export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  watchlist: boolean;
  factors: Factors;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_per_tvl: number;
}

export interface Radar {
  model: string;
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_count: number;
  rows: RadarRow[];
  live: LiveRow[];
  live_total: number;
  live_median_mcap_per_tvl: number;
  multiples: Record<string, number>;
}

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Cross Chain Bridge',
]);

const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Launch multiple per dollar of TVL, by what the protocol does. */
const CATEGORY_MULTIPLES: Record<string, number> = {
  Dexs: 0.35,
  Lending: 0.3,
  Derivatives: 0.3,
  'Prediction Market': 0.3,
  Yield: 0.28,
  'Yield Aggregator': 0.28,
  'Leveraged Farming': 0.28,
  'Basis Trading': 0.28,
  RWA: 0.22,
  Restaking: 0.22,
  CDP: 0.2,
  Chain: 0.2,
  'Staking Pool': 0.2,
};

const DEFAULT_MULTIPLE = 0.25;

/** Estimated gas per transaction in USD, by the protocol's first chain. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4,
  Solana: 0.01,
  Stellar: 0.01,
  Sui: 0.05,
  'Hyperliquid L1': 0.05,
  Base: 0.1,
  Polygon: 0.1,
  Linea: 0.1,
  Ink: 0.1,
  Unichain: 0.1,
  Blast: 0.1,
  Monad: 0.1,
  'Robinhood Chain': 0.1,
  Katana: 0.1,
  Corn: 0.1,
  Arc: 0.1,
  Flare: 0.1,
  Arbitrum: 0.25,
  Optimism: 0.25,
  Plasma: 0.25,
  Citrea: 0.25,
  Binance: 0.5,
  Avalanche: 0.5,
  Bittensor: 0.5,
  Tron: 1,
  Bitcoin: 2,
};

const DEFAULT_GAS_USD = 1;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.as_of !== 'string' || typeof raw.source !== 'string') {
    throw new Error('snapshot: missing as_of or source');
  }
  if (typeof raw.floor_usd !== 'number' || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: missing floor_usd or watchlist');
  }
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot: missing protocols');
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p) => {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
      throw new Error('snapshot: protocol without slug or name');
    }
    if (typeof p.tvl_usd !== 'number' || !(p.tvl_usd > 0)) {
      throw new Error(`snapshot: ${p.slug} has no positive tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    } as Protocol;
  });
  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    watchlist: raw.watchlist as string[],
    protocols,
  };
}

/** Records no token in the snapshot: mcap, gecko id and symbol all null. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own inclusion rule, applied to every protocol. */
export function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const days = Math.floor(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86_400_000,
  );
  return days < 0 ? 0 : days;
}

export function categoryMultiple(category: string | null): number {
  if (category === null) return DEFAULT_MULTIPLE;
  return CATEGORY_MULTIPLES[category] ?? DEFAULT_MULTIPLE;
}

export function gasUsd(chains: string[]): number {
  if (chains.length === 0) return DEFAULT_GAS_USD;
  return GAS_USD[chains[0]] ?? DEFAULT_GAS_USD;
}

export function impliedValue(
  p: Protocol,
  asOf: string,
): { value: number; factors: Factors } {
  const multiple = categoryMultiple(p.category);
  const change = p.change_7d ?? 0;
  const clamped = Math.min(120, Math.max(-60, change));
  const growthMult = 1 + (clamped / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  const maturityMult = 0.6 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.4;
  const chainBreadth = 1 + Math.min(Math.max(p.chains.length - 1, 0), 4) * 0.03;
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * chainBreadth));
  return {
    value,
    factors: { multiple, growth_mult: growthMult, maturity_mult: maturityMult, chain_breadth: chainBreadth, age_days: age },
  };
}

function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  const a = age ?? 365;
  if (a >= 730) return 60;
  if (a >= 365) return 45;
  return 30;
}

/** The deposit target for the farm plan's second step, as a full phrase. */
function depositInto(p: Protocol): string {
  switch (p.category) {
    case 'Dexs':
      return `the ${p.name} liquidity pools`;
    case 'Lending':
      return `a ${p.name} lending market`;
    case 'Risk Curators':
      return `a ${p.name} vault`;
    case 'Onchain Capital Allocator':
      return `a ${p.name} allocation vault`;
    case 'Yield':
    case 'Yield Aggregator':
      return `a ${p.name} yield vault`;
    case 'RWA':
      return `the ${p.name} tokenised asset`;
    case 'CDP':
    case 'CDP Manager':
      return `a ${p.name} vault`;
    case 'Derivatives':
      return `a ${p.name} perpetual position`;
    case 'Prediction Market':
      return `a ${p.name} prediction market`;
    case 'Basis Trading':
      return `the ${p.name} basis vault`;
    default:
      return `the ${p.name} core product`;
  }
}

const WEEKLY_ACTION: Record<string, string> = {
  Dexs: 'Swap a small amount through the pool once a week so the wallet shows repeat use.',
  Lending: 'Adjust the supply or borrow a small amount once a week so the wallet shows repeat use.',
  'Risk Curators': 'Top up the vault by a small amount once a week so the wallet shows repeat use.',
  'Onchain Capital Allocator': 'Top up the vault by a small amount once a week so the wallet shows repeat use.',
  Yield: 'Claim or compound the yield once a week so the wallet shows repeat use.',
  'Yield Aggregator': 'Claim or compound the yield once a week so the wallet shows repeat use.',
  RWA: 'Hold the tokenised asset and check its yield once a week.',
  CDP: 'Adjust the vault collateral once a week so the wallet shows repeat use.',
  'CDP Manager': 'Adjust the vault collateral once a week so the wallet shows repeat use.',
  Derivatives: 'Open and close a small position once a week so the wallet shows repeat use.',
  'Prediction Market': 'Place a small prediction once a week so the wallet shows repeat use.',
  'Basis Trading': 'Rebalance the basis position once a week so the wallet shows repeat use.',
};

/** Six concrete farm steps for one protocol, with what they cost and how long they take. */
export function farmSteps(p: Protocol, asOf: string): string[] {
  const capital = capitalTier(p.tvl_usd);
  const gas = gasUsd(p.chains);
  const gasText = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas}`;
  const hold = holdDays(ageDays(asOf, p.listed_at));
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const weekly = WEEKLY_ACTION[p.category ?? ''] ?? 'Use the protocol\u2019s core product once a week so the wallet shows repeat use.';
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: nothing but a few minutes. Time: 5 minutes.',
    `Deposit $${capital} into ${depositInto(p)} on ${chain} and keep the position. Cost: $${capital} of capital and about ${gasText} of gas. Time: 15 minutes to set up.`,
    `${weekly} Cost: about ${gasText} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 5 minutes a week.',
    `When the position is no longer needed, withdraw most of it but leave a small balance for a week so a late snapshot still sees activity. Cost: about ${gasText} of gas. Time: 10 minutes.`,
  ];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Score every rankable protocol, rank by implied value, set the live view aside. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const watchlist = new Set(snapshot.watchlist);
  const scored: RadarRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const { value, factors } = impliedValue(p, snapshot.as_of);
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      farm_steps: farmSteps(p, snapshot.as_of),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      watchlist: watchlist.has(p.slug),
      factors,
    });
  }
  // Highest implied value first; ties break by TVL, then by slug, so the
  // order is stable and deterministic.
  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      mcap_per_tvl: (p.mcap_usd as number) / p.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 24);

  const liveTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;

  const board: BoardRow[] = scored.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  return {
    board,
    radar: {
      model: MODEL_VERSION,
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      watchlist_count: snapshot.watchlist.length,
      rows: scored,
      live,
      live_total: liveTotal,
      live_median_mcap_per_tvl: median(live.map((r) => r.mcap_per_tvl)),
      multiples: { ...CATEGORY_MULTIPLES, default: DEFAULT_MULTIPLE },
    },
  };
}

/** The dashboard's data file: the same board the program writes, in page form. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, the gate wants 100-4000`;
  }
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (typeof row.slug !== 'string' || row.slug.length < 1 || row.slug.length > 128 || /\s/.test(row.slug)) {
      return `row ${row.rank}: bad slug ${JSON.stringify(row.slug)}`;
    }
    if (seen.has(row.slug)) return `row ${row.rank}: duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (!snapshot.protocols.some((p) => p.slug === row.slug)) {
      return `row ${row.rank}: slug ${row.slug} is not in the snapshot`;
    }
    if (row.rank < 1 || !Number.isInteger(row.rank)) return `row ${row.rank}: bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) {
      return `row ${row.rank}: bad implied value`;
    }
    if (row.implied_value_usd > previous) return `row ${row.rank}: implied value rises after rank ${row.rank - 1}`;
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.rank}: ${row.farm_steps?.length ?? 0} farm steps, the gate wants 3-12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = typeof step === 'string' ? step.trim() : '';
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.rank}: farm step of ${trimmed.length} chars, the gate wants 20-600`;
      }
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) return `row ${i + 1}: rank is ${board[i].rank}, not ${i + 1}`;
  }
  if (board.some((r) => r.implied_value_usd === board[0].implied_value_usd) && board.length > 1) {
    // All-same values are refused; a shared top value with a lower one after is fine.
    if (board.every((r) => r.implied_value_usd === board[0].implied_value_usd)) {
      return 'every row carries the same implied value';
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
