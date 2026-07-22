export type LazyResourceState<T> = {
  data: T[];
  loaded: boolean;
  loading: boolean;
  error: string;
};

export function emptyLazyResource<T>(): LazyResourceState<T> {
  return { data: [], loaded: false, loading: false, error: '' };
}

/** Starts one fetch per modal session unless the caller explicitly retries. */
export function beginLazyResourceLoad<T>(state: LazyResourceState<T>, force = false): LazyResourceState<T> | null {
  if (state.loading || (state.loaded && !force)) return null;
  return { ...state, loading: true, error: '' };
}

export function resolveLazyResource<T>(data: T[]): LazyResourceState<T> {
  return { data, loaded: true, loading: false, error: '' };
}

export function rejectLazyResource<T>(state: LazyResourceState<T>, error: unknown): LazyResourceState<T> {
  return {
    ...state,
    loading: false,
    error: error instanceof Error ? error.message : 'No se pudo cargar el contenido.',
  };
}
