"use client";
import { useEffect, useState } from "react";
import {
  catalogSchema,
  catalogQueryKey,
  defaultQuery,
  type Catalog,
  type CatalogQuery,
} from "./domain";
export function useCatalog(initialQuery: () => CatalogQuery = defaultQuery) {
  const [request, setRequest] = useState(() => ({ query: initialQuery() }));
  const { query } = request;
  const [draft, setDraft] = useState(query);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A completion belongs to one committed query/retry, never to a later search.
  const [result, setResult] = useState<{
    request: typeof request; catalog: Catalog | null;
    status: "ready" | "error"; error: string;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/scenes?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}`, { signal: abort.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(
            typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
              ? body.error
              : "Catalog request failed",
          );
        return catalogSchema.parse(body);
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          setResult({ request, catalog: data, status: "ready", error: "" });
          setSelectedId(data.scenes[0]?.id ?? null);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setResult({ request, catalog: null, status: "error", error: e instanceof Error ? e.message : "Catalog request failed" });
        }
      });
    return () => abort.abort();
  }, [query, request]);
  const current = result?.request === request ? result : null;
  const currentCatalog = current?.catalog &&
    catalogQueryKey(current.catalog.query) === catalogQueryKey(query)
      ? current.catalog : null;
  const selected =
    currentCatalog?.scenes.find((s) => s.id === selectedId) ??
    currentCatalog?.scenes[0] ??
    null;
  return {
    query,
    draft,
    setDraft,
    catalog: currentCatalog,
    selected,
    status:
      !current || (current.status === "ready" && !currentCatalog) ? ("loading" as const) : current.status,
    error: current?.error ?? "",
    select: setSelectedId,
    search: () => {
      setRequest({ query: { ...draft } });
    },
    retry: () => setRequest(current => ({ ...current })),
    reset: () => {
      const value = defaultQuery();
      setDraft(value);
      setRequest({ query: value });
    },
    setQuery: (q: CatalogQuery) => {
      setDraft(q);
      setRequest(current => current.query === q ? current : { query: q });
    },
  };
}
