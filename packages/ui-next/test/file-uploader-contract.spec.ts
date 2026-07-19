import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { fileUploaderAllowedMetaFields } from '../src/lib/file-uploader-meta.ts';

function multipartTextFields(content: string) {
  const uppy = new Uppy().use(XHRUpload, {
    endpoint: '/d/system/p/P5035/files',
    formData: true,
    allowedMetaFields: false,
  });
  const id = uppy.addFile({
    name: '1.in',
    type: 'text/plain',
    data: new Blob([content]),
    meta: { operation: 'upload_file', filename: '1.in' },
  });
  uppy.setFileMeta(id, { operation: 'upload_file', filename: '1.in', type: 'testdata' });
  uppy.setFileState(id, {
    xhrUpload: { allowedMetaFields: fileUploaderAllowedMetaFields({ type: 'testdata' }) },
  } as any);
  const file = uppy.getFile(id)!;
  const plugin = uppy.getPlugin('XHRUpload') as XHRUpload<any, any>;
  const form = plugin.createFormDataUpload(file as any, plugin.getOptions(file as any));
  return [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

describe('managed problem file uploader contract', () => {
  it('sends only Hydro file fields for empty and non-empty files', () => {
    const expected = [
      ['operation', 'upload_file'],
      ['filename', '1.in'],
      ['type', 'testdata'],
    ];
    expect(multipartTextFields('')).to.deep.equal(expected);
    expect(multipartTextFields('x')).to.deep.equal(expected);
  });
});
