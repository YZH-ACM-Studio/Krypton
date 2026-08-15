import { createHmac } from 'node:crypto';
import type {
    ExamSeatAssignmentParticipantFact,
    ExamSeatAssignmentRiskEdge,
    ExamSeatAssignmentStrategy,
    ExamSeatAssignmentV2Explanation,
    ExamSeatAssignmentV2Mapping,
    ExamSeatAssignmentV2SeatFact,
    ExamSeatIdentity,
} from './exam-seat-assignment';
import type { ExamSeatPlanClassroomRef } from './exam-seat-plan';

const RISK_RADIUS = 1.6;
export const EXAM_SEAT_RISK_NEIGHBORS_PER_SEAT = 8;
export const EXAM_SEAT_MAX_RISK_EDGES = 500 * EXAM_SEAT_RISK_NEIGHBORS_PER_SEAT;
const GREEDY_ATTEMPTS = 4;
const CLASSROOM_SET_CANDIDATES = 4;
const CROSS_CLASSROOM_TEAM_DISTANCE = 1_000;

interface SeatPairFact {
    distance: number;
    level: 'high' | 'medium' | 'none';
    reason: ExamSeatAssignmentRiskEdge['reason'] | null;
}

interface AllocationCandidate {
    assignments: ExamSeatAssignmentV2Mapping[];
    explanation: ExamSeatAssignmentV2Explanation;
    score: number[];
}

interface SeatAggregate {
    highRisk: number;
    mediumRisk: number;
    spacingPenalty: number;
}

export interface SpatialAllocationInput {
    classrooms: ExamSeatPlanClassroomRef[];
    participants: ExamSeatAssignmentParticipantFact[];
    seatFacts: ExamSeatAssignmentV2SeatFact[];
    strategy: ExamSeatAssignmentStrategy;
    seed: string;
    fixedAssignments: ExamSeatAssignmentV2Mapping[];
}

