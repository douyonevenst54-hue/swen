import { itemLabelPayload } from "@swen/core";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";

/** Printable sheet of QR labels, one per active item. Print on sticker paper and put them on shelves/bins. */
export default async function LabelsPage() {
  const { t } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) return null;
  const items = await db().item.findMany({ where: { facilityId: facility.id, active: true }, orderBy: [{ category: "asc" }, { nameHt: "asc" }] });
  const labels = await Promise.all(
    items.map(async (i) => ({
      item: i,
      svg: await QRCode.toString(itemLabelPayload(i.code), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    })),
  );

  return (
    <>
      <div className="page-head no-print">
        <h1>{t("dash.printLabels")}</h1>
      </div>
      <div className="labels">
        {labels.map(({ item, svg }) => (
          <div className="label" key={item.id}>
            <div dangerouslySetInnerHTML={{ __html: svg }} />
            <strong>{item.nameHt}</strong>
            <span>
              {item.nameFr} · {item.code}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
