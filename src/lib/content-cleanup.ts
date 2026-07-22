export type PendingCleanupRecord = {
  id: string;
  pendingImageCleanupPaths?: string[];
};

export function uniqueStoragePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export type ReplacementOperations<Image> = {
  upload: () => Promise<Image>;
  commit: (image: Image, pendingOldPath?: string) => Promise<void>;
  deleteOld: (path: string) => Promise<void>;
  clearPendingOld: (path: string) => Promise<void>;
  deleteNew: (image: Image) => Promise<void>;
  oldPath?: string;
  getOldPath?: () => Promise<string | undefined>;
};

/**
 * The new reference and old cleanup marker are committed together. A failed old
 * deletion leaves the marker durable for a later client retry.
 */
export async function replaceWithDurableCleanup<Image>(operations: ReplacementOperations<Image>): Promise<Image> {
  let uploaded: Image | undefined;
  let committed = false;
  const oldPath = operations.getOldPath ? await operations.getOldPath() : operations.oldPath;

  try {
    uploaded = await operations.upload();
    await operations.commit(uploaded, oldPath);
    committed = true;
    if (oldPath) {
      await operations.deleteOld(oldPath);
      await operations.clearPendingOld(oldPath);
    }
    return uploaded;
  } catch (error) {
    if (!committed && uploaded) await operations.deleteNew(uploaded);
    throw error;
  }
}

export function isAlreadyMissingStorageObject(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'storage/object-not-found';
}

export async function retryPendingCleanup<T extends PendingCleanupRecord>(
  records: T[],
  operations: { deletePath: (path: string) => Promise<void>; clearPath: (recordId: string, path: string) => Promise<void> },
): Promise<void> {
  let firstError: unknown;
  for (const record of records) {
    for (const path of uniqueStoragePaths(record.pendingImageCleanupPaths || [])) {
      try {
        try {
          await operations.deletePath(path);
        } catch (error) {
          if (!isAlreadyMissingStorageObject(error)) throw error;
        }
        await operations.clearPath(record.id, path);
      } catch (error) {
        firstError ||= error;
      }
    }
  }
  if (firstError) throw firstError;
}

/**
 * Removes every image path even after an individual failure. Each successful
 * removal is durably cleared before the record itself is deleted, so a retry
 * only retains paths that still need Storage cleanup.
 */
export async function deleteWithDurableCleanup(
  paths: Array<string | undefined>,
  operations: {
    deletePath: (path: string) => Promise<void>;
    clearPath: (path: string) => Promise<void>;
    deleteRecord: () => Promise<void>;
  },
): Promise<void> {
  let firstError: unknown;
  for (const path of uniqueStoragePaths(paths)) {
    try {
      try {
        await operations.deletePath(path);
      } catch (error) {
        if (!isAlreadyMissingStorageObject(error)) throw error;
      }
      await operations.clearPath(path);
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
  await operations.deleteRecord();
}