export interface SpatialExplanationInput {
    classrooms: ExamSeatPlanClassroomRef[];
    participants: ExamSeatAssignmentParticipantFact[];
    seatFacts: ExamSeatAssignmentV2SeatFact[];
    assignments: ExamSeatAssignmentV2Mapping[];
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function seatKey(seat: ExamSeatIdentity): string {
    return `${seat.classroomId.toHexString()}\u0000${seat.sourceSeatId}`;
}

function pairKey(left: ExamSeatIdentity, right: ExamSeatIdentity): string {
    const keys = [seatKey(left), seatKey(right)].sort(compareText);
    return `${keys[0]}\u0001${keys[1]}`;
}

function identity(seat: ExamSeatIdentity): ExamSeatIdentity {
    return { classroomId: seat.classroomId, sourceSeatId: seat.sourceSeatId };
}

function seededRank(seed: string, stream: string, value: string): string {
    return createHmac('sha256', Buffer.from(seed, 'hex')).update(`${stream}\u0000${value}`, 'utf8').digest('hex');
}

function rounded(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function center(seat: ExamSeatAssignmentV2SeatFact): { x: number; y: number } {
    return {
        x: seat.x + (seat.width === null ? 0 : seat.width / 2),
        y: seat.y + (seat.height === null ? 0 : seat.height / 2),
    };
}

function centerDistance(left: ExamSeatAssignmentV2SeatFact, right: ExamSeatAssignmentV2SeatFact): number {
    const leftCenter = center(left);
    const rightCenter = center(right);
    return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
}

function median(values: number[]): number {
    if (!values.length) return 1;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function classroomSpacing(seats: ExamSeatAssignmentV2SeatFact[]): number {
    const nearest = seats.flatMap((seat, index) => {
        let best = Number.POSITIVE_INFINITY;
        for (let other = 0; other < seats.length; other++) {
            if (other === index) continue;
            const distance = centerDistance(seat, seats[other]);
            if (distance > 0 && distance < best) best = distance;
        }
        return Number.isFinite(best) ? [best] : [];
    });
    const footprints = seats.flatMap((seat) =>
        seat.width === null ||
        seat.height === null ||
        seat.width <= 0 ||
        seat.height <= 0 ||
        !Number.isFinite(seat.width) ||
        !Number.isFinite(seat.height)
            ? []
            : [Math.hypot(seat.width, seat.height)],
    );
    const nearestSpacing = nearest.length ? median(nearest) : null;
    const footprintSpacing = footprints.length ? median(footprints) : null;
    if (nearestSpacing !== null && footprintSpacing !== null) return Math.min(nearestSpacing, footprintSpacing);
    if (nearestSpacing !== null) return nearestSpacing;
    if (footprintSpacing !== null) return footprintSpacing;
    return 1;
}

function oppositeFacing(left: ExamSeatAssignmentV2SeatFact['facing'], right: ExamSeatAssignmentV2SeatFact['facing']): boolean {
    return (
        (left === 'left' && right === 'right') ||
        (left === 'right' && right === 'left') ||
        (left === 'up' && right === 'down') ||
        (left === 'down' && right === 'up')
    );
}

function riskReason(
    left: ExamSeatAssignmentV2SeatFact['facing'],
    right: ExamSeatAssignmentV2SeatFact['facing'],
): { level: SeatPairFact['level']; reason: SeatPairFact['reason'] } {
    if (left === 'unset' || right === 'unset') return { level: 'high', reason: 'unset_facing' };
    if (oppositeFacing(left, right)) return { level: 'none', reason: null };
    if (left === right) return { level: 'high', reason: 'same_facing' };
    return { level: 'medium', reason: 'perpendicular_facing' };
}

function pairFacts(seatFacts: ExamSeatAssignmentV2SeatFact[]): Map<string, SeatPairFact> {
    const result = new Map<string, SeatPairFact>();
    const byClassroom = new Map<string, ExamSeatAssignmentV2SeatFact[]>();
    for (const seat of seatFacts) {
        const classroomId = seat.classroomId.toHexString();
        const rows = byClassroom.get(classroomId) || [];
        rows.push(seat);
        byClassroom.set(classroomId, rows);
    }
    for (const seats of byClassroom.values()) {
        const spacing = classroomSpacing(seats);
        const classroomPairs: Array<{
            key: string;
            left: ExamSeatAssignmentV2SeatFact;
            right: ExamSeatAssignmentV2SeatFact;
            distance: number;
            risk: ReturnType<typeof riskReason>;
        }> = [];
        for (let leftIndex = 0; leftIndex < seats.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < seats.length; rightIndex++) {
                const left = seats[leftIndex];
                const right = seats[rightIndex];
                const distance = rounded(centerDistance(left, right) / spacing);
                const risk = riskReason(left.facing, right.facing);
                classroomPairs.push({ key: pairKey(left, right), left, right, distance, risk });
            }
        }
        const pairsBySeat = new Map<string, typeof classroomPairs>();
        for (const pair of classroomPairs) {
            for (const seat of [pair.left, pair.right]) {
                const key = seatKey(seat);
                const rows = pairsBySeat.get(key) || [];
                rows.push(pair);
                pairsBySeat.set(key, rows);
            }
        }
        const localPairKeys = new Set<string>();
        for (const rows of pairsBySeat.values()) {
            rows
                .sort((left, right) => left.distance - right.distance || compareText(left.key, right.key))
                .slice(0, EXAM_SEAT_RISK_NEIGHBORS_PER_SEAT)
                .forEach((pair) => localPairKeys.add(pair.key));
        }
        for (const pair of classroomPairs) {
            result.set(pair.key, {
                distance: pair.distance,
                level: pair.distance <= RISK_RADIUS && localPairKeys.has(pair.key) ? pair.risk.level : 'none',
                reason: pair.risk.reason,
            });
        }
    }
    return result;
}

function eligible(seat: ExamSeatAssignmentV2SeatFact): boolean {
    return seat.enabled && ['active', 'empty'].includes(seat.layoutStatus) && seat.bindingId !== null && seat.endpointId !== null;
}

function sameTeam(left: ExamSeatAssignmentParticipantFact, right: ExamSeatAssignmentParticipantFact): boolean {
    return left.teamId !== null && left.teamId === right.teamId;
}

function compareScore(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] || 0) - (right[index] || 0);
        if (Math.abs(difference) > 1e-9) return difference < 0 ? -1 : 1;
    }
    return 0;
}

