import { examShowsVerdict } from '@hydrooj/common';

type RecordLike = Record<string, any>;

export function shouldUseLiveClientRecordCodeOnly({
    clientRequired,
    ongoing,
    contestOwner,
    canEditContest,
    systemAdmin,
    contextualRecordAccess = false,
}: {
    clientRequired: boolean;
    ongoing: boolean;
    contestOwner: boolean;
    canEditContest: boolean;
    systemAdmin: boolean;
    contextualRecordAccess?: boolean;
}) {
    return clientRequired && ongoing && !contestOwner && !canEditContest && !systemAdmin && !contextualRecordAccess;
}

function minimalProblem(pdoc: RecordLike | null | undefined) {
    if (!pdoc || typeof pdoc !== 'object') return null;
    return {
        docId: pdoc.docId,
        title: pdoc.title,
    };
}

function minimalUser(udoc: RecordLike | null | undefined) {
    if (!udoc || typeof udoc !== 'object') return null;
    return {
        _id: udoc._id,
        uname: udoc.uname,
    };
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Exam Mode exposes the source the current route already authorized, plus the
 * overall verdict of this submission. Per-case output, compiler text, and
 * judge text stay out of the bootstrap. An exam that hides right/wrong omits
 * the verdict as well.
 */
export function buildExamModeRecordCodePayload(body: RecordLike) {
    const rdoc = body?.rdoc;
    if (!rdoc || typeof rdoc !== 'object') throw new TypeError('Exam Mode record payload is missing rdoc');
    if (rdoc.code != null && typeof rdoc.code !== 'string') {
        throw new TypeError('Exam Mode record code must be a string');
    }

    const lang = typeof rdoc.lang === 'string' ? rdoc.lang : '';
    const selectedLang = lang ? body.langs?.[lang] : null;
    const langInfo =
        lang && selectedLang
            ? {
                  [lang]: {
                      ...(typeof selectedLang.display === 'string' ? { display: selectedLang.display } : {}),
                      ...(typeof selectedLang.name === 'string' ? { name: selectedLang.name } : {}),
                  },
              }
            : {};
    const hasInlineCode = typeof rdoc.code === 'string' && rdoc.code.length > 0;
    const hasUploadedCode = typeof rdoc.files?.code === 'string' && rdoc.files.code.length > 0;
    const downloadAvailable =
        typeof body.examRecordDownloadAvailable === 'boolean' ? body.examRecordDownloadAvailable : hasInlineCode || hasUploadedCode;
    const statusVisible = examShowsVerdict(body.tdoc || {});
    const status = finiteNumber(rdoc.status);
    const score = finiteNumber(rdoc.score);
    const time = finiteNumber(rdoc.time);
    const memory = finiteNumber(rdoc.memory);
    const progress = finiteNumber(rdoc.progress);

    return {
        tdoc: body.tdoc,
        rdoc: {
            _id: rdoc._id,
            uid: rdoc.uid,
            pid: rdoc.pid,
            lang,
            code: rdoc.code || '',
            ...(statusVisible
                ? {
                      ...(status !== undefined ? { status } : {}),
                      ...(score !== undefined ? { score } : {}),
                      ...(time !== undefined ? { time } : {}),
                      ...(memory !== undefined ? { memory } : {}),
                      ...(progress !== undefined ? { progress } : {}),
                  }
                : {}),
        },
        pdoc: minimalProblem(body.pdoc),
        udoc: minimalUser(body.udoc),
        langs: langInfo,
        examRecordCodeOnly: true,
        examRecordDownloadAvailable: downloadAvailable,
        examRecordStatusVisible: statusVisible,
    };
}
