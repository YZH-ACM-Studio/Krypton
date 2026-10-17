import { localizeError, localizedErrorText, PermissionError, ValidationError } from '../error';
import { readProblemSchoolBank } from '../lib/teach-fields';
import { Logger } from '../logger';
import { PRIV } from './builtin';
import * as document from './document';
import type { ProblemDoc } from './problem';

const logger = new Logger('problem-school-bank');
const MAX_SCHOOL_BANK_BATCH = 500;
const PROBLEM_FIELDS = ['docId', 'owner', 'authoringMode', 'archivedAt', 'schoolBank'] as const;

interface SchoolBankActor {
    _id: number;
    hasPriv: (...priv: number[]) => boolean;
}

export function isProblemInSchoolBank(pdoc: Pick<ProblemDoc, 'schoolBank'>): boolean {
    return readProblemSchoolBank(pdoc.schoolBank) !== null;
}

/** Site administrators may toggle any problem. Owners may toggle only non-managed problems. */
export function canToggleProblemSchoolBank(
    actor: SchoolBankActor,
    pdoc: Pick<ProblemDoc, 'owner' | 'authoringMode'>,
): boolean {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    return pdoc.owner === actor._id && pdoc.authoringMode !== 'managed';
}

function assertDomainId(domainId: string): void {
    if (typeof domainId !== 'string' || domainId.length === 0) throw new TypeError('problem_school_bank_domain_invalid');
}

function assertActor(actor: SchoolBankActor): void {
    if (!actor || typeof actor.hasPriv !== 'function' || !Number.isSafeInteger(actor._id) || actor._id <= 0) {
        throw new TypeError('problem_school_bank_actor_invalid');
    }
}

function uniquePositiveIds(docIds: readonly number[], invalid: () => never): number[] {
    if (!Array.isArray(docIds)) invalid();
    const seen = new Set<number>();
    const unique: number[] = [];
    for (const id of docIds) {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) invalid();
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }
    return unique;
}

async function readProblems(domainId: string, docIds: number[]): Promise<ProblemDoc[]> {
    return document
        .getMulti(domainId, document.TYPE_PROBLEM, { docId: { $in: docIds } }, PROBLEM_FIELDS)
        .toArray();
}

export async function setProblemSchoolBank(
    domainId: string,
    actor: SchoolBankActor,
    docIds: number[],
    shared: boolean,
): Promise<{ changed: number[]; unchanged: number[] }> {
    assertDomainId(domainId);
    assertActor(actor);
    if (typeof shared !== 'boolean') throw new ValidationError('shared', null, localizedErrorText`请选择共享或取消共享`);
    const unique = uniquePositiveIds(docIds, () => {
        throw new ValidationError('docIds', null, localizedErrorText`题目编号不正确`);
    });
    if (unique.length === 0) throw new ValidationError('docIds', null, localizedErrorText`请至少选择一道题`);
    if (unique.length > MAX_SCHOOL_BANK_BATCH) throw new ValidationError('docIds', null, localizedErrorText`一次最多处理 500 道题`);

    const byId = new Map<number, ProblemDoc>();
    for (const doc of await readProblems(domainId, unique)) {
        if (!Number.isSafeInteger(doc.docId) || byId.has(doc.docId)) throw new TypeError('problem_school_bank_duplicate');
        byId.set(doc.docId, doc);
    }
    const absent = unique.filter((id) => {
        const doc = byId.get(id);
        return !doc || doc.archivedAt != null;
    });
    if (absent.length) {
        throw new ValidationError('docIds', null, localizedErrorText`题目不存在或已归档：${absent.join('、')}`);
    }

    const rows = unique.map((id) => {
        const doc = byId.get(id);
        if (!doc) throw new TypeError('problem_school_bank_missing');
        return { id, doc, inBank: readProblemSchoolBank(doc.schoolBank) !== null };
    });
    if (rows.some((row) => !canToggleProblemSchoolBank(actor, row.doc))) {
        throw localizeError(new PermissionError(), '你不能修改这些题目的学校题库共享。');
    }

    const changed = rows.filter((row) => row.inBank !== shared).map((row) => row.id);
    const unchanged = rows.filter((row) => row.inBank === shared).map((row) => row.id);
    if (changed.length) {
        const identity = {
            domainId,
            docType: document.TYPE_PROBLEM,
            docId: { $in: changed },
            archivedAt: { $exists: false },
        };
        if (shared) {
            await document.coll.updateMany(identity, {
                $set: { schoolBank: { sharedBy: actor._id, sharedAt: new Date() } },
            });
        } else {
            await document.coll.updateMany(identity, { $unset: { schoolBank: '' } });
        }
    }
    logger.info(
        'Problem school bank updated domain=%s actor=%d shared=%s changed=%d stage=set result=ok',
        domainId,
        actor._id,
        shared,
        changed.length,
    );
    return { changed, unchanged };
}

/** Doc ids from `docIds` whose stored school-bank field is present in this domain. */
export async function listSchoolBankDocIds(domainId: string, docIds: number[]): Promise<number[]> {
    assertDomainId(domainId);
    const unique = uniquePositiveIds(docIds, () => {
        throw new TypeError('problem_school_bank_doc_ids_invalid');
    });
    if (!unique.length) return [];
    const shared = new Set<number>();
    for (const doc of await readProblems(domainId, unique)) {
        if (readProblemSchoolBank(doc.schoolBank)) shared.add(doc.docId);
    }
    return unique.filter((id) => shared.has(id));
}
