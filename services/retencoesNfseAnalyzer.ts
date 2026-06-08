/**
 * services/retencoesNfseAnalyzer.ts
 *
 * Analisa o CSV de NFSes capturadas do portal SP (formato exportado pela
 * captura `nfse-sp-portal`) e detecta retenções tributárias por nota:
 *   ISS / INSS / PIS / COFINS / CSLL / IRRF
 *
 * Heurísticas:
 *   - ISS: vem na coluna própria do CSV (campo "ISS"). > 0 = retido.
 *   - Demais tributos: parseia a coluna "Discriminação", que é texto livre
 *     e contém múltiplos padrões. Captura "TRIBUTO R$ X,XX" se X > 0.
 *
 * Falsos positivos comuns que sao filtrados explicitamente:
 *   - "IBPT" / "Lei 12741" / "Trib Aprox": tributos aproximados ao consumidor
 *     (informativo, NAO retenção).
 *   - "NAO RETEN" / "NÃO RETENÇÃO": declaração explícita de não retenção
 *     (ex: Notre Dame, AMIL).
 *   - "RECOLHIMENTO EFETUADO PELO EMITENTE": IRRF já recolhido na fonte pelo
 *     prestador (ex: Pluxee) — não é retenção do tomador.
 *   - Trechos com "%" sem "R$": menção de alíquota, não valor retido.
 *
 * Funcao pura: nao depende de Firebase/HTTP. Pode ser usada client OU server.
 */

export type LinhaNfseCsv = {
    direcao: 'Emitida' | 'Recebida' | string;
    numero: string;
    data: string;
    prestadorCnpj: string;
    prestadorNome: string;
    tomadorCnpj: string;
    tomadorNome: string;
    valorServicos: number;
    iss: number;
    codServico: string;
    discriminacao: string;
};

export type TributoRetido = {
    retido: boolean;
    valor: number;       // 0 quando nao retido
    motivo?: string;     // ex: "declaracao explicita de NAO RETEN"
    trechoEvidencia?: string; // trecho da discriminacao que evidencia
};

export type AnaliseRetencoes = {
    iss: TributoRetido;
    inss: TributoRetido;
    pis: TributoRetido;
    cofins: TributoRetido;
    csll: TributoRetido;
    irrf: TributoRetido;
    totalRetido: number;
    temAlgumaRetencao: boolean;
    inconsistencias?: Inconsistencia[];
};

export type SeveridadeInconsistencia = 'erro' | 'alerta' | 'info';
export type Inconsistencia = {
    severidade: SeveridadeInconsistencia;
    codigo: string;
    mensagem: string;
};

// ─── Constantes fiscais (CSRF/IRRF) ──────────────────────────────────────
// Base legal:
//   - Lei 10.833/2003 art. 30 e 31 (regra geral CSRF)
//   - Lei 13.137/2015 art. 24 (alteração do art. 31 §3º)
//   - IN RFB 2.110/2022 (substitui IN 459/2004)
//   - Decreto-Lei 1.598/1977 + Lei 7.713/88 (IRRF serviços)
//
// IMPORTANTE: as alíquotas DE RETENÇÃO sao distintas das aliquotas DO
// REGIME tributario do prestador (que pode ser cumulativo ou nao).
// Lei 10.833/03 art. 30 §1º + IN RFB 2.110/22 art. 2º:
export const ALIQ_PIS_RETENCAO = 0.0065;     // 0,65%
export const ALIQ_COFINS_RETENCAO = 0.03;    // 3,00%
export const ALIQ_CSLL_RETENCAO = 0.01;      // 1,00%
export const ALIQ_CSRF_TOTAL = 0.0465;       // 4,65% = soma das três (0,65 + 3 + 1)
/**
 * Alíquotas usuais de IRRF retido na fonte (Decreto 3.000/99 art. 647-651):
 *   1.0%  — serviços de limpeza, vigilância, locação de mão-de-obra (Lei 7.713/88 art. 55)
 *   1.5%  — serviços profissionais em geral (Decreto-Lei 1.598/77)
 *   4.8%  — comissões/propaganda (raro em NFSe SP)
 */
export const ALIQUOTAS_IRRF_USUAIS = [0.01, 0.015, 0.048];
/**
 * Teto de dispensa CSRF: pagamento ≤ R$ 215,05 → CSRF (4,65%) ≤ R$ 10,00.
 * Lei 10.833/03 art. 31 §3º (com redação da Lei 13.137/2015).
 * Aplicado por PAGAMENTO INDIVIDUAL — nao cumula com outras notas do mes.
 */
