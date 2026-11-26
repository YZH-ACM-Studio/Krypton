import { STATUS_CODES, type STATUS } from '@hydrooj/common';

export type RecordDetailTab = 'overview' | 'cases' | 'code';
export type RecordDetailMode = 'workspace' | 'exam-code';

export interface RecordCaseLike {
  status?: number;
}

export function recordCodeView(
  code: unknown,
  problem: { problemKind?: unknown; config?: unknown },
): { text: string; error?: string } {
  const text = String(code ?? '');
  const config = problem.config;
  const configKind = config && typeof config === 'object' && 'type' in config ? config.type : undefined;
  const kind = problem.problemKind ?? configKind;
  if (!text || (kind !== 'function' && kind !== 'program_fill')) return { text };

  // Structured submissions contain only the student's region values. Keep
  // their submission order and never reconstruct the private judge template.
  try {
    const regions: unknown = JSON.parse(text);
    if (regions && typeof regions === 'object' && !Array.isArray(regions)) {
      const entries = Object.entries(regions);
      if (entries.length && entries.every(([id, value]) => id && typeof value === 'string')) {
        return { text: entries.map(([, value]) => value).join('\n\n') };
      }
    }
  } catch {
    // Invalid submissions must remain inspectable with an explicit error.
  }
  return { text, error: '这条提交的作答区数据格式无效，以下显示原始提交内容。' };
}

export function recordDetailTabs({ hasCode, caseCount }: { hasCode: boolean; caseCount: number }): RecordDetailTab[] {
  return ['overview', ...(caseCount > 0 ? (['cases'] as const) : []), ...(hasCode ? (['code'] as const) : [])];
}

export function defaultRecordDetailTab({ hasCode, caseCount }: { hasCode: boolean; caseCount: number }): RecordDetailTab {
  if (hasCode) return 'code';
  if (caseCount > 0) return 'cases';
  return 'overview';
}

export function recordDetailMode({
  hasExamMode,
}: {
  hasExamMode: boolean;
  hasContestContext?: boolean;
  postContestPractice?: boolean;
}): RecordDetailMode {
  return hasExamMode ? 'exam-code' : 'workspace';
}

export function recordCodeDownloadAvailable({
  mode,
  serverAvailable,
  hasInlineCode,
  hasCodeFile,
  hasHackFile,
}: {
  mode: RecordDetailMode;
  serverAvailable: unknown;
  hasInlineCode: boolean;
  hasCodeFile: boolean;
  hasHackFile: boolean;
}) {
  if (mode === 'exam-code') return serverAvailable === true;
  return hasInlineCode || hasCodeFile || hasHackFile;
}

export function resolveRecordIdentity({
  user,
  uid,
  student,
}: {
  user?: { uname?: unknown } | null;
  uid: unknown;
  student?: { studentId?: unknown; realName?: unknown } | null;
}) {
  const uname = typeof user?.uname === 'string' ? user.uname.trim() : '';
  const studentId = typeof student?.studentId === 'string' ? student.studentId.trim() : '';
  const realName = typeof student?.realName === 'string' ? student.realName.trim() : '';
  return {
    username: uname || `#${String(uid ?? '')}`,
    student: studentId || realName ? { studentId, realName } : null,
  };
}

export function summarizeRecordCases(cases: RecordCaseLike[]) {
  return cases.reduce(
    (summary, item) => {
      const status = Number(item.status ?? 0);
      const category = STATUS_CODES[status as STATUS];
      if (category === 'pass') summary.accepted += 1;
      else if (category === 'pending' || category === 'progress') summary.active += 1;
      else if (category === 'fail') summary.failed += 1;
      else summary.other += 1;
      return summary;
    },
    { accepted: 0, failed: 0, active: 0, other: 0, total: cases.length },
  );
}

export function paginateRecordCases<T>(items: T[], requestedPage: number, pageSize = 50) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer');
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    total: items.length,
    totalPages,
    start: items.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
  };
}
