import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import type { TrainingNode } from '../src/interface';
import {
    applyMindmapToChapters,
    CourseChapterGenerateError,
    stripCourseMindmapChapterSources,
    type MindmapChapterSourceNode,
} from '../src/lib/course-mindmap-chapters';

const hex = (char: string) => {
    if (!/^[a-f0-9]$/.test(char)) throw new Error(`test id ${char} is not a hex digit`);
    return char.repeat(24);
};

function node(char: string, parent: string | null, topic: string, order = 0, description?: string): MindmapChapterSourceNode {
    return {
        id: hex(char),
        parentId: parent ? hex(parent) : null,
        topic,
        order,
        ...(description ? { description } : {}),
    };
}

function chapter(partial: Partial<TrainingNode> & Pick<TrainingNode, '_id' | 'title'>): TrainingNode {
    return {
        requireNids: [],
        pids: [],
        ...partial,
    };
}

const video = {
    id: 'cv_abcdefghijklmnopqr',
    title: '导入',
    filename: 'intro.mp4',
    ext: 'mp4' as const,
    size: 10,
    sha256: 'a'.repeat(64),
    durationMs: 1000,
    confirmed: true,
    contentRevision: 1,
};

describe('course chapters generated from the owned mindmap', () => {
    const root = node('0', null, '课程');

    it('turns the first two levels into chapters and sections and replaces a single empty placeholder', () => {
        const result = applyMindmapToChapters({
            dag: [chapter({ _id: 1, title: '第一章' })],
            rootNodeId: hex('0'),
            nodes: [
                root,
                node('b', '0', '数组', 0),
                node('a', '0', '循环', 1, '反复执行'),
                node('d', 'a', 'while', 1),
                node('c', 'a', 'for', 0),
                node('e', 'c', '初始化', 0),
                node('f', 'e', 'i = 0', 0, '计数'),
            ],
        });
        expect(result.createdChapters).to.equal(2);
        expect(result.createdSections).to.equal(2);
        expect(result.dag.map((item) => item.title)).to.deep.equal(['数组', '循环']);
        expect(result.dag.map((item) => item._id)).to.deep.equal([2, 3]);
        expect(result.dag[1]?.content).to.equal('反复执行');
        expect(result.dag[1]?.sourceMindmapBody).to.equal('反复执行');
        expect(result.dag[1]?.sourceMindmapNodeId).to.equal(hex('a'));
        expect(result.dag[1]?.sections?.map((section) => section.title)).to.deep.equal(['for', 'while']);
        expect(result.dag[1]?.sections?.[0]?.content).to.equal('- 初始化\n  - i = 0\n    计数');
        expect(result.dag[0]?.requireNids).to.deep.equal([]);
        expect(result.notices).to.deep.equal([]);
        const again = applyMindmapToChapters({
            dag: result.dag,
            rootNodeId: hex('0'),
            nodes: [
                root,
                node('b', '0', '数组', 0),
                node('a', '0', '循环', 1, '反复执行'),
                node('d', 'a', 'while', 1),
                node('c', 'a', 'for', 0),
                node('e', 'c', '初始化', 0),
                node('f', 'e', 'i = 0', 0, '计数'),
            ],
        });
        expect(again.dag).to.deep.equal(result.dag);
        expect(again.createdChapters).to.equal(0);
        expect(again.createdSections).to.equal(0);
    });

    it('fills an empty body, refreshes an untouched body, and keeps a teacher edit', () => {
        const filled = applyMindmapToChapters({
            dag: [chapter({ _id: 4, title: '旧', sourceMindmapNodeId: hex('a') })],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '循环', 0, '新说明')],
        });
        expect(filled.dag[0]?.content).to.equal('新说明');
        const refreshed = applyMindmapToChapters({
            dag: [
                chapter({
                    _id: 4,
                    title: '循环',
                    content: '旧说明',
                    sourceMindmapNodeId: hex('a'),
                    sourceMindmapBody: '旧说明',
                }),
            ],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '循环', 0, '新说明')],
        });
        expect(refreshed.dag[0]?.content).to.equal('新说明');
        expect(refreshed.dag[0]?.sourceMindmapBody).to.equal('新说明');
        const cleared = applyMindmapToChapters({
            dag: [
                chapter({
                    _id: 4,
                    title: '循环',
                    sourceMindmapNodeId: hex('a'),
                    sourceMindmapBody: '旧说明',
                }),
            ],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '循环', 0, '新说明')],
        });
        expect(cleared.dag[0]?.content).to.equal('新说明');
        const edited = applyMindmapToChapters({
            dag: [
                chapter({
                    _id: 4,
                    title: '旧标题',
                    content: '老师写的',
                    sourceMindmapNodeId: hex('a'),
                    sourceMindmapBody: '旧说明',
                    videos: [video],
                }),
            ],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '新标题', 0, '新说明')],
        });
        expect(edited.dag[0]?.title).to.equal('新标题');
        expect(edited.dag[0]?.content).to.equal('老师写的');
        expect(edited.dag[0]?.sourceMindmapBody).to.equal('旧说明');
        expect(edited.dag[0]?.videos).to.deep.equal([video]);
        expect(edited.notices).to.deep.equal(['有 1 处正文已经改过，没有用导图说明覆盖。']);
    });

    it('keeps a chapter that still has a video and drops an empty generated chapter whose node is gone', () => {
        const result = applyMindmapToChapters({
            dag: [
                chapter({ _id: 3, title: '循环', sourceMindmapNodeId: hex('a'), videos: [video] }),
                chapter({ _id: 4, title: '旧数组', sourceMindmapNodeId: hex('b'), sourceMindmapBody: '旧', content: '旧' }),
            ],
            rootNodeId: hex('0'),
            nodes: [root, node('c', '0', '函数', 0)],
        });
        expect(result.dag.map((item) => item._id)).to.deep.equal([5, 3]);
        expect(result.dag[1]?.videos).to.deep.equal([video]);
        expect(result.removedChapters).to.equal(1);
        expect(result.notices.some((notice) => notice.includes('已有内容'))).to.equal(true);
    });

    it('keeps a protected chapter after its node disappears', () => {
        const result = applyMindmapToChapters({
            dag: [chapter({ _id: 5, title: '门槛', sourceMindmapNodeId: hex('a') })],
            rootNodeId: hex('0'),
            nodes: [root, node('b', '0', '数组', 0)],
            protectedChapterIds: new Set([5]),
        });
        expect(result.dag.map((item) => item._id)).to.deep.equal([6, 5]);
        expect(result.removedChapters).to.equal(0);
        expect(result.notices).to.deep.equal(['有 1 个章节被结业考试或文件收集使用，课程里仍保留。']);
    });

    it('leaves a moved section on its original chapter', () => {
        const result = applyMindmapToChapters({
            dag: [
                chapter({
                    _id: 1,
                    title: '循环',
                    sourceMindmapNodeId: hex('a'),
                    sections: [{ _id: 1, title: 'for', pids: [9], sourceMindmapNodeId: hex('1') }],
                }),
            ],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '循环', 0), node('b', '0', '数组', 1), node('1', 'b', 'for', 0)],
        });
        expect(result.dag[0]?.sections?.map((section) => section.sourceMindmapNodeId)).to.deep.equal([hex('1')]);
        expect(result.dag[0]?.sections?.[0]?.pids).to.deep.equal([9]);
        expect(result.dag[1]?.sections).to.equal(undefined);
        expect(result.notices).to.deep.equal(['有 1 个节点在导图里换了层级或换到别的章，课程里仍留在原处。']);
    });

    it('does not turn an existing chapter into a section when the node moves down', () => {
        const result = applyMindmapToChapters({
            dag: [chapter({ _id: 1, title: '循环', sourceMindmapNodeId: hex('a'), videos: [video] })],
            rootNodeId: hex('0'),
            nodes: [root, node('b', '0', '数组', 0), node('a', 'b', '循环', 0)],
        });
        expect(result.dag.map((item) => item.sourceMindmapNodeId)).to.deep.equal([hex('b'), hex('a')]);
        expect(result.dag[0]?.sections).to.equal(undefined);
        expect(result.dag[1]?.videos).to.deep.equal([video]);
        expect(result.notices.some((notice) => notice.includes('换了层级'))).to.equal(true);
    });

    it('keeps a handwritten chapter after the generated ones and drops only the stock placeholder', () => {
        const handwritten = applyMindmapToChapters({
            dag: [chapter({ _id: 1, title: '老师写的章' })],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '数组', 0)],
        });
        expect(handwritten.dag.map((item) => item.title)).to.deep.equal(['数组', '老师写的章']);
        expect(handwritten.notices).to.deep.equal(['手写章节留在后面。']);
        const stock = applyMindmapToChapters({
            dag: [chapter({ _id: 8, title: '第 2 章' })],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '数组', 0)],
        });
        expect(stock.dag.map((item) => item.title)).to.deep.equal(['数组']);
        const customNumber = applyMindmapToChapters({
            dag: [chapter({ _id: 8, title: '第1章' })],
            rootNodeId: hex('0'),
            nodes: [root, node('a', '0', '数组', 0)],
        });
        expect(customNumber.dag.map((item) => item.title)).to.deep.equal(['数组', '第1章']);
    });

    it('rejects an empty map, a broken tree, a duplicate link, and a title with a newline', () => {
        expect(() =>
            applyMindmapToChapters({
                dag: [],
                rootNodeId: hex('0'),
                nodes: [root],
            }),
        )
            .to.throw(CourseChapterGenerateError)
            .with.property('code', 'empty');
        expect(() =>
            applyMindmapToChapters({
                dag: [],
                rootNodeId: hex('0'),
                nodes: [root, { ...node('a', '0', '数组', 0), parentId: 'z'.repeat(24) }],
            }),
        )
            .to.throw(CourseChapterGenerateError)
            .with.property('code', 'broken');
        expect(() =>
            applyMindmapToChapters({
                dag: [chapter({ _id: 1, title: 'A', sourceMindmapNodeId: hex('a') }), chapter({ _id: 2, title: 'B', sourceMindmapNodeId: hex('a') })],
                rootNodeId: hex('0'),
                nodes: [root, node('a', '0', '数组', 0)],
            }),
        )
            .to.throw(CourseChapterGenerateError)
            .with.property('code', 'duplicate');
        expect(() =>
            applyMindmapToChapters({
                dag: [],
                rootNodeId: hex('0'),
                nodes: [root, { ...node('a', '0', '数组', 0), topic: '第一行\n第二行' }],
            }),
        )
            .to.throw(CourseChapterGenerateError)
            .with.property('code', 'newline');
    });

    it('strips generated links when a course is copied', () => {
        const stripped = stripCourseMindmapChapterSources([
            chapter({
                _id: 2,
                title: '数组',
                sourceMindmapNodeId: hex('a'),
                sourceMindmapBody: '说明',
                content: '说明',
                videos: [video],
                sections: [
                    {
                        _id: 1,
                        title: '下标',
                        pids: [4],
                        sourceMindmapNodeId: hex('1'),
                        sourceMindmapBody: '- 深层',
                        content: '- 深层',
                    },
                ],
            }),
        ]);
        expect(stripped[0]?.sourceMindmapNodeId).to.equal(undefined);
        expect(stripped[0]?.sourceMindmapBody).to.equal(undefined);
        expect(stripped[0]?.videos).to.deep.equal([video]);
        expect(stripped[0]?.content).to.equal('说明');
        expect(stripped[0]?.sections?.[0]?.sourceMindmapNodeId).to.equal(undefined);
        expect(stripped[0]?.sections?.[0]?.pids).to.deep.equal([4]);
        const handler = readFileSync(resolve(__dirname, '../src/handler/course.ts'), 'utf8');
        const postCopy = handler.slice(handler.indexOf('async postCopy('), handler.indexOf('async postDelete('));
        expect(postCopy).to.include('stripCourseMindmapChapterSources');
        expect(handler).to.include('async postGenerateChapters(');
        expect(handler).to.include('applyMindmapToChapters');
        expect(handler).to.include('请先创建本课导图，再生成章节');
    });
});