export const TETO_DISPENSA_CSRF = 215.05;
const TOLERANCIA_PCT = 0.01; // 1% de tolerância pra arredondamento

export type ContextoValidacao = {
    /** CNPJs do tomador atual que são optantes Simples (dispensa CSRF). */
    cnpjsSimples?: Set<string>;
};

/**
 * Aplica validações fiscais à análise extraída de uma linha. Retorna lista
 * de inconsistências (vazia quando tudo bate). Use opts.cnpjsSimples pra
 * cruzar Simples — se o prestador (em notas Recebidas) for Simples, a CSRF
 * normalmente é indevida (LC 123/06 art. 13 §1º VI — exceção Anexo IV).
 */
export function validarRetencoesLinha(
    linha: LinhaNfseCsv,
    analise: AnaliseRetencoes,
    opts?: ContextoValidacao,
): Inconsistencia[] {
    const incs: Inconsistencia[] = [];
    const valor = linha.valorServicos;
    if (valor <= 0) return incs;

    // 1) Erro lógico: retenção total > valor do serviço
    if (analise.totalRetido > valor + 0.01) {
        incs.push({
            severidade: 'erro',
            codigo: 'RETENCAO_MAIOR_QUE_SERVICO',
            mensagem: `Retenção total (R$ ${analise.totalRetido.toFixed(2)}) maior que o valor do serviço (R$ ${valor.toFixed(2)}).`,
        });
    }

    // 2) CSRF consistência: quando PIS+COFINS+CSLL todos retidos, soma deve
    //    bater com 4,65% × valor (Lei 10.833/03 art. 30). Tolerância 1%.
    const csrfRetido = analise.pis.valor + analise.cofins.valor + analise.csll.valor;
    if (analise.pis.retido && analise.cofins.retido && analise.csll.retido) {
        const esperado = valor * ALIQ_CSRF_TOTAL;
        if (Math.abs(csrfRetido - esperado) / esperado > TOLERANCIA_PCT) {
            incs.push({
                severidade: 'alerta',
                codigo: 'CSRF_INCONSISTENTE',
                mensagem: `CSRF retido R$ ${csrfRetido.toFixed(2)} diverge de 4,65% × valor (esperado R$ ${esperado.toFixed(2)}).`,
            });
        }
    }

    // 3) IRRF: alíquota deve ser uma das usuais + piso de dispensa R$ 10
    //         (Lei 9.430/96 art. 67 - dispensada retencao inferior a R$ 10,00).
    if (analise.irrf.retido && analise.irrf.valor > 0) {
        if (analise.irrf.valor < 10) {
            incs.push({
                severidade: 'alerta',
                codigo: 'IRRF_ABAIXO_PISO',
                mensagem: `IRRF retido R$ ${analise.irrf.valor.toFixed(2)} - DISPENSADO pelo art. 67 da Lei 9.430/96 (retencoes inferiores a R$ 10,00 nao sao recolhidas).`,
            });
        }
        const aliq = analise.irrf.valor / valor;
        const usual = ALIQUOTAS_IRRF_USUAIS.some(a => Math.abs(aliq - a) <= 0.001);
        if (!usual) {
            incs.push({
                severidade: 'alerta',
                codigo: 'IRRF_ALIQUOTA_ATIPICA',
                mensagem: `IRRF a ${(aliq * 100).toFixed(2)}% (usual: 1%, 1,5% ou 4,8%).`,
            });
        }
    }

    // 3b) CSRF (PIS+COFINS+CSLL): piso R$ 10 (Lei 13.137/2015 art. 24).
    //     Antes era R$ 10 no agregado; lei agora isenta retencao quando valor < R$ 10.
    if ((analise.pis.retido || analise.cofins.retido || analise.csll.retido) && csrfRetido > 0 && csrfRetido < 10) {
        incs.push({
            severidade: 'alerta',
            codigo: 'CSRF_ABAIXO_PISO',
            mensagem: `CSRF total R$ ${csrfRetido.toFixed(2)} - DISPENSADO pela Lei 13.137/2015 (retencoes < R$ 10,00).`,
        });
    }

    // 4) Cruzamento com Simples — só aplica em notas Recebidas (eu sou tomador,
    //    prestador é o CNPJ na coluna). Se o prestador for Simples e tiver
    //    sofrido CSRF, alerta — geralmente indevida (LC 123/06 art. 13 §1º VI,
    //    salvo Anexo IV: vigilância, limpeza, construção).
    if (linha.direcao === 'Recebida') {
        const cnpjPrestador = (linha.prestadorCnpj || '').replace(/\D/g, '');
        const prestadorEhSimples = opts?.cnpjsSimples?.has(cnpjPrestador) || false;
        if (prestadorEhSimples) {
            const teveCsrf = analise.pis.retido || analise.cofins.retido || analise.csll.retido;
            if (teveCsrf) {
                incs.push({
                    severidade: 'alerta',
                    codigo: 'CSRF_PRESTADOR_SIMPLES',
                    mensagem: 'Prestador é Simples — CSRF geralmente indevida (verifique se prestou serviço do Anexo IV).',
                });
            }
        }
    }

    // 5) Falta de retenção quando obrigatória: valor > R$ 215,05, sem CSRF,
    //    prestador NÃO-Simples (em notas Recebidas, eu sou tomador).
    if (linha.direcao === 'Recebida' && valor > TETO_DISPENSA_CSRF) {
        const cnpjPrestador = (linha.prestadorCnpj || '').replace(/\D/g, '');
        const prestadorEhSimples = opts?.cnpjsSimples?.has(cnpjPrestador) || false;
        const teveCsrf = analise.pis.retido || analise.cofins.retido || analise.csll.retido;
        if (!prestadorEhSimples && !teveCsrf) {
            incs.push({
                severidade: 'alerta',
                codigo: 'FALTA_CSRF',
                mensagem: `Pagamento R$ ${valor.toFixed(2)} > teto de dispensa R$ 215,05 e nenhuma CSRF retida (Lei 10.833/03 art. 30 — verifique se prestador não-Simples).`,
            });
        }
    }

    return incs;
}

