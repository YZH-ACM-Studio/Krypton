import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContestParticipationField } from '../src/components/contest-participation-field';

const root = resolve(import.meta.dirname, '..');

function teachSource(relative: string) {
  return readFileSync(resolve(root, relative), 'utf8');
}

describe('p1.11 contest team-mode editor contract', () => {
  it('posts the authoritative mode revision and the team-mode clear token', () => {
    const students = teachSource('src/pages/teach/tabs/students.tsx');
    const forms = teachSource('src/pages/teach/legacy-forms.ts');
    expect(
      renderToStaticMarkup(ContestParticipationField({ rule: 'acm', value: 'individual', onValueChange: () => undefined })),
    ).to.include('name="participationMode"');
    expect(students).to.include('participationRevision');
    expect(students).to.include('teamModeClearConfirmation');
    expect(forms).to.include("body.set('participationRevision', String(state.participationRevision))");
    expect(forms).to.include("body.set('teamModeClearConfirmation', state.teamModeClearConfirmation)");
  });

  it('posts rule=acm exactly once when the students tab switches to team mode', () => {
    const students = teachSource('src/pages/teach/tabs/students.tsx');
    const forms = teachSource('src/pages/teach/legacy-forms.ts');
    expect(students).to.include('rule=acm');
    expect(students).to.include("rule: participationMode === 'team' ? 'acm' : state.rule");
    expect(forms.match(/body\.set\('rule'/g) ?? []).to.have.length(1);
    expect(forms).to.include("body.set('rule', state.rule)");
  });

  it('keeps the team-mode protocol on the students tab and the legacy contest form', () => {
    const students = teachSource('src/pages/teach/tabs/students.tsx');
    const forms = teachSource('src/pages/teach/legacy-forms.ts');
    expect(students).to.include('participationRevision');
    expect(students).to.include('teamModeClearConfirmation');
    expect(students).to.include("participationMode === 'team' ? 'acm'");
    expect(forms).to.include("body.set('participationMode', state.participationMode)");
    expect(forms).to.include("body.set('participationRevision', String(state.participationRevision))");
    expect(forms).to.include("body.set('teamModeClearConfirmation', state.teamModeClearConfirmation)");
    expect(students).not.to.include('contest-edit-exam');
    expect(forms).not.to.include('contest-edit-exam');
  });

  it('routes all mode and cleanup writes through the contest model', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/contest.ts'), 'utf8');
    const operations = readFileSync(resolve(root, '../hydrooj/src/handler/contestops.ts'), 'utf8');
    expect(handler).to.include('expectedParticipationRevision: participationRevision');
    expect(handler).to.include('teamModeClearConfirmation');
    expect(handler).to.include('actor: this.user');
    expect(handler).not.to.include('contestTeam.coll.');
    expect(operations).to.include('participationMode: contest.getParticipationMode(src)');
    const model = readFileSync(resolve(root, '../hydrooj/src/model/contest.ts'), 'utf8');
    const teamModel = readFileSync(resolve(root, '../hydrooj/src/model/contest-team.ts'), 'utf8');
    expect(model).to.include('options.actor.own(current, PERM.PERM_EDIT_CONTEST_SELF)');
    expect(teamModel).to.include('actor.own(tdoc, PERM.PERM_EDIT_CONTEST_SELF)');
    expect(model).to.include("toRevision: result === 'success' ? fromRevision + 1 : fromRevision");
  });

  it('rechecks start time and records after asynchronous hooks and immediately before the mode CAS', () => {
    const model = readFileSync(resolve(root, '../hydrooj/src/model/contest.ts'), 'utf8');
    const documentHook = model.indexOf("await bus.parallel('document/set'");
    const finalNow = model.indexOf('const finalNow = options.now || new Date()', documentHook);
    const finalRecordCount = model.indexOf('const finalRecordCount = await RecordModel.coll.countDocuments', documentHook);
    const modeCas = model.indexOf('res = await document.coll.findOneAndUpdate', documentHook);
    expect(documentHook).to.be.greaterThan(-1);
    expect(finalNow).to.be.greaterThan(documentHook);
    expect(finalRecordCount).to.be.greaterThan(finalNow);
    expect(modeCas).to.be.greaterThan(finalRecordCount);
  });
});
