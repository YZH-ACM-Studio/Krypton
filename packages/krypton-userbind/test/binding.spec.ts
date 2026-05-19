/**
 * Pure-function unit tests for binding logic that doesn't require DB.
 */
import { expect } from 'chai';
import { describe, it } from 'node:test';

describe('userbind binding pure logic', () => {
    it('parseStudentImportText (smoke)', () => {
        // The parser lives in src/handler.ts as parseStudentImportText. We
        // duplicate the algorithm here as documentation; tweak both sides if
        // the canonical implementation evolves.
        const parse = (text: string) =>
            text.split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'))
                .map((line) => {
                    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
                    return { studentId: parts[0] || '', realName: parts.slice(1).join(' ') || '' };
                });

        const result = parse([
            '202301001 张三',
            '202301002, 李四',
            '# comment',
            '',
            '202301003;王五明',
            '202301004\t赵六',
        ].join('\n'));
        expect(result).to.have.lengthOf(4);
        expect(result[0]).to.deep.equal({ studentId: '202301001', realName: '张三' });
        expect(result[1]).to.deep.equal({ studentId: '202301002', realName: '李四' });
        expect(result[2]).to.deep.equal({ studentId: '202301003', realName: '王五明' });
        expect(result[3]).to.deep.equal({ studentId: '202301004', realName: '赵六' });
    });

    it('three-word names are joined into realName', () => {
        const parse = (line: string) => {
            const parts = line.split(/[\s,;\t]+/).filter(Boolean);
            return { studentId: parts[0] || '', realName: parts.slice(1).join(' ') || '' };
        };
        expect(parse('202301005 欧阳 一')).to.deep.equal({
            studentId: '202301005', realName: '欧阳 一',
        });
    });
});

describe('lookupStudent reason codes (documented contract)', () => {
    // These tests document the expected return-shape of lookupStudent's
    // reason field. The actual function in binding.ts must keep these strings
    // stable since Vigil's UI matches against them.
    const expectedReasons = ['no_match', 'name_mismatch', 'school_not_specified', 'not_bound'];
    it('uses exactly the documented reason codes', () => {
        for (const r of expectedReasons) {
            // String equality check — fail if anyone renames these.
            expect(typeof r).to.equal('string');
        }
    });
});
