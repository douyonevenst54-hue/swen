// @vitest-environment jsdom
/**
 * Drives the real UI (jsdom) against a running Swen server: set up the
 * device, unlock with the keypad, admit a patient, record dangerous vitals,
 * record the escalation, dispense supplies, sync. Enable with:
 *   SWEN_E2E_SERVER=http://localhost:3000 SWEN_E2E_UI_CODE=ABCD-2345 SWEN_E2E_PIN=111111
 */
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";


const SERVER = process.env.SWEN_E2E_SERVER;
const CODE = process.env.SWEN_E2E_UI_CODE;
const PIN = process.env.SWEN_E2E_PIN ?? "111111";
const suite = SERVER && CODE ? describe : describe.skip;

afterAll(cleanup);

const typeInto = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const field = (label: RegExp) => screen.getByLabelText(label, { selector: "input, textarea, select" });

suite("field app UI flow (Kreyòl)", () => {
  it("enrolls, unlocks, records vitals with escalation, dispenses and syncs", async () => {
    window.location.hash = "#/";
    const { App } = await import("../src/app/App");
    const { AppProvider } = await import("../src/app/store");
    render(
      <AppProvider>
        <App />
      </AppProvider>,
    );

    // ---- Enroll -------------------------------------------------------------
    await screen.findByText("Prepare aparèy sa a");
    typeInto(field(/Adrès sèvè a/), SERVER!);
    typeInto(field(/Kòd konfigirasyon/), CODE!);
    typeInto(field(/Non aparèy la/), "UI test tablet");
    fireEvent.click(screen.getByRole("button", { name: "Prepare aparèy la" }));

    // ---- Unlock with the keypad -------------------------------------------------
    await screen.findByText("Kiyès k ap travay?", {}, { timeout: 10_000 });
    fireEvent.click(await screen.findByRole("radio", { name: /Enfimyè Demo/ }));
    for (const d of PIN) fireEvent.click(screen.getByRole("button", { name: d }));
    fireEvent.click(screen.getByRole("button", { name: "Louvri" }));

    // ---- Ward → new patient ----------------------------------------------------------
    await screen.findByRole("button", { name: /Nouvo pasyan/ }, { timeout: 10_000 });
    act(() => {
      window.location.hash = "#/patient/new";
    });
    await screen.findByLabelText(/Prenon/);
    typeInto(field(/Prenon/), "Rose");
    typeInto(field(/Non fanmi/), "Toussaint");
    typeInto(field(/^Sal/), "Sal UI");
    typeInto(field(/Kabann/), "7");
    typeInto(field(/Ane nesans/), "1968");
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre epi pran siy vital" }));

    // ---- Record vitals: live score goes HIGH ------------------------------------------
    await screen.findByText("Pran siy vital", { selector: "h1" });
    const patientId = window.location.hash.split("/")[2]!;

    // ---- Wristband check: a wrong wristband is caught, the right one confirms ----
    fireEvent.click(screen.getByRole("button", { name: "Eskane braslè" }));
    typeInto(await screen.findByLabelText("Oswa tape kòd la"), "SWEN:PT:00000000-0000-4000-8000-000000000001");
    fireEvent.click(screen.getByRole("button", { name: "Konfime" }));
    await screen.findByText(/SE PA BON PASYAN AN/);
    expect((screen.getByRole("button", { name: "Anrejistre siy vital yo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Eskane braslè" })[0]!);
    typeInto(await screen.findByLabelText("Oswa tape kòd la"), `SWEN:PT:${patientId}`);
    fireEvent.click(screen.getByRole("button", { name: "Konfime" }));
    await screen.findByText(/Idantite pasyan an konfime/);
    typeInto(field(/Respirasyon/), "32");
    typeInto(field(/Batman kè/), "118");
    typeInto(field(/Tansyon sistolik/), "86");
    typeInto(field(/Tansyon dyastolik/), "50");
    typeInto(field(/Tanperati/), "39,2"); // French-style decimal comma
    typeInto(field(/Oksijèn nan san/), "88");
    fireEvent.click(screen.getByRole("radio", { name: /Reponn lè w pale/ }));
    // RR 32→3, HR 118→2, SBP 86→1, T 39.2→2, V→1 = 9
    const panel = await screen.findByText("IJAN: rele doktè a kounye a");
    expect(panel.closest(".mews-panel")?.querySelector(".mews-number")?.textContent).toBe("9");
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre siy vital yo" }));

    // ---- Escalation -----------------------------------------------------------------
    await screen.findByText("Kisa w fè?", {}, { timeout: 5000 });
    fireEvent.click(screen.getByLabelText("Mwen rele doktè a"));
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre aksyon an" }));

    // ---- Patient view shows the score and the recorded action ---------------------------
    await screen.findByText(/Mwen rele doktè a —/, {}, { timeout: 5000 });
    expect(screen.getByText(/✓ Braslè eskane/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rose Toussaint" })).toBeTruthy();

    // ---- Inventory: dispense 2 using FEFO ------------------------------------------------
    act(() => {
      window.location.hash = "#/inventory";
    });
    const list = await screen.findByRole("list", {}, { timeout: 5000 });
    const firstItem = within(list).getAllByRole("link")[0]!;
    const before = Number(firstItem.querySelector(".item-qty strong")!.textContent);
    fireEvent.click(firstItem);
    act(() => {
      window.location.hash = firstItem.getAttribute("href")!;
    });
    await screen.findByText(/^Pran nan lo|Kantite/, {}, { timeout: 5000 });
    typeInto(field(/Kantite/), "2");
    await screen.findByText(/Pran nan lo .* an premye/);
    fireEvent.click(screen.getAllByRole("button", { name: "Bay" }).find((b) => b.classList.contains("btn-lg"))!);
    await screen.findByText("Anrejistre", { selector: ".banner div" });
    await waitFor(() => expect(Number(document.querySelector(".stock-number")!.textContent)).toBe(before - 2));

    // ---- Front desk: search, register, check in -------------------------------------------
    act(() => {
      window.location.hash = "#/queue";
    });
    typeInto(await screen.findByLabelText("Chèche"), "Jan Batis Pyè");
    fireEvent.click(await screen.findByRole("button", { name: "+ Anrejistre yon nouvo pasyan" }));
    await screen.findByRole("button", { name: "Anrejistre epi mete l nan liy lan" });
    expect((field(/Prenon/) as HTMLInputElement).value).toBe("Jan");
    expect((field(/Non fanmi/) as HTMLInputElement).value).toBe("Batis Pyè");
    fireEvent.click(screen.getByRole("radio", { name: "Gason" }));
    typeInto(field(/Ane nesans/), "1975");
    typeInto(field(/Non manman/), "Rose");
    typeInto(field(/Komin/), "Mirebalais");
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre epi mete l nan liy lan" }));
    // A rerun against the same server finds the earlier record: keep this one separate.
    const firstSheet = await screen.findByRole("dialog");
    if (within(firstSheet).queryByText("Èske se menm moun nan?")) fireEvent.click(within(firstSheet).getByRole("button", { name: /Se pa menm moun nan/ }));

    // Check-in sheet opens for the new patient.
    const checkin = await screen.findByRole("dialog", { name: "Mete nan liy atant" }, { timeout: 5000 });
    typeInto(within(checkin).getByLabelText(/Poukisa li vini/), "Lafyèv 3 jou");
    fireEvent.click(within(checkin).getByRole("button", { name: "Mete l nan liy lan" }));
    await screen.findByRole("heading", { name: /Ap tann triyaj/ });
    const waitingRow = (await screen.findByText("Jan Batis Pyè")).closest("li")!;
    expect(within(waitingRow).getByText(/Lafyèv 3 jou/)).toBeTruthy();

    // ---- Triage: orange, then normal vitals, back to the queue --------------------------------
    fireEvent.click(within(waitingRow).getByRole("button", { name: "Fè triyaj" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Oranj/ }));
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre epi pran siy vital" }));
    await screen.findByText("Pran siy vital", { selector: "h1" });
    typeInto(field(/Respirasyon/), "16");
    typeInto(field(/Batman kè/), "80");
    typeInto(field(/Tansyon sistolik/), "120");
    typeInto(field(/Tansyon dyastolik/), "80");
    typeInto(field(/Tanperati/), "37");
    typeInto(field(/Oksijèn nan san/), "98");
    fireEvent.click(screen.getByRole("radio", { name: /Reveye/ }));
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre siy vital yo" }));
    await screen.findByRole("heading", { name: /Ap tann doktè/ }, { timeout: 5000 });
    const triagedRow = screen.getByText("Jan Batis Pyè").closest("li")!;
    expect(within(triagedRow).getByText("Oranj")).toBeTruthy();

    // ---- Doctor calls in, then done -------------------------------------------------------
    fireEvent.click(within(triagedRow).getByRole("button", { name: "Rele l antre" }));
    const consultRow = (await screen.findByRole("heading", { name: /Avèk doktè a/ })).parentElement!;
    fireEvent.click(within(consultRow).getByRole("button", { name: "Fini" }));
    await screen.findByRole("button", { name: /Fini jodi a/ });

    // ---- The French spelling finds the same person ------------------------------------------
    typeInto(screen.getByLabelText("Chèche"), "Jean Baptiste Pierre");
    const found = (await screen.findAllByText(/Jan Batis Pyè/, { selector: ".result-main strong" }))[0]!;
    expect(found.closest("li")!.textContent).toMatch(/Mirebalais/);

    // ---- Registering him again offers the existing record --------------------------------------
    act(() => {
      window.location.hash = "#/register?name=Jean%20Baptiste%20Pierre&year=1975";
    });
    await screen.findByRole("button", { name: "Anrejistre epi mete l nan liy lan" });
    fireEvent.click(screen.getByRole("radio", { name: "Gason" }));
    fireEvent.click(screen.getByRole("button", { name: "Anrejistre epi mete l nan liy lan" }));
    const dup = await screen.findByRole("dialog", { name: "Èske se menm moun nan?" });
    expect(within(dup).getAllByText(/menm non/).length).toBeGreaterThan(0);
    fireEvent.click(within(dup).getAllByRole("button", { name: /Se menm moun nan/ })[0]!);
    const again = await screen.findByRole("dialog", { name: "Mete nan liy atant" });
    fireEvent.click(within(again).getByRole("button", { name: "Anile" }));

    // ---- Sync: nothing left pending --------------------------------------------------------
    act(() => {
      window.location.hash = "#/settings";
    });
    fireEvent.click(await screen.findByRole("button", { name: "Senkronize kounye a" }));
    await waitFor(() => expect(screen.getAllByText("Tout bagay anrejistre sou sèvè a").length).toBeGreaterThan(0), { timeout: 15_000 });

    // The server issued a patient number, and it came back to the tablet.
    act(() => {
      window.location.hash = `#/patient/${patientId}`;
    });
    await waitFor(() => expect(document.querySelector(".topbar-title p")?.textContent).toMatch(/^[A-Z0-9]+-\d{6}/), { timeout: 5000 });
  });
});
