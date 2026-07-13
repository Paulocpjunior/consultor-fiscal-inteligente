/**
 * services/giaStExportService.ts
 *
 * Gerador do arquivo de importação "Sistema Próprio" do aplicativo GIA-ST 3
 * (SEFAZ-RS/PROCERGS), layout v3.1 (26/11/2015) — "Formato dos Arquivos para
 * Sistema Próprio".
 *
 * Estrutura (larguras fixas, posições cumulativas conforme coluna "Soma"):
 *   A0 — Registro Principal (1 por GIA-ST), 1031 posições
 *   A1 — Anexo I  (devoluções, 0..N),  55 posições
 *   A2 — Anexo II (ressarcimentos, 0..N), 55 posições
 *   A3 — Anexo III (transferências p/ UF favorecida, 0..N), 46 posições
 *   A4 — Anexo EC 87/15 (não usado nesta fase — campos EC ficam N/zeros)
 *
 * Convenções do layout:
 *   A  = alfanumérico, alinhado à esquerda, completado com espaços à direita
 *   N  = numérico, alinhado à direita, zeros à esquerda (valores em CENTAVOS,
 *        sem vírgula — ex.: R$ 1.995,23 → "000000000199523")
 *   D  = data AAAAMMDD (sem vencimento → "00000000")
 *   S/N = 'S' ou 'N'
 *
 * Arquivo final: Windows-1252 + CRLF (aplicativo GIA-ST 3 é Windows/Firebird).
 */

import type { GiaStGuia } from './giaStService';
import { encodeWindows1252 } from './iobSageExportService';

export interface GiaStDeclarante {
    nome: string;
    cpf: string;
    cargo: string;
    telefoneDdd: string;
    telefoneNumero: string;
    email: string;
    local: string;
}

export interface GiaStAnexoNf {
    numeroNf: string;
    serie: string;
    inscricaoEstadual: string;
    dataEmissao: string;   // AAAA-MM-DD
    valor: number;         // R$
}

export interface GiaStAnexoTransferencia {
    inscricaoEstadual: string;
    baseCalculo: number;
    valorIcmsDestacado: number;
}

export class GiaStExportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GiaStExportError';
    }
}

/** Alfanumérico: corta no tamanho e completa com espaços à direita. */
export function padA(valor: string | null | undefined, tam: number): string {
    const s = String(valor ?? '').replace(/[\r\n]+/g, ' ');
    return s.length > tam ? s.slice(0, tam) : s.padEnd(tam, ' ');
}

/** Numérico em centavos: R$ 1.995,23 → "000000000199523" (tam 15). */
export function padValor(valorReais: number | null | undefined, tam = 15): string {
    const centavos = Math.round(((valorReais ?? 0) + Number.EPSILON) * 100);
    if (!Number.isFinite(centavos)) throw new GiaStExportError(`Valor inválido: ${valorReais}`);
    if (centavos < 0) {
        const digitos = String(-centavos);
        if (digitos.length > tam - 1) throw new GiaStExportError(`Valor negativo excede ${tam} posições: ${valorReais}`);
        return '-' + digitos.padStart(tam - 1, '0');
    }
    const digitos = String(centavos);
    if (digitos.length > tam) throw new GiaStExportError(`Valor excede ${tam} posições: ${valorReais}`);
    return digitos.padStart(tam, '0');
}

/** Numérico inteiro (contadores, CNPJ, CPF, DDD/telefone). */
export function padN(valor: string | number | null | undefined, tam: number): string {
    const digitos = String(valor ?? '').replace(/\D/g, '');
    if (digitos.length > tam) throw new GiaStExportError(`Campo numérico excede ${tam} posições: ${valor}`);
    return digitos.padStart(tam, '0');
}

