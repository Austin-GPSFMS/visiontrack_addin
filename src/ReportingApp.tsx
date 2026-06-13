/**
 * Reporting hub — Geotab-style report cards you click into. Hosts all GPSFMS
 * VisionTrack reports (Watchdog now, Scorecard later). Searchable, with
 * per-user favorites (localStorage) and a Favorites filter.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Banner } from "@geotab/zenith";
import type { GeotabApi, GeotabSession } from "./types";
import { friendlyError, getSession } from "./api/geotab";
import { WatchdogReport } from "./reports/WatchdogReport";

interface AppProps {
  api: GeotabApi | null;
}

interface ReportDef {
  id: string;
  title: string;
  description: string;
  tags: string[];
  render: (session: GeotabSession) => ReactNode;
}

const REPORTS: ReportDef[] = [
  {
    id: "watchdog",
    title: "Watchdog",
    description:
      "Cameras and GO devices that haven't reported within a chosen window — spot offline hardware before a customer does.",
    tags: ["Device & Installation", "Safety"],
    render: (s) => <WatchdogReport session={s} />,
  },
  // Scorecard and future reports slot in here.
];

const FAV_KEY = "vt-report-favorites";

function loadFavorites(userKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${FAV_KEY}:${userKey}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function ReportingApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getSession(api)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setFavorites(loadFavorites(`${s.database}|${s.userName}`));
      })
      .catch((e) => !cancelled && setBootError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const toggleFav = useCallback(
    (id: string) => {
      if (!session) return;
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          localStorage.setItem(
            `${FAV_KEY}:${session.database}|${session.userName}`,
            JSON.stringify([...next])
          );
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [session]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REPORTS.filter((r) => {
      if (favOnly && !favorites.has(r.id)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [query, favOnly, favorites]);

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Reporting</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }
  if (bootError) return <Banner type="error">{bootError}</Banner>;

  const current = REPORTS.find((r) => r.id === selected);

  // ---- Single report view ----
  if (current && session) {
    return (
      <div>
        <div className="vt-header">
          <h1>{current.title}</h1>
          <button className="vt-link" onClick={() => setSelected(null)}>
            ← All reports
          </button>
        </div>
        {current.render(session)}
      </div>
    );
  }

  // ---- Report list ----
  return (
    <div>
      <div className="vt-header">
        <h1>Reporting</h1>
      </div>

      <div className="vt-toolbar">
        <input
          className="vt-input"
          style={{ maxWidth: 280 }}
          placeholder="Search reports…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vt-viewtoggle">
          <button
            className={!favOnly ? "vt-viewbtn vt-viewbtn--active" : "vt-viewbtn"}
            onClick={() => setFavOnly(false)}
          >
            All reports
          </button>
          <button
            className={favOnly ? "vt-viewbtn vt-viewbtn--active" : "vt-viewbtn"}
            onClick={() => setFavOnly(true)}
          >
            ★ Favorites{favorites.size > 0 ? ` (${favorites.size})` : ""}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="vt-empty">
          {favOnly ? "No favorite reports yet — star one to pin it here." : "No reports match."}
        </div>
      ) : (
        <div className="vt-report-grid">
          {filtered.map((r) => (
            <div key={r.id} className="vt-report-card" onClick={() => setSelected(r.id)}>
              <div className="vt-report-card-head">
                <span className="vt-report-card-title">{r.title}</span>
                <button
                  className={`vt-star${favorites.has(r.id) ? " vt-star--on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFav(r.id);
                  }}
                  aria-label={favorites.has(r.id) ? "Unfavorite" : "Favorite"}
                  title={favorites.has(r.id) ? "Remove from favorites" : "Add to favorites"}
                >
                  {favorites.has(r.id) ? "★" : "☆"}
                </button>
              </div>
              <div className="vt-report-card-desc">{r.description}</div>
              <div className="vt-report-card-tags">
                {r.tags.map((t) => (
                  <span key={t} className="vt-tag">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
