// Attachment filenames arrive straight from the network (MIME
// `Content-Disposition`, Graph's attachment `name`) and are therefore
// attacker-controlled. Anything that reaches `vault.adapter.writeBinary` must
// be a single, inert path segment: no directory traversal, no separators, no
// dotfile shenanigans.

const MAX_NAME_LENGTH = 200;

// Characters that are illegal or dangerous in a path segment on at least one
// supported platform (`/` and `\` are already gone after the basename step,
// but keep them here so the function is safe if reordered).
const PATH_HOSTILE = /[\\/:*?"<>|]/g;
// C0 controls + DEL, written with escapes so the source stays plain ASCII.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Reduce an untrusted attachment filename to a single safe path segment.
 *
 * Guarantees about the return value: it is non-empty, contains no `/` or `\`,
 * no control characters, and never starts with `.` — so it can be neither
 * `.` / `..` (traversal) nor a hidden dotfile that shadows something like
 * `.obsidian`.
 */
export function safeAttachmentName(raw: string): string {
  // 1. Basename only — drop everything through the last separator. Handles
  //    `../../etc/passwd`, `foo/bar/baz.pdf` and Windows-style `..\..\x`.
  const segments = String(raw ?? "").split(/[/\\]/);
  let name = segments[segments.length - 1] ?? "";

  // 2. Strip control characters, then neutralize any remaining hostile chars.
  name = name.replace(CONTROL_CHARS, "").replace(PATH_HOSTILE, "_");

  // 3. Collapse leading dots (so `..`, `.`, `.hidden` can never survive as
  //    traversal or as a dotfile) and trailing dots/spaces (Windows).
  name = name.trim().replace(/^\.+/, "").replace(/[. ]+$/, "").trim();

  // 4. Bound the length so an absurd name can't trip filesystem limits.
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();

  return name || "attachment";
}

/** Split `dir/stem.ext` into `["dir/stem", ".ext"]`; extension may be "". */
function splitExtension(path: string): [string, string] {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  // `dot > slash + 1` keeps a leading-dot basename (".env") as an extensionless
  // stem rather than an empty one.
  return dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
}

/**
 * Return `rel` if nothing is there, else `stem (1).ext`, `stem (2).ext`, … so a
 * saved attachment never silently overwrites an existing vault file.
 */
export async function uniqueAttachmentPath(
  rel: string,
  exists: (path: string) => Promise<boolean>,
  maxAttempts = 1000,
): Promise<string> {
  if (!(await exists(rel))) return rel;
  const [stem, ext] = splitExtension(rel);
  for (let i = 1; i <= maxAttempts; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Too many files named like ${rel}`);
}