/** Data AAAA-MM-DD → AAAAMMDD; vazio → "00000000". */
export function padData(dataIso: string | null | undefined): string {
    const m = String(dataIso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}${m[2]}${m[3]}` : '00000000';
}

const SN = (b: boolean): string => (b ? 'S' : 'N');

/**
 * Registro Principal A0 — 1031 posições.
 * dataPreenchimento (AAAA-MM-DD): data do campo 35 do A0; default = hoje.
 * Injetável para testes-gabarito contra arquivos reais exportados pelo app.
 */
export function montarRegistroA0(
    guia: GiaStGuia,
    declarante: GiaStDeclarante,
    contagem: { anexoI: number; anexoII: number; anexoIII: number },
    dataPreenchimento?: string,
): string {
    // 05. Período Referência MMAAAA (guia.competencia é AAAA-MM)
    const mComp = guia.competencia.match(/^(\d{4})-(\d{2})$/);
    if (!mComp) throw new GiaStExportError(`Competência inválida: ${guia.competencia}`);
    const periodoMMAAAA = `${mComp[2]}${mComp[1]}`;

    // 03. Até 6 pares [data vencimento + valor]. Fase atual: vencimento único
    // com o total da guia (campo 21). Sem valor a recolher → tudo zerado.
    const vencimentos: Array<{ data: string; valor: number }> = [];
    if (guia.c21TotalRecolher > 0) {
        vencimentos.push({ data: guia.dataVencimento, valor: guia.c21TotalRecolher });
    }
    let blocoVencimentos = '';
    for (let i = 0; i < 6; i++) {
        const v = vencimentos[i];
        blocoVencimentos += padData(v?.data) + padValor(v?.valor ?? 0);
    }

    const linha =
        'A0'                                                    // ID (pos 2)
        + 'GST'                                                 // fixo (5)
        + '03'                                                  // versão (7)
        + padN(periodoMMAAAA, 6)                                // 05 (13)
        + padA(guia.inscricaoEstadualUfFavorecida, 14)          // 06 (27)
        + SN(guia.semMovimento)                                 // 01 (28)
        + SN(guia.retificacao)                                  // 02 (29)
        + blocoVencimentos                                      // 03 (167)
        + padA(guia.ufFavorecida, 2)                            // 04 (169)
        + padValor(guia.c7ValorProdutos)                        // 07 (184)
        + padValor(guia.c8ValorIpi)                             // 08 (199)
        + padValor(guia.c9DespesasAcessorias)                   // 09 (214)
        + padValor(guia.c10BcIcmsProprio)                       // 10 (229)
        + padValor(guia.c11IcmsProprio)                         // 11 (244)
        + padValor(guia.c12BcIcmsSt)                            // 12 (259)
        + padValor(guia.c13IcmsRetidoSt)                        // 13 (274)
        + padValor(guia.c14IcmsDevolucao)                       // 14 (289)
        + padValor(guia.c15IcmsRessarcimentos)                  // 15 (304)
        + padValor(guia.c16CreditoPeriodoAnterior)              // 16 (319)
        + padValor(guia.c17PagamentosAntecipados)               // 17 (334)
        + padValor(guia.c18IcmsStDevido)                        // 18 (349)
        + padValor(guia.c19RepasseRefinarias)                   // 19 (364)
        + padValor(guia.c20CreditoPeriodoSeguinte)              // 20 (379)
        + padValor(guia.c21TotalRecolher)                       // 21 (394)
        + padN(guia.empresaCnpj, 14)                            // 28 (408)
        + padA(declarante.nome, 46)                             // 29 (454)
        + padN(declarante.cpf, 11)                              // 30 (465)
        + padA(declarante.cargo, 30)                            // 31 (495)
        + padN(declarante.telefoneDdd, 4)                       // 32 DDD (499)
        + padN(declarante.telefoneNumero, 9)                    // 32 nº (508)
        + padN('', 4)                                           // 33 fax DDD (512)
        + padN('', 9)                                           // 33 fax nº (521)
        + padA(declarante.email, 80)                            // 34 (601)
        + padA(declarante.local, 30)                            // 35 local (631)
        + padData(dataPreenchimento || new Date().toISOString().slice(0, 10)) // 35 data (639)
        + padA(guia.informacoesComplementares.slice(0, 65), 65)          // 36 L1 (704)
        + padA(guia.informacoesComplementares.slice(65, 125), 60)        // 36 L2 (764)
        + padA(guia.informacoesComplementares.slice(125, 185), 60)       // 36 L3 (824)
        + SN(!!guia.c37DistribuidoraCombustivel)                // 37 (825)
        + SN(contagem.anexoIII > 0)                             // 38 (826)
        + padA('', 6)                                           // código entrega (832)
        + padN(contagem.anexoI, 6)                              // qtd Anexo I (838)
        + padN(contagem.anexoII, 6)                             // qtd Anexo II (844)
        + padN(contagem.anexoIII, 6)                            // qtd Anexo III (850)
        + padValor(guia.c39RepasseOutros)                       // 39 (865)
        // Bloco EC 87/15 (DIFAL consumidor final) — fora do escopo do Livro de
        // ICMS Substituto; layout permite zerado.
        + 'N'                                                   // EC c/ movimento (866)
        + padValor(0) + padValor(0) + padValor(0)               // FCP venc 1-3
        + padValor(0) + padValor(0) + padValor(0)               // FCP venc 4-6 (956)
        + padValor(0)                                           // ICMS devido UF destino (971)
        + padValor(0)                                           // devoluções/anulações (986)
        + padValor(0)                                           // pagamentos antecipados (1001)
        + padValor(0)                                           // total ICMS UF destino (1016)
        + padValor(0);                                          // total ICMS FCP (1031)

    if (linha.length !== 1031) {
        throw new GiaStExportError(`Registro A0 com ${linha.length} posições (esperado 1031) — layout quebrado.`);
    }
    return linha;
}

/** Registros A1 (Anexo I) e A2 (Anexo II) — 55 posições. */
export function montarRegistroAnexoNf(tipo: 'A1' | 'A2', item: GiaStAnexoNf): string {
    const linha =
        tipo
        + padN(item.numeroNf, 13)
        + padA(item.serie, 3)
        + padA(item.inscricaoEstadual, 14)
        + padData(item.dataEmissao)
        + padValor(item.valor);
    if (linha.length !== 55) throw new GiaStExportError(`Registro ${tipo} com ${linha.length} posições (esperado 55).`);
    return linha;
}

/** Registro A3 (Anexo III — transferências p/ UF favorecida) — 46 posições. */
export function montarRegistroA3(item: GiaStAnexoTransferencia): string {
    const linha =
        'A3'
        + padA(item.inscricaoEstadual, 14)
        + padValor(item.baseCalculo)
        + padValor(item.valorIcmsDestacado);
    if (linha.length !== 46) throw new GiaStExportError(`Registro A3 com ${linha.length} posições (esperado 46).`);
    return linha;
}

export interface GiaStArquivoGuia {
    guia: GiaStGuia;
    anexoI?: GiaStAnexoNf[];
    anexoII?: GiaStAnexoNf[];
    anexoIII?: GiaStAnexoTransferencia[];
}

/**
 * Monta o conteúdo completo do arquivo (1 A0 por guia + anexos logo abaixo).
 * Valida o que o aplicativo GIA-ST 3 validaria na importação:
 *  - soma do Anexo I = campo 14 e soma do Anexo II = campo 15 (quando > 0);
 *  - guia sem inconsistências pendentes.
 */
export function montarArquivoGiaSt(
    itens: GiaStArquivoGuia[],
    declarante: GiaStDeclarante,
    dataPreenchimento?: string,
): string {
    if (!itens.length) throw new GiaStExportError('Nenhuma guia selecionada para o arquivo.');
    if (!declarante.nome.trim() || declarante.cpf.replace(/\D/g, '').length !== 11) {
        throw new GiaStExportError('Declarante obrigatório: informe nome e CPF válido (11 dígitos).');
    }

    const somaCentavos = (lista: Array<{ valor: number }> | undefined): number =>
        Math.round((lista || []).reduce((acc, i) => acc + (i.valor || 0), 0) * 100);

    const linhas: string[] = [];
    for (const { guia, anexoI = [], anexoII = [], anexoIII = [] } of itens) {
        const rotulo = `GIA-ST ${guia.ufFavorecida} ${guia.competencia}`;
        if (guia.inconsistencias?.length) {
            throw new GiaStExportError(`${rotulo}: resolva as ${guia.inconsistencias.length} inconsistência(s) antes de gerar o arquivo.`);
        }
        if (Math.round(guia.c14IcmsDevolucao * 100) !== somaCentavos(anexoI)) {
            throw new GiaStExportError(`${rotulo}: campo 14 (devoluções) = R$ ${guia.c14IcmsDevolucao.toFixed(2)} difere da soma do Anexo I. Detalhe as notas de devolução.`);
        }
        if (Math.round(guia.c15IcmsRessarcimentos * 100) !== somaCentavos(anexoII)) {
            throw new GiaStExportError(`${rotulo}: campo 15 (ressarcimentos) = R$ ${guia.c15IcmsRessarcimentos.toFixed(2)} difere da soma do Anexo II. Detalhe as notas de ressarcimento.`);
        }
        linhas.push(montarRegistroA0(guia, declarante, {
            anexoI: anexoI.length, anexoII: anexoII.length, anexoIII: anexoIII.length,
        }, dataPreenchimento));
        for (const nf of anexoI) linhas.push(montarRegistroAnexoNf('A1', nf));
        for (const nf of anexoII) linhas.push(montarRegistroAnexoNf('A2', nf));
        for (const tr of anexoIII) linhas.push(montarRegistroA3(tr));
    }
    return linhas.join('\r\n') + '\r\n';
}

export function gerarArquivoGiaStBlob(itens: GiaStArquivoGuia[], declarante: GiaStDeclarante): { blob: Blob; nomeArquivo: string } {
    const conteudo = montarArquivoGiaSt(itens, declarante);
    const bytes = encodeWindows1252(conteudo);
    const primeira = itens[0].guia;
    const mm = primeira.competencia.slice(5, 7);
    const aaaa = primeira.competencia.slice(0, 4);
    const nomeArquivo = `GIAST_${primeira.empresaCnpj}_${mm}${aaaa}.txt`;
    return { blob: new Blob([bytes as BlobPart], { type: 'text/plain;charset=windows-1252' }), nomeArquivo };
}
