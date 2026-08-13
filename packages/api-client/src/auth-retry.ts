export interface AuthRetryOptions {
  authenticate(): Promise<string>;
  isAuthError(error: unknown): boolean;
}

export interface AuthRetry {
  refreshAuth(): Promise<string>;
  withAuth<T>(action: (authToken: string) => Promise<T>, authToken?: string): Promise<T>;
}

export function createSingleFlightAuthRetry(options: AuthRetryOptions): AuthRetry {
  let refreshPromise: Promise<string> | null = null;

  const refreshAuth = () => {
    if (!refreshPromise) {
      refreshPromise = options.authenticate().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  };

  const withAuth = async <T>(action: (authToken: string) => Promise<T>, authToken = ""): Promise<T> => {
    const currentToken = authToken || (await refreshAuth());
    try {
      return await action(currentToken);
    } catch (error) {
      if (!options.isAuthError(error)) throw error;
      const freshToken = await refreshAuth();
      return action(freshToken);
    }
  };

  return { refreshAuth, withAuth };
}

export function isAuthErrorLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  return status === 401 || status === 403 || code === "AUTH_INVALID" || code === "FORBIDDEN";
}
