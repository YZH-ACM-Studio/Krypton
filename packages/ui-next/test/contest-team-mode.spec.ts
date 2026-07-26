import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('P1.11 contest team-mode editor contract', () => {
  it('posts the authoritative mode revision and uses a custom destructive confirmation', () => {
    const editor = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
    expect(editor).to.include('name="participationMode"');
    expect(editor).to.include('name="participationRevision"');
    expect(editor).to.include('name="teamModeClearConfirmation"');
    expect(editor).to.include('停用本场全部队伍？');
    expect(editor).to.include('titleId="clear-contest-teams-dialog-title"');
    expect(editor).to.include('tone="destructive"');
    expect(editor).to.include('setModeClearOpen(true)');
    expect(editor).to.include('ref={primarySubmitRef}');
    expect(editor).to.include('formRef.current.requestSubmit(primarySubmitRef.current)');
    expect(editor).to.include("submitter.name === 'operation'");
    expect(editor).to.include("submitter.value === 'update'");
    expect(editor).to.include("!submitter.hasAttribute('formaction')");
  });

  it('locks the complete team safety tuple without dropping the disabled ACM rule value', () => {
    const editor = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
    expect(editor).to.include("if (participationMode !== 'team') return");
    expect(editor).to.include("setEntryMode('client_required')");
    expect(editor).to.include('setVigilEnabled(true)');
    expect(editor).to.include('setRated(false)');
    expect(editor).to.include('<input type="hidden" name="rule" value="acm" />');
    expect(editor).to.include('<input type="hidden" name="rated" value="false" />');
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
