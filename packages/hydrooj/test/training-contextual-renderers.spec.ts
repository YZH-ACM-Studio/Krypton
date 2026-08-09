import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(__dirname, '..');

describe('controlled training renderer data', () => {
    it('projects scoped completion for home, list, and files without replacing legacy status', () => {
        const home = readFileSync(resolve(root, 'src/handler/home.ts'), 'utf8');
        const training = readFileSync(resolve(root, 'src/handler/training.ts'), 'utf8');

        expect(home).to.match(/training\s*\.getMulti\(domainId, \{ kind: \{ \$ne: 'course' \} \}\)/);
        expect(home).to.include("practiceIntegrityService.getLatestPublished(domainId, 'problemSet'");
        expect(home).to.include('contextualCompletionService.getCompletedByScope(');
        expect(home).to.include('training.buildScopedTrainingProgress(tdoc, doneByScope)');
        expect(training.match(/training\.buildScopedTrainingProgress\(/g)).to.have.length(2);
        expect(training).to.include('tsdoc: contextualProgress ? { ...tsdoc, contextualProgress } : tsdoc');
    });
});
