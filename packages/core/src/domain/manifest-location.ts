// Where in the manifest file a value was written. A decode error that names a
// path is something the reader has to find; one that names a line is something
// an editor can jump to. The host that read the file knows its lines; the
// decoder knows the path — the locator is how the second asks the first.

// A path into the manifest as the decoder sees it: object keys and array
// indices, root first.
export type ManifestPath = ReadonlyArray<PropertyKey>;

export type ManifestPosition = {
  // 1-based, as editors count.
  readonly line: number;
  readonly column: number;
};

// Answers with the position of the value at `path`, or the nearest ancestor
// that exists when the path names something the file does not contain (a
// missing key), or `null` when the source has no positions to give.
export type ManifestLocator = (path: ManifestPath) => ManifestPosition | null;
