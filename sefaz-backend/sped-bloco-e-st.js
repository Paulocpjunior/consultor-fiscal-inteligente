// ============================================================================
// sefaz-backend/sped-bloco-e-st.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Apuração do ICMS-ST do Bloco E (EFD ICMS/IPI) — registros E200/E210/E220/E250.
//
// Quem retém ST na saída (contribuinte SUBSTITUTO) precisa apurar o imposto
// retido POR UF de destino: a ST interestadual vira uma GNRE para cada estado.
// Era o bloqueio nº 1 que sobrou depois do E111 — o painel 🚦 marca essas
// empresas como "ST em saída (bloqueio: E220)".
//
// Registros:
//   E200 — período da apuração do ICMS ST, UMA OCORRÊNCIA POR UF
//   E210 — apuração do ST daquela UF
//   E220 — ajuste/benefício/incentivo da apuração do ST (mesma tabela 5.1.1 do
//          E111, mas com '1' no 3º caractere do código)
//   E250 — obrigação do ICMS ST a recolher (a guia)
//
// ATENÇÃO AO LEIAUTE: a documentação oficial (Guia Prático) é inacessível do
// ambiente do app, então a ORDEM dos campos aqui vem do leiaute conhecido e
// PRECISA passar pelo PVA antes de ir a cliente — igual ao G125 do bloco G.
// Os testes travam a estrutura: corrigir é mexer em um lugar só.
//
// CORREÇÃO EMBUTIDA: o gerador antigo usava E200/E210 para IPI. E200/E210 são
// do ICMS-ST; IPI é E500/E520. Sem isso, ST e IPI disputariam o mesmo registro.
// ============================================================================

import { classificarAjustes } from './sped-ajustes-apuracao.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'denegada', 'inutilizado']);

/**
 * Agrupa o ICMS-ST RETIDO nas saídas por UF do destinatário.
 * Saída sem ST não entra. Nota cancelada/denegada fica de fora.
 */
export function agruparStPorUf(notas, ufEmpresa) {
    const porUf = new Map();

    for (const nota of notas || []) {
        if (String(nota?.direcao) !== 'saida') continue;
        if (CANCELADOS.has(String(nota?.situacao || nota?.status || '').toLowerCase())) continue;

        const vST = num(nota?.totais?.vST) || num(nota?.totais?.vICMSST)
            || (nota?.itens || []).reduce((s, i) => s + num(i?.vICMSST), 0);
        if (vST <= 0) continue;

        const uf = String(
            nota?.destinatario?.uf || nota?.tomador?.uf || ufEmpresa || '',
        ).toUpperCase();
        if (!uf) continue;

        const atual = porUf.get(uf) || { uf, retencao: 0, documentos: 0 };
        atual.retencao = r2(atual.retencao + vST);
        atual.documentos += 1;
        porUf.set(uf, atual);
    }

    return Array.from(porUf.values()).sort((a, b) => a.uf.localeCompare(b.uf));
}

/**
 * Apura o ST de UMA UF: retenção + ajustes de débito − créditos − deduções −
 * saldo credor anterior. O que sobrar de crédito vai para o mês seguinte.
 */
export function apurarStDaUf({ uf, retencao, ajustes = {}, saldoCredorAnterior = 0, saldoDevedorAnterior = 0, devolucoes = 0, ressarcimentos = 0, outrosCreditos = 0, outrosDebitos = 0 }) {
    const ajDebitos = r2(num(ajustes.outrosDebitos) + num(ajustes.estornosCredito));
    const ajCreditos = r2(num(ajustes.outrosCreditos) + num(ajustes.estornosDebito));
    const deducoes = r2(num(ajustes.deducoes));
    const debEsp = r2(num(ajustes.debitosEspeciais));

    const creditos = r2(
        num(saldoCredorAnterior) + num(devolucoes) + num(ressarcimentos)
        + num(outrosCreditos) + ajCreditos,
    );
    const debitos = r2(num(retencao) + num(outrosDebitos) + ajDebitos + num(saldoDevedorAnterior));

    const saldo = r2(debitos - creditos - deducoes);
    return {
        uf,
        saldoCredorAnterior: r2(saldoCredorAnterior),
        devolucoes: r2(devolucoes),
        ressarcimentos: r2(ressarcimentos),
        outrosCreditos: r2(outrosCreditos),
        ajCreditos,
        retencao: r2(retencao),
        outrosDebitos: r2(outrosDebitos),
        ajDebitos,
        saldoDevedorAnterior: r2(saldoDevedorAnterior),
        deducoes,
        // Deduções só abatem saldo DEVEDOR (mesma regra do E110).
        icmsRecolher: saldo > 0 ? saldo : 0,
        saldoCredorTransportar: saldo < 0 ? r2(-saldo) : 0,
        debitosEspeciais: debEsp,
    };
}

