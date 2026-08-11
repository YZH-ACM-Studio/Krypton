import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
    ExamNetworkConfigError,
    ExamTargetResolution,
    ExamTargetResolverInput,
} from '../model/exam-network-config';
import { endpointEnrollmentBatchColl } from '../model/endpoint-enrollment';
import { preflightExamNetworkOnVigil } from '../service/vigil-bridge';

function fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export async function resolveExamTargetSources(input: ExamTargetResolverInput): Promise<ExamTargetResolution> {
    if (input.sources.some((source) => source.kind !== 'endpoint')) {
        throw new ExamNetworkConfigError('target_source_not_available');
    }
    const endpointIds = input.sources.flatMap((source) => source.ids).sort();
    if (!endpointIds.length || new Set(endpointIds).size !== endpointIds.length) {
        throw new ExamNetworkConfigError('invalid_endpoint');
    }
    const batches = await endpointEnrollmentBatchColl
        .find({ domainId: input.domainId, 'claims.endpointId': { $in: endpointIds } })
        .toArray();
    const ownershipFacts = batches.flatMap((batch) =>
        batch.claims
            .filter((claim) => claim.endpointId && endpointIds.includes(claim.endpointId))
            .map((claim) => ({
                endpointId: claim.endpointId!,
                batchId: batch._id.toHexString(),
                claimId: claim.claimId,
                finalizedAt: claim.finalizedAt?.toISOString() || null,
            })),
    );
    ownershipFacts.sort((left, right) => left.endpointId.localeCompare(right.endpointId));
    if (
        ownershipFacts.length !== endpointIds.length ||
        new Set(ownershipFacts.map((fact) => fact.endpointId)).size !== endpointIds.length ||
        ownershipFacts.some((fact) => !fact.finalizedAt)
    ) {
        throw new ExamNetworkConfigError('endpoint_not_owned');
    }
    const preflight = await preflightExamNetworkOnVigil(endpointIds);
    const byEndpoint = new Map(preflight.map((item) => [item.endpointId, item]));
    const endpoints = endpointIds.map((endpointId) => {
        const item = byEndpoint.get(endpointId);
        if (!item || item.credentialStatus !== 'active') throw new ExamNetworkConfigError('endpoint_not_active');
        if (item.compatible === false) throw new ExamNetworkConfigError('endpoint_protocol_incompatible');
        return {
            endpointId,
            // Explicit endpoint sources are domain-owned. Classroom/seat
            // school ownership enters through those future canonical source
            // resolvers instead of being guessed here.
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
            ownershipFacts,
            endpoints: endpoints.map((endpoint) => ({
                endpointId: endpoint.endpointId,
                capabilities: endpoint.capabilities,
            })),
        }),
        endpoints,
    };
}
