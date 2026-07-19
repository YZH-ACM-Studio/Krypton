/**
 * Uppy injects its own `name` and MIME `type` metadata. Hydro file routes have
 * a narrower multipart contract, so only protocol fields and caller-owned
 * metadata may cross the request boundary.
 */
export function fileUploaderAllowedMetaFields(meta?: Record<string, string>): string[] {
  return [...new Set(['operation', 'filename', ...Object.keys(meta || {})])];
}
