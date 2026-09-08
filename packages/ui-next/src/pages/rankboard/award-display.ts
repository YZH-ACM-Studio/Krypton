export type MedalMetal = 'gold' | 'silver' | 'bronze';

export interface AwardTypeLike {
  key: string;
  name: string;
  hidden?: boolean;
  order?: number;
}

export interface AwardLike {
  type: string;
}

export type AwardFilterGroupId = 'icpc' | 'ccpc' | 'pat' | 'ladder' | 'other';

export const LADDER_DETAIL_COLUMNS: Array<{ key: string; label: string; matchName: RegExp }> = [
  { key: 'ladder_team_special', label: '团特', matchName: /团队特等/ },
  { key: 'ladder_team_1', label: '团一', matchName: /团队一等/ },
  { key: 'ladder_team_2', label: '团二', matchName: /团队二等/ },
  { key: 'ladder_team_3', label: '团三', matchName: /团队三等/ },
  { key: 'ladder_individual_1', label: '个一', matchName: /个人一等/ },
  { key: 'ladder_individual_2', label: '个二', matchName: /个人二等/ },
  { key: 'ladder_individual_3', label: '个三', matchName: /个人三等/ },
];

export const MEDAL_TEXT_CLASS: Record<MedalMetal, string> = {
  gold: 'text-amber-500',
  silver: 'text-slate-400',
  bronze: 'text-orange-500',
};

function blobOf(type: AwardTypeLike | undefined, fallback: string) {
  return `${type?.key || ''} ${type?.name || ''} ${fallback}`;
}

export function isIcpcEcType(type: AwardTypeLike | undefined, fallback = ''): boolean {
  const key = type?.key || fallback;
  const name = type?.name || fallback;
  return /^icpc_ec(?:_|$)/i.test(key) || /ICPC[-_]EC/i.test(key) || /ICPC[-_]EC/i.test(name);
}

export function isIcpcRegularType(type: AwardTypeLike | undefined, fallback = ''): boolean {
  if (isIcpcEcType(type, fallback)) return false;
  const key = type?.key || fallback;
  const name = type?.name || fallback;
  return /^icpc(?:_|$)/i.test(key) || /^ICPC[-_]/i.test(name);
}

export function isCcpcType(type: AwardTypeLike | undefined, fallback = ''): boolean {
  const key = type?.key || fallback;
  const name = type?.name || fallback;
  return /^ccpc(?:_|$)/i.test(key) || /^CCPC[-_]/i.test(name);
}

export function isPatType(type: AwardTypeLike | undefined, fallback = ''): boolean {
  const key = type?.key || fallback;
  const name = type?.name || fallback;
  return /^pat(?:_|$)/i.test(key) || /^PAT[-_]/i.test(name);
}

export function isLadderIndividualKey(typeKey: string): boolean {
  return /^ladder_individual(?:_|$)/i.test(typeKey);
}

export function awardHasEditableExamScore(typeKey: string): boolean {
  return /^pat/i.test(typeKey) || isLadderIndividualKey(typeKey);
}

export function isLadderType(type: AwardTypeLike | undefined, fallback = ''): boolean {
  const key = type?.key || fallback;
  const name = type?.name || fallback;
  return /^ladder(?:_|$)/i.test(key) || /天梯赛/.test(name);
}

export function medalMetal(type: AwardTypeLike | undefined, fallback = ''): MedalMetal | null {
  const blob = blobOf(type, fallback);
  if (/金奖|_gold|gold/i.test(blob)) return 'gold';
  if (/银奖|_silver|silver/i.test(blob)) return 'silver';
  if (/铜奖|_bronze|bronze/i.test(blob)) return 'bronze';
  return null;
}

export interface MedalPair {
  regular: number;
  extra: number;
}

export interface AwardTally {
  icpc: Record<MedalMetal, MedalPair>;
  ccpc: Record<MedalMetal, number>;
  pat: number;
  ladder: number;
  ladderByKey: Record<string, number>;
  other: number;
}

function emptyPair(): MedalPair {
  return { regular: 0, extra: 0 };
}

export function emptyAwardTally(): AwardTally {
  return {
    icpc: { gold: emptyPair(), silver: emptyPair(), bronze: emptyPair() },
    ccpc: { gold: 0, silver: 0, bronze: 0 },
    pat: 0,
    ladder: 0,
    ladderByKey: {},
    other: 0,
  };
}

export function tallyAwards(awards: AwardLike[], typeMap: Map<string, AwardTypeLike>): AwardTally {
  const counts = emptyAwardTally();
  for (const award of awards) {
    const type = typeMap.get(award.type);
    const fallback = type?.name || type?.key || award.type;
    if (isIcpcRegularType(type, fallback) || isIcpcEcType(type, fallback)) {
      const metal = medalMetal(type, fallback);
      if (metal) {
        if (isIcpcEcType(type, fallback)) counts.icpc[metal].extra += 1;
        else counts.icpc[metal].regular += 1;
        continue;
      }
    }
    if (isCcpcType(type, fallback)) {
      const metal = medalMetal(type, fallback);
      if (metal) {
        counts.ccpc[metal] += 1;
        continue;
      }
    }
    if (isPatType(type, fallback)) {
      counts.pat += 1;
      continue;
    }
    if (isLadderType(type, fallback)) {
      counts.ladder += 1;
      const key = type?.key || award.type;
      counts.ladderByKey[key] = (counts.ladderByKey[key] || 0) + 1;
      continue;
    }
    counts.other += 1;
  }
  return counts;
}

