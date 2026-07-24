type RecordLike = Record<string, any>;

export function shouldUseLiveClientRecordCodeOnly({
    clientRequired,
    ongoing,
    contestOwner,
    canEditContest,
    systemAdmin,
}: {
    clientRequired: boolean;
    ongoing: boolean;
    contestOwner: boolean;
    canEditContest: boolean;
    systemAdmin: boolean;
}) {
    return clientRequired && ongoing && !contestOwner && !canEditContest && !systemAdmin;
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

/**
 * Exam Mode deliberately exposes only the source the current route already
 * authorized. Result details stay out of the bootstrap entirely rather than
 * relying on the React view to hide them.
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

    return {
        tdoc: body.tdoc,
        rdoc: {
            _id: rdoc._id,
            uid: rdoc.uid,
            pid: rdoc.pid,
            lang,
            code: rdoc.code || '',
        },
        pdoc: minimalProblem(body.pdoc),
        udoc: minimalUser(body.udoc),
        langs: langInfo,
        examRecordCodeOnly: true,
        examRecordDownloadAvailable: downloadAvailable,
    };
}
