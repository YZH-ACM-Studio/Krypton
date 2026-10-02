export const EASE_OUT: readonly [number, number, number, number] = Object.freeze([0.16, 1, 0.3, 1] as const);
export const EASE_IN: readonly [number, number, number, number] = Object.freeze([0.55, 0, 1, 0.45] as const);
export const EASE_STANDARD: readonly [number, number, number, number] = Object.freeze([0.2, 0, 0, 1] as const);

export interface MotionTokens {
  enter: { duration: number; ease: readonly number[] };
  exit: { duration: number; ease: readonly number[] };
  state: { duration: number; ease: readonly number[] };
  spring: { type: 'spring'; stiffness: 560; damping: 42; mass: 0.7 };
}

function freezeMotion(tokens: MotionTokens): MotionTokens {
  Object.freeze(tokens.enter);
  Object.freeze(tokens.exit);
  Object.freeze(tokens.state);
  Object.freeze(tokens.spring);
  Object.freeze(tokens);
  return tokens;
}

/** JS mirror of the CSS motion tokens. Durations are seconds for `motion/react`. */
export const MOTION: MotionTokens = freezeMotion({
  enter: { duration: 0.24, ease: EASE_OUT },
  exit: { duration: 0.16, ease: EASE_IN },
  state: { duration: 0.16, ease: EASE_STANDARD },
  spring: { type: 'spring', stiffness: 560, damping: 42, mass: 0.7 },
});

/** Hook shape is reserved so a future setting can replace this constant. */
export function useMotionTokens(): MotionTokens {
  return MOTION;
}
