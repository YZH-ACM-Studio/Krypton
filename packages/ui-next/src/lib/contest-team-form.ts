export function evaluateSelfTeamName(value: string): { error: string; preventSubmit: boolean } {
  const error = value.trim() ? '' : '请输入队伍名称';
  return { error, preventSubmit: !!error };
}
