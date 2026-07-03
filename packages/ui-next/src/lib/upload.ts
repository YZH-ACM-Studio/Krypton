/**
 * 上传一个文件到当前用户的 Hydro 文件存储（FilesHandler，POST /file）。
 *
 * 该端点必须带 `operation=upload_file` + `filename` 字段（否则 405 /
 * ValidationError），且响应是重定向而非 JSON —— 最终 URL 由客户端按
 * `/file/{uid}/{filename}` 约定自行拼出（与 ui-default 的 uploadFiles
 * 相同流程，见 packages/ui-default/components/upload.tsx:59-63）。
 *
 * 返回可直接用于 <img src> 的站内 URL；失败抛 Error（带可读 message）。
 */
export async function uploadUserFile(file: File, uid: number): Promise<string> {
  const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'png').toLowerCase();
  // 唯一文件名，避开 FileExistsError（同名文件端点直接拒绝）。
  const filename = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const form = new FormData();
  form.append('filename', filename);
  form.append('file', file);
  form.append('operation', 'upload_file');
  const res = await fetch('/file', { method: 'POST', body: form, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let msg = `上传失败（HTTP ${res.status}）`;
    try {
      const body = await res.json();
      if (body?.error?.message) msg = `上传失败：${body.error.message}`;
    } catch { /* 非 JSON 响应，用默认文案 */ }
    throw new Error(msg);
  }
  return `/file/${uid}/${filename}`;
}
