/**
 * Save the composer paper by rewriting the legacy edit form.
 * The latest snapshot is read first; only the paper fields are replaced.
 */
import { TEACH_SCORED_CONTEST_RULES } from '@hydrooj/common';
import type { TeachType } from '@hydrooj/common';
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
  return {
    ...state,
    pids: paperPids(current),
    scores: TEACH_SCORED_CONTEST_RULES.includes(rule) ? paperScores(current) : state.scores,
    examPaperQuotas: rule === 'exam' ? paperQuotas(current) : state.examPaperQuotas,
  };
}

function homeworkState(state: HomeworkFormState, current: PaperState): HomeworkFormState {
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

function formBody(type: TeachType, raw: unknown, current: PaperState): URLSearchParams {
  switch (type) {
    case 'homework':
      return homeworkFormBody(homeworkState(parseHomeworkSnapshot(raw).state, current));
    case 'practice':
      return practiceFormBody(practiceState(parsePracticeSnapshot(raw).state, current));
    case 'exam':
    case 'acm':
    case 'oi':
      return contestFormBody(contestState(parseContestSnapshot(raw).state, current));
    default: {
      const unexpected: never = type;
      throw new TypeError(`teach_type_invalid:${String(unexpected)}`);
    }
  }
}

export async function saveComposition(args: { type: TeachType; id: string; current: PaperState }): Promise<void> {
  const { type, id, current } = args;
  if (paperIssues(current).length > 0) throw new Error(PAPER_BLOCKED);
  if (current.type !== type) throw new TypeError('teach_compose_type_mismatch');
  const path = legacyEditPath(type, id);
  const raw = await getJson(path, SAVE_FAILED);
  await postForm(path, formBody(type, raw, current), SAVE_FAILED);
}
