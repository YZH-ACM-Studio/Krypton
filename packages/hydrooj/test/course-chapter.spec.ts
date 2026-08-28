import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { courseNodePids, parseCourseSections } from '../src/lib/course-chapter';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

const pidsOf = (value: unknown) => (value as number[]).map(Number);

describe('course chapter sections', () => {
    it('collects loose chapter pids and section pids without duplicates', () => {
        expect(courseNodePids({ pids: [11, 12], sections: [{ _id: 1, title: 'A', pids: [12, 13] }] })).to.deep.equal([11, 12, 13]);
        expect(courseNodePids({ pids: [11] })).to.deep.equal([11]);
    });

    it('parses linear sections and rejects overlapping or duplicate identities', () => {
        const sections = parseCourseSections(3, [{ _id: 1, title: '引入', pids: [11] }, { _id: 2, title: '练习', content: 'md', pids: [12] }], pidsOf);
        expect(sections.map((section) => section._id)).to.deep.equal([1, 2]);
        expect(() => parseCourseSections(3, [{ _id: 1, title: 'A', pids: [11] }, { _id: 1, title: 'B', pids: [12] }], pidsOf)).to.throw(/小节 _id 必须唯一/);
        expect(() => parseCourseSections(3, [{ _id: 1, title: 'A', pids: [11] }, { _id: 2, title: 'B', pids: [11] }], pidsOf)).to.throw(
            /不能属于多个小节/,
        );
        expect(parseCourseSections(3, undefined, () => [])).to.deep.equal([]);
    });

    it('rejects extra keys, non-string titles, and non-number section ids', () => {
        expect(() => parseCourseSections(3, [{ _id: 1, title: 'A', pids: [11], order: 1 }], pidsOf)).to.throw(/未知字段 order/);
        expect(() => parseCourseSections(3, [{ _id: 1, title: 12, pids: [11] }], pidsOf)).to.throw(/小节标题必须是字符串/);
        expect(() => parseCourseSections(3, [{ _id: '1', title: 'A', pids: [11] }], pidsOf)).to.throw(/小节需要正整数 _id/);
        expect(() => parseCourseSections(3, [{ _id: 1.5, title: 'A', pids: [11] }], pidsOf)).to.throw(/小节需要正整数 _id/);
        expect(() => parseCourseSections(3, [{ _id: 1, title: '   ', pids: [11] }], pidsOf)).to.throw(/每个小节需要标题/);
    });

    it('unions section pids for integrity membership, progress, and problem-set parse rejection', () => {
        const access = readSrc('src/model/practice-integrity-access.ts');
        expect(access).to.include('courseNodePids(scope)');
        expect(access).to.include('courseNodePids(chapter)');
        const training = readSrc('src/model/training.ts');
        expect(training).to.include('export async function assignCourseOwnership');
        expect(training).to.include("kind: 'course'");
        expect(training).to.include('owner: expectedOwner');
        expect(training).to.include('const nodePids = new Set(courseNodePids(node))');
        expect(training).to.match(/export function isOpen[\s\S]*const pids = courseNodePids\(node\)/);
        expect(training).to.include('for (const section of tdoc.dag[i].sections || [])');
        expect(readSrc('src/handler/training.ts')).to.include('题集阶段不支持小节');
        expect(readSrc('src/handler/course.ts')).to.include('liveRefPids.filter((pid) => !sectionPidSet.has(pid))');
        expect(readSrc('src/handler/course.ts')).to.include('章节 ${node._id} 的题目必须是数组');
        expect(readSrc('src/handler/course.ts')).to.include('不能同时属于小节');
        expect(readSrc('src/model/problem-lifecycle.ts')).to.include("{ 'dag.sections.pids': pid }");
    });
});
