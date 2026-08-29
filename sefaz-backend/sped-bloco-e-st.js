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
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';
// A UF do destinatário chega em DUAS formas (aninhada × `ufDest` achatado) —
// quem as concilia é o dono, nunca uma leitura nova.
import { ufDoDestinatarioDoc } from './participante-doc-helper.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'denegada', 'inutilizado']);

/**
 * Agrupa o ICMS-ST RETIDO nas saídas por UF do destinatário.
 *
 * 🚨 A UF SAI DA RÉGUA, NUNCA DA FORMA ANINHADA (21/08, varredura dos leitores
 * de documento). Este agrupamento lia `nota.destinatario?.uf` — e o importer
 * principal grava **`ufDest` ACHATADO**. Em toda nota capturada
 * automaticamente a UF vinha vazia e caía no **`ufEmpresa`**: o ST retido para
 * MG, PR ou RJ era apurado como se fosse do próprio estado, e cada UF aqui é
 * **uma GNRE**. Dinheiro no estado errado, sem nada acusar.
 *
 * ⚠️ E O `ufEmpresa` DEIXOU DE SER DEFAULT: ele só vale quando a nota é da
 * PRÓPRIA UF — o que a régua já responde lendo o documento. Sem UF legível o
 * documento sai NOMEADO em `semUf`, porque UF de destino inventada é a mesma
 * família do 'PARTSEM', num campo que decide para QUEM se recolhe.
 *
 * Saída sem ST não entra. Cancelada fica de fora e quem decide é `docCancelado`
 * (o campo cru mente quando o cancelamento chega por evento); o `situacao`
 * derivado continua honrado para quem já vem classificado. A direção também é
 * pela régua: a nota PRÓPRIA de entrada (tpNF=0) fica gravada como 'saida' até
 * o backfill passar, e ela não é retenção nenhuma.
 *
 * @returns {{grupos: object[], semUf: string[]}}
 */
export function agruparStPorUf(notas, ufEmpresa) {
    const porUf = new Map();
    const semUf = [];

    for (const notaCrua of notas || []) {
        if (direcaoEfetivaDoc(notaCrua) !== 'saida') continue;
        if (docCancelado(notaCrua)) continue;
        if (CANCELADOS.has(String(notaCrua?.situacao || '').toLowerCase())) continue;

        const vST = num(notaCrua?.totais?.vST) || num(notaCrua?.totais?.vICMSST)
            || (notaCrua?.itens || []).reduce((s, i) => s + num(i?.vICMSST), 0);
        if (vST <= 0) continue;

        const uf = ufDoDestinatarioDoc(notaCrua);
        if (!uf) {
            semUf.push(String(notaCrua?.numero || notaCrua?.chave || '(sem número)'));
            continue;
        }

        const atual = porUf.get(uf) || { uf, retencao: 0, documentos: 0 };
        atual.retencao = r2(atual.retencao + vST);
        atual.documentos += 1;
        porUf.set(uf, atual);
    }

    return {
        grupos: Array.from(porUf.values()).sort((a, b) => a.uf.localeCompare(b.uf)),
        semUf,
    };
}

/**
 * Apura o ST de UMA UF: retenção + ajustes de débito − créditos − deduções −
 * saldo credor anterior. O que sobrar de crédito vai para o mês seguinte.
 *
 * ⚠️ `saldoDevedorApurado` é o campo 11 do E210 (VL_SLD_DEV_ANT_ST = saldo
 * devedor ANTES das deduções) — corroborado pelo E210 aceito do e-Fiscal da
 * REALITY 07/2026 (retenção 380,79 ⇒ campo 11 = 380,79 ⇒ recolher 380,79).
 * A 1ª versão deste módulo leu o nome como "saldo devedor ANTERIOR" (do mês
 * passado) e escrevia 0,00 ali — o PVA não fecha a conta 11 − 12 = 13.
 */
export function apurarStDaUf({ uf, retencao, ajustes = {}, saldoCredorAnterior = 0, saldoDevedorAnterior = 0, devolucoes = 0, ressarcimentos = 0, outrosCreditos = 0, outrosDebitos = 0 }) {
    const ajDebitos = r2(num(ajustes.outrosDebitos) + num(ajustes.estornosCredito));
    const ajCreditos = r2(num(ajustes.outrosCreditos) + num(ajustes.estornosDebito));
    const deducoesLancadas = r2(num(ajustes.deducoes));
    const debEsp = r2(num(ajustes.debitosEspeciais));

    const creditos = r2(
        num(saldoCredorAnterior) + num(devolucoes) + num(ressarcimentos)
        + num(outrosCreditos) + ajCreditos,
    );
    const debitos = r2(num(retencao) + num(outrosDebitos) + ajDebitos + num(saldoDevedorAnterior));

    // Deduções só abatem saldo DEVEDOR (mesma regra do E110): com o período já
    // credor, deduzir "sobra" não aumenta o crédito a transportar — o excedente
    // sai NOMEADO para virar aviso, nunca crédito inventado.
    const antesDeducoes = r2(debitos - creditos);
    const saldoDevedorApurado = antesDeducoes > 0 ? antesDeducoes : 0;
    const deducoes = r2(Math.min(deducoesLancadas, saldoDevedorApurado));
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
        saldoDevedorApurado,
        deducoes,
        deducoesExcedentes: r2(deducoesLancadas - deducoes),
        icmsRecolher: r2(saldoDevedorApurado - deducoes),
        saldoCredorTransportar: antesDeducoes < 0 ? r2(-antesDeducoes) : 0,
        debitosEspeciais: debEsp,
    };
}

const dec = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2).replace('.', ',');