export type ConsolidadoPorPrestadorMes = {
    prestadorCnpj: string;
    prestadorNome: string;
    competencia: string; // YYYY-MM
    qtdNotas: number;
    valorTotal: number;
    csrfTotalRetido: number;
    irrfTotalRetido: number;
};

/**
 * Agrupa notas RECEBIDAS por prestador + mês. Útil pra conferir DARF
 * mensal consolidado (IN RFB 1.234/2012 art. 4º §3º — pagamentos ao mesmo
 * prestador no mês recolhem em DARF único).
 *
 * NOTA fiscal importante: a dispensa de R$ 10,00 (art. 31 §3º Lei 10.833/03)
 * aplica-se a CADA PAGAMENTO, não cumula. Logo, não geramos alerta de
 * "falta retenção" apenas porque o cumulativo passou de R$ 215,05 — isso
 * é tratado por nota individual em validarRetencoesLinha.
 */
export function consolidarPorPrestadorMes(
    items: { linha: LinhaNfseCsv; analise: AnaliseRetencoes }[],
): ConsolidadoPorPrestadorMes[] {
    const grupos = new Map<string, ConsolidadoPorPrestadorMes>();
    for (const it of items) {
        if (it.linha.direcao !== 'Recebida') continue;
        const cnpj = (it.linha.prestadorCnpj || '').replace(/\D/g, '');
        const mes = (it.linha.data || '').slice(0, 7);
        if (!cnpj || !mes) continue;
        const key = `${cnpj}|${mes}`;
        if (!grupos.has(key)) {
            grupos.set(key, {
                prestadorCnpj: cnpj,
                prestadorNome: it.linha.prestadorNome || '',
                competencia: mes,
                qtdNotas: 0,
                valorTotal: 0,
                csrfTotalRetido: 0,
                irrfTotalRetido: 0,
            });
        }
        const g = grupos.get(key)!;
        g.qtdNotas++;
        g.valorTotal += it.linha.valorServicos;
        g.csrfTotalRetido += it.analise.pis.valor + it.analise.cofins.valor + it.analise.csll.valor;
        g.irrfTotalRetido += it.analise.irrf.valor;
    }
    return Array.from(grupos.values()).sort((a, b) => b.valorTotal - a.valorTotal);
}

// Parse "1.234,56" / "1234.56" / "1234,56" -> number
function parseValorBR(s: string): number {
    if (!s) return 0;
    const txt = s.replace(/\s/g, '');
    // formato BR (vírgula decimal, ponto milhar) vs US (ponto decimal)
    if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(txt)) return parseFloat(txt.replace(/\./g, '').replace(',', '.'));
    if (/,\d{1,2}$/.test(txt)) return parseFloat(txt.replace(/\./g, '').replace(',', '.'));
    return parseFloat(txt.replace(/,/g, '')) || 0;
}

