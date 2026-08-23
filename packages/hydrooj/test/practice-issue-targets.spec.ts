import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { selectPracticeIssueTargets } from '../src/lib/practice-issue-targets';

describe('P3.9 practice issue target selection', () => {
    const courseId = new ObjectId();
    const setId = new ObjectId();
    const primary = { containerKind: 'course' as const, containerId: courseId, scopeKind: 'chapter' as const, scopeId: 3 };
    const extra = { containerKind: 'problemSet' as const, containerId: setId, scopeKind: 'stage' as const, scopeId: 1 };

    it('keeps an unconfigured course uncontrolled when the set also has no policy', () => {
        expect(selectPracticeIssueTargets({ primary, extra, primaryPublished: null, extraPublished: null })).to.deep.equal({ controlled: false });
    });

    it('issues the problem set as primary when only the referenced set is published', () => {
        const selected = selectPracticeIssueTargets({ primary, extra, primaryPublished: null, extraPublished: { revision: 4 } });
        expect(selected).to.deep.equal({
            controlled: true,
            identity: extra,
            targets: [{ revision: { revision: 4 }, scopeKind: 'stage', scopeId: 1 }],
        });
    });

    it('issues the course chain when both policies are published', () => {
        const selected = selectPracticeIssueTargets({
            primary,
            extra,
            primaryPublished: { revision: 1 },
            extraPublished: { revision: 4 },
        });
        expect(selected.controlled).to.equal(true);
        if (!selected.controlled) return;
        expect(selected.identity).to.deep.equal(primary);
        expect(selected.targets).to.have.length(2);
    });
});