export function awardFilterGroup(type: AwardTypeLike): AwardFilterGroupId {
  if (isIcpcRegularType(type) || isIcpcEcType(type)) return 'icpc';
  if (isCcpcType(type)) return 'ccpc';
  if (isPatType(type)) return 'pat';
  if (isLadderType(type)) return 'ladder';
  return 'other';
}

export const AWARD_FILTER_GROUP_LABEL: Record<AwardFilterGroupId, string> = {
  icpc: 'ICPC',
  ccpc: 'CCPC',
  pat: 'PAT',
  ladder: '天梯赛',
  other: '其它',
};

export function awardFilterChipLabel(type: AwardTypeLike): string {
  if (isIcpcEcType(type)) {
    const metal = medalMetal(type);
    if (metal === 'gold') return 'EC 金';
    if (metal === 'silver') return 'EC 银';
    if (metal === 'bronze') return 'EC 铜';
    return type.name.replace(/^ICPC[-_]EC[-_]?/, '') || type.name;
  }
  if (isIcpcRegularType(type) || isCcpcType(type)) {
    const metal = medalMetal(type);
    if (metal === 'gold') return '金';
    if (metal === 'silver') return '银';
    if (metal === 'bronze') return '铜';
  }
  const ladder = LADDER_DETAIL_COLUMNS.find((column) => column.key === type.key || column.matchName.test(type.name));
  if (ladder) return ladder.label;
  return type.name.replace(/^(PAT|百度之星|天梯赛)[-_]?/, '') || type.name;
}

export function buildAwardFilterGroups(types: AwardTypeLike[]): Array<{
  id: AwardFilterGroupId;
  label: string;
  items: AwardTypeLike[];
}> {
  const visible = types.filter((type) => !type.hidden);
  const grouped = new Map<AwardFilterGroupId, AwardTypeLike[]>();
  for (const type of visible) {
    const id = awardFilterGroup(type);
    const items = grouped.get(id) || [];
    items.push(type);
    grouped.set(id, items);
  }
  const order: AwardFilterGroupId[] = ['icpc', 'ccpc', 'pat', 'ladder', 'other'];
  return order
    .filter((id) => (grouped.get(id) || []).length > 0)
    .map((id) => ({
      id,
      label: AWARD_FILTER_GROUP_LABEL[id],
      items: (grouped.get(id) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || a.key.localeCompare(b.key)),
    }));
}

export function shouldShowLadderDetails(typeFilter: Set<string>, showAllLadderDetails: boolean, types: AwardTypeLike[]): boolean {
  if (showAllLadderDetails) return true;
  return types.some((type) => !type.hidden && isLadderType(type) && typeFilter.has(type.key));
}

export function withoutLadderKeys(typeFilter: Set<string>, ladderKeys: Iterable<string>): Set<string> {
  const drop = new Set(ladderKeys);
  return new Set([...typeFilter].filter((key) => !drop.has(key)));
}

export function rowMatchesAwardFilter(
  awards: AwardLike[],
  typeFilter: Set<string>,
  ladderGroupSelected: boolean,
  typeMap: Map<string, AwardTypeLike>,
): boolean {
  if (typeFilter.size === 0 && !ladderGroupSelected) return true;
  return awards.some((award) => {
    if (typeFilter.has(award.type)) return true;
    if (!ladderGroupSelected) return false;
    const type = typeMap.get(award.type);
    return isLadderType(type, type?.name || type?.key || award.type);
  });
}

export function ladderColumnCount(awards: AwardLike[], typeMap: Map<string, AwardTypeLike>, columnKey: string): number {
  const column = LADDER_DETAIL_COLUMNS.find((item) => item.key === columnKey);
  let count = 0;
  for (const award of awards) {
    const type = typeMap.get(award.type);
    const key = type?.key || award.type;
    const name = type?.name || award.type;
    if (!isLadderType(type, name)) {
      if (key === columnKey) count += 1;
      continue;
    }
    if (key === columnKey || (column && column.matchName.test(name))) count += 1;
  }
  return count;
}

export function mergeAwardTally(left: AwardTally, right: AwardTally): AwardTally {
  const ladderByKey = { ...left.ladderByKey };
  for (const [key, value] of Object.entries(right.ladderByKey)) {
    ladderByKey[key] = (ladderByKey[key] || 0) + value;
  }
  return {
    icpc: {
      gold: { regular: left.icpc.gold.regular + right.icpc.gold.regular, extra: left.icpc.gold.extra + right.icpc.gold.extra },
      silver: { regular: left.icpc.silver.regular + right.icpc.silver.regular, extra: left.icpc.silver.extra + right.icpc.silver.extra },
      bronze: { regular: left.icpc.bronze.regular + right.icpc.bronze.regular, extra: left.icpc.bronze.extra + right.icpc.bronze.extra },
    },
    ccpc: {
      gold: left.ccpc.gold + right.ccpc.gold,
      silver: left.ccpc.silver + right.ccpc.silver,
      bronze: left.ccpc.bronze + right.ccpc.bronze,
    },
    pat: left.pat + right.pat,
    ladder: left.ladder + right.ladder,
    ladderByKey,
    other: left.other + right.other,
  };
}

export function isRankboardStatsMode(input: {
  typeFilterSize: number;
  ladderGroupSelected: boolean;
  schoolFilter: string;
  yearFilter: string;
  search: string;
}): boolean {
  return input.typeFilterSize > 0 || input.ladderGroupSelected || input.schoolFilter !== 'all' || input.yearFilter !== 'all' || input.search.trim() !== '';
}

export function rankboardTableRows<T extends { rank: number }>(filtered: T[], statsMode: boolean): T[] {
  return statsMode ? filtered : filtered.filter((row) => row.rank > 3);
}