// Trechos que indicam "informativo, não retenção" — usados pra invalidar matches.
const REGEX_IBPT = /(?:trib(?:utos?)?\s+aprox|fonte\s+ibpt|lei\s+12\.?741|carga\s+tribut[áa]ria\s+aprox)/i;
const REGEX_NAO_RETENCAO = /(?:n[ãa]o\s+reten[çc][ãa]o|n[ãa]o\s+ret[ée]m|n[ãa]o\s+retid[oa]s?|nao\s+reten)/i;
const REGEX_EMITENTE_RECOLHEU = /recolhimento\s+(?:j[áa]\s+)?efetuado\s+pelo\s+emitente/i;

/**
 * Tenta extrair o valor retido de um tributo da discriminação.
 *   tributoRegex deve casar com o NOME do tributo (ex: /IRRF/i).
 *
 * Estratégia: procura padrões "TRIBUTO ... R$ X,XX" ou "TRIBUTO ... X,XX"
 * no entorno (até 80 chars depois do nome), com guards contra falsos positivos.
 */
function detectarTributoEmTexto(texto: string, tributoRegex: RegExp): TributoRetido {
    if (!texto) return { retido: false, valor: 0 };

    // 1) Checa se há menção a "NÃO RETENÇÃO" no texto (declaração explícita)
    //    Aplicada APENAS se o trecho de não-retenção menciona o tributo.
    const matchNaoReten = texto.match(/(?:n[ãa]o\s+reten[^.|]{0,80})/i);
    if (matchNaoReten && tributoRegex.test(matchNaoReten[0])) {
        return {
            retido: false, valor: 0,
            motivo: 'declaracao explicita de nao retencao',
            trechoEvidencia: matchNaoReten[0].trim().slice(0, 120),
        };
    }

    // 2) Procura padrão "TRIBUTO ... R$ X,XX" (com R$, mais confiável)
    const regexComRS = new RegExp(
        `(${tributoRegex.source})[^|\\n]{0,80}?R\\$\\s*([0-9]+(?:[.,][0-9]+)*)`,
        tributoRegex.flags.includes('i') ? 'gi' : 'g'
    );
    let m: RegExpExecArray | null;
    while ((m = regexComRS.exec(texto)) !== null) {
        const trecho = texto.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
        // Filtra IBPT (tributos aproximados, não retenção)
        if (REGEX_IBPT.test(trecho)) continue;
        // Filtra "recolhimento efetuado pelo emitente" (recolhido pelo prestador)
        if (REGEX_EMITENTE_RECOLHEU.test(trecho)) {
            return {
                retido: false, valor: 0,
                motivo: 'recolhido pelo emitente (nao retencao do tomador)',
                trechoEvidencia: trecho.trim().slice(0, 120),
            };
        }
        const valor = parseValorBR(m[2] || '');
        if (valor > 0) {
            return {
                retido: true, valor,
                trechoEvidencia: m[0].trim().slice(0, 120),
            };
        }
        // valor explicito = 0 -> nao retido, mas registra evidencia
        return {
            retido: false, valor: 0,
            motivo: 'tributo mencionado com valor R$ 0,00',
            trechoEvidencia: m[0].trim().slice(0, 120),
        };
    }

    return { retido: false, valor: 0 };
}

export function analisarRetencoes(linha: LinhaNfseCsv): AnaliseRetencoes {
    const disc = linha.discriminacao || '';

    // ISS vem na coluna própria (> 0 = retido).
    const iss: TributoRetido = linha.iss > 0
        ? { retido: true, valor: linha.iss, trechoEvidencia: `coluna ISS = R$ ${linha.iss.toFixed(2)}` }
        : { retido: false, valor: 0 };

    const irrf = detectarTributoEmTexto(disc, /\bIRRF\b/);
    const pis = detectarTributoEmTexto(disc, /\bPIS\b/);
    const cofins = detectarTributoEmTexto(disc, /\bCOFINS\b/);
    const csll = detectarTributoEmTexto(disc, /\bCSLL\b/);
    const inss = detectarTributoEmTexto(disc, /\bINSS\b/);

    const totalRetido = iss.valor + inss.valor + pis.valor + cofins.valor + csll.valor + irrf.valor;
    const temAlgumaRetencao = iss.retido || inss.retido || pis.retido || cofins.retido || csll.retido || irrf.retido;

    return { iss, inss, pis, cofins, csll, irrf, totalRetido, temAlgumaRetencao };
}

