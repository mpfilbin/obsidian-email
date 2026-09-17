// Chunked rather than one `bin += String.fromCharCode(b)` per byte: repeated
// string concatenation is quadratic and gets noticeably slow on larger
// attachments, since each `+=` re-copies the whole string built so far.
const CHUNK_SIZE = 8192;

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(""));
}