/**
 * Monta E200/E210/E220 (+E250 quando há guia) de TODAS as UFs com ST.
 *
 * 🚨 CADA LINHA SAI COMO ARRAY DE CAMPOS, NUNCA COMO STRING PRONTA — o dono do
 * formato (`|campo|…|\r\n`) é o `fmt.buildLine` de quem monta o arquivo.
 * A 1ª versão devolvia strings com `join('|')` cru (sem o `|` inicial e sem o
 * `\r\n`), e como o arquivo final é `join('')`, TODOS os E200/E210 de todas as
 * UFs saíam GRUDADOS numa linha só, colados na linha do E500 — caso REALITY
 * 0899 · 07/2026 (21/08): 9 registros numa linha, invisíveis para o PVA, para
 * o 9900 e para a própria prevalidação. É o mesmo desenho do `montarLinhasE111`.
 *
 * @param {object} p
 * @param {Array}  p.notas            documentos do período
 * @param {string} p.ufEmpresa
 * @param {Array}  p.ajustes          ajustes lançados (códigos de ST e próprios juntos)
 * @param {string} p.dtIni            DDMMAAAA
 * @param {string} p.dtFin            DDMMAAAA
 * @param {object} [p.obrigacoesPorUf] { UF: { dtVcto, codRec } } para o E250
 */
/**
 * MES_REF do E250 (`mmaaaa`) a partir do DT_INI do 0000 (`DDMMAAAA`).
 *
 * Devolve `''` quando a data não é legível — campo de competência não recebe
 * palpite, e a prevalidação acusa o vazio com a recusa literal.
 */
export function mesRefDoPeriodo(dtIni) {
    const d = String(dtIni || '').replace(/\D/g, '');
    if (d.length !== 8) return '';
    return d.slice(2, 8);   // DD MMAAAA → MMAAAA
}

export function montarLinhasStBlocoE({ notas, ufEmpresa, ajustes = [], dtIni, dtFin, obrigacoesPorUf = {} }) {
    const { grupos, semUf } = agruparStPorUf(notas, ufEmpresa);
    const avisos = [];
    if (semUf.length) {
        avisos.push(
            `ST: ${semUf.length} documento(s) com ICMS-ST retido ficaram FORA da apuração por UF porque a `
            + `UF do destinatário não foi capturada — nº ${semUf.slice(0, 8).join(', ')}`
            + `${semUf.length > 8 ? '…' : ''}. Cada UF aqui é uma GNRE: declarar na UF da empresa mandaria o `
            + 'recolhimento para o estado errado. Reimporte o XML (♻️ Reler XMLs guardados) e gere de novo.',
        );
    }
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

        if (ap.deducoesExcedentes > 0) {
            avisos.push(
                `ST de ${g.uf}: R$ ${dec(ap.deducoesExcedentes)} de dedução NÃO aplicada — dedução só abate `
                + 'saldo DEVEDOR (mesma regra do E110) e o período não tinha devedor suficiente. '
                + 'O E210 declara só a parte aplicada.',
            );
        }

        linhas.push(['E200', g.uf, dtIni, dtFin]);
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
            dec(ap.saldoDevedorApurado),      // VL_SLD_DEV_ANT_ST — saldo devedor ANTES das deduções
            dec(ap.deducoes),                 // VL_DEDUCOES_ST
            dec(ap.icmsRecolher),             // VL_ICMS_RECOL_ST
            dec(ap.saldoCredorTransportar),   // VL_SLD_CRED_ST_TRANSPORTAR
            dec(ap.debitosEspeciais),         // DEB_ESP_ST
        ]);

        // E220 — uma linha por ajuste, só na UF da empresa.
        if (daUfDaEmpresa) {
            for (const aj of cls.validos) {
                linhas.push(['E220', aj.codigo, aj.descricao || '', dec(aj.valor)]);
            }
        }

        // E250 — a guia. Sem vencimento/código de receita cadastrados o
        // registro NÃO é inventado: vira aviso (o PVA recusa código errado).
        if (ap.icmsRecolher > 0) {
            const o = obrigacoesPorUf[g.uf] || {};
            if (o.dtVcto && o.codRec) {
                // Mesmos 9 campos do E116 (IND_OBR…MES_REF), espelho do bloco próprio.
                linhas.push([
                    'E250', '000', dec(ap.icmsRecolher), o.dtVcto, o.codRec, '', '', '', '',
                    // 🚨 CAMPO 10 — MES_REF, **OBRIGATÓRIO** desde jan/2011 e
                    // que saía VAZIO (29/08, auditoria do de-para).
                    //
                    // Guia 3.2.3, E250 campo 10: *"Informe o mês de referência
                    // no formato 'mmaaaa'"*, Obrig. **O**. Campo obrigatório em
                    // branco é a recusa `Campo de preenchimento obrigatório` —
                    // a mesma do M210 da DGB (28/08).
                    //
                    // ⚠️ Ele é DERIVADO do período do arquivo (`dtIni`, que já
                    // chega em DDMMAAAA), nunca da data de hoje: o E250 de uma
                    // competência regerada meses depois tem de dizer a
                    // competência DELA. E a Validação do Guia é justamente essa
                    // — *"não pode ser superior à competência do campo DT_INI
                    // do registro 0000"*.
                    mesRefDoPeriodo(dtIni),
                ]);
            } else {
                avisos.push(
                    `ST de ${g.uf}: R$ ${dec(ap.icmsRecolher)} a recolher, mas o E250 não foi gerado — `
                    + 'falta o vencimento e o código de receita da GNRE dessa UF. '
                    + 'Cadastre em SPED Fiscal → aba Ajustes E111 → "ICMS-ST a recolher por UF" '
                    + '(ou lance a obrigação no PVA antes de transmitir).',
                );
            }
        }
    }

    return { linhas, apuracoes, avisos };
}
