export function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function extractStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }

    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }

  return [];
}

export function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function readNestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : undefined;
}

export function readNestedStringArray(record: Record<string, unknown>, path: string[]): string[] {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return [];
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (!Array.isArray(current)) {
    return [];
  }

  return current
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

export function toScore(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, parsed));
}

export function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stripHtml(value: string, maxLength = 240): string {
  // State-machine approach avoids regex-based tag matching (js/bad-tag-filter).
  const lower = value.toLowerCase();
  let result = '';
  let i = 0;
  while (i < value.length) {
    if (lower.startsWith('<script', i)) {
      const end = lower.indexOf('</script>', i);
      i = end === -1 ? value.length : end + '</script>'.length;
      result += ' ';
    } else if (value[i] === '<') {
      const end = value.indexOf('>', i);
      i = end === -1 ? value.length : end + 1;
      result += ' ';
    } else {
      result += value[i];
      i++;
    }
  }
  const normalized = result.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

export function sanitizeUrl(value: string | undefined, allowedHosts: string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') {
      return undefined;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}
