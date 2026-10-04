// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function openingTags(text: string, name: string): string[] {
  return text.match(new RegExp(`<${name}\\b[\\s\\S]*?>`, 'g')) ?? [];
}

describe('contest-edit ACM regression', () => {
  const manage = source('src/pages/contest-manage.tsx');

  it('posts team hidden rule=acm and rated=false', () => {
    expect(manage).to.include('{participationMode === \'team\' ? <input type="hidden" name="rule" value="acm" /> : null}');
    expect(manage).to.include('{participationMode === \'team\' ? <input type="hidden" name="rated" value="false" /> : null}');
  });

  it('posts operation=update and copy-as-new formaction', () => {
    expect(manage).to.match(/<Button ref=\{primarySubmitRef\}(?: variant="[\w-]+")? type="submit" name="operation" value="update"(?: variant="[\w-]+")?>/);
    expect(manage).to.include('formAction={`${bs.urls.contests}/create`}');
    expect(manage).to.include('复制为新比赛');
  });

  it('keeps duration, contestDuration and vigilEnabled field names', () => {
    expect(manage).to.include('name="duration"');
    expect(manage).to.include('name="contestDuration"');
    expect(manage).to.include('<input type="hidden" name="vigilEnabled" value={vigilEnabled ? \'true\' : \'false\'} />');
  });

  it('does not emit examPaperQuotas from the ACM tree', () => {
    expect(manage).not.to.include('ContestExamPaperQuotas');
    expect(manage).not.to.include('contest-exam-paper-quotas');
    expect(manage).not.to.match(/name=["']examPaperQuotas["']/);
  });

  it('keeps exam create free of team UI and primary-create formaction when present', () => {
    const examPath = resolve(root, 'src/pages/contest-edit-exam.tsx');
    if (!existsSync(examPath)) return;
    const exam = source('src/pages/contest-edit-exam.tsx');
    expect(exam).not.to.include('ContestParticipationField');
    expect(exam).not.to.include('teamBatches');
    expect(exam).not.to.include('<input type="hidden" name="rule" value="acm" />');
    const updateButtons = openingTags(exam, 'Button').filter(
      (tag) => tag.includes('name="operation"') && tag.includes('value="update"'),
    );
    expect(updateButtons.some((tag) => !/formAction|formaction/i.test(tag))).to.equal(true);
  });
});
