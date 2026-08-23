export type ProblemSetAccessSourceKind = 'public' | 'group' | 'course' | 'redemption' | 'manage';

export interface ProblemSetAccessSource {
  kind: ProblemSetAccessSourceKind;
  groupId?: string;
  courseId?: string;
  entitlementId?: string;
}

export interface ProblemSetAccessDecision {
  discoverable?: boolean;
  accessible?: boolean;
  enrolled?: boolean;
  sources?: ProblemSetAccessSource[];
}

export type ProblemSetListBucket = 'all' | 'discoverable' | 'mine' | 'redemption';

export function problemSetAccessSources(access: ProblemSetAccessDecision | undefined): ProblemSetAccessSource[] {
  if (!Array.isArray(access?.sources)) return [];
  return access.sources.filter((source): source is ProblemSetAccessSource => {
    return !!source && typeof source === 'object' && typeof source.kind === 'string';
  });
}

export function isCatalogDiscoverable(sources: readonly ProblemSetAccessSource[]): boolean {
  return sources.some((source) => source.kind === 'public' || source.kind === 'group' || source.kind === 'course' || source.kind === 'manage');
}

export function isRedemptionVisible(sources: readonly ProblemSetAccessSource[]): boolean {
  return sources.some((source) => source.kind === 'redemption');
}

export function matchesProblemSetBucket(
  bucket: ProblemSetListBucket,
  access: ProblemSetAccessDecision | undefined,
  enrolled: boolean,
): boolean {
  const sources = problemSetAccessSources(access);
  if (bucket === 'all') return true;
  if (bucket === 'mine') return enrolled;
  if (bucket === 'redemption') return isRedemptionVisible(sources);
  return isCatalogDiscoverable(sources);
}

export function problemSetSourceLabel(source: ProblemSetAccessSource): string {
  if (source.kind === 'public') return '公开';
  if (source.kind === 'group') return '用户组';
  if (source.kind === 'course') return '课程引用';
  if (source.kind === 'redemption') return '兑换';
  if (source.kind === 'manage') return '管理';
  return source.kind;
}

export function isStageEnterable(ns: {
  isOpen?: boolean;
  isProgress?: boolean;
  isDone?: boolean;
  hasAccess?: boolean;
}): boolean {
  if (ns.hasAccess === false) return false;
  return !!ns.isOpen || !!ns.isProgress || !!ns.isDone;
}

export function stageLockReason(ns: {
  isOpen?: boolean;
  isProgress?: boolean;
  isDone?: boolean;
  hasAccess?: boolean;
  lockReason?: string;
}): 'no_access' | 'prereq' | null {
  if (isStageEnterable(ns)) return null;
  if (ns.hasAccess === false || ns.lockReason === 'no_access') return 'no_access';
  return 'prereq';
}
