// ============================================================================
// sefaz-backend/captura-resumo-cron.js  (ESM)
// ----------------------------------------------------------------------------
// Resumo diario por email das capturas NFe DistDFe.
//
// Conteudo do email:
//  1. KPIs do dia anterior (24h): empresas tentadas, XMLs novos, erros
//  2. Quebra por cStat: 137 (nada novo), 138 (ok), 280 (cert invalido),
//     593 (cert/cnpj-base), 656 (rejeicao por consumo indevido)
//  3. Tabela com empresas monitoradas e STATUS individual: ultima sync,
//     cStat, NSU, XMLs novos
//  4. Acoes sugeridas pra erros recorrentes
//
// Auth: x-cron-secret (mesmo padrao dos demais crons).
// Canal: email via Microsoft Graph (mesmo do cert-alerta-cron).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';
import { secretsMatch } from './cron-secret.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { analisarSequenciasSaida } from './prova-saida.js';

const router = express.Router();

const REMETENTE = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
// Aceita lista: CAPTURA_RESUMO_TO="a@sp.com.br, b@sp.com.br; c@sp.com.br".
// Valores inválidos na env var (ex.: nome sem @) caem no destinatário padrão.
const DESTINATARIO_PADRAO = 'alexandre@spassessoriacontabil.com.br';
const ALERTA_PARA = parseDestinatarios(process.env.CAPTURA_RESUMO_TO, DESTINATARIO_PADRAO);
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function requireCronAuth(req, res, next) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) {
    console.error('[captura-resumo-cron] SEFAZ_CRON_SECRET não configurado');
    return res.status(500).json({ error: 'Cron secret not configured' });
  }
  const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
  if (secretsMatch(headerSecret, secret)) return next();
  const headerPrefix = headerSecret ? String(headerSecret).slice(0, 4) + '...' : '(ausente)';
  const jobName = req.headers['x-cloudscheduler-jobname'] || '(no header)';
  console.warn(`[captura-resumo-cron] 403 mismatch — header=${headerPrefix} job=${jobName} ip=${req.ip}`);
  return res.status(403).json({ error: 'Cron auth failed' });
}

// Mapa cStat → label + acao sugerida. Cobre os mais frequentes em DistDFe.
const CSTAT_LABEL = {
  '137': { label: 'Nada novo (NSU em dia)', categoria: 'ok' },
  '138': { label: 'Documentos retornados', categoria: 'ok' },
  '252': { label: 'Ambiente inválido', categoria: 'erro', acao: 'Verificar SEFAZ_AMBIENTE=producao' },
  '280': { label: 'Certificado inválido', categoria: 'erro', acao: 'Renovar A1 da empresa/mesma raiz CNPJ ou usar agente A3 local.' },
  '281': { label: 'Cert expirado', categoria: 'erro', acao: 'Renovar A1 da empresa/mesma raiz CNPJ ou usar agente A3 local.' },
  '283': { label: 'Cert não pertence ao CNPJ consultado', categoria: 'erro', acao: 'Subir A1 da mesma raiz CNPJ da empresa consultada.' },
  '593': { label: 'CNPJ-Base do certificado divergente', categoria: 'erro', acao: 'Para NFe DistDFe, use A1 próprio/mesma raiz CNPJ. Procuração e-CAC do escritório não substitui certificado.' },
  '656': { label: 'Consumo indevido (rate-limit)', categoria: 'erro', acao: 'Reduzir frequência do cron OU intercalar requests' },
};

function categorizarCstat(cStat) {
  if (!cStat) return 'sem_sync';
  const info = CSTAT_LABEL[cStat];
  return info?.categoria || 'erro';
}

function fmtDateBr(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch { return '—'; }
}

