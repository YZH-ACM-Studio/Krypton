export type StudentSetsTab = 'running' | 'upcoming' | 'practice' | 'ended';
export type ContestFlavor = 'paper' | 'acm' | 'ioi' | 'oi' | 'homework';
export type RowTone = 'neutral' | 'warning';
export type RowTarget = 'overview' | 'problems';

export interface ContestRow {
  kind: 'exam' | 'homework';
  id: string;
  flavor: ContestFlavor;
  title: string;
  href: string;
  beginAt: string;
  endAt: string;
  dueAt: string | null;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
  attended: boolean;
  clientRequired: boolean;
  team: boolean;
  problemCount: number;
  progress: { answered: number } | { accepted: number } | { score: number } | null;
  finalized: boolean;
  done: boolean;
}

export interface PracticeRow {
  kind: 'practice';
  id: string;
  title: string;
  href: string;
  stageCount: number;
  problemCount: number;
  doneCount: number;
  sourceLabel: string;
}

export interface TeamRow {
  kind: 'team';
  id: string;
  title: string;
  href: string;
  description: string;
  myState: 'none' | 'invited' | 'joined';
  inviteCount: number;
  memberCount: number | null;
}

export type StudentSetRow = ContestRow | PracticeRow | TeamRow;

export interface EndedRow {
  kind: 'exam' | 'homework';
  id: string;
  flavor: ContestFlavor;
  title: string;
  href: string;
  endAt: string;
  result: { kind: 'absent' } | { kind: 'hidden' } | { kind: 'score'; score: number } | { kind: 'accepted'; accepted: number };
}

export interface StudentSetsBody {
  tab: StudentSetsTab;
  counts: { running: number; upcoming: number; practice: number };
  rows: StudentSetRow[];
  practice: { page: number; pageCount: number; q: string } | null;
  ended: {
    rows: EndedRow[];
    page: number;
    pageCount: number;
    total: number;
    type: 'all' | 'exam' | 'homework';
    q: string;
  } | null;
}

export interface RowView {
  typeLabel: string;
  meta: string;
  time: { kind: 'text'; text: string } | { kind: 'countdown'; endAt: number; label: '剩余' };
  sub: { text: string; tone: RowTone } | null;
  progress: { text: string; ratio: number | null } | null;
  action: { label: string; variant: 'soft' | 'ghost'; href: string; target: RowTarget } | null;
  done: boolean;
}

