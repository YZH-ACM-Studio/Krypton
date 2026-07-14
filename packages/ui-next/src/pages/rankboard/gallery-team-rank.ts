export type GalleryTeamRankStatus = 'confirmed' | 'missing' | 'conflict';

export function formatGalleryTeamRank(status: GalleryTeamRankStatus, rank: number | null): string {
  if (status === 'confirmed') {
    if (!Number.isInteger(rank) || rank == null || rank <= 0) {
      throw new Error('Rankboard gallery confirmed rank must be a positive integer');
    }
    return `队伍排名 #${rank}`;
  }

  if (rank !== null) {
    throw new Error(`Rankboard gallery ${status} rank must not carry a value`);
  }
  if (status === 'missing') return '队伍排名待补充';
  if (status === 'conflict') return '队伍排名待核对';
  throw new Error(`Unknown rankboard gallery team-rank status: ${String(status)}`);
}