function selectMinimizedClassroomCandidates(
    input: SpatialAllocationInput,
    eligibleSeats: ExamSeatAssignmentV2SeatFact[],
): Set<string>[] {
    const capacity = new Map<string, number>();
    for (const seat of eligibleSeats) {
        const classroomId = seat.classroomId.toHexString();
        capacity.set(classroomId, (capacity.get(classroomId) || 0) + 1);
    }
    const selected = new Set(input.fixedAssignments.map((mapping) => mapping.seat.classroomId.toHexString()));
    let total = [...selected].reduce((count, classroomId) => count + (capacity.get(classroomId) || 0), 0);
    const remaining = [...capacity.keys()]
        .filter((classroomId) => !selected.has(classroomId))
        .sort(
            (left, right) =>
                (capacity.get(right) || 0) - (capacity.get(left) || 0) ||
                compareText(seededRank(input.seed, 'classroom', left), seededRank(input.seed, 'classroom', right)) ||
                compareText(left, right),
        );
    for (const classroomId of remaining) {
        if (total >= input.participants.length) break;
        selected.add(classroomId);
        total += capacity.get(classroomId) || 0;
    }
    const capacityOf = (classrooms: Set<string>) =>
        [...classrooms].reduce((count, classroomId) => count + (capacity.get(classroomId) || 0), 0);
    const selectionKey = (classrooms: Set<string>) => [...classrooms].sort(compareText).join('\u0000');
    const fixedClassrooms = new Set(input.fixedAssignments.map((mapping) => mapping.seat.classroomId.toHexString()));
    const candidates = [selected];
    const seen = new Set([selectionKey(selected)]);
    for (let candidateIndex = 0; candidateIndex < candidates.length && candidates.length < CLASSROOM_SET_CANDIDATES; candidateIndex++) {
        const current = candidates[candidateIndex];
        const replaceable = [...current].filter((classroomId) => !fixedClassrooms.has(classroomId)).sort(compareText);
        const alternatives = [...capacity.keys()]
            .filter((classroomId) => !current.has(classroomId))
            .sort(
                (left, right) =>
                    compareText(seededRank(input.seed, 'classroom-alternative', left), seededRank(input.seed, 'classroom-alternative', right)) ||
                    compareText(left, right),
            );
        for (const removed of replaceable) {
            for (const added of alternatives) {
                const alternative = new Set(current);
                alternative.delete(removed);
                alternative.add(added);
                if (capacityOf(alternative) < input.participants.length) continue;
                const key = selectionKey(alternative);
                if (seen.has(key)) continue;
                seen.add(key);
                candidates.push(alternative);
                if (candidates.length >= CLASSROOM_SET_CANDIDATES) break;
            }
            if (candidates.length >= CLASSROOM_SET_CANDIDATES) break;
        }
    }
    return candidates;
}

function participantUnits(
    participants: ExamSeatAssignmentParticipantFact[],
    seed: string,
    attempt: number,
    plannedTeamRooms: Map<string, string>,
) {
    const units = new Map<string, ExamSeatAssignmentParticipantFact[]>();
    for (const participant of participants) {
        const key = participant.teamId === null ? `solo:${participant.boundUserId}` : `team:${participant.teamId}`;
        const rows = units.get(key) || [];
        rows.push(participant);
        units.set(key, rows);
    }
    return [...units.entries()]
        .map(([key, rows]) => ({
            key,
            participants: [...rows].sort(
                (left, right) =>
                    Number(right.teamRole === 'captain') - Number(left.teamRole === 'captain') ||
                    compareText(
                        seededRank(seed, `member:${attempt}`, String(left.boundUserId)),
                        seededRank(seed, `member:${attempt}`, String(right.boundUserId)),
                    ) ||
                    left.boundUserId - right.boundUserId,
            ),
        }))
        .sort(
            (left, right) =>
                Number(plannedTeamRooms.has(right.participants[0]?.teamId || '')) -
                    Number(plannedTeamRooms.has(left.participants[0]?.teamId || '')) ||
                right.participants.length - left.participants.length ||
                compareText(seededRank(seed, `unit:${attempt}`, left.key), seededRank(seed, `unit:${attempt}`, right.key)) ||
                compareText(left.key, right.key),
        );
}

