import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('p2.40 record score cancellation UI', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/pages/records.tsx'), 'utf8');

  it('uses one custom dialog for list and detail operations', () => {
    expect(source).to.include('function RecordScoreActionDialog');
    expect(source).to.include('<DialogContent');
    expect(source).to.include('备注（可选）');
    expect(source).to.include('若比赛仍在进行，榜单会立即按新投影更新');
    expect(source).not.to.include('window.confirm(');
  });

  it('submits the server-issued CAS fields and keeps errors inside the dialog', () => {
    expect(source).to.include("body.set('expectedStatus', String(action.expectedStatus))");
    expect(source).to.include("body.set('expectedJudgeAt', action.expectedJudgeAt)");
    expect(source).to.include("body.set('expectedCancellationAt', action.expectedCancellationAt)");
    expect(source).to.include('setError(cause instanceof Error ? cause.message : String(cause))');
    expect(source).to.include('if (payload.recordScoreAction) updated[rid] = payload.recordScoreAction');
  });

  it('keeps management controls out of the Exam Mode code-only branch', () => {
    expect(source).to.include("detailMode !== 'exam-code' && recordScoreAction");
    expect(source).to.include("disabled: !rdoc._id || detailMode === 'exam-code'");
  });
});
