import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const hydroojRoot = resolve(__dirname, '..');

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function extractNamed(text: string, marker: string) {
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`missing ${JSON.stringify(marker)}`);
    const brace = text.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${marker}`);
    let depth = 0;
    for (let i = brace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${marker}`);
}

describe('problem-set roster handler contracts', () => {
    it('registers /problem-sets/:tid/roster without PERM_VIEW_TRAINING and redirects /training roster', () => {
        const handler = readHydrooj('src/handler/training.ts');
        expect(handler).to.include("ctx.Route('training_roster', '/problem-sets/:tid/roster', TrainingRosterHandler);");
        expect(handler).to.include("ctx.Route('training_compat_roster', '/training/:tid/roster', TrainingCompatRedirectHandler);");
        expect(handler).to.include('class TrainingRosterHandler');
        expect(handler).not.to.include(
            "ctx.Route('training_roster', '/problem-sets/:tid/roster', TrainingRosterHandler, PERM.PERM_VIEW_TRAINING)",
        );
        const canonical = extractNamed(handler, 'function canonicalTrainingRouteName');
        expect(canonical).to.include('/\\/roster\\/?$/');
        expect(canonical).to.include("'training_roster'");
    });

    it('loads roster members from enroll: 1 and problem-set audience', () => {
        const roster = extractNamed(readHydrooj('src/handler/training.ts'), 'class TrainingRosterHandler');
        expect(roster).to.include("this.response.template = 'problem_set_roster.html'");
        expect(roster).to.include('PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS)');
        expect(roster).to.include('problemSetAudienceOf');
        expect(roster).to.include('assemblePracticeRosterMembers');
        expect(roster).to.include('rosterGroupIds');
        expect(roster).to.include('groupCatalogById');
        expect(roster).to.include('canViewRoster');
        expect(roster).to.include('enroll: 1');
    });

    it('does not assign members on TrainingDetailHandler.get', () => {
        const detailGet = extractNamed(extractNamed(readHydrooj('src/handler/training.ts'), 'class TrainingDetailHandler'), 'async get(');
        expect(detailGet).not.to.include('this.response.body.members =');
        expect(detailGet).not.to.include('assemblePracticeRosterMembers');
        expect(detailGet).not.to.include('rosterProblems');
        expect(detailGet).not.to.include('membersTruncated');
    });
});
