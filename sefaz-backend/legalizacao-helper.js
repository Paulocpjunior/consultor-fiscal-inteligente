// ============================================================================
// sefaz-backend/legalizacao-helper.js
// Lógica PURA do módulo Legalização: classificação de vencimentos
// (certificados digitais, certidões, procurações, parcelamentos), faixas de
// alerta antecipado e montagem dos e-mails ao cliente.
//
// Sem I/O — testado em __tests__/legalizacaoHelper.test.ts.
// ESPELHO frontend: services/legalizacaoLogic.ts (mesmos limiares — manter
// em sincronia manual, mesmo pacto do calendarioFiscal ↔ tarefas-orchestrator).
// ============================================================================

/**
 * Faixas de antecedência (dias antes do vencimento) em que o cron alerta.
 * A cada corrida vale a MENOR faixa >= diasRestantes ainda não alertada —
 * assim fins de semana/feriados sem cron não "pulam" o alerta (o próximo
 * dia útil dispara a faixa corrente).
 */
export const FAIXAS_ALERTA = [30, 15, 7, 3, 1, 0];

/** Vencido há mais que isso = histórico (não alertar; o form existe desde 2020). */
export const DIAS_VENCIDO_HISTORICO = 60;

/**
 * Classifica um vencimento pelo farol do módulo.
 * @param {number|null} diasRestantes  dias até o vencimento (negativo = vencido)
 * @returns {'sem_data'|'vencido'|'critico'|'atencao'|'ok'}
 */
export function classificarVencimento(diasRestantes) {
    if (diasRestantes === null || diasRestantes === undefined || Number.isNaN(diasRestantes)) return 'sem_data';
    if (diasRestantes < 0) return 'vencido';
    if (diasRestantes <= 7) return 'critico';
    if (diasRestantes <= 30) return 'atencao';
    return 'ok';
}

/**
 * Faixa de alerta devida para o item hoje, ou null se nenhum alerta cabe.
 * - Vencido recentemente (até DIAS_VENCIDO_HISTORICO): faixa 'vencido' (uma vez).
 * - Vencido antigo: null (histórico, não spam).
 * - Futuro: a MENOR faixa f com diasRestantes <= f. Ex.: 9 dias → 15.
 *   Idempotência por item+faixa fica no orquestrador (doc em legalizacao_alertas).
 * @param {number|null} diasRestantes
 * @param {number[]} [faixas]
 * @returns {number|'vencido'|null}
 */
export function faixaAlertaDevida(diasRestantes, faixas = FAIXAS_ALERTA) {
    if (diasRestantes === null || diasRestantes === undefined || Number.isNaN(diasRestantes)) return null;
    if (diasRestantes < 0) {
        return Math.abs(diasRestantes) <= DIAS_VENCIDO_HISTORICO ? 'vencido' : null;
    }
    const ordenadas = [...faixas].sort((a, b) => a - b);
    for (const f of ordenadas) {
        if (diasRestantes <= f) return f;
    }
    return null;
}

/** Rótulos por categoria — usados em assunto/corpo dos alertas. */
export const CATEGORIA_LABEL = {
    certificado: 'Certificado Digital',
    certidao: 'Certidão',
    parcelamento: 'Parcelamento',
    procuracao: 'Procuração',
    processo: 'Processo',
};

/** Ação prática por categoria (padrão interpretarCstat: erro/aviso SEMPRE com o que fazer). */
export function acaoPratica(categoria) {
    switch (categoria) {
        case 'certificado':
            return 'Agende a renovação do certificado digital com antecedência — sem ele a empresa fica sem emitir notas e sem acessar e-CAC/SEFAZ. A SP Assessoria emite o novo certificado pra você: responda este e-mail ou chame no WhatsApp.';
        case 'certidao':
            return 'Solicite a emissão da nova certidão antes do vencimento — certidão vencida trava licitações, financiamentos e comprovações de regularidade.';
        case 'parcelamento':
            return 'Pague a parcela até o vencimento — parcela em atraso pode RESCINDIR o parcelamento e devolver a dívida integral com juros para cobrança imediata.';
        case 'procuracao':
            return 'Renove a procuração eletrônica antes do vencimento — sem ela o escritório perde o acesso aos sistemas (e-CAC/SEFAZ) em nome da empresa e a captura de documentos para.';
        default:
            return 'Entre em contato com a SP Assessoria Contábil para regularizar antes do prazo.';
    }
}

