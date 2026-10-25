import { computeStock, describeStockAlert, localDate, parseItemCode, stockAlerts, type Item, type ItemStock, type StockAlert } from "@swen/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, BottomNav, Empty, TopBar } from "../app/components";
import { go } from "../app/router";
import { useApp } from "../app/store";
import { itemByCode, allMovements, listItems } from "../lib/repo";
import { scanOnce, scanSupported } from "../lib/scanner";

export function itemName(i: Pick<Item, "nameHt" | "nameFr">, locale: string) {
  return locale === "fr" ? i.nameFr : i.nameHt;
}

export function Inventory() {
  const { t, locale, dataVersion, fmtDate } = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  const [stock, setStock] = useState<Map<string, ItemStock>>(new Map());
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void Promise.all([listItems(), allMovements()]).then(([its, mv]) => {
      const today = localDate(new Date());
      const s = computeStock(mv, today);
      setItems(its);
      setStock(s);
      setAlerts(stockAlerts(its, s, today));
    });
  }, [dataVersion]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const alertsByItem = useMemo(() => {
    const m = new Map<string, StockAlert[]>();
    for (const a of alerts) m.set(a.itemId, [...(m.get(a.itemId) ?? []), a]);
    return m;
  }, [alerts]);

  async function openCode(raw: string) {
    const code = parseItemCode(raw);
    const item = await itemByCode(code);
    if (item) go(`/item/${item.id}`);
    else setNotFound(code);
  }

  async function scan() {
    setNotFound(null);
    setScanning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Wait one frame so the <video> element exists.
    await new Promise((r) => requestAnimationFrame(r));
    try {
      const value = await scanOnce(videoRef.current!, ctrl.signal);
      setScanning(false);
      await openCode(value);
    } catch {
      setScanning(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => i.active && (!q || `${i.code} ${i.nameHt} ${i.nameFr} ${i.category ?? ""}`.toLowerCase().includes(q)));

  return (
    <>
      <TopBar title={t("inventory.title")} />
      <main className="content">
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && void openCode(query)}
            placeholder={`${t("common.search")} / ${t("dash.code")}`}
            aria-label={t("common.search")}
          />
          {scanSupported() && (
            <button className="btn btn-primary" onClick={() => void scan()}>
              {t("inventory.scan")}
            </button>
          )}
        </div>
        {scanning && (
          <div className="scanner">
            <video ref={videoRef} playsInline muted />
            <p>{t("inventory.scanHint")}</p>
            <button
              className="btn btn-quiet"
              onClick={() => {
                abortRef.current?.abort();
                setScanning(false);
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
        {notFound && <Banner tone="warn">{t("inventory.notFound", { code: notFound })}</Banner>}

        {items === null ? (
          <p className="muted pad">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <Empty>{t("inventory.empty")}</Empty>
        ) : (
          <ul className="item-list">
            {shown.map((i) => {
              const s = stock.get(i.id);
              const a = alertsByItem.get(i.id) ?? [];
              const worst = a[0];
              return (
                <li key={i.id}>
                  <a href={`#/item/${i.id}`} className={worst ? `alert-${worst.kind}` : ""}>
                    <span className="item-main">
                      <strong>{itemName(i, locale)}</strong>
                      <small>
                        {i.code}
                        {i.category ? ` · ${i.category}` : ""}
                      </small>
                      {a.map((x, k) => (
                        <span key={k} className={`tag ${x.kind === "expiring_soon" || x.kind === "low_stock" ? "tag-warn" : "tag-danger"}`}>
                          {describeStockAlert(t, x, fmtDate)}
                        </span>
                      ))}
                    </span>
                    <span className="item-qty">
                      <strong>{s?.usable ?? 0}</strong>
                      <small>{i.unit}</small>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <BottomNav current="inventory" />
    </>
  );
}
