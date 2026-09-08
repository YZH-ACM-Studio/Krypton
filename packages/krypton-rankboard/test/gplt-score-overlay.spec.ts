import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

describe('gplt display score overlay', () => {
    it('keeps an embedded honor-board score instead of overwriting from the store', () => {
        const source = readFileSync(resolve(__dirname, '../src/model.ts'), 'utf8');
        expect(source).to.include('if (award.score != null) continue');
    });
});
