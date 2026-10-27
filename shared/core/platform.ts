export type PlatformKind = 'extension-mv2' | 'extension-mv3' | 'userscript';

/**
 * The only surface the shared code is allowed to touch that differs between
 * the extension builds and the userscript build.
 */
export interface Platform {
  kind: PlatformKind;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** Same-page settings changes are emitted locally; this covers other tabs. */
  onExternalChange(listener: () => void): void;
  addStyle(css: string): void;
}
