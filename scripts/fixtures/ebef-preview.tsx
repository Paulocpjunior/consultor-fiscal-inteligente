import React from "react";
import { createRoot } from "react-dom/client";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import EbefModule from "../../components/Ebef/EbefModule";
import { EmpresaAtivaProvider } from "../../services/empresaAtivaContext";
import "../../index.css";
const auth = getAuth(
  initializeApp({
    apiKey: "fake-key",
    projectId: "test",
    authDomain: "localhost",
  }),
);
await auth.authStateReady();
Object.defineProperty(auth, "currentUser", {
  value: { getIdToken: async () => "fixture" },
  configurable: true,
});
const empresa = {
  id: "test",
  nome: "Empresa de homologação (dados sintéticos)",
  cnpj: "61343420000165",
  fonte: "lucro" as const,
};
createRoot(document.getElementById("root")!).render(
  <div style={{ maxWidth: 1200, margin: "24px auto", padding: 24 }}>
    <EmpresaAtivaProvider
      empresa={empresa}
      onTrocar={() => {}}
      onAtivar={() => {}}
    >
      <EbefModule currentUser={{ uid: "tester", role: "admin" } as any} />
    </EmpresaAtivaProvider>
  </div>,
);
