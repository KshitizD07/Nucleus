/**
 * Lightweight, high-performance unified line diff generator.
 * Produces standard Git-compatible unified diff hunks (@@ -start,len +start,len @@).
 */
export function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines = 3
): string {
  if (oldContent === newContent) {
    return "";
  }

  const oldLines = oldContent ? oldContent.split(/\r?\n/) : [];
  const newLines = newContent ? newContent.split(/\r?\n/) : [];

  // 1. Newly created file
  if (oldLines.length === 0) {
    const lines = newLines.map((l) => `+${l}`).join("\n");
    return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${newLines.length} @@\n${lines}`;
  }

  // 2. Deleted file
  if (newLines.length === 0) {
    const lines = oldLines.map((l) => `-${l}`).join("\n");
    return `--- a/${filePath}\n+++ /dev/null\n@@ -1,${oldLines.length} +0,0 @@\n${lines}`;
  }

  // 3. Modified file: identify changed region by matching common prefix & suffix
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Context lines before the change
  const startPrefix = Math.max(0, prefix - contextLines);
  const contextPrefix = oldLines.slice(startPrefix, prefix);

  // Changed lines in the middle
  const removedMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const addedMiddle = newLines.slice(prefix, newLines.length - suffix);

  // Context lines after the change
  const endSuffix = Math.min(oldLines.length, oldLines.length - suffix + contextLines);
  const contextSuffix = oldLines.slice(oldLines.length - suffix, endSuffix);

  const oldStart = startPrefix + 1;
  const oldCount = prefix - startPrefix + removedMiddle.length + (endSuffix - (oldLines.length - suffix));
  const newStart = startPrefix + 1;
  const newCount = prefix - startPrefix + addedMiddle.length + (endSuffix - (oldLines.length - suffix));

  const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  const hunkLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    hunkHeader,
    ...contextPrefix.map((l) => ` ${l}`),
    ...removedMiddle.map((l) => `-${l}`),
    ...addedMiddle.map((l) => `+${l}`),
    ...contextSuffix.map((l) => ` ${l}`)
  ];

  return hunkLines.join("\n");
}
