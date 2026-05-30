import * as YAML from 'yaml';
import { downloadZip, type ZipDownloadTarget } from '@/lib/download-zip';

type R = Record<string, any>;

interface ProblemPackageOptions {
  pdoc: R;
  problemUrl: string;
  testdata?: R[];
  additionalFiles?: R[];
  content?: string | R;
}

function cleanDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim() || 'problem';
}

function problemFolder(pdoc: R) {
  return String(pdoc.docId || pdoc.pid || 'problem');
}

function metadataYaml(pdoc: R) {
  const metadata: R = {
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

function statementTargets(folder: string, content: string | R | undefined): ZipDownloadTarget[] {
  let statement: any = content ?? '';
  if (typeof statement === 'string') {
    try {
      const parsed = JSON.parse(statement);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) statement = parsed;
    } catch {
      /* raw markdown */
    }
  }

  if (statement && typeof statement === 'object' && !Array.isArray(statement)) {
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
    const data = await res.json();
    return data?.error || data?.message || `HTTP ${res.status}`;
  } catch {
    const text = await res.text().catch(() => '');
    return text.slice(0, 160) || `HTTP ${res.status}`;
  }
}

async function getFileLinks(problemUrl: string, files: string[], type: 'testdata' | 'additional_file') {
  if (!files.length) return {};
  const body = new URLSearchParams();
  body.set('operation', 'get_links');
  body.set('type', type);
  for (const file of files) body.append('files', file);

  const res = await fetch(`${problemUrl}/files`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(await responseMessage(res));
  const data = await res.json().catch(() => ({}));
  return (data?.links || {}) as Record<string, string>;
}

export async function downloadProblemPackage({
  pdoc,
  problemUrl,
  testdata = [],
  additionalFiles = [],
  content,
}: ProblemPackageOptions) {
  const folder = problemFolder(pdoc);
  const targets: ZipDownloadTarget[] = [
    { name: `${folder}/problem.yaml`, content: metadataYaml(pdoc) },
    ...statementTargets(folder, content ?? pdoc.content),
  ];

  const testdataNames = testdata.map((file) => file?.name).filter(Boolean);
  const additionalNames = additionalFiles.map((file) => file?.name).filter(Boolean);
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
