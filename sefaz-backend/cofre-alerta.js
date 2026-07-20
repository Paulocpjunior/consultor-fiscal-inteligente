// ============================================================================
// sefaz-backend/cofre-alerta.js  (ESM)
// ----------------------------------------------------------------------------
// Lógica PURA (testável) dos ALERTAS do cofre de e-mail (Fase 2).
//
// Detecta três situações que exigem atenção humana e decide se dispara aviso
// (com anti-spam por assinatura, no mesmo padrão do cron-health):
//   1. erros_import  — anexos .xml que falharam ao importar
//   2. pendencias    — e-mails com anexo mas SEM .xml importável (PDF/encaminhado)
//   3. inatividade   — cliente que sempre enviava e parou (emissor pode ter caído)
//
// O DESTINATÁRIO é resolvido fora daqui: por enquanto um e-mail padrão do
// escritório; o gancho por-empresa (responsável) entra quando for atribuído.
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Empresas que enviavam saída e pararam: última saída ingerida mais antiga que
 * a janela. `ultimaSaidaPorEmpresa` é o mapa mantido pelo ingestor.
 * @param {Record<string,{nome?:string, ms:number}>} ultimaSaidaPorEmpresa
 * @param {number} hojeMs
 * @param {number} [janelaDias=7]
 */
export function detectarInatividade(ultimaSaidaPorEmpresa, hojeMs, janelaDias = 7) {
  const limite = hojeMs - janelaDias * DIA_MS;
  const inativos = [];
  for (const [empresaId, info] of Object.entries(ultimaSaidaPorEmpresa || {})) {
    const ms = Number(info?.ms);
    if (Number.isFinite(ms) && ms > 0 && ms < limite) {
      inativos.push({
        empresaId,
        nome: info.nome || '—',
        ultimaSaidaMs: ms,
        diasSem: Math.floor((hojeMs - ms) / DIA_MS),
      });
    }
  }
  return inativos.sort((a, b) => a.ultimaSaidaMs - b.ultimaSaidaMs);
}

/** Assinatura estável do estado de alerta — muda só quando o conteúdo muda. */
function calcularAssinatura(alertas) {
  return alertas
    .map((a) => {
      if (a.tipo === 'inatividade') return `inatividade:${a.empresas.map((e) => e.empresaId).sort().join(',')}`;
      return `${a.tipo}:${a.qtd}`;
    })
    .sort()
    .join('|') || 'sem_alerta';
}

/**
 * Monta a lista de alertas a partir do resultado da última run + pendências +
 * inatividade, e decide se dispara (anti-spam: só reenvia se a assinatura mudou).
 *
 * @param {object} p
 * @param {{erros?:number, errosDetalhe?:string[]}} [p.run]
 * @param {Array<{assunto?:string, from?:string, anexos?:string[]}>} [p.pendencias]
 * @param {Array<{empresaId:string, nome:string, diasSem:number}>} [p.inativos]
 * @param {{assinatura?:string}|null} [p.estadoAnterior]
 * @returns {{ enviar:boolean, alertas:Array, assinatura:string }}
 */
export function decidirAlertasCofre({ run = null, pendencias = [], inativos = [], estadoAnterior = null } = {}) {
  const alertas = [];

  const erros = Number(run?.erros || 0);
  if (erros > 0) {
    alertas.push({ tipo: 'erros_import', qtd: erros, detalhe: (run.errosDetalhe || []).slice(0, 10) });
  }
  if (pendencias.length > 0) {
    alertas.push({
      tipo: 'pendencias',
      qtd: pendencias.length,
      detalhe: pendencias.slice(0, 10).map((p) => ({ assunto: p.assunto || '(sem assunto)', from: p.from || null, anexos: p.anexos || [] })),
    });
  }
  if (inativos.length > 0) {
    alertas.push({ tipo: 'inatividade', qtd: inativos.length, empresas: inativos.slice(0, 50) });
  }

  const assinatura = calcularAssinatura(alertas);
  const mudou = assinatura !== (estadoAnterior?.assinatura || 'sem_alerta');
  return { enviar: alertas.length > 0 && mudou, alertas, assinatura };
}

/** Monta o corpo HTML do e-mail de alerta a partir dos alertas decididos. */
export function montarCorpoAlerta(alertas) {
  const partes = ['<h2>Cofre CFI — alertas de captura de saída</h2>'];
  for (const a of alertas) {
    if (a.tipo === 'erros_import') {
      partes.push(`<h3>❌ ${a.qtd} erro(s) de importação</h3><ul>${a.detalhe.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`);
    } else if (a.tipo === 'pendencias') {
      partes.push(`<h3>⚠ ${a.qtd} e-mail(s) com anexo mas sem XML importável</h3><ul>${a.detalhe.map((d) => `<li>${escapeHtml(d.assunto)}${d.from ? ` — ${escapeHtml(d.from)}` : ''} [${(d.anexos || []).map(escapeHtml).join(', ')}]</li>`).join('')}</ul>`);
    } else if (a.tipo === 'inatividade') {
      partes.push(`<h3>🔕 ${a.qtd} cliente(s) sem enviar saída (emissor pode ter parado)</h3><ul>${a.empresas.map((e) => `<li>${escapeHtml(e.nome)} — ${e.diasSem} dia(s) sem saída</li>`).join('')}</ul>`);
    }
  }
  partes.push('<p style="color:#888;font-size:12px">Aviso automático do Cofre CFI. Configure o responsável por empresa para direcionar estes alertas.</p>');
  return partes.join('\n');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
