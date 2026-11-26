/** A single public board at the server-authorized contest time. No record IDs or private results. */
export interface ContestReplayFrame {
    atMs: number;
    availableMs: number;
    durationMs: number;
    ended: boolean;
    frozen: boolean;
    incomplete: number;
    rule: 'acm' | 'ioi' | 'highest';
    hideTotals: boolean;
    pids: number[];
    rows: Array<{
        uid: number;
        source: 'official' | 'virtual' | 'self';
        name: string;
        rank?: number;
        score?: number;
        maxPoints?: number;
        /** A visible tie-breaker is null when only the archived final score survives. */
        passed?: number | null;
        seconds?: number | null;
        cells: (string | number | null)[];
    }>;
}
