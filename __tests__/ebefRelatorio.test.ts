import { relatorioEbef } from "../services/ebefRelatorio";
import { novoEbef, analisarEbef } from "../sefaz-backend/ebef-core.js";
import type { EbefRecord } from "../services/ebefTypes";
test("relatório identifica pendências e escapa dados do cliente", () => {
  const draft = novoEbef(2026);
  draft.observacoes = "<script>alert(1)</script>";
  const r = {
    draft,
    revision: 1,
    status: "rascunho",
    documentos: [],
    analise: analisarEbef(draft),
    entrega: null,
    atualizadoEm: "2026-09-15",
    atualizadoPor: "autor",
  } as EbefRecord;
  const html = relatorioEbef(
    {
      empresaId: "test",
      fonte: "lucro",
      cnpj: "61343420000165",
      nome: "Empresa <teste>",
    },
    r,
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Entrega não registrada");
  expect(html).toContain("Revisar dispensas");
  expect(html).toContain("Versão 1");
});