function planWholeTeamRooms(
    input: SpatialAllocationInput,
    eligibleSeats: ExamSeatAssignmentV2SeatFact[],
): Map<string, string> {
    const residualCapacity = new Map<string, number>();
    for (const seat of eligibleSeats) {
        const classroomId = seat.classroomId.toHexString();
        residualCapacity.set(classroomId, (residualCapacity.get(classroomId) || 0) + 1);
    }
    const fixedByUid = new Map(input.fixedAssignments.map((mapping) => [mapping.boundUserId, mapping]));
    for (const mapping of input.fixedAssignments) {
        const classroomId = mapping.seat.classroomId.toHexString();
        residualCapacity.set(classroomId, (residualCapacity.get(classroomId) || 0) - 1);
    }
    const teams = new Map<string, ExamSeatAssignmentParticipantFact[]>();
    for (const participant of input.participants) {
        if (participant.teamId === null) continue;
        const rows = teams.get(participant.teamId) || [];
        rows.push(participant);
        teams.set(participant.teamId, rows);
    }
    const roomByTeam = new Map<string, string>();
    const flexibleTeams: Array<{ teamId: string; size: 2 | 3 }> = [];
    const partialFixedTeams = new Map<string, Array<{ teamId: string; required: number }>>();
    for (const [teamId, members] of [...teams.entries()].sort(([left], [right]) => compareText(left, right))) {
        const fixedRooms = new Set(
            members.flatMap((member) => {
                const mapping = fixedByUid.get(member.boundUserId);
                return mapping ? [mapping.seat.classroomId.toHexString()] : [];
            }),
        );
        if (fixedRooms.size > 1) continue;
        if (fixedRooms.size === 1) {
            const classroomId = [...fixedRooms][0];
            const required = members.filter((member) => !fixedByUid.has(member.boundUserId)).length;
            if (!required) roomByTeam.set(teamId, classroomId);
            else {
                const rows = partialFixedTeams.get(classroomId) || [];
                rows.push({ teamId, required });
                partialFixedTeams.set(classroomId, rows);
            }
            continue;
        }
        if (members.length >= 2) flexibleTeams.push({ teamId, size: members.length as 2 | 3 });
    }
    for (const [classroomId, candidates] of [...partialFixedTeams.entries()].sort(([left], [right]) => compareText(left, right))) {
        let capacity = Math.max(0, residualCapacity.get(classroomId) || 0);
        for (const candidate of [...candidates].sort(
            (left, right) =>
                left.required - right.required ||
                compareText(seededRank(input.seed, `partial-team-pack:${classroomId}`, left.teamId), seededRank(input.seed, `partial-team-pack:${classroomId}`, right.teamId)) ||
                compareText(left.teamId, right.teamId),
        )) {
            if (candidate.required > capacity) continue;
            roomByTeam.set(candidate.teamId, classroomId);
            capacity -= candidate.required;
        }
        residualCapacity.set(classroomId, capacity);
    }

    const threePersonTeams = flexibleTeams
        .filter((team) => team.size === 3)
        .sort(
            (left, right) =>
                compareText(seededRank(input.seed, 'team-pack-3', left.teamId), seededRank(input.seed, 'team-pack-3', right.teamId)) ||
                compareText(left.teamId, right.teamId),
        );
    const twoPersonTeams = flexibleTeams
        .filter((team) => team.size === 2)
        .sort(
            (left, right) =>
                compareText(seededRank(input.seed, 'team-pack-2', left.teamId), seededRank(input.seed, 'team-pack-2', right.teamId)) ||
                compareText(left.teamId, right.teamId),
        );
    const rooms = [...residualCapacity.entries()]
        .filter(([, capacity]) => capacity > 0)
        .sort(
            ([left], [right]) =>
                compareText(seededRank(input.seed, 'team-pack-room', left), seededRank(input.seed, 'team-pack-room', right)) ||
                compareText(left, right),
        );
    interface PackingStep {
        previousThree: number;
        threeInRoom: number;
        twoCapacity: number;
    }
    const layers: Array<Map<number, PackingStep>> = [new Map([[0, { previousThree: 0, threeInRoom: 0, twoCapacity: 0 }]])];
    for (const [, capacity] of rooms) {
        const previous = layers[layers.length - 1];
        const next = new Map<number, PackingStep>();
        for (const [usedThree, state] of previous) {
            const remainingThree = threePersonTeams.length - usedThree;
            for (let threeInRoom = 0; threeInRoom <= Math.min(Math.floor(capacity / 3), remainingThree); threeInRoom++) {
                const totalThree = usedThree + threeInRoom;
                const twoCapacity = Math.min(
                    twoPersonTeams.length,
                    state.twoCapacity + Math.floor((capacity - threeInRoom * 3) / 2),
                );
                const current = next.get(totalThree);
                if (!current || twoCapacity > current.twoCapacity) {
                    next.set(totalThree, { previousThree: usedThree, threeInRoom, twoCapacity });
                }
            }
        }
        layers.push(next);
    }
    let selectedThree = 0;
    let selectedTwo = 0;
    for (const [usedThree, state] of layers[layers.length - 1]) {
        const usedTwo = Math.min(state.twoCapacity, twoPersonTeams.length);
        const selectedTeamCount = selectedThree + selectedTwo;
        const candidateTeamCount = usedThree + usedTwo;
        const selectedMemberCount = selectedThree * 3 + selectedTwo * 2;
        const candidateMemberCount = usedThree * 3 + usedTwo * 2;
        if (candidateTeamCount > selectedTeamCount || (candidateTeamCount === selectedTeamCount && candidateMemberCount > selectedMemberCount)) {
            selectedThree = usedThree;
            selectedTwo = usedTwo;
        }
    }

    const threeCounts = Array.from({ length: rooms.length }, () => 0);
    let usedThree = selectedThree;
    for (let roomIndex = rooms.length - 1; roomIndex >= 0; roomIndex--) {
        const step = layers[roomIndex + 1].get(usedThree)!;
        threeCounts[roomIndex] = step.threeInRoom;
        usedThree = step.previousThree;
    }
    let threeIndex = 0;
    let twoIndex = 0;
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
        const [classroomId, capacity] = rooms[roomIndex];
        for (let count = 0; count < threeCounts[roomIndex]; count++) {
            roomByTeam.set(threePersonTeams[threeIndex++].teamId, classroomId);
        }
        const availableForTwo = Math.floor((capacity - threeCounts[roomIndex] * 3) / 2);
        for (let count = 0; count < availableForTwo && twoIndex < selectedTwo; count++) {
            roomByTeam.set(twoPersonTeams[twoIndex++].teamId, classroomId);
        }
    }
    return roomByTeam;
}

