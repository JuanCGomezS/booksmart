export function getSafeReturnTo(value: string | null, baseUrl: string): string | null {
  if (!value || typeof window === 'undefined' || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    const origin = window.location.origin;
    const candidate = new URL(value, origin);
    const basePath = new URL(baseUrl, origin).pathname;

    const normalizedBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const isWithinBasePath = normalizedBasePath === ''
      || candidate.pathname === normalizedBasePath
      || candidate.pathname.startsWith(`${normalizedBasePath}/`);
    if (candidate.origin !== origin || !isWithinBasePath) return null;

    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return null;
  }
}
