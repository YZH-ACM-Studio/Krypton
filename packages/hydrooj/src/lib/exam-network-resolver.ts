import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { ExamNetworkConfigError, ExamTargetResolution, ExamTargetResolverInput } from '../model/exam-network-config';
import { endpointEnrollmentBatchColl, endpointIdForMachineFingerprint, endpointRegistrationColl } from '../model/endpoint-enrollment';
import { endpointSeatBindingService } from '../model/endpoint-seat-binding';
import { examClassroomService } from '../model/exam-classroom';
import { examSeatAssignmentService, isExamSeatAssignmentV2 } from '../model/exam-seat-assignment';
import { preflightExamNetworkOnVigil } from '../service/vigil-bridge';

function fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalCompare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export async function resolveExamTargetSources(input: ExamTargetResolverInput): Promise<ExamTargetResolution> {
    if (input.sources.some((source) => !['classroom', 'endpoint', 'examSeat', 'seat'].includes(source.kind))) {
        throw new ExamNetworkConfigError('target_source_not_available');
    }
    const observedAt = new Date();

    const sourceFacts: Array<{
        kind: 'classroom' | 'endpoint' | 'examSeat' | 'seat';
        sourceId: string;
        endpointId: string;
        bindingId?: string;
        bindingRevision?: number;
        classroomId?: string;
        sourceSeatId?: string;
        assignmentRevision?: number;
        assignmentFingerprint?: string;
        publicationRevision?: number;
        boundUserId?: number;
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
            if (source.kind === 'examSeat') {
                const assignmentId = new ObjectId(sourceId);
                const publication = await examSeatAssignmentService.getPublication(input.domainId, input.eventId);
                if (!publication || !publication.assignment.assignmentId.equals(assignmentId)) {
                    throw new ExamNetworkConfigError('exam_seat_assignment_not_published');
                }
                const assignment = await examSeatAssignmentService.getRevision(input.domainId, input.eventId, publication.assignment.revision);
                if (
                    !assignment ||
                    !assignment._id.equals(assignmentId) ||
                    assignment.fingerprint !== publication.assignment.fingerprint ||
                    !assignment.schoolId.equals(input.schoolId)
                ) {
                    throw new ExamNetworkConfigError('exam_seat_assignment_changed');
                }
                if (isExamSeatAssignmentV2(assignment)) {
                    throw new ExamNetworkConfigError('exam_seat_assignment_v2_not_enabled');
                }
                const classroom = await examClassroomService.get(input.domainId, assignment.classroomId);
                if (!classroom || !classroom.schoolId.equals(input.schoolId)) {
                    throw new ExamNetworkConfigError('seat_binding_invalid');
                }
                if (classroom.layoutRevision !== assignment.layoutRevision) {
                    throw new ExamNetworkConfigError('exam_seat_layout_changed');
                }
                const layout = examClassroomService.layout(classroom, assignment.layoutRevision).snapshot;
                if (layout.fingerprint !== assignment.layoutFingerprint) {
                    throw new ExamNetworkConfigError('exam_seat_layout_changed');
                }
                const currentSeatIds = new Set(layout.seats.map((seat) => seat.sourceSeatId));
                const bindings = await endpointSeatBindingService.listClassroomBindings(input.domainId, assignment.classroomId);
                const activeBindings = bindings.filter((binding) => binding.status === 'active' && binding.endpointId);
                if (new Set(activeBindings.map((binding) => binding.sourceSeatId)).size !== activeBindings.length) {
                    throw new ExamNetworkConfigError('seat_binding_invalid');
                }
                const bindingBySeat = new Map(activeBindings.map((binding) => [binding.sourceSeatId, binding]));
                for (const mapping of assignment.assignments) {
                    const binding = bindingBySeat.get(mapping.sourceSeatId);
                    if (
                        !currentSeatIds.has(mapping.sourceSeatId) ||
                        !binding ||
                        !binding.endpointId ||
                        binding.domainId !== input.domainId ||
                        !binding.schoolId.equals(input.schoolId) ||
                        !binding.classroomId.equals(assignment.classroomId)
                    ) {
                        throw new ExamNetworkConfigError('seat_binding_not_active');
                    }
                    sourceFacts.push({
                        kind: 'examSeat',
                        sourceId,
                        endpointId: binding.endpointId,
                        bindingId: binding._id.toHexString(),
                        bindingRevision: binding.revision,
                        classroomId: assignment.classroomId.toHexString(),
                        sourceSeatId: mapping.sourceSeatId,
                        assignmentRevision: assignment.revision,
                        assignmentFingerprint: assignment.fingerprint,
                        publicationRevision: publication.revision,
                        boundUserId: mapping.boundUserId,
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
        canonicalCompare(`${left.kind}\0${left.sourceId}\0${left.endpointId}`, `${right.kind}\0${right.sourceId}\0${right.endpointId}`),
    );
    const endpointIds = sourceFacts.map((fact) => fact.endpointId).sort(canonicalCompare);
    if (!endpointIds.length) throw new ExamNetworkConfigError('empty_target');
    if (new Set(endpointIds).size !== endpointIds.length) {
        throw new ExamNetworkConfigError('duplicate_endpoint');
    }
    const [batches, registrations] = await Promise.all([
        endpointEnrollmentBatchColl.find({ 'claims.endpointId': { $in: endpointIds } }).toArray(),
        endpointRegistrationColl.find({ endpointId: { $in: endpointIds } }).toArray(),
    ]);
    const legacyOwnershipFacts = batches.flatMap((batch) =>
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
    const automaticOwnershipFacts = registrations.map((registration) => ({
        endpointId: registration.endpointId,
        domainId: registration.domainId,
        registrationId: registration._id.toHexString(),
        machineFingerprint: registration.machineFingerprint,
        finalizedAt: registration.registeredAt,
        revision: registration.revision,
    }));
    const ownershipFacts = [...legacyOwnershipFacts, ...automaticOwnershipFacts];
    ownershipFacts.sort((left, right) => canonicalCompare(left.endpointId, right.endpointId));
    if (
        ownershipFacts.length !== endpointIds.length ||
        new Set(ownershipFacts.map((fact) => fact.endpointId)).size !== endpointIds.length ||
        ownershipFacts.some(
            (fact) =>
                !(fact.finalizedAt instanceof Date) ||
                !Number.isFinite(fact.finalizedAt.getTime()) ||
                fact.finalizedAt > observedAt ||
                fact.domainId !== input.domainId ||
                ('registrationId' in fact &&
                    (fact.revision !== 1 ||
                        !/^[a-f0-9]{64}$/.test(fact.machineFingerprint) ||
                        endpointIdForMachineFingerprint(fact.machineFingerprint) !== fact.endpointId)),
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