function candidateScore(input: {
    participant: ExamSeatAssignmentParticipantFact;
    seat: ExamSeatAssignmentV2SeatFact;
    assignedByTeam: Map<string, ExamSeatAssignmentV2SeatFact[]>;
    aggregates: Map<string, SeatAggregate>;
    pairBySeat: Map<string, SeatPairFact>;
    seed: string;
    attempt: number;
}): number[] {
    let splitTeam = 0;
    let teamDistance = 0;
    const aggregate = input.aggregates.get(seatKey(input.seat)) || { highRisk: 0, mediumRisk: 0, spacingPenalty: 0 };
    let highRisk = aggregate.highRisk;
    let mediumRisk = aggregate.mediumRisk;
    let spacingPenalty = aggregate.spacingPenalty;
    const teammates = input.participant.teamId === null ? [] : input.assignedByTeam.get(input.participant.teamId) || [];
    for (const assignedSeat of teammates) {
        if (!assignedSeat.classroomId.equals(input.seat.classroomId)) {
            splitTeam = 1;
            teamDistance += CROSS_CLASSROOM_TEAM_DISTANCE;
            continue;
        }
        const pair = input.pairBySeat.get(pairKey(assignedSeat, input.seat));
        if (!pair) continue;
        teamDistance += pair.distance;
        const attenuation = Math.max(0, RISK_RADIUS - pair.distance + 0.1);
        if (pair.level === 'high') highRisk -= attenuation;
        else if (pair.level === 'medium') mediumRisk -= attenuation;
        if (pair.reason !== null) spacingPenalty -= 1 / (1 + pair.distance);
    }
    return [splitTeam, teamDistance, rounded(highRisk), rounded(mediumRisk), rounded(spacingPenalty)];
}

function bestSeat(
    seats: ExamSeatAssignmentV2SeatFact[],
    input: Parameters<typeof candidateScore>[0],
): ExamSeatAssignmentV2SeatFact {
    let best: { seat: ExamSeatAssignmentV2SeatFact; score: number[]; rank: string | null } | null = null;
    const rank = (seat: ExamSeatAssignmentV2SeatFact) =>
        seededRank(input.seed, `seat:${input.attempt}:${input.participant.boundUserId}`, seatKey(seat));
    for (const seat of seats) {
        const score = candidateScore({ ...input, seat });
        if (!best || compareScore(score, best.score) < 0) {
            best = { seat, score, rank: null };
            continue;
        }
        if (compareScore(score, best.score) === 0) {
            const candidateRank = rank(seat);
            const bestRank = best.rank || rank(best.seat);
            if (
                compareText(candidateRank, bestRank) < 0 ||
                (candidateRank === bestRank && compareText(seatKey(seat), seatKey(best.seat)) < 0)
            ) {
                best = { seat, score, rank: candidateRank };
            } else {
                best.rank = bestRank;
            }
        }
    }
    if (!best) throw new Error('spatial allocation exhausted its eligible seat pool');
    return best.seat;
}

