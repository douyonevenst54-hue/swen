import { ageInYears, codePayload, type CodeKind, type MessageKey } from "@swen/core";
import Link from "next/link";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";

type LabelType = "patients" | "staff" | "devices" | "equipment";
const TYPES: LabelType[] = ["patients", "staff", "devices", "equipment"];

interface Label {
  id: string;
  code: string;
  title: string;
  lines: string[];
}

const qr = (kind: CodeKind, value: string) => QRCode.toString(codePayload(kind, value), { type: "svg", margin: 1, errorCorrectionLevel: "M" });

/**
 * Printable QR codes for traceability: patient wristbands, staff badges,
 * tablet labels and instrument asset tags. Print on sticker paper or card.
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ type?: string; ward?: string }> }) {
  const { t } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) return null;
  const sp = await searchParams;
  const type: LabelType = TYPES.includes(sp.type as LabelType) ? (sp.type as LabelType) : "patients";

  let labels: Label[] = [];
  if (type === "patients") {
    const patients = await db().patient.findMany({
      where: { facilityId: facility.id, dischargedAt: null, ...(sp.ward ? { ward: sp.ward } : {}) },
      orderBy: [{ ward: "asc" }, { bed: "asc" }, { familyName: "asc" }],
    });
    labels = await Promise.all(
      patients.map(async (p) => {
        const age = ageInYears(p.birthYear);
        return {
          id: p.id,
          code: await qr("patient", p.id),
          title: `${p.familyName.toUpperCase()} ${p.givenName}`,
          lines: [
            [p.ward, p.bed ? `${t("patients.bed")} ${p.bed}` : null].filter(Boolean).join(" · "),
            [t(`patients.sex.${p.sex}` as MessageKey), age != null ? t("patients.age", { n: age }) : null, p.mrn].filter(Boolean).join(" · "),
          ],
        };
      }),
    );
  } else if (type === "staff") {
    const staff = await db().staff.findMany({ where: { facilityId: facility.id, active: true }, orderBy: { name: "asc" } });
    labels = await Promise.all(
      staff.map(async (s) => ({ id: s.id, code: await qr("staff", s.id), title: s.name, lines: [t(`role.${s.role}` as MessageKey), facility.name] })),
    );
  } else if (type === "devices") {
    const devices = await db().device.findMany({ where: { facilityId: facility.id, revokedAt: null }, orderBy: { name: "asc" } });
    labels = await Promise.all(
      devices.map(async (d) => ({ id: d.id, code: await qr("device", d.id), title: d.name, lines: [t("dash.device"), d.id.slice(0, 8)] })),
    );
  } else {
    const equipment = await db().equipment.findMany({ where: { facilityId: facility.id, active: true }, orderBy: { code: "asc" } });
    labels = await Promise.all(
      equipment.map(async (e) => ({
        id: e.id,
        code: await qr("equipment", e.code),
        title: e.code,
        lines: [e.name, [t(`equipment.kind.${e.kind}` as MessageKey), e.serial].filter(Boolean).join(" · ")],
      })),
    );
  }

  const tabLabel: Record<LabelType, MessageKey> = {
    patients: "dash.printWristbands",
    staff: "dash.printBadges",
    devices: "dash.printDeviceLabels",
    equipment: "dash.printEquipmentLabels",
  };

  return (
    <>
      <div className="page-head no-print">
        <h1>{t(tabLabel[type])}</h1>
        <PrintButton label="🖨" />
      </div>
      <nav className="tabs no-print">
        {TYPES.map((x) => (
          <Link key={x} href={`/labels?type=${x}`} className={x === type ? "on" : ""}>
            {t(tabLabel[x])}
          </Link>
        ))}
      </nav>
      {labels.length === 0 ? (
        <p className="muted">{t("common.none")}</p>
      ) : (
        <div className={type === "patients" ? "wristbands" : "labels"}>
          {labels.map((l) => (
            <div className={type === "patients" ? "wristband" : "label"} key={l.id}>
              <div className="label-qr" dangerouslySetInnerHTML={{ __html: l.code }} />
              <div className="label-text">
                <strong>{l.title}</strong>
                {l.lines.filter(Boolean).map((line, i) => (
                  <span key={i}>{line}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
