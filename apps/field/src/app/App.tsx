import { useRegisterSW } from "virtual:pwa-register/react";
import { Enroll } from "../screens/Enroll";
import { Escalate } from "../screens/Escalate";
import { Inventory } from "../screens/Inventory";
import { ItemView } from "../screens/ItemView";
import { PatientForm } from "../screens/PatientForm";
import { PatientView } from "../screens/PatientView";
import { RecordVitals } from "../screens/RecordVitals";
import { Settings } from "../screens/Settings";
import { Unlock } from "../screens/Unlock";
import { Ward } from "../screens/Ward";
import { useRoute } from "./router";
import { useApp } from "./store";

export function App() {
  const { phase } = useApp();
  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (phase === "loading") return <div className="splash" aria-busy="true" />;
  if (phase === "enroll") return <Enroll />;
  if (phase === "locked") return <Unlock />;
  return <Unlocked updateReady={updateReady} onUpdate={() => void updateServiceWorker(true)} />;
}

function Unlocked({ updateReady, onUpdate }: { updateReady: boolean; onUpdate: () => void }) {
  const { path, query } = useRoute();
  const [a, b, c] = path;
  if (a === "patient" && b === "new") return <PatientForm />;
  if (a === "patient" && b && c === "edit") return <PatientForm id={b} />;
  if (a === "patient" && b && c === "vitals") return <RecordVitals key={`${b}-${query.get("correct")}`} patientId={b} correctId={query.get("correct")} />;
  if (a === "patient" && b) return <PatientView id={b} />;
  if (a === "escalate" && b) return <Escalate observationId={b} />;
  if (a === "inventory") return <Inventory />;
  if (a === "item" && b) return <ItemView id={b} />;
  if (a === "settings") return <Settings updateReady={updateReady} onUpdate={onUpdate} />;
  return <Ward />;
}