function chooseTeamClassroom(input: {
    unit: ExamSeatAssignmentParticipantFact[];
    remaining: ExamSeatAssignmentV2SeatFact[];
    assigned: Map<number, ExamSeatAssignmentV2SeatFact>;
    assignedByTeam: Map<string, ExamSeatAssignmentV2SeatFact[]>;
    aggregates: Map<string, SeatAggregate>;
    pairBySeat: Map<string, SeatPairFact>;
    seed: string;
    attempt: number;
}): string | null {
    if (input.unit[0]?.teamId === null) return null;
    const fixedRooms = new Set(
        input.unit.flatMap((participant) => {
            const seat = input.assigned.get(participant.boundUserId);
            return seat ? [seat.classroomId.toHexString()] : [];
        }),
    );
    const unassigned = input.unit.filter((participant) => !input.assigned.has(participant.boundUserId));
    if (!unassigned.length) return null;
    if (fixedRooms.size === 1) {
        const classroomId = [...fixedRooms][0];
        if (input.remaining.filter((seat) => seat.classroomId.toHexString() === classroomId).length >= unassigned.length) return classroomId;
        return null;
    }
    if (fixedRooms.size > 1) return null;
    const candidates = new Map<string, ExamSeatAssignmentV2SeatFact[]>();
    for (const seat of input.remaining) {
        const classroomId = seat.classroomId.toHexString();
        const rows = candidates.get(classroomId) || [];
        rows.push(seat);
        candidates.set(classroomId, rows);
    }
    const viable = [...candidates.entries()].filter(([, seats]) => seats.length >= unassigned.length);
    let best: { classroomId: string; score: number[]; rank: string } | null = null;
    for (const [classroomId, seats] of viable) {
        const seat = bestSeat(seats, {
            participant: unassigned[0],
            seat: seats[0],
            assignedByTeam: input.assignedByTeam,
            aggregates: input.aggregates,
            pairBySeat: input.pairBySeat,
            seed: input.seed,
            attempt: input.attempt,
        });
        const score = candidateScore({
            participant: unassigned[0],
            seat,
            assignedByTeam: input.assignedByTeam,
            aggregates: input.aggregates,
            pairBySeat: input.pairBySeat,
            seed: input.seed,
            attempt: input.attempt,
        });
        const rank = seededRank(input.seed, `team-room:${input.attempt}:${input.unit[0].teamId}`, classroomId);
        if (
            !best ||
            compareScore(score, best.score) < 0 ||
            (compareScore(score, best.score) === 0 &&
                (compareText(rank, best.rank) < 0 || (rank === best.rank && compareText(classroomId, best.classroomId) < 0)))
        ) {
            best = { classroomId, score, rank };
        }
    }
    return best?.classroomId || null;
}

function explanationFor(
    classrooms: ExamSeatPlanClassroomRef[],
    participants: ExamSeatAssignmentParticipantFact[],
    seatFacts: ExamSeatAssignmentV2SeatFact[],
    assignments: ExamSeatAssignmentV2Mapping[],
    pairBySeat: Map<string, SeatPairFact>,
): ExamSeatAssignmentV2Explanation {
    const participantByUid = new Map(participants.map((participant) => [participant.boundUserId, participant]));
    const assignedSeatKeys = new Set(assignments.map((assignment) => seatKey(assignment.seat)));
    const highRiskEdges: ExamSeatAssignmentRiskEdge[] = [];
    const mediumRiskEdges: ExamSeatAssignmentRiskEdge[] = [];
    for (let leftIndex = 0; leftIndex < assignments.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex++) {
            const leftAssignment = assignments[leftIndex];
            const rightAssignment = assignments[rightIndex];
            if (sameTeam(participantByUid.get(leftAssignment.boundUserId)!, participantByUid.get(rightAssignment.boundUserId)!)) continue;
            const pair = pairBySeat.get(pairKey(leftAssignment.seat, rightAssignment.seat));
            if (!pair || pair.level === 'none' || pair.reason === null) continue;
            const [left, right] = [identity(leftAssignment.seat), identity(rightAssignment.seat)].sort((first, second) =>
                compareText(seatKey(first), seatKey(second)),
            );
            const edge = { left, right, distance: pair.distance, reason: pair.reason };
            if (pair.level === 'high') highRiskEdges.push(edge);
            else mediumRiskEdges.push(edge);
        }
    }
    const edgeSort = (left: ExamSeatAssignmentRiskEdge, right: ExamSeatAssignmentRiskEdge) =>
        compareText(`${seatKey(left.left)}\u0001${seatKey(left.right)}\u0001${left.reason}`, `${seatKey(right.left)}\u0001${seatKey(right.right)}\u0001${right.reason}`);
    highRiskEdges.sort(edgeSort);
    mediumRiskEdges.sort(edgeSort);

    const teams = new Map<string, Set<string>>();
    for (const assignment of assignments) {
        const participant = participantByUid.get(assignment.boundUserId)!;
        if (participant.teamId === null) continue;
        const rooms = teams.get(participant.teamId) || new Set<string>();
        rooms.add(assignment.seat.classroomId.toHexString());
        teams.set(participant.teamId, rooms);
    }
    const skippedSeats = seatFacts
        .flatMap((seat) => {
            if (seat.enabled && ['active', 'empty'].includes(seat.layoutStatus) && seat.bindingId !== null && seat.endpointId !== null) return [];
            const reason = !seat.enabled ? 'disabled' : !['active', 'empty'].includes(seat.layoutStatus) ? 'layout_status' : 'unbound';
            return [{ seat: identity(seat), reason: reason as 'disabled' | 'layout_status' | 'unbound' }];
        })
        .sort((left, right) => compareText(seatKey(left.seat), seatKey(right.seat)));
    const assignedFacts = seatFacts.filter((seat) => assignedSeatKeys.has(seatKey(seat)));
    return {
        classrooms: classrooms.map((classroom) => ({
            classroomId: classroom.classroomId,
            assignedCount: assignments.filter((assignment) => assignment.seat.classroomId.equals(classroom.classroomId)).length,
            eligibleSeatCount: seatFacts.filter((seat) => seat.classroomId.equals(classroom.classroomId) && eligible(seat)).length,
        })),
        highRiskEdges,
        mediumRiskEdges,
        splitTeamIds: [...teams.entries()]
            .filter(([, rooms]) => rooms.size > 1)
            .map(([teamId]) => teamId)
            .sort(compareText),
        skippedSeats,
        offlineSeats: assignedFacts
            .filter((seat) => seat.endpointOnline !== true)
            .map(identity)
            .sort((left, right) => compareText(seatKey(left), seatKey(right))),
        unsetFacingSeats: assignedFacts
            .filter((seat) => seat.facing === 'unset')
            .map(identity)
            .sort((left, right) => compareText(seatKey(left), seatKey(right))),
    };
}

