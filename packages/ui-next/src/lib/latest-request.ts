export interface LatestRequestGate {
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGate(): LatestRequestGate {
  let currentGeneration = 0;
  return {
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    isCurrent(generation) {
      return generation === currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
    },
  };
}
