/** Configured sets save only paper fields; legacy containers keep their full-form contract. */
import { TEACH_SCORED_CONTEST_RULES } from '@hydrooj/common';
import type { TeachType } from '@hydrooj/common';
import { promptDialog } from '@/components/ui/dialog';
import { getJson, postForm } from '../api';
import {
  contestFormBody,
  homeworkFormBody,
  legacyEditPath,
  parseContestSnapshot,
  parseHomeworkSnapshot,
  parsePracticeSnapshot,
  practiceFormBody,
} from '../legacy-forms';
import type { ContestFormState, HomeworkFormState, PracticeFormState } from '../legacy-forms';
import {
  paperIssues,
  paperPids,
  paperQuotas,
  paperScores,
  paperStagesForSave,
} from '../paper';
import type { PaperState } from '../paper';

const SAVE_FAILED = '保存失败';
const PAPER_BLOCKED = '试卷还有问题没解决，不能保存';

function contestState(state: ContestFormState, current: PaperState): ContestFormState {
  const { rule } = state;
  if (state.setCodePolicy !== current.setCodePolicy) throw new Error('题目集设置已变更，请刷新后重新组卷。');
  return {
    ...state,
    pids: paperPids(current),
    scores: state.setCodePolicy === undefined ? TEACH_SCORED_CONTEST_RULES.includes(rule) ? paperScores(current) : state.scores
      : state.setCodePolicy === 'acm' ? state.scores : paperScores({ ...current, setCodePolicy: state.setCodePolicy }),
    examPaperQuotas: state.setCodePolicy === undefined && rule === 'exam' ? paperQuotas(current) : state.examPaperQuotas,
  };
}

function homeworkState(state: HomeworkFormState, current: PaperState): HomeworkFormState {
  if (state.setCodePolicy !== current.setCodePolicy) throw new Error('题目集设置已变更，请刷新后重新组卷。');
  return {
    ...state,
    pids: paperPids(current),
    scores: paperScores(current),
  };
}

function practiceState(state: PracticeFormState, current: PaperState): PracticeFormState {
  return {
    ...state,
    stages: paperStagesForSave(current),
  };
}

function configuredPaperBody(current: PaperState): URLSearchParams {
  const body = new URLSearchParams({ operation: 'update_problems', pids: paperPids(current).join(',') });
  const scores = paperScores(current);
  if (scores !== null) body.set('problemScores', JSON.stringify(scores));
  return body;
}

function formBody(type: TeachType, raw: unknown, current: PaperState): URLSearchParams {
  switch (type) {
    case 'homework': {
      const state = homeworkState(parseHomeworkSnapshot(raw).state, current);
      return state.setCodePolicy !== undefined ? configuredPaperBody(current) : homeworkFormBody(state);
    }
    case 'practice':
      return practiceFormBody(practiceState(parsePracticeSnapshot(raw).state, current));
    case 'exam':
    case 'acm':
    case 'oi': {
      const state = contestState(parseContestSnapshot(raw).state, current);
      return state.setCodePolicy !== undefined ? configuredPaperBody(current) : contestFormBody(state);
    }
    default: {
      const unexpected: never = type;
      throw new TypeError(`teach_type_invalid:${String(unexpected)}`);
    }
  }
}

async function savePaperPoints(path: string, paper: PaperState): Promise<number> {
  if (paper.revision === undefined) throw new Error('请刷新组卷页后保存卷内分值。');
  const edit = {
    revision: paper.revision, target: paper.target ?? null, points: paperScores(paper),
    excluded: paper.items.filter((item) => item.excluded).map((item) => item.docId), quotas: paperQuotas(paper),
  };
  const body = new URLSearchParams({ operation: 'update_problems', pids: paperPids(paper).join(','), paperEdit: JSON.stringify(edit) });
  for (;;) {
    const result = await postForm(path, body, SAVE_FAILED);
    const preview = result.confirmation;
    if (preview === undefined) {
      if (typeof result.revision !== 'number' || !Number.isSafeInteger(result.revision)) throw new Error('服务器没有返回试卷版本。');
      return result.revision;
    }
    if (!preview || typeof preview !== 'object' || !('fingerprint' in preview) || typeof preview.fingerprint !== 'string'
      || !('participants' in preview) || typeof preview.participants !== 'number' || !('changes' in preview) || !Array.isArray(preview.changes)
      || !preview.changes.every((range) => typeof range === 'string') || !('locked' in preview) || typeof preview.locked !== 'number'
      || !('passScore' in preview) || (preview.passScore !== null && typeof preview.passScore !== 'number')) throw new Error('改分影响信息无效。');
    const lines = [`将更新 ${preview.participants} 名参与者的成绩。`];
    if (preview.changes.length) lines.push(`卷面满分变动为 ${preview.changes.join('、')} 分。`);
    if (preview.passScore !== null) lines.push(`及格线为 ${preview.passScore} 分。`);
    if (preview.locked) lines.push(`${preview.locked} 个锁定历史轮次保留原分。`);
    const reason = await promptDialog(lines.join(''), { title: '确认调整试卷', placeholder: '填写修改理由', confirmLabel: '确认并重算' });
    if (reason === null) throw new Error('已取消，修改保留在组卷页。');
    if (!reason.trim()) throw new Error('请填写修改理由后保存。');
    body.set('paperEdit', JSON.stringify({ ...edit, confirm: preview.fingerprint, reason: reason.trim() }));
  }
}

export async function saveComposition(args: { type: TeachType; id: string; current: PaperState }): Promise<number | undefined> {
  const { type, id, current } = args;
  if (paperIssues(current).length > 0) throw new Error(PAPER_BLOCKED);
  if (current.type !== type) throw new TypeError('teach_compose_type_mismatch');
  const path = legacyEditPath(type, id);
  if (current.setCodePolicy !== undefined && current.setCodePolicy !== 'acm') return savePaperPoints(path, current);
  const raw = await getJson(path, SAVE_FAILED);
  await postForm(path, formBody(type, raw, current), SAVE_FAILED);
  return undefined;
}
