import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    COLLECT_ALLOWED_EXTS,
    COLLECT_REJECTED_EXTS,
    isAllowedExt,
    normalizeExt,
    requiredSlotsFilled,
    type CollectAllowedExt,
    type CollectCurrentFileRef,
    type CollectSlot,
} from '../src/types';

function slot(id: string, required: boolean, allowedExt: CollectAllowedExt[] = ['pdf']): CollectSlot {
    return { id, title: id, required, allowedExt, maxFiles: 1 };
}

function file(slotId: string, ext: CollectAllowedExt = 'pdf'): CollectCurrentFileRef {
    return {
        slotId,
        fileId: `file-${slotId}`,
        originalName: `work.${ext}`,
        size: 12,
        sha256: 'abc',
        ext,
    };
}

describe('collect slot helpers', () => {
    it('maps jpeg to jpg and keeps other extensions lowercase', () => {
        expect(normalizeExt('photo.JPEG')).to.equal('jpg');
        expect(normalizeExt('  Report.Jpeg ')).to.equal('jpg');
        expect(normalizeExt('scan.jpg')).to.equal('jpg');
        expect(normalizeExt('notes.PDF')).to.equal('pdf');
        expect(normalizeExt('archive.ZIP')).to.equal('zip');
        expect(normalizeExt('image.PNG')).to.equal('png');
        expect(normalizeExt('essay.DOCX')).to.equal('docx');
    });

    it('returns an empty extension when the name has no usable suffix', () => {
        expect(normalizeExt('README')).to.equal('');
        expect(normalizeExt('trailing.')).to.equal('');
        expect(normalizeExt('   ')).to.equal('');
        expect(normalizeExt('payload.jpg.exe')).to.equal('exe');
    });

    it('allows only slot-listed members of the global allow-list', () => {
        const pdfOnly = { allowedExt: ['pdf'] as CollectAllowedExt[] };
        const images = { allowedExt: ['png', 'jpg'] as CollectAllowedExt[] };

        expect(isAllowedExt('pdf', pdfOnly)).to.equal(true);
        expect(isAllowedExt('docx', pdfOnly)).to.equal(false);
        expect(isAllowedExt('jpg', images)).to.equal(true);
        expect(isAllowedExt('png', images)).to.equal(true);
        expect(isAllowedExt('zip', images)).to.equal(false);
        expect(isAllowedExt('jpeg', images)).to.equal(false);
        expect(isAllowedExt('', pdfOnly)).to.equal(false);

        for (const ext of COLLECT_ALLOWED_EXTS) {
            expect(isAllowedExt(ext, { allowedExt: [...COLLECT_ALLOWED_EXTS] })).to.equal(true);
        }
    });

    it('rejects executable, markup, script, and macro extensions', () => {
        const wideSlot = { allowedExt: [...COLLECT_ALLOWED_EXTS] };
        expect(COLLECT_REJECTED_EXTS).to.deep.equal([
            'exe', 'dll', 'bat', 'cmd', 'ps1', 'sh', 'msi', 'apk', 'app',
            'html', 'htm', 'js', 'svg', 'docm', 'xlsm', 'pptm',
        ]);
        for (const ext of COLLECT_REJECTED_EXTS) {
            expect(isAllowedExt(ext, wideSlot)).to.equal(false);
            expect(isAllowedExt(ext, { allowedExt: [ext] as unknown as CollectAllowedExt[] })).to.equal(false);
        }
    });

    it('treats required slots as filled only when each has a current file', () => {
        const slots = [slot('report', true), slot('photo', true, ['jpg']), slot('extra', false, ['zip'])];

        expect(requiredSlotsFilled(slots, [file('report'), file('photo', 'jpg')])).to.equal(true);
        expect(requiredSlotsFilled(slots, [file('report'), file('photo', 'jpg'), file('extra', 'zip')])).to.equal(true);
        expect(requiredSlotsFilled(slots, [file('report')])).to.equal(false);
        expect(requiredSlotsFilled(slots, [file('photo', 'jpg'), file('extra', 'zip')])).to.equal(false);
        expect(requiredSlotsFilled(slots, [])).to.equal(false);
        expect(requiredSlotsFilled([slot('optional', false)], [])).to.equal(true);
        expect(requiredSlotsFilled([], [])).to.equal(true);
    });
});
