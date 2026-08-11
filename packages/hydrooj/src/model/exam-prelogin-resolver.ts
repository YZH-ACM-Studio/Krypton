import { ObjectId } from 'mongodb';
import {
    createExamPreloginPreparation,
    ExamPreloginDiagnostic,
    ExamPreloginEndpointCapability,
    ExamPreloginEndpointFact,
    ExamPreloginPreparation,
    ExamPreloginWorkspace,
} from './exam-prelogin';

export interface ExamPreloginPreparationFacts {
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    eventType: 'external' | 'krypton';
    eventLifecycle: 'archived' | 'draft' | 'scheduled';
    eventEndAt: Date;
    schoolId: ObjectId;
    assignment: { assignmentId: ObjectId; revision: number; fingerprint: string };
    publicationRevision: number;
    workspace: ExamPreloginWorkspace | null;
    assignments: Array<{ uid: number; studentRecordId: ObjectId; sourceSeatId: string }>;
    students: Array<{ uid: number; studentRecordId: ObjectId | null; schoolId: ObjectId | null }>;
    bindings: Array<{
        sourceSeatId: string;
        bindingId: ObjectId;
        bindingRevision: number;
        endpointId: string;
        schoolId: ObjectId;
    }>;
    contestEligibility: Array<{ uid: number; eligible: boolean; reason?: string }>;
    endpointFacts: Array<{
        endpointId: string;
        online: boolean;
        serviceVersion: string | null;
        protocolVersion: number | null;
        capabilities: ExamPreloginEndpointCapability[];
        activeSessionId: string | null;
    }>;
    observedAt: Date;
}

export interface ExamPreloginEndpointReadiness {
    endpointId: string;
    online: boolean;
    compatible: boolean | null;
    serviceVersion: string | null;
    protocolVersion: number | null;
    capabilities: ExamPreloginEndpointCapability[];
    activeSessionId: string | null;
    resumableSessionId: string | null;
}

export interface ExamPreloginEndpointSubject {
    endpointId: string;
    uid: number;
    contestId: string | null;
    retry?: { batchId: string; ticketId: string };
}

export type ExamPreloginEndpointPreflight = (subjects: ExamPreloginEndpointSubject[]) => Promise<ExamPreloginEndpointReadiness[]>;

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function versionAtLeast(value: string | null, minimum: readonly [number, number, number]): boolean {
    if (value === null) return false;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) return false;
    const current = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
    for (let index = 0; index < minimum.length; index++) {
        if (current[index] !== minimum[index]) return current[index] > minimum[index];
    }
    return true;
}

function endpointSupportsPrelogin(endpoint: ExamPreloginEndpointFact): boolean {
    return endpoint.capabilities.some(
        (capability) =>
            capability.name === 'exam.prelogin' &&
            capability.version === 1 &&
            capability.commands.length === 1 &&
            capability.commands[0] === 'launch_prelogin',
    );
}

function diagnostic(code: ExamPreloginDiagnostic['code']): ExamPreloginDiagnostic {
    return { code, severity: 'error' };
}

function unavailableEndpoint(): ExamPreloginEndpointFact {
    return {
        online: false,
        serviceVersion: null,
        protocolVersion: null,
        capabilities: [],
        activeSessionId: null,
    };
}

