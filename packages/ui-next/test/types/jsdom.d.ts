// Minimal typings for the parts of jsdom used by tests. jsdom ships no
// declarations and the repo cannot add @types/jsdom (offline production host).
declare module 'jsdom' {
  export interface ConstructorOptions {
    url?: string;
    contentType?: string;
    pretendToBeVisual?: boolean;
    runScripts?: 'dangerously' | 'outside-only';
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
    serialize(): string;
  }
}