// ─── Parser do CSV NFSe SP ───────────────────────────────────────────────────
// Formato esperado (cabecalho na 1a linha):
//   Direção;Número;Data;Prestador CNPJ;Prestador Nome;Tomador CNPJ;
//   Tomador Nome;Valor Serviços;ISS;Cód Serviço;Discriminação
//
// Separador `;` (campos contem virgula e R$). Discriminação pode ter aspas
// envolvendo o conteudo quando ele contem `;` ou `\n`.
export function parseCsvNfseSp(texto: string): LinhaNfseCsv[] {
    // Normaliza BOM e quebra linhas respeitando aspas
    let txt = texto.replace(/^﻿/, '');
    const linhas: string[] = [];
    let buffer = '';
    let dentroDeAspas = false;
    for (let i = 0; i < txt.length; i++) {
        const c = txt[i];
        if (c === '"') dentroDeAspas = !dentroDeAspas;
        if ((c === '\n' || c === '\r') && !dentroDeAspas) {
            if (buffer.length > 0) linhas.push(buffer);
            buffer = '';
            // pula \r\n
            if (c === '\r' && txt[i + 1] === '\n') i++;
        } else {
            buffer += c;
        }
    }
    if (buffer.length > 0) linhas.push(buffer);

    if (linhas.length < 2) return [];

    // Split com separador `;` respeitando aspas
    const splitLinha = (l: string): string[] => {
        const out: string[] = [];
        let cur = '';
        let aspas = false;
        for (const c of l) {
            if (c === '"') { aspas = !aspas; continue; }
            if (c === ';' && !aspas) { out.push(cur); cur = ''; }
            else cur += c;
        }
        out.push(cur);
        return out.map(s => s.trim());
    };

    const header = splitLinha(linhas[0] || '').map(h => h.toLowerCase());
    const idx = {
        direcao: header.findIndex(h => h.startsWith('direç') || h.startsWith('direc')),
        numero: header.findIndex(h => h.startsWith('número') || h.startsWith('numero')),
        data: header.findIndex(h => h === 'data'),
        prestadorCnpj: header.findIndex(h => h.includes('prestador') && h.includes('cnpj')),
        prestadorNome: header.findIndex(h => h.includes('prestador') && h.includes('nome')),
        tomadorCnpj: header.findIndex(h => h.includes('tomador') && h.includes('cnpj')),
        tomadorNome: header.findIndex(h => h.includes('tomador') && h.includes('nome')),
        valorServicos: header.findIndex(h => h.includes('valor') && h.includes('serv')),
        iss: header.findIndex(h => h === 'iss'),
        codServico: header.findIndex(h => h.includes('cód') || h.includes('cod')),
        discriminacao: header.findIndex(h => h.startsWith('discrim')),
    };

    const out: LinhaNfseCsv[] = [];
    for (let i = 1; i < linhas.length; i++) {
        const cols = splitLinha(linhas[i] || '');
        if (cols.length < 5) continue;
        out.push({
            direcao: cols[idx.direcao] || '',
            numero: cols[idx.numero] || '',
            data: cols[idx.data] || '',
            prestadorCnpj: cols[idx.prestadorCnpj] || '',
            prestadorNome: cols[idx.prestadorNome] || '',
            tomadorCnpj: cols[idx.tomadorCnpj] || '',
            tomadorNome: cols[idx.tomadorNome] || '',
            valorServicos: parseValorBR(cols[idx.valorServicos] || '0'),
            iss: parseValorBR(cols[idx.iss] || '0'),
            codServico: cols[idx.codServico] || '',
            discriminacao: cols[idx.discriminacao] || '',
        });
    }
    return out;
}

// ─── Agregado p/ UI ───────────────────────────────────────────────────────
export type ResumoRetencoes = {
    totalNotas: number;
    notasComRetencao: number;
    totalRetido: number;
    porTributo: Record<'iss' | 'inss' | 'pis' | 'cofins' | 'csll' | 'irrf', { qtd: number; valor: number }>;
};

export function resumirRetencoes(analises: AnaliseRetencoes[]): ResumoRetencoes {
    const r: ResumoRetencoes = {
        totalNotas: analises.length,
        notasComRetencao: 0,
        totalRetido: 0,
        porTributo: {
            iss: { qtd: 0, valor: 0 }, inss: { qtd: 0, valor: 0 },
            pis: { qtd: 0, valor: 0 }, cofins: { qtd: 0, valor: 0 },
            csll: { qtd: 0, valor: 0 }, irrf: { qtd: 0, valor: 0 },
        },
    };
    for (const a of analises) {
        if (a.temAlgumaRetencao) r.notasComRetencao++;
        r.totalRetido += a.totalRetido;
        for (const k of ['iss', 'inss', 'pis', 'cofins', 'csll', 'irrf'] as const) {
            if (a[k].retido) {
                r.porTributo[k].qtd++;
                r.porTributo[k].valor += a[k].valor;
            }
        }
    }
    return r;
}
