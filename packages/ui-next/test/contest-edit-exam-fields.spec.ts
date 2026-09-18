// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const examRel = 'packages/ui-next/src/pages/contest-edit-exam.tsx';
const examPath = resolve(workspaceRoot, examRel);

const LOCKED_POST_NAMES = [
  'duration',
  'contestDuration',
  'examPaperQuotas',
  'participationMode',
  'vigilEnabled',
  'entryMode',
  'liveEnabled',
  'cameraEnabled',
  'hidden',
] as const;

const FORBIDDEN_POST_NAMES = ['courseExam', 'examEvent'] as const;

function source(rel: string) {
  return readFileSync(resolve(workspaceRoot, rel), 'utf8');
}

function contestEditPostUpdateParamNames(handler: string): string[] {
  const cls = handler.indexOf('export class ContestEditHandler');
  expect(cls, 'ContestEditHandler missing').to.be.at.least(0);
  const post = handler.indexOf('async postUpdate(', cls);
  expect(post, 'ContestEditHandler.postUpdate missing').to.be.greaterThan(cls);
  return [...handler.slice(cls, post).matchAll(/@param\('([A-Za-z]+)'/g)].map((match) => match[1]);
}

function readExamTree(): string {
  if (!existsSync(examPath)) {
    throw new Error('contest-edit-exam.tsx is missing');
  }
  return readFileSync(examPath, 'utf8');
}

function hasPostName(src: string, name: string) {
  return new RegExp(`name=["']${name}["']`).test(src);
}

describe('contest edit exam field contract', () => {
  it('locks exam tree POST names against ContestEditHandler.postUpdate', () => {
    const handler = source('packages/hydrooj/src/handler/contest.ts');
    const params = contestEditPostUpdateParamNames(handler);
    for (const name of LOCKED_POST_NAMES) {
      expect(params, `postUpdate missing ${name}`).to.include(name);
    }
    for (const name of FORBIDDEN_POST_NAMES) {
      expect(params, `postUpdate must not accept ${name}`).to.not.include(name);
    }

    const exam = readExamTree();
    expect(exam, 'wall-clock duration label').to.match(/htmlFor="duration"[\s\S]{0,120}整场关门（小时）/);
    expect(exam, 'wall-clock duration POST name').to.match(/id="duration"\s+name="duration"/);
    expect(exam, 'personal contestDuration label').to.match(/htmlFor="contestDuration"[\s\S]{0,120}开考后个人时长（小时）/);
    expect(exam, 'personal contestDuration POST name').to.match(/id="contestDuration"\s+name="contestDuration"/);
    expect(exam, 'vigilEnabled POST name').to.match(/name=["']vigilEnabled["']/);
    expect(exam, 'entryMode POST name').to.match(/name=["']entryMode["']/);
    expect(exam, 'edit must POST liveEnabled explicitly').to.include('<HiddenFlag name="liveEnabled" value={liveEnabled} />');
    expect(exam, 'edit must POST cameraEnabled explicitly').to.include('<HiddenFlag name="cameraEnabled" value={cameraEnabled} />');
    expect(exam, 'exam tree must POST hidden explicitly').to.include('<HiddenFlag name="hidden" value={listHidden} />');
    expect(exam, 'list-hide control').to.include('不在列表中显示');
    expect(exam, 'exam tree must not use ContestParticipationField').not.to.include('ContestParticipationField');
    expect(exam, 'participationMode must POST flags.participationMode').to.include(
      '<input type="hidden" name="participationMode" value={flags.participationMode} />',
    );

    expect(exam, 'exam tree splits with MiniTabs').to.include('MiniTabs');
    expect(exam, 'inactive exam tabs stay mounted for POST').to.match(/hidden=\{tab !== '/);
    expect(exam, 'exam tree uses ContestExamPaperPool').to.include('ContestExamPaperPool');
    expect(exam, 'exam tree must POST pids via the paper pool').to.include('name="pids"');
    expect(exam, 'exam tree must not use ProblemPicker').not.to.include('ProblemPicker');
    expect(exam, 'examPaperQuotas via ContestExamPaperPool').to.include('ContestExamPaperPool');
    expect(exam).to.match(/from\s+['"][^'"]*contest-exam-paper-pool['"]/);
    const quotas = source('packages/ui-next/src/pages/contest-exam-paper-quotas.tsx');
    expect(quotas, 'ContestExamPaperQuotas posts examPaperQuotas').to.match(/name=["']examPaperQuotas["']/);
    const manage = source('packages/ui-next/src/pages/contest-manage.tsx');
    expect(manage, 'ACM tree must not mount ContestExamPaperQuotas').not.to.include('ContestExamPaperQuotas');
    expect(manage, 'ACM tree must not import exam paper quotas').not.to.include('contest-exam-paper-quotas');

    for (const name of FORBIDDEN_POST_NAMES) {
      expect(hasPostName(exam, name), `exam tree must not POST ${name}`).to.equal(false);
    }
  });
});