const dec = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2).replace('.', ',');

/**
 * Monta E200/E210/E220 (+E250 quando há guia) de TODAS as UFs com ST.
 *
 * @param {object} p
 * @param {Array}  p.notas            documentos do período
 * @param {string} p.ufEmpresa
 * @param {Array}  p.ajustes          ajustes lançados (códigos de ST e próprios juntos)
 * @param {string} p.dtIni            DDMMAAAA
 * @param {string} p.dtFin            DDMMAAAA
 * @param {object} [p.obrigacoesPorUf] { UF: { dtVcto, codRec } } para o E250
 */
export function montarLinhasStBlocoE({ notas, ufEmpresa, ajustes = [], dtIni, dtFin, obrigacoesPorUf = {} }) {
    const grupos = agruparStPorUf(notas, ufEmpresa);
    const avisos = [];
    if (grupos.length === 0) return { linhas: [], apuracoes: [], avisos };

    // Ajustes de ST valem para a apuração da UF da EMPRESA (a tabela 5.1.1 é
    // estadual). ST de outras UFs sem ajuste próprio fica só com a retenção.
    const cls = classificarAjustes(ajustes, ufEmpresa, 'st');
    for (const erro of cls.erros) avisos.push(`Ajuste de ST IGNORADO: ${erro}`);

    const linhas = [];
    const apuracoes = [];

    for (const g of grupos) {
        const daUfDaEmpresa = g.uf === String(ufEmpresa || '').toUpperCase();
        const ap = apurarStDaUf({
            uf: g.uf,
            retencao: g.retencao,
            ajustes: daUfDaEmpresa ? cls : {},
        });
        apuracoes.push({ ...ap, documentos: g.documentos });

        linhas.push(['E200', g.uf, dtIni, dtFin, ''].join('|'));
        linhas.push([
            'E210',
            '1',                              // IND_MOV_ST: 1 = com operações de ST
            dec(ap.saldoCredorAnterior),      // VL_SLD_CRED_ANT_ST
            dec(ap.devolucoes),               // VL_DEVOL_ST
            dec(ap.ressarcimentos),           // VL_RESSARC_ST
            dec(ap.outrosCreditos),           // VL_OUT_CRED_ST
            dec(ap.ajCreditos),               // VL_AJ_CREDITOS_ST
            dec(ap.retencao),                 // VL_RETENCAO_ST
            dec(ap.outrosDebitos),            // VL_OUT_DEB_ST
            dec(ap.ajDebitos),                // VL_AJ_DEBITOS_ST
            dec(ap.saldoDevedorAnterior),     // VL_SLD_DEV_ANT_ST
            dec(ap.deducoes),                 // VL_DEDUCOES_ST
            dec(ap.icmsRecolher),             // VL_ICMS_RECOL_ST
            dec(ap.saldoCredorTransportar),   // VL_SLD_CRED_ST_TRANSPORTAR
            dec(ap.debitosEspeciais),         // DEB_ESP_ST
            '',
        ].join('|'));

        // E220 — uma linha por ajuste, só na UF da empresa.
        if (daUfDaEmpresa) {
            for (const aj of cls.validos) {
                linhas.push(['E220', aj.codigo, aj.descricao || '', dec(aj.valor), ''].join('|'));
            }
        }

        // E250 — a guia. Sem vencimento/código de receita cadastrados o
        // registro NÃO é inventado: vira aviso (o PVA recusa código errado).
        if (ap.icmsRecolher > 0) {
            const o = obrigacoesPorUf[g.uf] || {};
            if (o.dtVcto && o.codRec) {
                linhas.push([
                    'E250', '000', dec(ap.icmsRecolher), o.dtVcto, o.codRec, '', '', '', '', '',
                ].join('|'));
            } else {
                avisos.push(
                    `ST de ${g.uf}: R$ ${dec(ap.icmsRecolher)} a recolher, mas o E250 não foi gerado — `
                    + 'falta o vencimento e o código de receita da GNRE dessa UF no cadastro. '
                    + 'Informe-os ou lance a obrigação no PVA antes de transmitir.',
                );
            }
        }
    }

    return { linhas, apuracoes, avisos };
}