/** School calendar. China Standard Time has no DST, so a fixed offset matches every ISO instant. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SEP = ' \u00B7 ';
const EM_DASH = '\u2014';
const TEAM_FALLBACK = '每队 1\u20133 人';
const LATE = '已过截止，迟交会扣分';

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseInstant(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) invalid(`invalid timestamp ${iso}`);
  return parsed;
}

function civilTime(instant: number): CivilTime {
  if (!Number.isFinite(instant)) invalid('timestamp must be finite');
  const shifted = new Date(instant + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function formatMoment(iso: string, now: number): string {
  const at = civilTime(parseInstant(iso));
  const today = civilTime(now);
  const clock = `${pad(at.hour)}:${pad(at.minute)}`;
  if (at.year === today.year && at.month === today.month && at.day === today.day) return clock;
  if (at.year === today.year) return `${pad(at.month)}/${pad(at.day)} ${clock}`;
  return `${at.year}-${pad(at.month)}-${pad(at.day)} ${clock}`;
}

export function formatDate(iso: string, now: number): string {
  const at = civilTime(parseInstant(iso));
  const today = civilTime(now);
  if (at.year === today.year) return `${pad(at.month)}/${pad(at.day)}`;
  return `${at.year}-${pad(at.month)}-${pad(at.day)}`;
}

export function durationText(ms: number): string {
  if (!Number.isFinite(ms)) invalid('duration must be a finite number');
  if (ms < 0) invalid('duration must not be negative');
  const minutesTotal = Math.floor(ms / MINUTE_MS);
  if (minutesTotal < 1) return '1 分钟';
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) {
    const hours = Math.floor((ms - days * DAY_MS) / HOUR_MS);
    return hours === 0 ? `${days} 天` : `${days} 天 ${hours} 小时`;
  }
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 1) {
    const minutes = Math.floor((ms - hours * HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutesTotal} 分钟`;
}

export function endedResultText(result: EndedRow['result']): string {
  if (result.kind === 'absent') return '未参加';
  if (result.kind === 'hidden') return '未公布';
  if (result.kind === 'score') return `${result.score} 分`;
  return `通过 ${result.accepted} 题`;
}

function textTime(text: string): RowView['time'] {
  return { kind: 'text', text };
}

function countdown(iso: string): RowView['time'] {
  return { kind: 'countdown', endAt: parseInstant(iso), label: '剩余' };
}

function note(text: string, tone: RowTone = 'neutral'): NonNullable<RowView['sub']> {
  return { text, tone };
}

function meter(text: string, ratio: number | null = null): NonNullable<RowView['progress']> {
  return { text, ratio };
}

function rowAction(label: string, variant: 'soft' | 'ghost', href: string, target: RowTarget = 'overview'): NonNullable<RowView['action']> {
  return { label, variant, href, target };
}

function remainingMs(iso: string, now: number): number {
  return Math.max(0, parseInstant(iso) - now);
}

function contestTypeLabel(row: ContestRow): string {
  if (row.kind === 'homework' || row.flavor === 'homework') return '作业';
  if (row.flavor === 'paper') return `考试${SEP}试卷`;
  if (row.flavor === 'acm') return `考试${SEP}ACM`;
  if (row.flavor === 'ioi') return `考试${SEP}IOI`;
  if (row.flavor === 'oi') return `考试${SEP}OI`;
  return invalid(`unknown contest flavor ${row.flavor}`);
}

function contestMeta(row: ContestRow): string {
  const parts = [`${row.problemCount} 题`];
  if (row.durationMinutes !== null && row.durationMinutes > 0) parts.push(`个人限时 ${row.durationMinutes} 分钟`);
  if (row.team) parts.push('团队赛');
  if (row.clientRequired) parts.push('机房客户端考试');
  return parts.join(SEP);
}

function isRanked(flavor: ContestFlavor): boolean {
  return flavor === 'acm' || flavor === 'ioi' || flavor === 'oi';
}

function readAnswered(progress: ContestRow['progress']): number {
  if (progress !== null && 'answered' in progress) return progress.answered;
  return invalid('contest progress must be an answered count');
}

function readAccepted(progress: ContestRow['progress']): number {
  if (progress !== null && 'accepted' in progress) return progress.accepted;
  return invalid('contest progress must be an accepted count');
}

function readScore(progress: ContestRow['progress']): number {
  if (progress !== null && 'score' in progress) return progress.score;
  return invalid('contest progress must be a score');
}

function teamView(row: TeamRow): RowView {
  let progressText = '还没有队伍';
  if (row.myState === 'invited') progressText = `${row.inviteCount} 个邀请`;
  if (row.myState === 'joined') {
    if (row.memberCount === null) invalid('joined team is missing memberCount');
    progressText = `已组队 ${row.memberCount}/3`;
  }
  const joined = row.myState === 'joined';
  return {
    typeLabel: '组队',
    meta: row.description.trim() === '' ? TEAM_FALLBACK : row.description,
    time: textTime('开放中'),
    sub: null,
    progress: meter(progressText),
    action: joined ? rowAction('查看', 'ghost', row.href) : rowAction('去组队', 'soft', row.href),
    done: false,
  };
}

function practiceView(row: PracticeRow): RowView {
  const parts: string[] = [];
  if (row.stageCount > 1) parts.push(`${row.stageCount} 个阶段`);
  parts.push(`${row.problemCount} 题`, row.sourceLabel);
  const ratio = row.problemCount === 0 ? 0 : row.doneCount / row.problemCount;
  const started = row.doneCount > 0;
  const percent = row.problemCount === 0 ? 0 : Math.round(ratio * 100);
  return {
    typeLabel: '练习',
    meta: parts.join(SEP),
    time: textTime('不限时间'),
    sub: note(started ? `已完成 ${percent}%` : '还没开始'),
    progress: meter(`${row.doneCount} / ${row.problemCount}`, ratio),
    action: started ? rowAction('继续', 'soft', row.href, 'problems') : rowAction('开始', 'ghost', row.href),
    done: false,
  };
}

function shell(row: ContestRow, patch: Pick<RowView, 'time' | 'sub' | 'progress' | 'action'>): RowView {
  return {
    typeLabel: contestTypeLabel(row),
    meta: contestMeta(row),
    time: patch.time,
    sub: patch.sub,
    progress: patch.progress,
    action: patch.action,
    done: row.done,
  };
}

function clientRunning(row: ContestRow, now: number): RowView {
  return shell(row, {
    time: textTime(`${formatMoment(row.endAt, now)} 结束`),
    sub: note('只能在机房客户端进入'),
    progress: meter(EM_DASH),
    action: rowAction('查看', 'ghost', row.href),
  });
}

function paperRunning(row: ContestRow, now: number): RowView {
  if (row.finalized) {
    return shell(row, {
      time: textTime('已交卷'),
      sub: note(`考试 ${formatMoment(row.endAt, now)} 结束`),
      progress: null,
      action: rowAction('查看', 'ghost', row.href),
    });
  }
  const personalEnd = row.personalEndAt;
  if (row.startAt !== null && personalEnd !== null && now < parseInstant(personalEnd)) {
    return shell(row, {
      time: countdown(personalEnd),
      sub: note(`个人截止 ${formatMoment(personalEnd, now)}`),
      progress: meter(`已答 ${readAnswered(row.progress)}/${row.problemCount}`),
      action: rowAction('继续作答', 'soft', row.href, 'problems'),
    });
  }
  if (row.startAt !== null && personalEnd !== null) {
    return shell(row, {
      time: textTime('作答时间已到'),
      sub: null,
      progress: null,
      action: rowAction('查看', 'ghost', row.href),
    });
  }
  if (row.startAt !== null) {
    return shell(row, {
      time: textTime(`${formatMoment(row.endAt, now)} 结束`),
      sub: note(`还有 ${durationText(remainingMs(row.endAt, now))}`),
      progress: meter(`已答 ${readAnswered(row.progress)}/${row.problemCount}`),
      action: rowAction('继续作答', 'soft', row.href, 'problems'),
    });
  }
  if (row.durationMinutes !== null && row.durationMinutes > 0) {
    return shell(row, {
      time: textTime(`${formatMoment(row.endAt, now)} 前开始`),
      sub: note(`限时 ${row.durationMinutes} 分钟`),
      progress: meter('未开始'),
      action: rowAction('开始作答', 'soft', row.href),
    });
  }
  return shell(row, {
    time: textTime(`${formatMoment(row.endAt, now)} 结束`),
    sub: note(`还有 ${durationText(remainingMs(row.endAt, now))}`),
    progress: meter('未开始'),
    action: rowAction('开始作答', 'soft', row.href),
  });
}

function rankedRunning(row: ContestRow, now: number): RowView {
  const closing = note(`${formatMoment(row.endAt, now)} 结束`);
  if (row.attended) {
    const progressText = row.flavor === 'acm' ? `通过 ${readAccepted(row.progress)}/${row.problemCount}` : `${readScore(row.progress)} 分`;
    return shell(row, {
      time: countdown(row.personalEndAt ?? row.endAt),
      sub: closing,
      progress: meter(progressText),
      action: rowAction('进入', 'soft', row.href, 'problems'),
    });
  }
  return shell(row, {
    time: countdown(row.endAt),
    sub: closing,
    progress: meter('未报名'),
    action: row.team ? rowAction('查看', 'ghost', row.href) : rowAction('报名', 'soft', row.href),
  });
}

function homeworkRunning(row: ContestRow, now: number): RowView {
  const limit = row.durationMinutes;
  if (limit !== null && limit > 0) {
    if (row.startAt === null) {
      const remain = parseInstant(row.endAt) - now;
      const short = remain < limit * MINUTE_MS;
      return shell(row, {
        time: textTime(`${formatMoment(row.endAt, now)} 前开始`),
        sub: short ? note(`只剩 ${durationText(Math.max(0, remain))}`, 'warning') : note(`个人限时 ${limit} 分钟`),
        progress: meter('未开始'),
        action: rowAction('开始作答', 'soft', row.href),
      });
    }
    const personalEnd = row.personalEndAt;
    if (personalEnd === null) invalid('timed homework is missing personalEndAt');
    if (now < parseInstant(personalEnd)) {
      return shell(row, {
        time: countdown(personalEnd),
        sub: note(`个人截止 ${formatMoment(personalEnd, now)}`),
        progress: meter(`${readAnswered(row.progress)}/${row.problemCount}`),
        action: rowAction('继续', 'soft', row.href, 'problems'),
      });
    }
    return shell(row, {
      time: textTime('作答时间已到'),
      sub: null,
      progress: meter(`${readAnswered(row.progress)}/${row.problemCount}`),
      action: rowAction('查看', 'ghost', row.href),
    });
  }
  const overdue = row.dueAt !== null && now >= parseInstant(row.dueAt);
  const deadline = overdue ? row.endAt : (row.dueAt ?? row.endAt);
  return shell(row, {
    time: textTime(`${formatMoment(deadline, now)} ${overdue ? '截止迟交' : '截止'}`),
    sub: row.done ? note('已全部提交') : overdue ? note(LATE, 'warning') : note(`还有 ${durationText(remainingMs(deadline, now))}`),
    progress: meter(`${readAnswered(row.progress)}/${row.problemCount}`),
    action: row.done ? rowAction('查看', 'ghost', row.href) : rowAction('去做', 'soft', row.href, 'problems'),
  });
}

function upcomingView(row: ContestRow, now: number): RowView {
  const registrable = isRanked(row.flavor) && !row.team && !row.attended && !row.clientRequired;
  return shell(row, {
    time: textTime(`${formatMoment(row.beginAt, now)} ${row.kind === 'homework' ? '开放' : '开始'}`),
    sub: note(`${durationText(remainingMs(row.beginAt, now))}后`),
    progress: isRanked(row.flavor) && row.attended ? meter('已报名') : null,
    action: registrable ? rowAction('报名', 'soft', row.href) : rowAction('查看', 'ghost', row.href),
  });
}

function runningView(row: ContestRow, now: number): RowView {
  if (row.clientRequired) return clientRunning(row, now);
  if (row.kind === 'homework') return homeworkRunning(row, now);
  if (row.flavor === 'paper') return paperRunning(row, now);
  if (isRanked(row.flavor)) return rankedRunning(row, now);
  return invalid(`unknown contest flavor ${row.flavor}`);
}

export function studentSetRowView(row: StudentSetRow, now: number): RowView {
  if (!Number.isFinite(now)) invalid('now must be a finite timestamp');
  if (row.kind === 'team') return teamView(row);
  if (row.kind === 'practice') return practiceView(row);
  if (now < parseInstant(row.beginAt)) return upcomingView(row, now);
  return runningView(row, now);
}

function read(record: Record<string, unknown>, key: string, label = key): unknown {
  if (!Object.hasOwn(record, key)) invalid(`missing ${label}`);
  return record[key];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be a finite number`);
  return value;
}

function requireIso(value: unknown, label: string): string {
  const text = requireString(value, label);
  parseInstant(text);
  return text;
}

function requireNullableIso(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireIso(value, label);
}

function requireNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return requireNumber(value, label);
}

function parseFlavor(kind: 'exam' | 'homework', flavor: unknown): ContestFlavor {
  if (kind === 'homework') {
    if (flavor !== 'homework') invalid('homework flavor must be homework');
    return 'homework';
  }
  if (flavor === 'paper' || flavor === 'acm' || flavor === 'ioi' || flavor === 'oi') return flavor;
  return invalid('exam flavor is unknown');
}

function parseProgress(value: unknown): ContestRow['progress'] {
  if (value === null) return null;
  if (!isRecord(value)) invalid('progress must be an object or null');
  const keys = Object.keys(value);
  if (keys.length !== 1) invalid('progress must contain exactly one metric');
  const key = keys[0];
  if (key === 'answered') return { answered: requireNumber(value.answered, 'progress.answered') };
  if (key === 'accepted') return { accepted: requireNumber(value.accepted, 'progress.accepted') };
  if (key === 'score') return { score: requireNumber(value.score, 'progress.score') };
  return invalid('progress metric is unknown');
}

function parseContest(record: Record<string, unknown>): ContestRow {
  const kind = record.kind === 'homework' ? 'homework' : record.kind === 'exam' ? 'exam' : invalid('contest kind is unknown');
  return {
    kind,
    id: requireString(read(record, 'id'), 'id'),
    flavor: parseFlavor(kind, read(record, 'flavor')),
    title: requireString(read(record, 'title'), 'title'),
    href: requireString(read(record, 'href'), 'href'),
    beginAt: requireIso(read(record, 'beginAt'), 'beginAt'),
    endAt: requireIso(read(record, 'endAt'), 'endAt'),
    dueAt: requireNullableIso(read(record, 'dueAt'), 'dueAt'),
    durationMinutes: requireNullableNumber(read(record, 'durationMinutes'), 'durationMinutes'),
    startAt: requireNullableIso(read(record, 'startAt'), 'startAt'),
    personalEndAt: requireNullableIso(read(record, 'personalEndAt'), 'personalEndAt'),
    attended: requireBoolean(read(record, 'attended'), 'attended'),
    clientRequired: requireBoolean(read(record, 'clientRequired'), 'clientRequired'),
    team: requireBoolean(read(record, 'team'), 'team'),
    problemCount: requireNumber(read(record, 'problemCount'), 'problemCount'),
    progress: parseProgress(read(record, 'progress')),
    finalized: requireBoolean(read(record, 'finalized'), 'finalized'),
    done: requireBoolean(read(record, 'done'), 'done'),
  };
}

function parsePractice(record: Record<string, unknown>): PracticeRow {
  return {
    kind: 'practice',
    id: requireString(read(record, 'id'), 'id'),
    title: requireString(read(record, 'title'), 'title'),
    href: requireString(read(record, 'href'), 'href'),
    stageCount: requireNumber(read(record, 'stageCount'), 'stageCount'),
    problemCount: requireNumber(read(record, 'problemCount'), 'problemCount'),
    doneCount: requireNumber(read(record, 'doneCount'), 'doneCount'),
    sourceLabel: requireString(read(record, 'sourceLabel'), 'sourceLabel'),
  };
}

function parseTeam(record: Record<string, unknown>): TeamRow {
  const myState = read(record, 'myState');
  if (myState !== 'none' && myState !== 'invited' && myState !== 'joined') invalid('team myState is unknown');
  return {
    kind: 'team',
    id: requireString(read(record, 'id'), 'id'),
    title: requireString(read(record, 'title'), 'title'),
    href: requireString(read(record, 'href'), 'href'),
    description: requireString(read(record, 'description'), 'description'),
    myState,
    inviteCount: requireNumber(read(record, 'inviteCount'), 'inviteCount'),
    memberCount: requireNullableNumber(read(record, 'memberCount'), 'memberCount'),
  };
}

function parseRow(value: unknown): StudentSetRow {
  if (!isRecord(value)) invalid('row must be an object');
  if (value.kind === 'practice') return parsePractice(value);
  if (value.kind === 'team') return parseTeam(value);
  if (value.kind === 'exam' || value.kind === 'homework') return parseContest(value);
  return invalid('row kind is unknown');
}

function parseCounts(value: unknown): StudentSetsBody['counts'] {
  if (!isRecord(value)) invalid('counts must be an object');
  return {
    running: requireNumber(read(value, 'running', 'counts.running'), 'counts.running'),
    upcoming: requireNumber(read(value, 'upcoming', 'counts.upcoming'), 'counts.upcoming'),
    practice: requireNumber(read(value, 'practice', 'counts.practice'), 'counts.practice'),
  };
}

function parsePracticePage(value: unknown): StudentSetsBody['practice'] {
  if (value === null) return null;
  if (!isRecord(value)) invalid('practice page must be an object or null');
  return {
    page: requireNumber(read(value, 'page', 'practice.page'), 'practice.page'),
    pageCount: requireNumber(read(value, 'pageCount', 'practice.pageCount'), 'practice.pageCount'),
    q: requireString(read(value, 'q', 'practice.q'), 'practice.q'),
  };
}

function parseEndedResult(value: unknown): EndedRow['result'] {
  if (!isRecord(value)) invalid('ended result must be an object');
  if (value.kind === 'absent') return { kind: 'absent' };
  if (value.kind === 'hidden') return { kind: 'hidden' };
  if (value.kind === 'score') return { kind: 'score', score: requireNumber(read(value, 'score', 'result.score'), 'result.score') };
  if (value.kind === 'accepted') return { kind: 'accepted', accepted: requireNumber(read(value, 'accepted', 'result.accepted'), 'result.accepted') };
  return invalid('ended result kind is unknown');
}

function parseEndedRow(value: unknown): EndedRow {
  if (!isRecord(value)) invalid('ended row must be an object');
  const kind = value.kind === 'homework' ? 'homework' : value.kind === 'exam' ? 'exam' : invalid('ended row kind is unknown');
  return {
    kind,
    id: requireString(read(value, 'id'), 'id'),
    flavor: parseFlavor(kind, read(value, 'flavor')),
    title: requireString(read(value, 'title'), 'title'),
    href: requireString(read(value, 'href'), 'href'),
    endAt: requireIso(read(value, 'endAt'), 'endAt'),
    result: parseEndedResult(read(value, 'result')),
  };
}

function parseEnded(value: unknown): StudentSetsBody['ended'] {
  if (value === null) return null;
  if (!isRecord(value)) invalid('ended page must be an object or null');
  const rows = read(value, 'rows', 'ended.rows');
  if (!Array.isArray(rows)) invalid('ended.rows must be an array');
  const type = read(value, 'type', 'ended.type');
  if (type !== 'all' && type !== 'exam' && type !== 'homework') invalid('ended type is unknown');
  return {
    rows: rows.map(parseEndedRow),
    page: requireNumber(read(value, 'page', 'ended.page'), 'ended.page'),
    pageCount: requireNumber(read(value, 'pageCount', 'ended.pageCount'), 'ended.pageCount'),
    total: requireNumber(read(value, 'total', 'ended.total'), 'ended.total'),
    type,
    q: requireString(read(value, 'q', 'ended.q'), 'ended.q'),
  };
}

function parseTab(value: unknown): StudentSetsTab {
  if (value === 'running' || value === 'upcoming' || value === 'practice' || value === 'ended') return value;
  return invalid('tab is unknown');
}

export function parseStudentSets(raw: unknown): StudentSetsBody {
  if (!isRecord(raw)) invalid('student sets payload must be an object');
  const tab = parseTab(read(raw, 'tab'));
  const rowsValue = read(raw, 'rows');
  if (!Array.isArray(rowsValue)) invalid('rows must be an array');
  const practice = parsePracticePage(read(raw, 'practice'));
  const ended = parseEnded(read(raw, 'ended'));
  if (tab === 'practice' && practice === null) invalid('practice tab is missing its page');
  if (tab !== 'practice' && practice !== null) invalid('practice page is only present on the practice tab');
  if (tab === 'ended' && ended === null) invalid('ended tab is missing its page');
  if (tab !== 'ended' && ended !== null) invalid('ended page is only present on the ended tab');
  if (tab === 'ended' && rowsValue.length !== 0) invalid('ended tab keeps list rows empty');
  return {
    tab,
    counts: parseCounts(read(raw, 'counts')),
    rows: rowsValue.map(parseRow),
    practice,
    ended,
  };
}
