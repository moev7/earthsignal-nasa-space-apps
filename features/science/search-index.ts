/** Local, literal search over caller-owned entries; no storage or shared cache. */
export type SearchField =
  | "product"
  | "track"
  | "frame"
  | "direction"
  | "polarization"
  | "maturity"
  | "date"
  | "source"
  | "kind"
  | "saved";

export type SearchEntry<T = unknown> = {
  id: string;
  title: string;
  subtitle: string;
  group: string;
  keywords?: string[];
  identifiers?: string[];
  fields?: Partial<Record<SearchField, string | string[]>>;
  target: T;
};

type Token = { field: SearchField | null; value: string };
const SEARCH_FIELDS: readonly SearchField[] = [
  "product", "track", "frame", "direction", "polarization", "maturity",
  "date", "source", "kind", "saved",
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function numericValue(value: string): string | null {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? String(Number(value))
    : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function parseQuery(query: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let cursor = 0;
  const fail = (error: string) => ({ tokens: [], error });
  while (cursor < query.length) {
    if (/\s/u.test(query[cursor])) {
      cursor++;
      continue;
    }
    let field: SearchField | null = null;
    const start = cursor;
    // A quote at token start is a literal phrase, including any colons inside it.
    if (query[cursor] !== '"') {
      while (cursor < query.length && !/[\s:"]/u.test(query[cursor])) cursor++;
      if (query[cursor] === ":") {
        const key = normalize(query.slice(start, cursor));
        if (!SEARCH_FIELDS.includes(key as SearchField)) {
          return fail(`Unknown search field: ${query.slice(start, cursor) || "(empty)"}.`);
        }
        field = key as SearchField;
        cursor++;
      } else {
        cursor = start;
      }
    }
    let raw: string;
    if (query[cursor] === '"') {
      const valueStart = ++cursor;
      while (cursor < query.length && query[cursor] !== '"') cursor++;
      if (cursor === query.length) return fail("Unclosed search quote.");
      raw = query.slice(valueStart, cursor++);
      if (cursor < query.length && !/\s/u.test(query[cursor])) {
        return fail("Quoted search values must be followed by whitespace.");
      }
    } else {
      const valueStart = cursor;
      while (cursor < query.length && !/\s/u.test(query[cursor])) {
        if (query[cursor] === '"') return fail("Quotes must enclose a complete search value.");
        cursor++;
      }
      raw = query.slice(valueStart, cursor);
    }
    let value = normalize(raw.trim());
    if (!value) return fail(`Empty search value${field ? ` for ${field}` : ""}.`);
    if (field === "track" || field === "frame") {
      const number = numericValue(value);
      if (number === null) return fail(`Invalid ${field}: use a nonnegative safe integer.`);
      value = number;
    }
    if (field === "date" && !validDate(value)) {
      return fail("Invalid date: use a valid YYYY-MM-DD calendar date.");
    }
    tokens.push({ field, value });
  }
  return { tokens, error: null };
}

/**
 * All free tokens must occur contiguously in an individual indexed value.
 * Structured tokens require exact field values (OR over an entry's value array).
 * Ranking: exact ID, ID prefix, then other literal matches, preserving input ties.
 * Quotes have no escape syntax. Bare quoted phrases may contain literal colons.
 * Finite limits are floored and clamped at zero; nonfinite limits use 40.
 * `total` counts every match before limiting. Entries and targets are not mutated.
 */
export function searchEntries<T>(
  entries: SearchEntry<T>[],
  query: string,
  limit = 40,
): { items: SearchEntry<T>[]; total: number; error: string | null } {
  const { tokens, error } = parseQuery(query);
  if (error) return { items: [], total: 0, error };
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 40;
  if (!tokens.length) return { items: entries.slice(0, cap), total: entries.length, error: null };

  const literals = tokens.filter((token) => token.field === null).map((token) => token.value);
  const matches: { entry: SearchEntry<T>; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const id = normalize(entry.id);
    const identifiers = [id, ...(entry.identifiers ?? []).map(normalize)];
    const fields = new Map<SearchField, string[]>();
    for (const field of SEARCH_FIELDS) {
      const raw = entry.fields?.[field];
      fields.set(field, (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw])
        .map((value) => normalize(value.trim())));
    }
    const text = [...identifiers, normalize(entry.title), normalize(entry.subtitle),
      ...(entry.keywords ?? []).map(normalize), ...Array.from(fields.values()).flat()];
    const matched = tokens.every(({ field, value }) => {
      if (field === null) return text.some((part) => part.includes(value));
      return fields.get(field)!.some((part) =>
        (field === "track" || field === "frame" ? numericValue(part) : part) === value);
    });
    if (!matched) return;
    const phrase = literals.join(" ");
    const rank = identifiers.some(identifier => literals.some(value => value === identifier) || (phrase !== "" && phrase === identifier))
      ? 0
      : identifiers.some(identifier => literals.some(value => identifier.startsWith(value)) || (phrase !== "" && identifier.startsWith(phrase)))
        ? 1 : 2;
    matches.push({ entry, rank, order });
  });
  matches.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { items: matches.slice(0, cap).map(({ entry }) => entry), total: matches.length, error: null };
}
