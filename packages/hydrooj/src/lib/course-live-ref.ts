import { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';
import type { TrainingNode } from '../interface';
import * as training from '../model/training';
import { isProblemSetKind } from './training-kind';

/** Live-project the referenced problem-set members. Never persist copied pids. */
export async function liveReferencedPids(domainId: string, node: Pick<TrainingNode, 'problemSetId' | 'stageIds'>): Promise<number[]> {
    if (!node.problemSetId) return [];
    const setDoc = await training.get(domainId, node.problemSetId instanceof ObjectId ? node.problemSetId : new ObjectId(String(node.problemSetId)));
    if (!isProblemSetKind(setDoc.kind)) throw new ValidationError('problemSetId', null, localizedErrorText`引用的不是题集`);
    const stages =
        Array.isArray(node.stageIds) && node.stageIds.length
            ? (setDoc.dag || []).filter((stage) => node.stageIds!.map(Number).includes(Number(stage._id)))
            : setDoc.dag || [];
    return training.getPids(stages);
}
