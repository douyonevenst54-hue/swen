import { useEffect, useState } from "react";

/**
 * Hash routes so the app works from a single cached index.html offline.
 *   #/                      ward
 *   #/patient/new           new patient
 *   #/patient/:id           patient
 *   #/patient/:id/edit      edit patient
 *   #/patient/:id/vitals    record vitals (?correct=<obsId>)
 *   #/escalate/:obsId       record escalation action
 *   #/inventory             supplies
 *   #/item/:id              item (?action=dispense|receive|...)
 *   #/settings
 */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [p = "/", q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo?.(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(path: string): void {
  window.location.hash = path;
}

export function back(fallback = "/"): void {
  if (window.history.length > 1) window.history.back();
  else go(fallback);
}