function fmtMillisBr(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Coleta dados das empresas com procuracaoEcacAtiva=true + estado de captura
// + contagem de XMLs capturados nas ultimas 24h.
async function coletarDados() {
  const db = fa().firestore();
  const agoraMs = Date.now();
  const desdeMs = agoraMs - 24 * 60 * 60 * 1000;

  // 1. Empresas com procuracao ativa
  const empresas = [];
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    const snap = await db.collection(col)
      .where('procuracaoEcacAtiva', '==', true)
      .get();
    snap.forEach(doc => {
      const d = doc.data() || {};
      if (d._merged_into || d._deleted) return; // perdedor de merge / excluida
      const cnpj = (d.cnpj || '').replace(/\D/g, '');
      if (cnpj.length !== 14) return;
      if (empresas.some(e => e.cnpj === cnpj)) return; // dedup
      empresas.push({
        id: doc.id,
        cnpj,
        nome: d.razaoSocial || d.nome || d.fantasia || '—',
        regime: col === 'simples_empresas' ? 'simples' : 'lucro',
        uf: d.dadosFiscais?.uf || d.uf || '—',
      });
    });
  }

  // 2. Estado de captura por CNPJ (sefaz_state/{cnpj})
  for (const e of empresas) {
    try {
      const snap = await db.collection('sefaz_state').doc(e.cnpj).get();
      if (snap.exists) {
        const d = snap.data();
        e.ultimaSyncMs = d.ultimaSync?.toMillis?.() ?? null;
        e.cStat = d.cStatUltimaSync || null;
        e.ultNSU = d.ultNSU || '0';
      } else {
        e.ultimaSyncMs = null;
        e.cStat = null;
        e.ultNSU = '0';
      }
    } catch (err) {
      console.warn(`[captura-resumo-cron] erro lendo sefaz_state/${e.cnpj}:`, err.message);
      e.ultimaSyncMs = null;
      e.cStat = null;
      e.ultNSU = '0';
    }
  }

  // 3. XMLs capturados nas ultimas 24h (origem='sefaz'), agrupado por empresaCnpj
  const xmlsPorCnpj = new Map();
  try {
    const snap = await db.collection('xml_capturas')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(desdeMs))
      .where('origem', '==', 'sefaz')
      .get();
    snap.forEach(doc => {
      const cnpj = (doc.data().empresaCnpj || '').replace(/\D/g, '');
      if (!cnpj) return;
      xmlsPorCnpj.set(cnpj, (xmlsPorCnpj.get(cnpj) || 0) + 1);
    });
  } catch (err) {
    console.warn('[captura-resumo-cron] erro lendo xml_capturas:', err.message);
  }
  for (const e of empresas) e.xmlsNovas24h = xmlsPorCnpj.get(e.cnpj) || 0;

  // 4. PROVA DE SAÍDA por numeração (pedido do Paulo 30/07 — "não pode ser no
  // chute"): buracos na sequência de nNF por série = notas faltantes COM
  // NÚMERO. Vai no e-mail diário pra equipe agir com exatidão. Universo:
  // TODAS as empresas monitoradas (não só procuração) — saída chega por
  // cofre/autXML independente de procuração.
  let provaSaida = null;
  try {
    const todasEmpresas = [];
    for (const col of ['simples_empresas', 'lucro_empresas']) {
      const snap = await db.collection(col).get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if (d._merged_into || d._deleted) return;
        const cnpj = (d.cnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) return;
        todasEmpresas.push({ empresaId: doc.id, cnpj, nome: d.razaoSocial || d.nome || '—' });
      });
    }
    const snaps = await fetchAllDocs(
      db.collection('documentos_fiscais').where('direcao', '==', 'saida'),
      { label: 'captura-resumo/prova-saida' },
    );
    const docsSaida = snaps.map((s) => {
      const x = s.data() || {};
      return {
        empresaId: x.empresaId, cnpjEmit: x.cnpjEmit, empresaCnpj: x.empresaCnpj,
        direcao: x.direcao, chave: x.chave, dhEmi: x.dhEmi,
        numero: x.numero, serie: x.serie,
      };
    });
    provaSaida = analisarSequenciasSaida({ docs: docsSaida, empresas: todasEmpresas, hojeMs: agoraMs, janelaDias: 90 });
  } catch (err) {
    console.warn('[captura-resumo-cron] prova de saída falhou:', err.message);
  }

  return { empresas, desdeMs, agoraMs, provaSaida };
}

