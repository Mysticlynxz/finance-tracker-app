export type CategorySourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export const loadCategorySource = async <T>(loader: () => Promise<T>): Promise<CategorySourceResult<T>> => {
  try {
    return { ok: true, value: await loader() };
  } catch (error) {
    return { ok: false, error };
  }
};

export const getCategorySourceErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