function allocationScore(
    input: SpatialAllocationInput,
    assignments: ExamSeatAssignmentV2Mapping[],
    explanation: ExamSeatAssignmentV2Explanation,
    pairBySeat: Map<string, SeatPairFact>,
): number[] {
    const participantByUid = new Map(input.participants.map((participant) => [participant.boundUserId, participant]));
    let teamDistance = 0;
    let highRisk = 0;
    let mediumRisk = 0;
    let spacingPenalty = 0;
    for (let leftIndex = 0; leftIndex < assignments.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex++) {
            const left = assignments[leftIndex];
            const right = assignments[rightIndex];
            const pair = pairBySeat.get(pairKey(left.seat, right.seat));
            if (sameTeam(participantByUid.get(left.boundUserId)!, participantByUid.get(right.boundUserId)!)) {
                teamDistance += left.seat.classroomId.equals(right.seat.classroomId)
                    ? pair?.distance || 0
                    : CROSS_CLASSROOM_TEAM_DISTANCE;
                continue;
            }
            if (!pair) continue;
            const attenuation = Math.max(0, RISK_RADIUS - pair.distance + 0.1);
            if (pair.level === 'high') highRisk += attenuation;
            else if (pair.level === 'medium') mediumRisk += attenuation;
            if (pair.reason !== null) spacingPenalty += 1 / (1 + pair.distance);
        }
    }
    return [
        explanation.splitTeamIds.length,
        rounded(teamDistance),
        rounded(highRisk),
        rounded(mediumRisk),
        rounded(spacingPenalty),
    ];
}

