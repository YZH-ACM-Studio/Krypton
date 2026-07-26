export type TeamExamModeRole = 'captain' | 'member' | 'admin_preview' | 'invalid';

export interface TeamExamModeContext {
  teamId: string | null;
  teamRole: TeamExamModeRole;
  teamInfo: {
    teamId: string;
    name: string;
    captainUid: number;
    memberUids: number[];
    revision: number;
  } | null;
  canBrowseProblems: boolean;
  canViewTeamRecords: boolean;
  canEditCode: boolean;
  canRun: boolean;
  canSubmit: boolean;
  canUseVirtualPrint: boolean;
}

const SERVER_TEAM_ROLES = new Set<TeamExamModeRole>(['captain', 'member', 'admin_preview']);
const TEAM_FIELDS = [
  'teamId',
  'teamRole',
  'teamInfo',
  'canBrowseProblems',
  'canViewTeamRecords',
  'canEditCode',
  'canRun',
  'canSubmit',
  'canUseVirtualPrint',
];

/**
 * Team UI is opt-in: legacy exam/individual bootstraps have no teamRole and
 * therefore render byte-for-byte through their old branch. Once a server
 * sends a teamRole, missing or malformed booleans fail closed to `false`.
 */
export function readTeamExamModeContext(examMode: unknown): TeamExamModeContext | null {
  if (!examMode || typeof examMode !== 'object') return null;
  const raw = examMode as Record<string, unknown>;
  if (!TEAM_FIELDS.some((field) => Object.hasOwn(raw, field))) return null;
  const rawRole = typeof raw.teamRole === 'string' ? raw.teamRole : '';
  const teamRole: TeamExamModeRole = SERVER_TEAM_ROLES.has(rawRole as TeamExamModeRole)
    ? (rawRole as TeamExamModeRole)
    : 'invalid';
  const validRole = teamRole !== 'invalid';
  const rawInfo = raw.teamInfo && typeof raw.teamInfo === 'object' ? (raw.teamInfo as Record<string, unknown>) : null;
  const memberUids = Array.isArray(rawInfo?.memberUids)
    ? rawInfo.memberUids.map(Number).filter((uid: number) => Number.isSafeInteger(uid) && uid > 0)
    : [];
  const teamInfo =
    rawInfo && typeof rawInfo.teamId === 'string' && typeof rawInfo.name === 'string'
      ? {
          teamId: rawInfo.teamId,
          name: rawInfo.name,
          captainUid: Number(rawInfo.captainUid),
          memberUids,
          revision: Number(rawInfo.revision),
        }
      : null;
  return {
    teamId: typeof raw.teamId === 'string' ? raw.teamId : null,
    teamRole,
    teamInfo,
    canBrowseProblems: validRole && raw.canBrowseProblems === true,
    canViewTeamRecords: validRole && raw.canViewTeamRecords === true,
    canEditCode: validRole && raw.canEditCode === true,
    canRun: validRole && raw.canRun === true,
    canSubmit: validRole && raw.canSubmit === true,
    canUseVirtualPrint: validRole && raw.canUseVirtualPrint === true,
  };
}

export function TeamExamModeSummary({ context, includeTeamName = true }: { context: TeamExamModeContext | null; includeTeamName?: boolean }) {
  if (!context) return null;
  const roleLabel =
    context.teamRole === 'captain'
      ? '队长'
      : context.teamRole === 'member'
        ? '队员 · 只读工作台'
        : context.teamRole === 'admin_preview'
          ? '管理员预览模式'
          : '团队身份异常 · 已锁定';
  return (
    <span data-team-exam-role={context.teamRole}>
      {includeTeamName && context.teamInfo?.name ? `${context.teamInfo.name} · ` : ''}
      {roleLabel}
    </span>
  );
}
