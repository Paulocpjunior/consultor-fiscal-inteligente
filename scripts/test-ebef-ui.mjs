import { chromium } from "playwright";
import { novoEbef, analisarEbef } from "../sefaz-backend/ebef-core.js";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let draft = novoEbef(2026),
    record = {
      revision: 0,
      status: "rascunho",
      draft,
      documentos: [],
      analise: analisarEbef(draft),
      entrega: null,
      atualizadoEm: "",
      atualizadoPor: "",
    };
  await page.route("**/api/admin/ebef**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const p = req.postDataJSON();
      record = {
        ...record,
        draft: p.draft,
        revision: record.revision + 1,
        analise: analisarEbef(p.draft),
      };
    }
    await route.fulfill({ json: { ok: true, record } });
  });
  await page.goto("http://127.0.0.1:5179/scripts/fixtures/ebef-preview.html");
  await page
    .getByRole("button", { name: "Enquadramento", exact: true })
    .click();
  await page.getByLabel("Natureza jurídica").selectOption("scp");
  await page.getByLabel("Domicílio da entidade").selectOption("BR");
  await page
    .getByLabel("Responsável pelo atendimento")
    .fill("Equipe de homologação");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await page.getByText("Operação salva no servidor.").waitFor();
  assert.equal(record.draft.natureza, "scp");
  await page
    .getByRole("button", { name: "Estrutura societária", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adicionar participante", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("Participante sintético");
  await page.getByLabel("Condição na SCP").selectOption("participante");
  await page
    .getByRole("button", { name: "Adicionar vínculo", exact: true })
    .click();
  await page.getByLabel("Capital (%)", { exact: true }).fill("-1");
  await page.getByText("Revise os valores:", { exact: false }).waitFor();
  await page.getByLabel("Capital (%)", { exact: true }).fill("1");
  await page.screenshot({ path: "/tmp/cfi-ebef-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/cfi-ebef-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "e-BEF UI: form edits, SCP fields, server save, invalid-input recovery and mobile width passed.",
  );
} finally {
  await browser.close();
}
