import { ObjectId } from 'mongodb';
import { STATUS } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import * as document from '../model/document';
import type { PracticeContainerKind } from '../model/practice-integrity';

export async function loadCompletedPidsByUid(input: {
    domainId: string;
    memberUids: readonly number[];
    pids: readonly number[];
    publishedIntegrity: boolean;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopePids: ReadonlyMap<number, ReadonlySet<number>>;
}): Promise<Map<number, Set<number>>> {
    if (!input.memberUids.length || !input.pids.length) return new Map();
    if (input.publishedIntegrity) {
        return contextualCompletionService.getCompletedPidsByUsers(
            input.domainId,
            input.memberUids,
            input.containerKind,
            input.containerId,
            input.scopePids,
        );
    }
    const acDocs = await document
        .getMultiStatus(input.domainId, document.TYPE_PROBLEM, {
            uid: { $in: [...input.memberUids] },
            docId: { $in: [...input.pids] },
            status: STATUS.STATUS_ACCEPTED,
        })
        .project({ uid: 1, docId: 1 })
        .toArray();
    const completedPidsByUid = new Map<number, Set<number>>();
    for (const doc of acDocs) {
        const uid = Number(doc.uid);
        const pid = Number(doc.docId);
        if (!Number.isSafeInteger(uid) || uid <= 1 || !Number.isSafeInteger(pid) || pid <= 0) {
            throw new TypeError(`invalid global AC roster projection for ${input.domainId}/${input.containerId}`);
        }
        const completed = completedPidsByUid.get(uid) || new Set<number>();
        completed.add(pid);
        completedPidsByUid.set(uid, completed);
    }
    return completedPidsByUid;
}
