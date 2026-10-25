import { DEFAULT_MEWS_CONFIG, resolveMewsConfig, Role, type MessageKey } from "@swen/core";
import {
  createCabinetAction,
  createFacility,
  createStaff,
  newSetupCode,
  resetMewsConfig,
  resetStaffPin,
  revokeDeviceAction,
  saveMewsConfig,
  toggleStaff,
} from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/ui";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";

export default async function AdminPage() {
  const { t, fmtRelative, fmtDateTime } = await getI18n();
  const { facility, facilities } = await currentFacility();

  const facilitySection = (
    <Section title={t("dash.facilities")}>
      {facilities.length > 0 && (
        <ul className="list" style={{ marginBottom: 12 }}>
          {facilities.map((f) => (
            <li key={f.id}>
              <span>{f.name}</span>
              {f.id === facility?.id && <span className="pill">✓</span>}
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={createFacility} submitLabel={t("dash.addFacility")}>
        <label>
          {t("dash.name")}
          <input name="name" required maxLength={120} placeholder="Lopital Sen Mak" />
        </label>
      </ActionForm>
    </Section>
  );

  if (!facility) return facilitySection;

  const [staff, devices, cabinets, codes] = await Promise.all([
    db().staff.findMany({ where: { facilityId: facility.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db().device.findMany({ where: { facilityId: facility.id }, orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }] }),
    db().cabinet.findMany({ where: { facilityId: facility.id }, orderBy: { name: "asc" } }),
    db().enrollmentCode.findMany({ where: { facilityId: facility.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  const config = resolveMewsConfig(facility.mewsConfig);

  return (
    <>
      <div className="page-head">
        <h1>{t("dash.admin")}</h1>
      </div>

      <Section title={t("dash.staff")}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("dash.name")}</th>
                <th>{t("dash.role")}</th>
                <th>{t("dash.resetPin")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className={s.active ? "" : "muted"}>
                  <td>
                    {s.name}
                    {s.lockedUntil && s.lockedUntil > new Date() && <span className="pill pill-high"> 🔒</span>}
                  </td>
                  <td>{t(`role.${s.role}` as MessageKey)}</td>
                  <td>
                    <ActionForm action={resetStaffPin} submitLabel="✓" variant="secondary" className="inline">
                      <input type="hidden" name="staffId" value={s.id} />
                      <input name="pin" inputMode="numeric" pattern="\d{6,8}" placeholder="PIN" aria-label={t("dash.resetPin")} required />
                    </ActionForm>
                  </td>
                  <td>
                    <form action={toggleStaff}>
                      <input type="hidden" name="staffId" value={s.id} />
                      <button className="btn btn-secondary" type="submit">
                        {s.active ? t("dash.deactivate") : t("dash.activate")}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ margin: "16px 0 8px" }}>{t("dash.addStaff")}</h3>
        <ActionForm action={createStaff} submitLabel={t("common.add")}>
          <div className="form-row">
            <label>
              {t("dash.name")}
              <input name="name" required maxLength={80} />
            </label>
            <label>
              {t("dash.role")}
              <select name="role" defaultValue="nurse">
                {Role.options.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PIN
              <input name="pin" inputMode="numeric" pattern="\d{6,8}" required autoComplete="off" />
            </label>
          </div>
          <p className="muted small">{t("dash.pinHelp")}</p>
        </ActionForm>
      </Section>

      <div className="grid-2">
        <Section title={t("dash.enrollment")}>
          <p className="muted small">{t("dash.codeHelp")}</p>
          <ActionForm action={newSetupCode} submitLabel={t("dash.newCode")} />
          {codes.length > 0 && (
            <ul className="list small" style={{ marginTop: 12 }}>
              {codes.map((c) => (
                <li key={c.id}>
                  <span className="muted">••••-••••</span>
                  <span>{t("dash.expires", { time: fmtDateTime(c.expiresAt) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("dash.devices")}>
          {devices.length === 0 ? (
            <p className="muted">{t("common.none")}</p>
          ) : (
            <ul className="list">
              {devices.map((d) => (
                <li key={d.id} className={d.revokedAt ? "muted" : ""}>
                  <span>
                    {d.name}
                    <br />
                    <span className="small muted">
                      {t("dash.lastSeen")}: {d.lastSeenAt ? fmtRelative(d.lastSeenAt) : t("sync.never")}
                      {d.appVersion ? ` · v${d.appVersion}` : ""}
                    </span>
                  </span>
                  {d.revokedAt ? (
                    <span className="pill">{t("dash.revoked")}</span>
                  ) : (
                    <form action={revokeDeviceAction}>
                      <input type="hidden" name="deviceId" value={d.id} />
                      <button className="btn btn-danger" type="submit">
                        {t("dash.revoke")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("dash.cabinets")}>
          {cabinets.length > 0 && (
            <ul className="list" style={{ marginBottom: 12 }}>
              {cabinets.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.name}
                    {c.location ? <span className="muted"> · {c.location}</span> : null}
                  </span>
                  <span className="small muted">{c.lastSeenAt ? fmtRelative(c.lastSeenAt) : t("sync.never")}</span>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={createCabinetAction} submitLabel={t("dash.addCabinet")}>
            <div className="form-row">
              <label>
                {t("dash.name")}
                <input name="name" required maxLength={80} />
              </label>
              <label>
                {t("inventory.location")} <span className="muted">({t("common.optional")})</span>
                <input name="location" maxLength={80} />
              </label>
            </div>
          </ActionForm>
        </Section>

        {facilitySection}
      </div>

      <Section title={t("dash.mewsSettings")}>
        <p className="muted small">{t("dash.mewsHelp")}</p>
        <ActionForm action={saveMewsConfig} submitLabel={t("common.save")} resetOnSuccess={false}>
          <textarea name="config" defaultValue={JSON.stringify(config, null, 2)} spellCheck={false} aria-label={t("dash.mewsSettings")} />
        </ActionForm>
        {JSON.stringify(config) !== JSON.stringify(DEFAULT_MEWS_CONFIG) && (
          <div style={{ marginTop: 10 }}>
            <ActionForm action={resetMewsConfig} submitLabel={t("dash.mewsReset")} variant="secondary" />
          </div>
        )}
      </Section>
    </>
  );
}