function greedyAttempt(
    input: SpatialAllocationInput,
    eligibleSeats: ExamSeatAssignmentV2SeatFact[],
    pairBySeat: Map<string, SeatPairFact>,
    plannedTeamRooms: Map<string, string>,
    attempt: number,
): AllocationCandidate {
    const seatByKey = new Map(eligibleSeats.map((seat) => [seatKey(seat), seat]));
    const assigned = new Map<number, ExamSeatAssignmentV2SeatFact>();
    const assignedByTeam = new Map<string, ExamSeatAssignmentV2SeatFact[]>();
    const aggregates = new Map<string, SeatAggregate>(
        eligibleSeats.map((seat) => [seatKey(seat), { highRisk: 0, mediumRisk: 0, spacingPenalty: 0 }]),
    );
    const occupied = new Set<string>();
    const addAssignedSeat = (participant: ExamSeatAssignmentParticipantFact, assignedSeat: ExamSeatAssignmentV2SeatFact) => {
        assigned.set(participant.boundUserId, assignedSeat);
        occupied.add(seatKey(assignedSeat));
        if (participant.teamId !== null) {
            const rows = assignedByTeam.get(participant.teamId) || [];
            rows.push(assignedSeat);
            assignedByTeam.set(participant.teamId, rows);
        }
        for (const candidate of eligibleSeats) {
            if (seatKey(candidate) === seatKey(assignedSeat)) continue;
            const pair = pairBySeat.get(pairKey(candidate, assignedSeat));
            if (!pair) continue;
            const aggregate = aggregates.get(seatKey(candidate))!;
            const attenuation = Math.max(0, RISK_RADIUS - pair.distance + 0.1);
            if (pair.level === 'high') aggregate.highRisk += attenuation;
            else if (pair.level === 'medium') aggregate.mediumRisk += attenuation;
            if (pair.reason !== null) aggregate.spacingPenalty += 1 / (1 + pair.distance);
        }
    };
    for (const mapping of input.fixedAssignments) {
        const seat = seatByKey.get(seatKey(mapping.seat));
        if (!seat) throw new Error('spatial allocation received a non-eligible fixed seat');
        addAssignedSeat(input.participants.find((participant) => participant.boundUserId === mapping.boundUserId)!, seat);
    }
    for (const unit of participantUnits(input.participants, input.seed, attempt, plannedTeamRooms)) {
        let remaining = eligibleSeats.filter((seat) => !occupied.has(seatKey(seat)));
        const teamId = unit.participants[0]?.teamId;
        const teamClassroom =
            (teamId === null ? null : plannedTeamRooms.get(teamId || '') || null) ||
            chooseTeamClassroom({
                unit: unit.participants,
                remaining,
                assigned,
                assignedByTeam,
                aggregates,
                pairBySeat,
                seed: input.seed,
                attempt,
            });
        for (const participant of unit.participants) {
            if (assigned.has(participant.boundUserId)) continue;
            remaining = eligibleSeats.filter((seat) => !occupied.has(seatKey(seat)));
            const candidates = teamClassroom
                ? remaining.filter((seat) => seat.classroomId.toHexString() === teamClassroom)
                : remaining;
            const seat = bestSeat(candidates.length ? candidates : remaining, {
                participant,
                seat: (candidates[0] || remaining[0])!,
                assignedByTeam,
                aggregates,
                pairBySeat,
                seed: input.seed,
                attempt,
            });
            addAssignedSeat(participant, seat);
        }
    }
    const assignments = input.participants.map((participant) => ({
        boundUserId: participant.boundUserId,
        seat: identity(assigned.get(participant.boundUserId)!),
    }));
    const explanation = explanationFor(input.classrooms, input.participants, input.seatFacts, assignments, pairBySeat);
    return { assignments, explanation, score: allocationScore(input, assignments, explanation, pairBySeat) };
}

export function allocateExamSeatsSpatially(input: SpatialAllocationInput): {
    assignments: ExamSeatAssignmentV2Mapping[];
    explanation: ExamSeatAssignmentV2Explanation;
} {
    const allEligible = input.seatFacts.filter(eligible);
    const selectedClassroomCandidates =
        input.strategy === 'minimizeClassrooms'
            ? selectMinimizedClassroomCandidates(input, allEligible)
            : [new Set(allEligible.map((seat) => seat.classroomId.toHexString()))];
    const pairBySeat = pairFacts(input.seatFacts);
    let best: AllocationCandidate | null = null;
    for (const selectedClassrooms of selectedClassroomCandidates) {
        const eligibleSeats = allEligible.filter((seat) => selectedClassrooms.has(seat.classroomId.toHexString()));
        const plannedTeamRooms = planWholeTeamRooms(input, eligibleSeats);
        const teamRoomCandidates = plannedTeamRooms.size ? [plannedTeamRooms, new Map<string, string>()] : [plannedTeamRooms];
        for (const teamRooms of teamRoomCandidates) {
            for (let attempt = 0; attempt < GREEDY_ATTEMPTS; attempt++) {
                const candidate = greedyAttempt(input, eligibleSeats, pairBySeat, teamRooms, attempt);
                if (!best || compareScore(candidate.score, best.score) < 0) best = candidate;
            }
        }
    }
    if (!best) throw new Error('spatial allocation produced no deterministic candidate');
    return { assignments: best.assignments, explanation: best.explanation };
}

export function explainExamSeatSpatialAllocation(input: SpatialExplanationInput): ExamSeatAssignmentV2Explanation {
    return explanationFor(input.classrooms, input.participants, input.seatFacts, input.assignments, pairFacts(input.seatFacts));
}
