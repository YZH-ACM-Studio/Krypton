import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getContestProblemStatus,
  prioritizeCurrentScoreboardRows,
  scoreboardParticipantColumn,
} from '../src/lib/contest-exam-display.ts';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('small interface fixes', () => {
  it('shows accepted and latest non-accepted contest status labels', () => {
    expect(getContestProblemStatus(1)).to.include({ label: 'AC', code: 'pass' });
    expect(getContestProblemStatus(2)).to.include({ label: 'WA', code: 'fail' });
    expect(getContestProblemStatus(3)).to.include({ label: 'TLE', code: 'fail' });
    expect(getContestProblemStatus(20)).to.include({ label: '评测中', code: 'progress' });
    expect(getContestProblemStatus(undefined)).to.equal(null);
  });

  it('moves the current individual or team to the top without changing other rows', () => {
    const rows = [
      [{ type: 'rank', value: 1 }, { type: 'user', raw: 10 }],
      [{ type: 'rank', value: 2 }, { type: 'user', raw: 20 }],
      [{ type: 'rank', value: 3 }, { type: 'user', raw: 30 }],
    ];
    expect(scoreboardParticipantColumn([{ type: 'rank' }, { type: 'user' }], false)).to.equal(1);
    expect(prioritizeCurrentScoreboardRows(rows, 1, 20).map((row) => row[1].raw)).to.deep.equal([20, 10, 30]);

    const teamRows = [
      [{ type: 'rank', value: 1 }, { type: 'string', raw: 'team-a' }],
      [{ type: 'rank', value: 2 }, { type: 'string', raw: 'team-b' }],
    ];
    expect(scoreboardParticipantColumn([{ type: 'rank' }, { type: 'string' }], true)).to.equal(1);
    expect(prioritizeCurrentScoreboardRows(teamRows, 1, 'team-b').map((row) => row[1].raw)).to.deep.equal(['team-b', 'team-a']);
  });

  it('filters the problem bank by the selected visible contest problem ids', () => {
    const handler = source('packages/hydrooj/src/handler/problem.ts');
    const page = source('packages/ui-next/src/pages/problems.tsx');
    expect(handler).to.include("@param('contest', Types.ObjectId, true)");
    expect(handler).to.include('const canFilterContest = this.user.hasPerm(PERM.PERM_VIEW_CONTEST);');
    expect(handler).to.include('if (contestId && !canFilterContest) throw new PermissionError(PERM.PERM_VIEW_CONTEST);');
    expect(handler).to.include("rule: { $ne: 'homework' }");
    expect(handler).to.include('filterParts.push({ docId: { $in: selectedContest.pids || [] } });');
    expect(page).to.include('name="contest"');
    expect(page).to.include('contestOptions={contestOptions}');
  });

  it('renders a sanitized exam problem status journal and keeps selftests out of that path', () => {
    const page = source('packages/ui-next/src/pages/contest-manage.tsx');
    const handler = source('packages/hydrooj/src/handler/contest.ts');
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const record = source('packages/hydrooj/src/model/record.ts');
    expect(page).to.include('const problemStatusByPid: Record<string, R> = data.problemStatusByPid || {};');
    expect(page).to.include(': problemStatusByPid[String(pid)] || null');
    expect(page).to.include('getContestProblemStatus(statusDoc?.status)');
    expect(paper).to.include('protected latestProblemStatusesEnabled = true;');
    expect(handler).to.include('buildLatestContestProblemStatusByPid(statusJournal, this.tdoc.pids)');
    expect(record).to.include("if (args.type === 'pretest')");
    expect(record).to.include('data.contest = RecordModel.RECORD_PRETEST;');
  });

  it('keeps the record list language filter on its live WebSocket subscription', () => {
    const page = source('packages/ui-next/src/pages/records.tsx');
    expect(page).to.include('lang: filterParams.lang || undefined');
  });
});
