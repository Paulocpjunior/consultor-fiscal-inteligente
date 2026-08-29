// ============================================================================
// sefaz-backend/rotina-empresa-insumo.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🚨 O DONO DE **O QUE A ROTINA PRECISA DE UMA EMPRESA**.
//
// ═══ O DEFEITO QUE ELE FECHA (27/08) ════════════════════════════════════════
//
// Print do Paulo (REGINA CELIA PIRES SERVIÇOS ADMINISTRATIVOS · 07/2026): a
// MESMA tela mostrando `5/5 etapas`, os cinco selos verdes e **"✓ Pronto para
// dar fim de mês"** — e, ao clicar, **"3 etapa(s) da rotina ainda não
// fecharam"**, com CAPTURA, APURAÇÃO e GUIAS abertas. Duas leituras do mesmo
// fato lado a lado, que é o defeito que esta casa mais paga.
//
// E a causa é sutil. Em 26/08 eu extraí `montarRotinasDaCompetencia`
// justamente para o painel e o ato não divergirem, e escrevi no comentário da
// rota do ato que *"uma segunda montagem divergiria no pior lugar"*. **O dono
// da MONTAGEM foi respeitado; o do CARREGAMENTO, não** — a rota montava o
// objeto da empresa à mão, com nove campos, e deixava de fora justamente os
// que decidem três etapas:
//
//   · `ccmSp` ausente ⇒ o ISS responde `sem-ccm` ⇒ **piora a CAPTURA**;
//   · `fichaFinanceira` / `faturamentoManual` / `faturamentoMensalDetalhado`
//     ausentes ⇒ `acharApuracaoDaCompetencia` devolve **null** ⇒ a APURAÇÃO
//     fica pendente e a GUIA — que fecha em 'na' quando o mês apurou ZERO —
//     volta a 'pendente'.
//
// 📌 **REGRA QUE FICA: dono de montagem não basta — quem CARREGA o insumo dela
// é dono também.** Objeto montado à mão para alimentar uma régua é uma segunda
// cópia com outra roupa, e ela envelhece em SILÊNCIO no primeiro campo novo.
//
// ⚠️ E ele mora AQUI, não na rota: `rotina-fiscal-routes.js` puxa express e
// firebase-admin e **não carrega no jest** — régua dentro de rota é régua sem
// prova (a lição do E116, do E250 e da varredura que virou script e sumiu).
// ============================================================================

import { ccmSpDaEmpresa } from './ccm-sp.js';

/** As duas coleções de empresa monitorada, na ordem em que se varre. */
export const COLECOES_DA_ROTINA = Object.freeze([
    ['simples_empresas', 'simples'],
    ['lucro_empresas', 'lucro'],
]);

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * O recorte de uma empresa que a Rotina do Mês consome.
 *
 * @param {string} id      id do documento
 * @param {string} colecao 'simples_empresas' | 'lucro_empresas'
 * @param {object} d       o `doc.data()` cru
 * @returns {object|null}  `null` quando a empresa não entra na rotina (lápide,
 *   fundida ou CNPJ ilegível) — a mesma recusa que a carteira sempre fez.
 */
export function empresaDaRotina(id, colecao, d) {
    const dados = d || {};
    if (dados._deleted || dados._merged_into) return null;
    const cnpj = soDigitos(dados.cnpj);
    if (cnpj.length !== 14) return null;
    const df = dados.dadosFiscais || {};
    return {
        id,
        cnpj,
        nome: dados.razaoSocial || dados.nome || dados.fantasia || '—',
        // O regime sai da COLEÇÃO: a empresa não guarda esse campo, e a rota do
        // ato passava `empresa.regime` (undefined) por montar o objeto à mão.
        regime: colecao === 'simples_empresas' ? 'simples' : 'lucro',
        // Para o catálogo dizer se COBRE este cliente: ele resolve o regime
        // fiscal pela coleção + regimePadrao (Lucro sem o campo vira
        // INDEFINIDO, e adivinhar regime é adivinhar imposto).
        colecao,
        regimePadrao: dados.regimePadrao || df.regimePadrao || '',
        uf: df.uf || dados.uf || '',
        capturaAtiva: dados.capturarSefaz !== false,
        // ISS de SP capital: município, CCM e SUP decidem se há guia do
        // município no mês (e se a captura da NFS-e sequer roda).
        codMunIBGE: String(df.codMunIBGE || dados.codMunIBGE || '').trim(),
        // Pelo dono: com os só-zeros o ISS respondia como se houvesse CCM, e a
        // etapa de CAPTURA deixava de acusar `sem-ccm`.
        ccmSp: ccmSpDaEmpresa(dados),
        issFixoSup: (dados.issPadraoConfig?.tipo || df.issConfig?.tipo) === 'sup_fixo',
        // As TRÊS fontes de prova da apuração da competência.
        fichaFinanceira: dados.fichaFinanceira || null,
        faturamentoManual: dados.faturamentoManual || null,
        faturamentoMensalDetalhado: dados.faturamentoMensalDetalhado || null,
    };
}