/** "12345678000199" → "12.345.678/0001-99" (mantém como veio se não tiver 14 dígitos). */
export function fmtCnpj(cnpj) {
    const d = String(cnpj || '').replace(/\D/g, '');
    if (d.length !== 14) return String(cnpj || '');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** "2026-08-05" → "05/08/2026" (sem Date pra não sofrer off-by-one de fuso). */
export function fmtDataBr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

function labelPrazo(diasRestantes) {
    if (diasRestantes < 0) {
        const d = Math.abs(diasRestantes);
        return `<b style="color:#d33">VENCIDO HÁ ${d} DIA${d > 1 ? 'S' : ''}</b>`;
    }
    if (diasRestantes === 0) return '<b style="color:#d33">VENCE HOJE</b>';
    if (diasRestantes === 1) return '<b style="color:#e80">VENCE AMANHÃ</b>';
    return `Vence em <b>${diasRestantes} dias</b>`;
}

/**
 * Monta assunto + corpo HTML do alerta ao CLIENTE.
 * @param {object} p
 * @param {'certificado'|'certidao'|'parcelamento'|'procuracao'|'processo'} p.categoria
 * @param {string} p.tipoDetalhe   ex.: "Certidão FGTS", "e-CNPJ A1", "PGFN"
 * @param {string} p.empresaNome
 * @param {string} p.cnpj
 * @param {string} p.dataVencimento  "YYYY-MM-DD"
 * @param {number} p.diasRestantes
 * @returns {{assunto: string, corpoHtml: string}}
 */
export function montarEmailAlerta({ categoria, tipoDetalhe, empresaNome, cnpj, dataVencimento, diasRestantes }) {
    const catLabel = CATEGORIA_LABEL[categoria] || 'Documento';
    const emoji = diasRestantes < 0 ? '🔴' : diasRestantes <= 7 ? '🟠' : '🟡';
    const detalhe = tipoDetalhe ? ` — ${tipoDetalhe}` : '';
    const assunto = `${emoji} ${catLabel}${detalhe} de ${empresaNome}: vencimento ${fmtDataBr(dataVencimento)}`;
    const corpoHtml = `
<!DOCTYPE html><html><body style="font-family: -apple-system, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #be185d, #9d174d); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">${emoji} Aviso de Vencimento — ${catLabel}</h1>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="margin-top:0">Prezado cliente,</p>
        <table style="width:100%; font-size:14px; border-collapse:collapse">
            <tr><td style="padding:6px 0; color:#6b7280">Empresa</td><td style="padding:6px 0"><b>${empresaNome}</b></td></tr>
            <tr><td style="padding:6px 0; color:#6b7280">CNPJ</td><td style="padding:6px 0">${fmtCnpj(cnpj)}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280">Documento</td><td style="padding:6px 0">${catLabel}${detalhe}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280">Vencimento</td><td style="padding:6px 0">${fmtDataBr(dataVencimento)} · ${labelPrazo(diasRestantes)}</td></tr>
        </table>
        <div style="background:#fdf2f8; border-left: 4px solid #be185d; padding: 12px 16px; margin: 16px 0; border-radius: 6px; font-size:14px;">
            ${acaoPratica(categoria)}
        </div>
        <p style="font-size:13px; color:#6b7280">Dúvidas? Responda este e-mail — Departamento de Legalização, SP Assessoria Contábil.</p>
    </div>
</body></html>`;
    return { assunto, corpoHtml };
}

/**
 * Resumo por categoria × farol pro painel (front usa /resumo ou calcula local).
 * @param {Array<{categoria: string, diasRestantes: number|null}>} itens
 */
export function resumirPorFarol(itens) {
    const out = {};
    for (const it of itens || []) {
        const cat = it.categoria || 'outro';
        if (!out[cat]) out[cat] = { total: 0, vencido: 0, critico: 0, atencao: 0, ok: 0, sem_data: 0 };
        out[cat].total++;
        out[cat][classificarVencimento(it.diasRestantes)]++;
    }
    return out;
}
