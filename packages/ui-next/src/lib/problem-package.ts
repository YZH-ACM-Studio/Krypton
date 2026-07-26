import * as YAML from 'yaml';
import { downloadZip, type ZipDownloadTarget } from './download-zip';

type JsonRecord = Record<string, unknown>;

interface ProblemPackageDocument {
  docId?: string | number;
  pid?: string | number;
  owner?: unknown;
  title?: string;
  tag?: unknown[];
  nSubmit?: number;
  nAccept?: number;
  content?: string | JsonRecord;
  statementFormat?: string;
  programmingStatement?: unknown;
}

interface ProblemPackageFile {
  name?: string;
}

interface ProblemPackageOptions {
  pdoc: ProblemPackageDocument;
  problemUrl: string;
  testdata?: ProblemPackageFile[];
  additionalFiles?: ProblemPackageFile[];
  content?: string | JsonRecord;
}

interface ProblemFilesDownloadOptions {
  pdoc: ProblemPackageDocument;
  problemUrl: string;
  files: string[];
  type: 'testdata' | 'additional_file';
}

function cleanDownloadName(value: string) {
  return (
    value
      // Control characters are exactly what this filename boundary must strip.
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'problem'
  );
}

function problemFolder(pdoc: ProblemPackageDocument) {
  return String(pdoc.docId || pdoc.pid || 'problem');
}

function metadataYaml(pdoc: ProblemPackageDocument) {
  const metadata: JsonRecord = {
    pid: pdoc.pid,
    owner: pdoc.owner,
    title: pdoc.title,
    tag: pdoc.tag || [],
    nSubmit: pdoc.nSubmit,
    nAccept: pdoc.nAccept,
  };
  for (const key of Object.keys(metadata)) {
    if (metadata[key] == null || metadata[key] === '') delete metadata[key];
  }
  return YAML.stringify(metadata);
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function statementTargets(folder: string, content: string | JsonRecord | undefined): ZipDownloadTarget[] {
  let statement: unknown = content ?? '';
  if (typeof statement === 'string') {
    try {
      const parsed: unknown = JSON.parse(statement);
      if (isRecord(parsed)) statement = parsed;
    } catch {
      /* raw markdown */
    }
  }

  if (isRecord(statement)) {
    const targets: ZipDownloadTarget[] = [];
    for (const key of Object.keys(statement)) {
      const value = statement[key];
      targets.push({
        name: `${folder}/problem_${key}.md`,
        content: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      });
    }
    if (targets.length) return targets;
  }

  return [{ name: `${folder}/problem.md`, content: String(content ?? '') }];
}

async function responseMessage(res: Response) {
  try {
    const data: unknown = await res.json();
    if (isRecord(data)) return String(data.error || data.message || `HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  } catch {
    const text = await res.text().catch(() => '');
    return text.slice(0, 160) || `HTTP ${res.status}`;
  }
}

async function getFileLinks(problemUrl: string, files: string[], type: 'testdata' | 'additional_file') {
  if (!files.length) return {};
  const res = await fetch(`${problemUrl}/files`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation: 'get_links', type, files }),
  });
  if (!res.ok) throw new Error(await responseMessage(res));
  const data: unknown = await res.json().catch(() => null);
  const links = isRecord(data) ? data.links : null;
  if (!isRecord(links)) {
    throw new Error('服务器返回的下载链接格式无效');
  }
  const missing = files.filter((file) => typeof links[file] !== 'string' || !links[file]);
  if (missing.length) throw new Error(`服务器未返回下载链接：${missing.join(', ')}`);
  return Object.fromEntries(files.map((file) => [file, links[file]])) as Record<string, string>;
}

export async function downloadProblemFiles({ pdoc, problemUrl, files, type }: ProblemFilesDownloadOptions) {
  if (!files.length) throw new Error('请至少选择一个文件');
  const links = await getFileLinks(problemUrl, files, type);
  const targets = files.map((file) => ({ name: file, url: links[file] }));
  const folder = problemFolder(pdoc);
  const filename = cleanDownloadName(`${folder} ${pdoc.title || pdoc.pid || 'problem'} ${type}.zip`);
  await downloadZip(filename, targets);
}

export async function downloadProblemPackage({ pdoc, problemUrl, testdata = [], additionalFiles = [], content }: ProblemPackageOptions) {
  const folder = problemFolder(pdoc);
  const targets: ZipDownloadTarget[] = [
    { name: `${folder}/problem.yaml`, content: metadataYaml(pdoc) },
    ...statementTargets(folder, content ?? pdoc.content),
  ];
  if (pdoc.statementFormat === 'structured-v1') {
    if (!pdoc.programmingStatement || typeof pdoc.programmingStatement !== 'object' || Array.isArray(pdoc.programmingStatement)) {
      throw new Error('结构化题面 canonical 缺失，无法打包');
    }
    targets.push({
      name: `${folder}/programming-statement.json`,
      content: `${JSON.stringify(pdoc.programmingStatement, null, 2)}\n`,
    });
  }

  const testdataNames = testdata.map((file) => file.name).filter((name): name is string => !!name);
  const additionalNames = additionalFiles.map((file) => file.name).filter((name): name is string => !!name);
  const [testdataLinks, additionalLinks] = await Promise.all([
    getFileLinks(problemUrl, testdataNames, 'testdata'),
    getFileLinks(problemUrl, additionalNames, 'additional_file'),
  ]);

  for (const [filename, url] of Object.entries(testdataLinks)) {
    targets.push({ name: `${folder}/testdata/${filename}`, url });
  }
  for (const [filename, url] of Object.entries(additionalLinks)) {
    targets.push({ name: `${folder}/additional_file/${filename}`, url });
  }

  const filename = cleanDownloadName(`${folder} ${pdoc.title || pdoc.pid || 'problem'}.zip`);
  await downloadZip(filename, targets);
}