// Seção "Prova de Saída por numeração" do e-mail. Só as empresas com BURACO
// (número exato das notas faltantes) — quem está exato vira uma linha-resumo.
function montarSecaoProvaSaida(provaSaida) {
  if (!provaSaida) return '';
  const { totais, empresas, janelaDias } = provaSaida;
  if (!totais || totais.empresasAnalisadas === 0) return '';

  const comBuraco = empresas.filter((e) => e.farol === 'incompleta').slice(0, 15);
  const linhas = comBuraco.map((e) => {
    const seriesTxt = e.series
      .filter((s) => s.totalFaltantes > 0)
      .map((s) => `série ${s.serie}: faltam ${s.totalFaltantes} — nº ${s.faltantes.join(', ')}${s.faltantesTruncado ? '…' : ''}`)
      .join('<br>');
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px">${e.cnpj}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${e.nome}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#b91c1c">${e.totalFaltantes}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px">${seriesTxt}</td>
      </tr>`;
  }).join('');

  return `
  <h3 style="color:#1f2937;margin:20px 0 4px">🔢 Prova de Saída por numeração (mod 55, ${janelaDias}d)</h3>
  <p style="color:#6b7280;font-size:12px;margin:0 0 8px">
    NF-e é sequencial por série: buraco na sequência capturada = nota que NÃO recebemos, com o número exato.
    <strong>${totais.empresasExatas}</strong> empresa(s) com sequência exata ·
    <strong style="color:${totais.empresasComBuraco > 0 ? '#b91c1c' : '#15803d'}">${totais.empresasComBuraco}</strong> com buraco ·
    <strong>${totais.notasFaltantes}</strong> nota(s) faltante(s) no total.
    <br><em>Um buraco também pode ser numeração INUTILIZADA (não desce por DistDFe) — confirmar com o cliente antes de cobrar.</em>
  </p>
  ${comBuraco.length > 0 ? `
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
    <thead>
      <tr style="background:#fef2f2">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #fecaca">CNPJ</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #fecaca">Empresa</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #fecaca">Faltantes</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #fecaca">Números exatos (por série)</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  ${totais.empresasComBuraco > comBuraco.length ? `<p style="font-size:11px;color:#6b7280">Mostrando ${comBuraco.length} de ${totais.empresasComBuraco} — lista completa na aba Cobertura de Saída → Prova de Saída.</p>` : ''}
  ` : '<p style="color:#15803d;font-size:12px">✓ Nenhum buraco de numeração — tudo que os clientes emitiram na janela chegou.</p>'}`;
}

function montarHtml({ empresas, desdeMs, agoraMs, provaSaida }) {
  // Agregados
  const total = empresas.length;
  const ok = empresas.filter(e => categorizarCstat(e.cStat) === 'ok').length;
  const erro = empresas.filter(e => categorizarCstat(e.cStat) === 'erro').length;
  const semSync = empresas.filter(e => !e.ultimaSyncMs).length;
  const totalXmls = empresas.reduce((acc, e) => acc + e.xmlsNovas24h, 0);
  const comXmls = empresas.filter(e => e.xmlsNovas24h > 0).length;

  // Quebra por cStat
  const porCstat = new Map();
  empresas.forEach(e => {
    const k = e.cStat || 'sem_sync';
    porCstat.set(k, (porCstat.get(k) || 0) + 1);
  });

  // Ordenacao: erros primeiro, depois sem_sync, depois ok por xmls desc
  empresas.sort((a, b) => {
    const aCat = categorizarCstat(a.cStat);
    const bCat = categorizarCstat(b.cStat);
    if (aCat !== bCat) {
      const ordem = { erro: 0, sem_sync: 1, ok: 2 };
      return ordem[aCat] - ordem[bCat];
    }
    return b.xmlsNovas24h - a.xmlsNovas24h;
  });

  const linhas = empresas.map(e => {
    const cat = categorizarCstat(e.cStat);
    const cor = cat === 'erro' ? '#dc2626' : cat === 'ok' ? '#16a34a' : '#6b7280';
    const info = e.cStat ? (CSTAT_LABEL[e.cStat]?.label || e.cStat) : 'Nunca sincronizou';
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px">${e.cnpj}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${e.nome}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${e.uf}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:${cor};font-weight:600">${e.cStat || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px">${info}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${e.xmlsNovas24h}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px">${fmtMillisBr(e.ultimaSyncMs)}</td>
      </tr>`;
  }).join('');

  const cstatBreakdown = Array.from(porCstat.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const info = CSTAT_LABEL[k];
      const label = info?.label || (k === 'sem_sync' ? 'Nunca sincronizou' : `cStat ${k}`);
      const acao = info?.acao ? `<br><span style="color:#6b7280;font-size:11px">→ ${info.acao}</span>` : '';
      return `<li><strong>${k === 'sem_sync' ? '—' : k}</strong> · ${label} — <strong>${v}</strong> empresa(s)${acao}</li>`;
    }).join('');

  return `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#1f2937;background:#f9fafb;padding:16px">
<div style="max-width:900px;margin:0 auto;background:white;border-radius:8px;padding:24px;border:1px solid #e5e7eb">
  <h2 style="color:#1e40af;margin:0 0 4px">📊 Resumo Diário · Captura NFe via Procuração e-CAC</h2>
  <p style="color:#6b7280;font-size:12px;margin:0 0 16px">
    Período: ${fmtMillisBr(desdeMs)} → ${fmtMillisBr(agoraMs)} (últimas 24h) ·
    S&P Assessoria Contábil
  </p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr>
      <td style="padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;text-align:center;width:25%">
        <div style="font-size:11px;color:#1e40af;font-weight:600;text-transform:uppercase">Empresas Monitoradas</div>
        <div style="font-size:24px;font-weight:700;color:#1e40af">${total}</div>
        <div style="font-size:11px;color:#6b7280">com procuração ativa</div>
      </td>
      <td style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;text-align:center;width:25%">
        <div style="font-size:11px;color:#15803d;font-weight:600;text-transform:uppercase">XMLs Novos (24h)</div>
        <div style="font-size:24px;font-weight:700;color:#15803d">${totalXmls}</div>
        <div style="font-size:11px;color:#6b7280">${comXmls} empresa(s) capturaram</div>
      </td>
      <td style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;text-align:center;width:25%">
        <div style="font-size:11px;color:#b91c1c;font-weight:600;text-transform:uppercase">Erros</div>
        <div style="font-size:24px;font-weight:700;color:#b91c1c">${erro}</div>
        <div style="font-size:11px;color:#6b7280">empresa(s) com cStat ≠ 137/138</div>
      </td>
      <td style="padding:12px;background:#fefce8;border:1px solid #fde68a;border-radius:6px;text-align:center;width:25%">
        <div style="font-size:11px;color:#a16207;font-weight:600;text-transform:uppercase">Sem Sync</div>
        <div style="font-size:24px;font-weight:700;color:#a16207">${semSync}</div>
        <div style="font-size:11px;color:#6b7280">nunca sincronizaram</div>
      </td>
    </tr>
  </table>

  <h3 style="color:#1f2937;margin:0 0 8px">Quebra por cStat</h3>
  <ul style="margin:0 0 20px;padding-left:20px;line-height:1.7">${cstatBreakdown || '<li>nenhum dado</li>'}</ul>

  <h3 style="color:#1f2937;margin:0 0 8px">Detalhamento por empresa</h3>
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">CNPJ</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">Razão Social</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">UF</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">cStat</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">Status</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #d1d5db">XMLs 24h</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db">Última sync</th>
      </tr>
    </thead>
    <tbody>${linhas || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#6b7280">Nenhuma empresa com procuração ativa.</td></tr>'}</tbody>
  </table>

  ${montarSecaoProvaSaida(provaSaida)}

  <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">
    Email gerado automaticamente pelo Consultor Fiscal Inteligente — cron <code>captura-resumo-cron</code>.<br>
    Pra desativar: remova o Cloud Scheduler <code>captura-resumo-diario</code> ou ajuste <code>CAPTURA_RESUMO_TO</code>.
  </p>
</div>
</body></html>`;
}

