import type { ProblemDoc } from 'hydrooj';

const indexOmit = new Set(['_id', 'docType', 'data', 'additional_file', 'config', 'stats', 'assign']);

export const processDocument = (doc: Partial<ProblemDoc>) => {
    const indexedDoc = {
        ...doc,
        tag: doc.tag ? [...doc.tag] : doc.tag,
    };
    indexedDoc.content &&= indexedDoc.content.replace(/[[\]【】()（）]/g, ' ');
    indexedDoc.title &&= indexedDoc.title.replace(/[[\]【】()（）]/g, ' ').replace(/([a-zA-Z]{2,})(\d+)/, '$1$2 $1 $2');
    if (indexedDoc.pid?.includes('-')) {
        const ns = indexedDoc.pid.split('-')[0];
        indexedDoc.tag.push(ns);
    }
    indexedDoc.pid &&= indexedDoc.pid.replace(/([a-zA-Z]{2,})(\d+)/, '$1$2 $1 $2').replace(/-/g, ' ');
    return Object.fromEntries(Object.entries(indexedDoc).filter(([key]) => !indexOmit.has(key)));
};