export function compileExamPreloginPreparation(facts: ExamPreloginPreparationFacts): ExamPreloginPreparation {
    if (
        !facts.domainId ||
        !(facts.eventId instanceof ObjectId) ||
        !(facts.schoolId instanceof ObjectId) ||
        !(facts.assignment.assignmentId instanceof ObjectId) ||
        !Number.isSafeInteger(facts.eventRevision) ||
        facts.eventRevision < 1 ||
        !Number.isSafeInteger(facts.assignment.revision) ||
        facts.assignment.revision < 1 ||
        !/^[a-f0-9]{64}$/.test(facts.assignment.fingerprint) ||
        !Number.isSafeInteger(facts.publicationRevision) ||
        facts.publicationRevision < 1 ||
        !(facts.eventEndAt instanceof Date) ||
        !Number.isFinite(facts.eventEndAt.getTime()) ||
        !(facts.observedAt instanceof Date) ||
        !Number.isFinite(facts.observedAt.getTime()) ||
        !Array.isArray(facts.assignments) ||
        !facts.assignments.length ||
        facts.assignments.length > 500
    ) {
        throw new TypeError('exam prelogin facts are invalid');
    }
    const studentsByUid = new Map(facts.students.map((student) => [student.uid, student]));
    const bindingsBySeat = new Map(facts.bindings.map((binding) => [binding.sourceSeatId, binding]));
    const eligibilityByUid = new Map(facts.contestEligibility.map((eligibility) => [eligibility.uid, eligibility]));
    const endpointsById = new Map(facts.endpointFacts.map((endpoint) => [endpoint.endpointId, endpoint]));
    if (
        studentsByUid.size !== facts.students.length ||
        bindingsBySeat.size !== facts.bindings.length ||
        eligibilityByUid.size !== facts.contestEligibility.length ||
        endpointsById.size !== facts.endpointFacts.length
    ) {
        throw new TypeError('exam prelogin facts contain duplicate identities');
    }
    const globalDiagnostics: ExamPreloginDiagnostic[] = [];
    if (facts.eventLifecycle !== 'scheduled' || facts.observedAt >= facts.eventEndAt) {
        globalDiagnostics.push(diagnostic('contest_not_enterable'));
    }
    if (facts.eventType !== 'krypton' || facts.workspace === null) {
        globalDiagnostics.push(diagnostic('external_workspace_unavailable'));
    }

    const items = [...facts.assignments]
        .sort((left, right) => left.uid - right.uid)
        .map((assignment) => {
            if (
                !Number.isSafeInteger(assignment.uid) ||
                assignment.uid <= 1 ||
                !(assignment.studentRecordId instanceof ObjectId) ||
                typeof assignment.sourceSeatId !== 'string' ||
                !assignment.sourceSeatId
            ) {
                throw new TypeError('exam prelogin assignment fact is invalid');
            }
            const diagnostics = [...globalDiagnostics];
            const student = studentsByUid.get(assignment.uid);
            if (
                !student ||
                !(student.studentRecordId instanceof ObjectId) ||
                !student.studentRecordId.equals(assignment.studentRecordId) ||
                !(student.schoolId instanceof ObjectId) ||
                !student.schoolId.equals(facts.schoolId)
            ) {
                diagnostics.push(diagnostic('user_binding_changed'));
            }
            const binding = bindingsBySeat.get(assignment.sourceSeatId);
            const validBinding =
                binding &&
                binding.bindingId instanceof ObjectId &&
                Number.isSafeInteger(binding.bindingRevision) &&
                binding.bindingRevision > 0 &&
                typeof binding.endpointId === 'string' &&
                !!binding.endpointId &&
                binding.schoolId instanceof ObjectId &&
                binding.schoolId.equals(facts.schoolId);
            if (!validBinding) diagnostics.push(diagnostic('seat_binding_changed'));
            const endpoint = validBinding ? endpointsById.get(binding.endpointId) || unavailableEndpoint() : unavailableEndpoint();
            if (validBinding) {
                if (!endpoint.online) diagnostics.push(diagnostic('endpoint_offline'));
                if (endpoint.protocolVersion !== 2 || !versionAtLeast(endpoint.serviceVersion, [0, 5, 0])) {
                    diagnostics.push(diagnostic('endpoint_incompatible'));
                }
                if (!endpointSupportsPrelogin(endpoint)) diagnostics.push(diagnostic('endpoint_capability_missing'));
                if (endpoint.activeSessionId !== null) diagnostics.push(diagnostic('active_session_conflict'));
            }
            const eligibility = eligibilityByUid.get(assignment.uid);
            if (!eligibility?.eligible) diagnostics.push(diagnostic('contest_not_enterable'));
            const canonicalDiagnostics = Array.from(new Map(diagnostics.map((item) => [item.code, item])).values()).sort((left, right) =>
                compareText(left.code, right.code),
            );
            return {
                uid: assignment.uid,
                studentRecordId: new ObjectId(assignment.studentRecordId),
                sourceSeatId: assignment.sourceSeatId,
                bindingId: validBinding ? new ObjectId(binding.bindingId) : null,
                bindingRevision: validBinding ? binding.bindingRevision : null,
                endpointId: validBinding ? binding.endpointId : null,
                ready: !canonicalDiagnostics.some((item) => item.severity === 'error'),
                diagnostics: canonicalDiagnostics,
                endpoint: {
                    online: endpoint.online,
                    serviceVersion: endpoint.serviceVersion,
                    protocolVersion: endpoint.protocolVersion,
                    capabilities: endpoint.capabilities,
                    activeSessionId: endpoint.activeSessionId,
                },
            };
        });
    const hardErrorCount = items.reduce(
        (count, item) => count + item.diagnostics.filter((entryDiagnostic) => entryDiagnostic.severity === 'error').length,
        0,
    );
    const warningCount = items.reduce(
        (count, item) => count + item.diagnostics.filter((entryDiagnostic) => entryDiagnostic.severity === 'warning').length,
        0,
    );
    return createExamPreloginPreparation({
        schemaVersion: 1,
        domainId: facts.domainId,
        eventId: new ObjectId(facts.eventId),
        eventRevision: facts.eventRevision,
        assignment: {
            assignmentId: new ObjectId(facts.assignment.assignmentId),
            revision: facts.assignment.revision,
            fingerprint: facts.assignment.fingerprint,
        },
        publicationRevision: facts.publicationRevision,
        workspace: facts.workspace,
        items,
        hardErrorCount,
        warningCount,
    });
}