// Cloud Scheduler bate via POST (--http-method=POST nos jobs do
// setup-cloud-schedulers.sh). Mantemos consistente com os demais crons
// (cert-alerta-cron, sefaz-cron-noturno, etc). Body vazio = {}.
router.post('/captura-resumo-cron', requireCronAuth, async (req, res) => {
  try {
    const dados = await coletarDados();
    if (dados.empresas.length === 0) {
      return res.json({ ok: true, motivo: 'Nenhuma empresa com procuracaoEcacAtiva=true', total: 0 });
    }

    const graphOk = isGraphConfigured();
    if (!graphOk) {
      return res.json({
        ok: false,
        motivo: 'Microsoft Graph não configurado — email não enviado',
        total: dados.empresas.length,
      });
    }

    const erros = dados.empresas.filter(e => categorizarCstat(e.cStat) === 'erro').length;
    const totalXmls = dados.empresas.reduce((acc, e) => acc + e.xmlsNovas24h, 0);
    const faltantes = dados.provaSaida?.totais?.notasFaltantes || 0;
    // Nota faltante no ASSUNTO: é o número que exige ação — não pode ficar
    // enterrado no corpo (exatidão pedida pelo Paulo 30/07).
    const sufixoProva = faltantes > 0 ? ` · 🔢 ${faltantes} nota(s) de saída FALTANDO` : '';
    const assunto = `📊 Captura via procuração e-CAC — ${dados.empresas.length} empresa(s), ${totalXmls} XMLs, ${erros} erro(s)${sufixoProva}`;

    const r = await enviarEmail({
      remetente: REMETENTE,
      para: ALERTA_PARA,
      assunto,
      corpoHtml: montarHtml(dados),
    });

    return res.json({
      ok: r.ok,
      total: dados.empresas.length,
      totalXmls,
      erros,
      provaSaida: dados.provaSaida?.totais || null,
      emailStatus: r.ok ? 'enviado' : `falha: ${r.error || 'desconhecida'}`,
    });
  } catch (e) {
    console.error('[captura-resumo-cron] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
