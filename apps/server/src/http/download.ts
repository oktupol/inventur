/** Replaces characters that are not allowed in file names on Windows. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
}

/** `Content-Disposition` of a download with an ASCII fallback and the UTF-8 file name. */
export function contentDisposition(filename: string): string {
  const fallback = filename
    .normalize('NFD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/"/g, '');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
