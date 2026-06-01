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
};

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
        const valor = parseValorBR(m[2]);
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

    const header = splitLinha(linhas[0]).map(h => h.toLowerCase());
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
        const cols = splitLinha(linhas[i]);
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
