import type { EbefContext, EbefRecord } from "./ebefTypes";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function relatorioEbef(c: EbefContext, r: EbefRecord): string {
  const a = r.analise,
    d = r.draft;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dossiê e-BEF ${esc(c.nome)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#17253a;max-width:1000px;margin:32px auto;padding:0 20px}h1{font-size:26px}h2{font-size:18px;border-bottom:1px solid #bac5d1;padding-bottom:6px;margin-top:28px}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{text-align:left;border:1px solid #c8d0d8;padding:8px;overflow-wrap:anywhere;vertical-align:top}th{background:#eef3f7}.muted{color:#566477}.box{background:#f3f6fa;padding:16px;border-radius:8px}li{margin:5px 0}@media print{body{margin:0;font-size:11px}tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body>
 <p class="muted">CFI · SP Assessoria Contábil · Dossiê de trabalho</p><h1>Beneficiários finais — e-BEF</h1><p><strong>${esc(c.nome)}</strong><br>CNPJ ${esc(c.cnpj)} · Exercício ${d.ano} · Versão ${r.revision}</p>
 <div class="box">Situação interna: <strong>${esc(r.status)}</strong><br>Data-base: ${esc(d.dataBase || "Não informada")}<br>Responsável: ${esc(d.responsavel || "Não definido")}<br>Prazo legal: ${esc(a.prazoLegal || "A confirmar")} · Prazo interno: ${esc(d.prazoInterno || "Não definido")}</div>
 <h2>Enquadramento e fundamento</h2><p>${esc(a.enquadramento)} — ${esc(a.motivo)}</p><p>Natureza: ${esc(d.natureza)} · Domicílio: ${esc(d.domicilio)} · PJ no QSA: ${esc(d.socioPJ)}</p><p>Receita informada de ${d.receitaAno}: ${esc(d.receitaAnterior || "Não informada")}. Documento: ${esc(r.documentos.find((x) => x.id === d.evidenciaReceitaId)?.nome || "Não anexado")}.</p><p>Regra: ${esc(a.regra)}. Fonte: <a href="${esc(a.fonte)}">Manual oficial da Receita Federal</a>.</p>
 <h2>Pendências da análise</h2><ul>${a.pendencias.length ? a.pendencias.map((x) => `<li>${esc(x)}</li>`).join("") : "<li>Sem pendências automáticas registradas nesta versão. A revisão documental é obrigatória.</li>"}</ul>
 <h2>Beneficiários indicados</h2><table><thead><tr><th>Pessoa física</th><th>Capital e critérios</th><th>Caminhos</th></tr></thead><tbody>${a.beneficiarios.map((b) => `<tr><td>${esc(b.nome)}</td><td>${esc(b.percentual)}${b.percentual === "não quantificado" ? "" : "%"}<br>${b.criterios.map(esc).join("<br>")}</td><td>${b.caminhos.map(esc).join("<br>")}</td></tr>`).join("")}</tbody></table>
 <h2>Vínculos documentados</h2><table><thead><tr><th>Titular → Entidade</th><th>Capital / voto</th><th>Período</th><th>Documento</th></tr></thead><tbody>${d.vinculos.map((v) => `<tr><td>${esc(d.pessoas.find((p) => p.id === v.titularId)?.nome)} → ${esc(v.entidadeId === "matriz" ? c.nome : d.pessoas.find((p) => p.id === v.entidadeId)?.nome)}</td><td>${esc(v.capital)}% / ${esc(v.votos)}%</td><td>${esc(v.inicio)} — ${esc(v.fim || "em curso")}</td><td>${esc(r.documentos.find((x) => x.id === v.evidenciaId)?.nome || "Ausente")}</td></tr>`).join("")}</tbody></table>
 <h2>Entrega e confirmações</h2><p>${r.entrega ? `Protocolo ${esc(r.entrega.protocolo)} · ${esc(r.entrega.data)}` : "Entrega não registrada."}</p><ul>${a.beneficiarios
   .map((b) => {
     const p = d.pessoas.find((p) => p.id === b.id);
     return `<li>${esc(b.nome)}: ${esc(p?.assinatura)} — ${esc(p?.assinaturaJustificativa)}</li>`;
   })
   .join("")}</ul>
 <h2>Documentos preservados</h2><ul>${r.documentos.map((x) => `<li>${esc(x.nome)}<br><small>SHA-256: ${esc(x.sha256)}</small></li>`).join("")}</ul><h2>Observações</h2><p style="white-space:pre-wrap">${esc(d.observacoes)}</p><p class="muted">Atualização: ${esc(r.atualizadoEm)} · Autor: ${esc(r.atualizadoPor)}. Este dossiê não substitui recibos ou comprovação de regularidade emitidos pela Receita.</p></body></html>`;
}
export function imprimirEbef(c: EbefContext, r: EbefRecord): void {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Permita a abertura do relatório no navegador.");
  w.opener = null;
  w.document.write(relatorioEbef(c, r));
  w.document.close();
  w.focus();
  w.print();
}
