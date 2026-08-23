import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

function readTemplate(name: string) {
  return readFileSync(resolve(process.cwd(), `packages/ui-default/templates/${name}`), 'utf8');
}

describe('ui-default contextual training progress', () => {
  it('uses scoped list progress for current-page and enrolled cards before legacy status', () => {
    const template = readTemplate('problem_set_main.html');
    expect(template).to.include("tsdict[tdoc.docId]['contextualProgress']");
    expect(template).to.include("tsdoc['contextualProgress']");
    expect(template.match(/contextual\['completedProblemCount'\]/g)).to.have.length(2);
    expect(template.match(/contextual\['totalProblemCount'\]/g)).to.have.length(4);
    expect(template).to.include("contextual['done']");
    expect(template).to.include("tsdoc['donePids']");
  });

  it('uses scope-aware counts for controlled detail progress and keeps legacy behavior separate', () => {
    const template = readTemplate('problem_set_detail.html');
    const controlledBranch = template.indexOf('{% if integrityControlled %}');
    const scopedFormula = template.indexOf('completedProblemCount / totalProblemCount');
    const legacyFormula = template.indexOf("tsdoc['donePids']|length / pids|length");
    expect(controlledBranch).to.be.greaterThan(-1);
    expect(scopedFormula).to.be.greaterThan(controlledBranch);
    expect(legacyFormula).to.be.greaterThan(scopedFormula);
  });

  it('keeps scoped progress authoritative on the homepage, file page, and detail problem rows', () => {
    const home = readTemplate('partials/homepage/training.html');
    const files = readTemplate('problem_set_files.html');
    const detailRows = readTemplate('partials/training_detail.html');

    expect(home.indexOf("tsdict[tdoc.docId]['contextualProgress']")).to.be.lessThan(home.indexOf("tsdict[tdoc.docId]['donePids']"));
    expect(files).to.include("tsdoc['contextualProgress']['done']");
    expect(detailRows).to.include('{% if integrityControlled %}');
    expect(detailRows).to.include("pid in nsdict[node['_id']]['donePids']");
    expect(detailRows).to.include("pid in nsdict[node['_id']]['selfDonePids']");
    expect(detailRows.indexOf('{% if integrityControlled %}')).to.be.lessThan(detailRows.indexOf('record.render_status_td(psdoc'));
  });
});
