import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { post, Types } from '@hydrooj/framework';
import { canonicalAntiAiMarkers, isRawStatementContentInput } from '../src/lib/anti-ai-marker';

const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('P1.6 anti AI marker integration contract', () => {
    it('keeps raw marker anchors out of public projections and problem detail responses', () => {
        const model = read('src/model/problem.ts');
        const publicStart = model.indexOf('static PROJECTION_PUBLIC');
        const editorStart = model.indexOf('static PROJECTION_MANAGED_EDITOR', publicStart);
        const bankStart = model.indexOf('static PROJECTION_MANAGED_BANK', editorStart);
        expect(model.slice(publicStart, editorStart)).not.to.include("'antiAiMarkers'");
        expect(model.slice(editorStart, bankStart)).not.to.include("'antiAiMarkers'");

        const handler = read('src/handler/problem.ts');
        const detailStart = handler.indexOf('export class ProblemDetailHandler');
        const detailEnd = handler.indexOf('export class ProblemSubmitHandler', detailStart);
        const detail = handler.slice(detailStart, detailEnd);
        expect(detail).to.include('delete responsePdoc.antiAiMarkers');
        expect(detail).to.include('this.practicePageContext?.controlled && this.practicePageContext.policy?.antiAiCopyInjection');
        expect(detail).to.include('problem.getAntiAiMarkerClientView(this.pdoc.domainId, this.pdoc.docId, this.pdoc)');
        expect(model).to.include('problem statement changed while serializing anti AI markers');
        expect(handler).to.include("@post('antiAiMarkers', Types.String, true)");
        expect(handler).to.include("[...problem.PROJECTION_MANAGED_EDITOR, 'config', 'antiAiMarkers']");
    });

    it('validates current stored anchors and uses the existing structure CAS for every marker write', () => {
        const model = read('src/model/problem.ts');
        const start = model.indexOf('static async editWithClaim(');
        const end = model.indexOf('/** HTTP/service-token metadata write entrypoint. */', start);
        const edit = model.slice(start, end);
        expect(edit).to.include('antiAiMarkers: 1');
        expect(edit.indexOf('assertStoredAntiAiMarkers(current.antiAiMarkers')).to.be.lessThan(edit.indexOf('canonicalAntiAiMarkers('));
        expect(edit).to.include('options.expectedStructureRevision !== 0');
        expect(edit).to.include('expectedStructureRevisionAbsent: true');
        expect(edit).to.include('expectedStructureRevision: options.expectedStructureRevision');
        expect(edit).to.include('写入钩子不能改变已验证的防 AI 标记');
        expect(edit).to.include('const markerDocumentUnchanged = currentAntiAiMarkers');
        expect(edit.indexOf('delete $set.antiAiMarkers')).to.be.lessThan(edit.indexOf('const structuralPatch ='));
        expect(edit).to.include('antiAiMarkersTouched = false');
    });

    it('blocks statement writes that omit an existing marker remap', () => {
        const model = read('src/model/problem.ts');
        const rawStart = model.indexOf('static async edit(');
        const rawEnd = model.indexOf('static async beginAuthorizedWriteClaim', rawStart);
        const raw = model.slice(rawStart, rawEnd);
        const claimStart = model.indexOf('static async editWithClaim(');
        const claimEnd = model.indexOf('/** HTTP/service-token metadata write entrypoint. */', claimStart);
        const claimed = model.slice(claimStart, claimEnd);
        expect(raw).to.include('题面包含防 AI 标记，必须从题面编辑器完成重新定位');
        expect(claimed).to.include('编辑题面时必须同时提交重新定位结果');
    });

    it('preserves statement whitespace and marker offsets through the real request decorator', () => {
        const content = '    int x;\n';
        class Fixture {
            request = { body: { content }, query: {}, params: {} };
            args = { domainId: 'system' };

            capture(_rawArgs: unknown, parsedContent?: string) {
                return parsedContent;
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(Fixture.prototype, 'capture');
        if (!descriptor) throw new Error('fixture descriptor missing');
        post('content', Types.String, true, isRawStatementContentInput)(Fixture.prototype, 'capture', descriptor);
        Object.defineProperty(Fixture.prototype, 'capture', descriptor);
        const fixture = new Fixture();
        const parsed = (fixture.capture as unknown as (rawArgs: { domainId: string }) => string)({ domainId: 'system' });

        expect(parsed).to.equal(content);
        const stored = canonicalAntiAiMarkers(
            {
                schemaVersion: 1,
                markers: [
                    {
                        id: 'marker_whitespace',
                        anchor: { path: 'content', offset: parsed.length, affinity: 'after' },
                        injectionText: '隐藏提示',
                        revision: 0,
                    },
                ],
            },
            { content: parsed },
            undefined,
        );
        expect(stored.markers[0].anchor.offset).to.equal(content.length);

        const handler = read('src/handler/problem.ts');
        expect(handler).to.include("@post('content', Types.String, true, isRawStatementContentInput)");
    });
});
