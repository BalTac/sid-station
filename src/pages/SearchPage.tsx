import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TuneRow } from "../lib/api";
import { TuneTable } from "../components/TuneTable";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";

const PAGE = 300;

export function SearchPage({ initialText }: { initialText?: string }) {
  const seed = useApp((s) => s.setSearchState);
  const { text, collection, sort, onlyStil } = useApp((s) => s.searchState);
  const setSearchState = useApp((s) => s.setSearchState);
  const setText = (value: string) => setSearchState({ text: value });
  const setCollection = (value: string) => setSearchState({ collection: value });
  const setSort = (value: string) => setSearchState({ sort: value });
  const setOnlyStil = (value: boolean) => setSearchState({ onlyStil: value });
  const [items, setItems] = useState<TuneRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const dataVersion = useApp((s) => s.dataVersion);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialText && initialText !== text) seed({ text: initialText });
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useMemo(
    () => ({
      text,
      collection: collection || null,
      sort,
      onlyStil,
      limit: PAGE,
      offset: 0,
    }),
    [text, collection, sort, onlyStil, dataVersion],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .searchTunes(query)
        .then((page) => {
          if (!alive) return;
          setItems(page.items);
          setTotal(page.total);
        })
        .catch(() => {
          if (!alive) return;
          setItems([]);
          setTotal(0);
        })
        .finally(() => alive && setLoading(false));
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  const loadMore = async () => {
    const page = await api.searchTunes({ ...query, offset: items.length });
    setItems((prev) => [...prev, ...page.items]);
    setTotal(page.total);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line/70 px-6 py-4">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-3 left-3.5 h-4.5 w-4.5 text-muted/70" />
          <input
            ref={inputRef}
            data-testid="search-input"
            className="input !py-2.5 pl-11 text-base"
            placeholder="Search title, author, STIL comment… (min. 3 characters for full-text search)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-soft"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">All collections</option>
            <option value="MUSICIANS">Musicians</option>
            <option value="DEMOS">Demos</option>
            <option value="GAMES">Games</option>
          </select>
          <select
            className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-soft"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="relevance">Relevance</option>
            <option value="title">Sort by title</option>
            <option value="artist">Sort by artist</option>
            <option value="year">Sort by year</option>
            <option value="duration">Length</option>
            <option value="path">Path</option>
          </select>
          <label className="chip cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)]"
              checked={onlyStil}
              onChange={(e) => setOnlyStil(e.target.checked)}
            />
            STIL notes only
          </label>
          <span data-testid="search-count" className="ml-auto text-xs text-muted">
            {loading ? "Searching…" : `${total.toLocaleString("en-US")} results`}
          </span>
        </div>
      </div>
      <TuneTable tunes={items} emptyLabel={loading ? "Searching…" : "No results"} />
      {items.length < total && (
        <div className="border-t border-line/60 px-6 py-3 text-center">
          <button className="btn" onClick={() => void loadMore()}>
            Load more ({total - items.length})
          </button>
        </div>
      )}
    </div>
  );
}
