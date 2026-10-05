// ============================================================================
// sefaz-backend/vencimento-da-guia.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📅 O VENCIMENTO QUE VAI NO E-MAIL DA GUIA DE ISS É O DO CALENDÁRIO (02/10).
//
// Paulo, 02/10, com o e-mail da RÁDIO E TV IBIRAPUERA ("Vencimento:
// 10/10/2026") e o print do calendário em Configurações: *"eu achava que o
// vencimento no template mudava conforme o calendário — não seria por esses
// vencimentos?"*. Era para ser. A aba 🏛️ ISS SP carimbava "dia 10 do mês
// seguinte" fixo (`vencimentoIssSp`), e 10/10/2026 é SÁBADO: a política da
// casa (Paulo, 11/08) é ANTECIPAR para o dia útil anterior — 09/10.
//
// A régua é a MESMA dos Vencimentos e Obrigações (um dono só):
//   · `resolverPrazoMunicipal` — o calendário do MUNICÍPIO da empresa, pela
//     vigência da competência;
//   · `calcularVencimento` — mês seguinte + dia + ajuste de dia não útil.
// Sem calendário do município, NÃO HÁ DATA: o motivo vai dito, com onde
// cadastrar. Data de outra prefeitura seria prazo inventado.
// ============================================================================

import { resolverPrazoMunicipal } from './prazos-municipais.js';
import { calcularVencimento } from './catalogo-obrigacoes.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} p
 * @param {Array}  p.cadastros    linhas de `prazos_municipais`
 * @param {string} p.codMunIBGE   município da empresa
 * @param {string} p.competencia  'AAAA-MM'
 * @param {string} [p.obrigacao]  'ISS'
 * @returns {{achou: true, data: string, dataBr: string, baseLegal: string|null, municipio: string|null, ajuste: string}
 *         | {achou: false, situacao: string, motivo: string}}
 */
export function vencimentoMunicipalDaGuia({ cadastros, codMunIBGE, competencia, obrigacao = 'ISS' } = {}) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
    if (!m) return { achou: false, situacao: 'competencia-invalida', motivo: 'Competência inválida (use AAAA-MM).' };
    const r = resolverPrazoMunicipal(cadastros || [], { codMunIBGE, obrigacao, competencia });
    if (!r.achou) {
        return {
            achou: false,
            situacao: r.situacao,
            motivo: `${r.motivo} Cadastre em Configurações do Admin → Prazos (calendário de ${obrigacao} do município) `
                + 'e o vencimento passa a sair sozinho no e-mail da guia.',
        };
    }
    const d = calcularVencimento(`${m[2]}/${m[1]}`, r.prazo);
    if (!d) {
        // QUAL calendário: com mais de um cadastro da cidade, vale o de
        // vigência mais recente — e é ESSE que precisa de conserto. Sem o nome
        // dele, a pessoa olha o cadastro certo e não acha o defeito (05/10).
        const p = r.prazo;
        const qual = [
            p.vigenciaInicio ? `vigente desde ${p.vigenciaInicio}` : 'sem início de vigência',
            p.cadastradoPorEmail ? `cadastrado por ${p.cadastradoPorEmail}` : null,
            p.baseLegal ? `base: ${p.baseLegal}` : null,
        ].filter(Boolean).join(', ');
        return {
            achou: false,
            situacao: 'sem-dia',
            motivo: `O calendário de ${obrigacao} de ${p.municipioNome || 'este município'} que vale em ${competencia} `
                + `(${qual}) está sem o dia do vencimento — corrija ou desative esse cadastro em Configurações do Admin → Prazos.`,
        };
    }
    const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
        achou: true,
        data,
        dataBr: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
        baseLegal: r.prazo.baseLegal || null,
        municipio: r.prazo.municipioNome || null,
        ajuste: r.prazo.ajusteDiaNaoUtil || 'antecipa',
        // A regra vai à tela ao lado da data: calendário errado fica VISÍVEL.
        regra: r.prazo.ultimoDiaUtilDoMes ? 'último dia útil do mês' : `dia ${r.prazo.diaVencimento}`,
    };
}
