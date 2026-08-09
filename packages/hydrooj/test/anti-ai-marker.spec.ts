import { expect } from 'chai';
import { describe, it } from 'node:test';
import { antiAiMarkerClientView, canonicalAntiAiMarkers, remapAntiAiMarkerOffset, statementSourcesForAntiAiMarkers } from '../src/lib/anti-ai-marker';

const legacyProblem = (content: string) => ({ content });

describe('anti AI marker canonical boundary', () => {
    it('stores anchors outside markdown and exposes only the client-safe fields', () => {
        const problem = legacyProblem('前缀 **正文** 后缀');
        const stored = canonicalAntiAiMarkers(
            {
                schemaVersion: 1,
                markers: [
                    {
                        id: 'marker_0001',
                        anchor: { path: 'content', offset: 3, affinity: 'after' },
                        injectionText: '只在复制时出现',
                        revision: 0,
                    },
                ],
            },
            problem,
            undefined,
        );

        expect(problem.content).to.equal('前缀 **正文** 后缀');
        expect(stored.markers[0]).to.deep.include({ id: 'marker_0001', injectionText: '只在复制时出现', revision: 1 });
        expect(stored.markers[0].anchor.before).to.equal('前缀 ');
        expect(stored.markers[0].anchor.after).to.equal('**正文** 后缀');
        expect(antiAiMarkerClientView(stored, problem)).to.deep.equal({
            schemaVersion: 1,
            markers: [{ id: 'marker_0001', path: 'content', offset: 3, injectionText: '只在复制时出现' }],
        });
    });

    it('supports localized, structured, code block, link, LaTeX and combining-character statement paths', () => {
        const combining = 'e\u0301';
        const problem = {
            statementFormat: 'structured-v1',
            programmingStatement: {
                background: { state: 'present', content: '[链接](https://example.com)' },
                description: { state: 'present', content: `公式 $x^2$\n\n\`\`\`cpp\nint x;\n\`\`\`\n${combining}` },
                input: { state: 'absent', content: '' },
                output: { state: 'absent', content: '' },
                examples: { state: 'present', items: [{ input: '', output: '', note: '样例说明' }] },
                hints: { state: 'present', content: '提示' },
            },
        };
        const sources = statementSourcesForAntiAiMarkers(problem);
        expect([...sources.keys()]).to.include.members([
            'programmingStatement.background',
            'programmingStatement.description',
            'programmingStatement.examples.0.note',
        ]);
        const background = sources.get('programmingStatement.background')!;
        const description = sources.get('programmingStatement.description')!;
        const accepted = canonicalAntiAiMarkers(
            {
                schemaVersion: 1,
                markers: [
                    {
                        id: 'marker_start',
                        anchor: { path: 'programmingStatement.background', offset: 0, affinity: 'before' },
                        injectionText: '始'.repeat(10_000),
                        revision: 0,
                    },
                    {
                        id: 'marker_link_end',
                        anchor: { path: 'programmingStatement.background', offset: background.length, affinity: 'after' },
                        injectionText: '链接末尾',
                        revision: 0,
                    },
                    {
                        id: 'marker_latex',
                        anchor: { path: 'programmingStatement.description', offset: description.indexOf('$x^2$'), affinity: 'before' },
                        injectionText: '公式边界',
                        revision: 0,
                    },
                    {
                        id: 'marker_code',
                        anchor: { path: 'programmingStatement.description', offset: description.indexOf('int x;'), affinity: 'before' },
                        injectionText: '代码边界',
                        revision: 0,
                    },
                    {
                        id: 'marker_end',
                        anchor: { path: 'programmingStatement.description', offset: description.length, affinity: 'after' },
                        injectionText: '段尾',
                        revision: 0,
                    },
                ],
            },
            problem,
            undefined,
        );
        expect(accepted.markers).to.have.length(5);
        expect(accepted.markers[0].injectionText).to.have.length(10_000);
        const invalidOffset = description.indexOf(combining) + 1;
        expect(() =>
            canonicalAntiAiMarkers(
                {
                    schemaVersion: 1,
                    markers: [
                        {
                            id: 'marker_0002',
                            anchor: { path: 'programmingStatement.description', offset: invalidOffset, affinity: 'after' },
                            injectionText: '不要拆开组合字符',
                            revision: 0,
                        },
                    ],
                },
                problem,
                undefined,
            ),
        ).to.throw('grapheme boundary');
        expect(statementSourcesForAntiAiMarkers({ content: { zh: '  中文  ', en: ' English ' } }).get('content.zh')).to.equal('  中文  ');
        expect(statementSourcesForAntiAiMarkers({ content: '{"zh":"  中文  "}' }).get('content.zh')).to.equal('  中文  ');
        expect(statementSourcesForAntiAiMarkers({ content: '  普通题面  ' }).get('content')).to.equal('  普通题面  ');
    });

    it('fails closed for unknown schemas, stale revisions and stored anchors that no longer match', () => {
        const problem = legacyProblem('abcdef');
        expect(() => canonicalAntiAiMarkers({ schemaVersion: 2, markers: [] }, problem, undefined)).to.throw('schemaVersion');
        expect(() => antiAiMarkerClientView(null, problem)).to.throw('antiAiMarkers must be an object');
        const stored = canonicalAntiAiMarkers(
            {
                schemaVersion: 1,
                markers: [
                    {
                        id: 'marker_0003',
                        anchor: { path: 'content', offset: 3, affinity: 'before' },
                        injectionText: 'x',
                        revision: 0,
                    },
                ],
            },
            problem,
            undefined,
        );
        expect(() =>
            canonicalAntiAiMarkers(
                {
                    schemaVersion: 1,
                    markers: [
                        {
                            id: stored.markers[0].id,
                            anchor: {
                                path: stored.markers[0].anchor.path,
                                offset: stored.markers[0].anchor.offset,
                                affinity: stored.markers[0].anchor.affinity,
                            },
                            injectionText: 'y',
                            revision: stored.markers[0].revision,
                        },
                    ],
                },
                problem,
                stored,
            ),
        ).not.to.throw();
        expect(() =>
            canonicalAntiAiMarkers(
                {
                    schemaVersion: 1,
                    markers: [
                        {
                            id: stored.markers[0].id,
                            anchor: {
                                path: stored.markers[0].anchor.path,
                                offset: stored.markers[0].anchor.offset,
                                affinity: stored.markers[0].anchor.affinity,
                            },
                            injectionText: 'y',
                            revision: 0,
                        },
                    ],
                },
                problem,
                stored,
            ),
        ).to.throw('revision');
        expect(() => antiAiMarkerClientView(stored, legacyProblem('abXcdef'))).to.throw('anchor context');
    });

    it('keeps marker offsets aligned when attachment URLs are rewritten', () => {
        const source = 'before ![x](file://a.jpg) after';
        const start = source.indexOf('file://a.jpg');
        const end = start + 'file://a.jpg'.length;
        const replacement = './7/file/a.jpg';
        const replacements = [{ start, end, replacementLength: replacement.length }];

        expect(remapAntiAiMarkerOffset(source.indexOf('before') + 2, replacements)).to.equal(source.indexOf('before') + 2);
        expect(remapAntiAiMarkerOffset(source.indexOf('after') + 2, replacements)).to.equal(
            source.indexOf('after') + 2 + replacement.length - (end - start),
        );
        expect(remapAntiAiMarkerOffset(start, replacements)).to.equal(start);
        expect(remapAntiAiMarkerOffset(end, replacements)).to.equal(start + replacement.length);
        expect(() => remapAntiAiMarkerOffset(start + 2, replacements)).to.throw('inside rewritten non-visible source');
    });
});
