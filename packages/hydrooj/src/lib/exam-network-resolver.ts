import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { ExamNetworkConfigError, ExamTargetResolution, ExamTargetResolverInput } from '../model/exam-network-config';
import { endpointEnrollmentBatchColl } from '../model/endpoint-enrollment';
import { endpointSeatBindingService } from '../model/endpoint-seat-binding';
import { examClassroomService } from '../model/exam-classroom';
import { preflightExamNetworkOnVigil } from '../service/vigil-bridge';

function fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export async function resolveExamTargetSources(input: ExamTargetResolverInput): Promise<ExamTargetResolution> {
    if (input.sources.some((source) => !['classroom', 'endpoint', 'seat'].includes(source.kind))) {
        throw new ExamNetworkConfigError('target_source_not_available');
    }
    const observedAt = new Date();

    const sourceFacts: Array<{
        kind: 'classroom' | 'endpoint' | 'seat';
        sourceId: string;
        endpointId: string;
        bindingId?: string;
        bindingRevision?: number;
        classroomId?: string;
        sourceSeatId?: string;
    }> = [];
    for (const source of input.sources) {
        if (source.kind === 'endpoint') {
            for (const endpointId of source.ids) sourceFacts.push({ kind: 'endpoint', sourceId: endpointId, endpointId });
            continue;
        }
        for (const sourceId of source.ids) {
            if (!ObjectId.isValid(sourceId) || new ObjectId(sourceId).toHexString() !== sourceId) {
                throw new ExamNetworkConfigError('invalid_target_source');
            }
            if (source.kind === 'classroom') {
                const classroomId = new ObjectId(sourceId);
                const classroom = await examClassroomService.get(input.domainId, classroomId);
                if (!classroom) throw new ExamNetworkConfigError('classroom_not_found');
                if (!classroom.schoolId.equals(input.schoolId)) throw new ExamNetworkConfigError('cross_school_endpoint');
                const currentSeatIds = new Set(examClassroomService.layout(classroom).snapshot.seats.map((seat) => seat.sourceSeatId));
                const bindings = await endpointSeatBindingService.listClassroomBindings(input.domainId, classroomId);
                for (const binding of bindings) {
                    if (binding.status !== 'active' || !binding.endpointId) continue;
                    if (binding.domainId !== input.domainId || !binding.schoolId.equals(input.schoolId) || !binding.classroomId.equals(classroomId)) {
                        throw new ExamNetworkConfigError('cross_school_endpoint');
                    }
                    if (!currentSeatIds.has(binding.sourceSeatId)) {
                        throw new ExamNetworkConfigError('seat_binding_invalid');
                    }
                    sourceFacts.push({
                        kind: 'classroom',
                        sourceId,
                        endpointId: binding.endpointId,
                        bindingId: binding._id.toHexString(),
                        bindingRevision: binding.revision,
                        classroomId: sourceId,
                        sourceSeatId: binding.sourceSeatId,
                    });
                }
                continue;
            }
            const binding = await endpointSeatBindingService.getBindingById(input.domainId, new ObjectId(sourceId));
            if (!binding || binding.status !== 'active' || !binding.endpointId) {
                throw new ExamNetworkConfigError('seat_binding_not_active');
            }
            if (binding.domainId !== input.domainId || !binding.schoolId.equals(input.schoolId)) {
                throw new ExamNetworkConfigError('cross_school_endpoint');
            }
            const classroom = await examClassroomService.get(input.domainId, binding.classroomId);
            if (!classroom || !classroom.schoolId.equals(binding.schoolId)) {
                throw new ExamNetworkConfigError('seat_binding_invalid');
            }
            const currentSeatIds = new Set(examClassroomService.layout(classroom).snapshot.seats.map((seat) => seat.sourceSeatId));
            if (!currentSeatIds.has(binding.sourceSeatId)) {
                throw new ExamNetworkConfigError('seat_binding_invalid');
            }
            sourceFacts.push({
                kind: 'seat',
                sourceId,
                endpointId: binding.endpointId,
                bindingId: binding._id.toHexString(),
                bindingRevision: binding.revision,
                classroomId: binding.classroomId.toHexString(),
                sourceSeatId: binding.sourceSeatId,
            });
        }
    }
    sourceFacts.sort((left, right) =>
        `${left.kind}\0${left.sourceId}\0${left.endpointId}`.localeCompare(`${right.kind}\0${right.sourceId}\0${right.endpointId}`),
    );
    const endpointIds = sourceFacts.map((fact) => fact.endpointId).sort();
    if (!endpointIds.length) throw new ExamNetworkConfigError('empty_target');
    if (new Set(endpointIds).size !== endpointIds.length) {
        throw new ExamNetworkConfigError('duplicate_endpoint');
    }
    const batches = await endpointEnrollmentBatchColl.find({ 'claims.endpointId': { $in: endpointIds } }).toArray();
    const ownershipFacts = batches.flatMap((batch) =>
        batch.claims
            .filter((claim) => claim.endpointId && endpointIds.includes(claim.endpointId))
            .map((claim) => ({
                endpointId: claim.endpointId!,
                domainId: batch.domainId,
                batchId: batch._id.toHexString(),
                claimId: claim.claimId,
                finalizedAt: claim.finalizedAt,
            })),
    );
    ownershipFacts.sort((left, right) => left.endpointId.localeCompare(right.endpointId));
    if (
        ownershipFacts.length !== endpointIds.length ||
        new Set(ownershipFacts.map((fact) => fact.endpointId)).size !== endpointIds.length ||
        ownershipFacts.some(
            (fact) =>
                !(fact.finalizedAt instanceof Date) ||
                !Number.isFinite(fact.finalizedAt.getTime()) ||
                fact.finalizedAt > observedAt ||
                fact.domainId !== input.domainId,
        )
    ) {
        throw new ExamNetworkConfigError('endpoint_not_owned');
    }
    const canonicalOwnershipFacts = ownershipFacts.map((fact) => ({
        ...fact,
        finalizedAt: fact.finalizedAt!.toISOString(),
    }));
    const preflight = await preflightExamNetworkOnVigil(endpointIds);
    if (
        preflight.length !== endpointIds.length ||
        preflight.some((item) => !endpointIds.includes(item.endpointId)) ||
        new Set(preflight.map((item) => item.endpointId)).size !== endpointIds.length
    ) {
        throw new ExamNetworkConfigError('endpoint_preflight_invalid');
    }
    const byEndpoint = new Map(preflight.map((item) => [item.endpointId, item]));
    const endpoints = endpointIds.map((endpointId) => {
        const item = byEndpoint.get(endpointId);
        if (!item || item.credentialStatus !== 'active') throw new ExamNetworkConfigError('endpoint_not_active');
        if (item.compatible === false) throw new ExamNetworkConfigError('endpoint_protocol_incompatible');
        return {
            endpointId,
            // Explicit endpoint sources remain domain-owned. Classroom and
            // seat sources have already proved their canonical school above.
            schoolId: new ObjectId(input.schoolId),
            capabilities: item.capabilities.map((capability) => ({
                name: capability.name,
                version: capability.version,
                commands: [...capability.commands],
            })),
        };
    });
    return {
        sourceFingerprint: fingerprint({
            domainId: input.domainId,
            eventId: input.eventId.toHexString(),
            schoolId: input.schoolId.toHexString(),
            ownershipFacts: canonicalOwnershipFacts,
            sourceFacts,
            endpoints: endpoints.map((endpoint) => ({
                endpointId: endpoint.endpointId,
                capabilities: endpoint.capabilities,
            })),
        }),
        endpoints,
    };
}
