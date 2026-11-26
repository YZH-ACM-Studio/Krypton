import {
    copyConfigAsDraft,
    mapLegacyContest,
    readStoredSetConfig,
    type SetConfig,
    type SetPurpose,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { ContestNotFoundError } from '../error';
import type { Tdoc } from '../interface';

const logger = new Logger('set-publication');

function plainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Own keys must be the decimal form of a copied pid. Values are finite scores at least 0. */
function copiedScore(raw: unknown, pids: readonly number[]): Record<number, number> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!plainObject(raw) || Object.getOwnPropertySymbols(raw).length !== 0) throw new TypeError('set_copy_score_invalid');
    const score: Record<number, number> = {};
    for (const key of Object.getOwnPropertyNames(raw)) {
        const pid = pids.find((item) => key === String(item));
        const value = raw[key];
        if (pid === undefined || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            throw new TypeError('set_copy_score_invalid');
        }
        score[pid] = value;
    }
    return score;
}

/** Missing configuration is not a draft. Callers that still serve legacy contests use null. */
export function storedSetConfigOrNull(doc: unknown): SetConfig | null {
    try {
        return readStoredSetConfig(doc);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'set_config_missing') return null;
        throw error;
    }
}

/** The publication gate applies to configured sets; legacy containers keep their own access checks. */
export function requirePublishedForStudent(tdoc: Tdoc, manager: boolean) {
    if (manager) return;
    const config = storedSetConfigOrNull(tdoc);
    if (!config || config.publication === 'published') return;
    logger.info('problem set hidden from student domain=%s tid=%s reason=draft', tdoc.domainId, String(tdoc.docId));
    throw new ContestNotFoundError(tdoc.domainId, tdoc.docId);
}

export function copiedDraftUpdate(
    source: unknown,
    kind: SetPurpose,
): { pids: number[]; setConfig: SetConfig; score?: Record<number, number> } {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) throw new TypeError('set_copy_source_missing');
    const record = source as Record<string, unknown>;
    let config: SetConfig;
    try {
        config = copyConfigAsDraft(readStoredSetConfig(record));
    } catch (error) {
        if (!(error instanceof TypeError) || error.message !== 'set_config_missing') throw error;
        config = copyConfigAsDraft(mapLegacyContest(record));
    }
    if (config.purpose !== kind) throw new TypeError('set_copy_purpose_mismatch');
    const pids = record.pids;
    if (!Array.isArray(pids) || pids.some((pid) => typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new TypeError('set_copy_pids_invalid');
    }
    const pidList = pids as number[];
    const score = copiedScore(record.score, pidList);
    if (score === undefined) return { pids: pidList, setConfig: config };
    return { pids: pidList, setConfig: config, score };
}

export interface CopiedDraftFields {
    pids: number[];
    content: string;
    copiedFrom: {
        type: string;
        id: unknown;
        title: string;
        ownerUid: number;
        copiedBy: number;
        copiedAt: Date;
    };
    score?: Record<number, number>;
}

/** Drops problems the copier cannot select. Does not carry a window or audience. */
export function selectCopiedDraftFields(input: {
    pids: readonly number[];
    score?: Record<number, number>;
    unusable: ReadonlySet<number>;
    statement: string;
    sourceType: string;
    sourceId: unknown;
    sourceTitle: string;
    ownerUid: number;
    copiedBy: number;
    copiedAt: Date;
}): CopiedDraftFields {
    if (!Number.isSafeInteger(input.ownerUid) || input.ownerUid <= 0) throw new TypeError('set_copy_owner_invalid');
    if (!Number.isSafeInteger(input.copiedBy) || input.copiedBy <= 0) throw new TypeError('set_copy_actor_invalid');
    if (input.sourceTitle.trim() === '') throw new TypeError('set_copy_title_invalid');
    const pids = input.pids.filter((pid) => !input.unusable.has(pid));
    const score: Record<number, number> = {};
    if (input.score) {
        for (const pid of pids) {
            const value = input.score[pid];
            if (value !== undefined) score[pid] = value;
        }
    }
    return {
        pids,
        content: input.statement,
        copiedFrom: {
            type: input.sourceType,
            id: input.sourceId,
            title: input.sourceTitle,
            ownerUid: input.ownerUid,
            copiedBy: input.copiedBy,
            copiedAt: input.copiedAt,
        },
        ...(Object.keys(score).length > 0 ? { score } : {}),
    };
}
