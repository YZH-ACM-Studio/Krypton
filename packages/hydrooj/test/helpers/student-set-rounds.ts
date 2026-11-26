import { ObjectId } from 'mongodb';
import { createDraftConfig, legacyRuleCreateKind, type SetConfig } from '@hydrooj/common';
import type { RoundDoc } from '../../src/model/set-round';

export function publishedConfig(rule: string): SetConfig {
    const config = createDraftConfig(legacyRuleCreateKind(rule));
    config.publication = 'published';
    if (rule === 'acm') config.settings.codePolicy = 'acm';
    if (rule === 'oi') config.settings.codePolicy = 'last';
    return config;
}

export function makeRound(doc: { domainId: string; docId: ObjectId; pids: number[]; beginAt: Date }, uid: number, patch: Partial<RoundDoc> = {}): RoundDoc {
    return {
        _id: new ObjectId(), domainId: doc.domainId, tid: doc.docId, participantKey: `u:${uid}`,
        roundNo: 1, state: 'open', startedAt: doc.beginAt, closedAt: null,
        paperPids: doc.pids, total: 0, passed: false, ...patch,
    };
}

export function roundStore() {
    const rounds: RoundDoc[] = [];
    const submitted = new Map<string, Set<number>>();
    return {
        rounds, submitted,
        reset() { rounds.length = 0; submitted.clear(); },
        model: {
            participantKey: (uid: number, team?: ObjectId) => team ? `t:${team.toHexString()}` : `u:${uid}`,
            listRounds: async (domain: string, ids: ObjectId | ObjectId[], key: string) =>
                rounds.filter((round) => round.domainId === domain && round.participantKey === key
                    && (Array.isArray(ids) ? ids : [ids]).some((id) => id.equals(round.tid))).sort((a, b) => a.roundNo - b.roundNo),
            listSubmittedPids: async (_domain: string, ids: ObjectId[]) => new Map(ids.map((id) => [id.toHexString(), submitted.get(id.toHexString())])),
        },
    };
}
