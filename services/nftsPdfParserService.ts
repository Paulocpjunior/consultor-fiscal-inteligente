/**
 * services/nftsPdfParserService.ts
 *
 * Parser de PDFs de notas fiscais de servico TOMADO para geracao da NFTS SP.
 * Extrai texto via pdfjs-dist e aplica heuristicas em camadas de confianca
 * (portadas do Gerador de Lotes NFTS, sem os perfis hardcoded por CNPJ).
 *
 * PDFs escaneados (sem texto extraivel) devem cair no fallback Gemini
 * (extractNftsDataFromPdf em geminiService.ts) — decidido pelo chamador
 * via resultado `textoInsuficiente`.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { validarCnpj } from './validadorDocumento';
import {
    cleanNfts, soDigitos, parseValorCentavos, parseDataAAAAMMDD,
    detectarIssRetido, selecionarCodigoSp, validarNotaNfts,
    type NftsNota, type NftsPendencia,
} from './nftsSpService';

if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

// ─── Extracao de texto ──────────────────────────────────────────────────────

export interface NftsPdfTexto {
    paginas: string[];
    textoInsuficiente: boolean;
}

const MIN_CHARS_PAGINA = 40;

export async function extrairTextoPdf(file: File): Promise<NftsPdfTexto> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paginas: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        paginas.push(content.items.map((item: any) => ('str' in item ? item.str : '')).join('\n'));
    }
    const textoInsuficiente = !paginas.length || paginas.every(t => t.trim().length < MIN_CHARS_PAGINA);
    return { paginas, textoInsuficiente };
}

// ─── Heuristicas de extracao ────────────────────────────────────────────────

function tokens(bloco: string): string[] {
    return bloco.split(/[|\r\n]+/)
        .map(x => x.replace(/\s+/g, ' ').trim().replace(/^[\s:-]+|[\s:-]+$/g, ''))
        .filter(Boolean);
}

function first(padroes: RegExp[], texto: string): string {
    for (const p of padroes) {
        const m = texto.match(p);
        if (m?.[1]) return m[1].trim();
    }
    return '';
}

/** Isola o bloco do prestador (entre o cabecalho do prestador e o do tomador). */
function isolarBlocoPrestador(texto: string): string {
    const t = cleanNfts(texto);
    const ini = t.match(/(?:PRESTADOR\s*\/\s*FORNECEDOR|EMITENTE DA NFS-?e|DADOS DO PRESTADOR(?: DE SERVICOS)?|PRESTADOR(?: DE| DO)? SERVI[CG]OS?)/i);
    if (!ini || ini.index == null) return t.slice(0, 5500);
    const resto = t.slice(ini.index + ini[0].length);
    const fim = resto.match(/(?:DADOS DO )?TOMADOR(?: DE| DO)? SERVI[CG]OS?|TOMADOR\s*\/\s*CLIENTE/i);
    const fimIdx = fim?.index != null ? fim.index : Math.min(resto.length, 5500);
    return t.slice(ini.index, ini.index + ini[0].length + fimIdx);
}

/** CNPJ do prestador por contexto de rotulo dentro do bloco do prestador. */
export function extrairCnpjPrestador(texto: string, cnpjTomador = ''): { cnpj: string; todos: string[] } {
    const t = cleanNfts(texto);
    const bloco = isolarBlocoPrestador(t);
    const toks = tokens(bloco);
    const rotulo = /(?:CNPJ|CNP\s*J|CNP\.J|CPF\s*\/\s*CNPJ|CNPJ\s*\/\s*CPF(?:\s*\/\s*NIF)?)/i;
    const proibido = /CHAVE|CODIGO IBGE|INSCRICAO/i;
    const encontrados: string[] = [];
    for (let i = 0; i < toks.length; i++) {
        if (!rotulo.test(toks[i]) || proibido.test(toks[i])) continue;
        for (const cand of [toks[i], ...toks.slice(i + 1, i + 5)]) {
            if (proibido.test(cand)) continue;
            const matches = cand.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}|\b\d{14}\b/g) ?? [];
            for (const x of matches) {
                const d = soDigitos(x);
                if (d.length === 14 && validarCnpj(d) && d !== cnpjTomador && !encontrados.includes(d)) encontrados.push(d);
            }
        }
    }
    if (!encontrados.length) {
        const m = bloco.match(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/\d{4}-\d{2}(?!\d)/);
        if (m) {
            const d = soDigitos(m[0]);
            if (validarCnpj(d) && d !== cnpjTomador) encontrados.push(d);
        }
    }
    const todos: string[] = [];
    const all = t.match(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/\d{4}-\d{2}(?!\d)|(?<!\d)\d{14}(?!\d)/g) ?? [];
    for (const x of all) {
        const d = soDigitos(x);
        if (validarCnpj(d) && !todos.includes(d)) todos.push(d);
    }
    return { cnpj: encontrados[0] ?? '', todos };
}

/** Numero/serie com camadas de confianca e fallback pelo nome do arquivo. */
export function extrairNumeroSerie(nomeArquivo: string, texto: string): { numero: string; serie: string; origem: string; confianca: 'alta' | 'media' | 'baixa' | 'nenhuma' } {
    const original = cleanNfts(texto);
    const normalizado = original.replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const blocos = tokens(original);
    // DANFSe nacional: rotulos primeiro, valores depois.
    for (let i = 0; i < blocos.length; i++) {
        if (/^Numero da NFS-?e$/i.test(blocos[i])) {
            const janela = blocos.slice(i + 1, i + 18);
            for (let j = 0; j < janela.length; j++) {
                if (/^\d{1,12}$/.test(janela[j])) {
                    const proximos = janela.slice(j + 1, j + 5).join(' ');
                    if (/\d{2}\/\d{2}\/\d{4}/.test(proximos)) {
                        return { numero: janela[j], serie: '', origem: 'bloco DANFSe nacional', confianca: 'alta' };
                    }
                }
            }
        }
    }
    const mFlat = normalizado.match(/Numero da NFS-?e\s+Competencia da NFS-?e\s+Data e Hora da emissao da NFS-?e(?:(?!\d{2}\/\d{2}\/\d{4}).){0,120}?\b(\d{1,12})\b\s+\d{2}\/\d{2}\/\d{4}/i);
    if (mFlat) return { numero: mFlat[1], serie: '', origem: 'bloco DANFSe nacional', confianca: 'alta' };
    const padroesAlta = [
        /Numero\s+da\s+NFS-?e\s*[:|\-]*\s*(\d{1,15})(?:\s*\/\s*([A-Z0-9]{1,5}))?/i,
        /Numero\s+da\s+Nota\s*[:|\-]*\s*(\d{1,15})(?:\s*\/\s*([A-Z0-9]{1,5}))?/i,
        /N[o°º]?\s*NFS-?e\s*[:|\-]*\s*(\d{1,15})(?:\s*\/\s*([A-Z0-9]{1,5}))?/i,
        /NFS-?e\s*N[o°º]?\s*[:|\-]*\s*(\d{1,15})(?:\s*\/\s*([A-Z0-9]{1,5}))?/i,
    ];
    for (const p of padroesAlta) {
        const m = normalizado.match(p);
        if (m) return { numero: m[1], serie: m[2] ?? '', origem: 'campo explicito', confianca: 'alta' };
    }
    const mComp = normalizado.match(/Competencia\s+da\s+NFS-?e\s*[:|\-]*\s*(\d{1,12})\s*\/\s*([A-Z][A-Z0-9]{0,4})\b/i);
    if (mComp) return { numero: mComp[1], serie: mComp[2], origem: 'numero/serie em bloco municipal', confianca: 'media' };
    for (const p of [
        /Numero\s*\/\s*Serie\s*[:|\-]*\s*(\d{1,15})\s*\/\s*([A-Z0-9]{1,5})/i,
        /Nota\s+Fiscal.*?Numero\s*[:|\-]*\s*(\d{1,15})/i,
    ]) {
        const m = normalizado.match(p);
        if (m) return { numero: m[1], serie: m[2] ??  '', origem: 'layout municipal', confianca: 'media' };
    }
    // Fallback controlado: nome do arquivo.
    const nome = cleanNfts(nomeArquivo.replace(/\.pdf$/i, ''));
    const candidatos: string[] = [];
    for (const p of [/NFSE?[_ .-]+(\d{1,15})/gi, /NF\.?[_ .-]*(\d{1,12})/gi, /NOTA[_ .-]*(\d{1,12})/gi]) {
        let m: RegExpExecArray | null;
        while ((m = p.exec(nome)) != null) candidatos.push(m[1]);
    }
    for (const bruto of candidatos) {
        let d = soDigitos(bruto);
        if (!d) continue;
        const mNac = d.match(/^20\d{2}0+(\d{1,8})$/);
        if (mNac) d = mNac[1];
        if (d.length <= 12) return { numero: d, serie: '', origem: 'nome do arquivo', confianca: 'baixa' };
    }
    return { numero: '', serie: '', origem: 'nao identificado', confianca: 'nenhuma' };
}

export function extrairNomePrestador(texto: string, cnpj: string): string {
    const bloco = isolarBlocoPrestador(cleanNfts(texto));
    const toks = tokens(bloco);
    const rotuloNome = /^(?:N[O0]ME\s*\/?\s*RAZ[AE]O SOCIAL|N[O0]ME\s*\/\s*N[O0]ME EMPRESARIAL|N[O0]ME EMPRESARIAL|RAZ[AE]O SOCIAL(?:\s*\/\s*N[O0]ME)?|PRESTADOR DE SERVI[CG]OS)$/i;
    const proibido = /^(?:E-?MAIL|TELEFONE|ENDERE[CG]O|MUNICIPIO|CEP|INSCRI[CG][AO]O(?: MUNICIPAL)?|CODIGO IBGE|CNPJ|CPF|NIF|SIMPLES NACIONAL|PRESTADOR|TOMADOR|SERVI[CG]O)$/i;
    // Rejeita rotulos multi-palavra que vazavam como razao social,
    // ex. "Prestador do servico", "Dados do Prestador de Servicos".
    const rotuloMultiPalavra = /^(?:DADOS\s+DO\s+)?(?:PRESTADOR|TOMADOR|EMITENTE)(?:\s+D[EOA]S?)?(?:\s+SERVI[CG]OS?)?$/i;
    const valido = (c: string) => c.length >= 5 && /[A-Za-z]{3}/.test(c)
        && !proibido.test(c.trim()) && !rotuloMultiPalavra.test(c.trim()) && !/^[\d./() -]+$/.test(c);
    for (let i = 0; i < toks.length; i++) {
        const mm = toks[i].match(/^(?:N[O0]me \/ N[O0]me Empresarial|N[O0]me Empresarial|Raz[ae]o Social(?:\/N[O0]me)?|N[O0]me\/Raz[ae]o Social)\s+(.+)/i);
        if (mm && valido(mm[1])) return mm[1].slice(0, 75);
        if (rotuloNome.test(toks[i]) && !/CNPJ|CPF|NIF/i.test(toks[i])) {
            for (const cand of toks.slice(i + 1, i + 9)) {
                if (proibido.test(cand) || /CNPJ|CPF|NIF/i.test(cand)) continue;
                if (valido(cand)) return cand.slice(0, 75);
            }
        }
    }
    for (let i = 0; i < toks.length; i++) {
        // Rotulo e valor na mesma linha: "Prestador de Servicos ALELO S.A."
        const inline = toks[i].match(/^Prestador de Servi[cg]os\s+(.+)/i);
        if (inline && valido(inline[1])) return inline[1].slice(0, 75);
        if (/^Prestador de Servi[cg]os$/i.test(toks[i])) {
            for (const cand of toks.slice(i + 1, i + 5)) {
                if (valido(cand)) return cand.slice(0, 75);
            }
        }
    }
    const mRecibo = cleanNfts(texto).match(/RECEBI(?:MOS|\(EMOS\))? DE\s+([A-Z0-9 .&-]{5,75}?)\s*,?\s*CNPJ/i);
    if (mRecibo && !/TOMADOR/i.test(mRecibo[1])) return mRecibo[1].trim().slice(0, 75);
    return 'PRESTADOR ' + cnpj;
}

export function extrairValorServico(texto: string): number | null {
    const t = cleanNfts(texto);
    const padroes = [
        /VALOR TOTAL DA NOTA\s*(?:=|:)?\s*R?\$?\s*([0-9.]+,\d{2})/i,
        /Valor (?:Total )?dos Servicos\s*(?:R\$)?\s*([0-9.]+,\d{2})/i,
        /Valor do Servico\s*(?:R\$)?\s*([0-9.]+,\d{2})/i,
        /Valor da NFS-?e\s*(?:R\$)?\s*([0-9.]+,\d{2})/i,
        /Valor Liquido(?: da NFS-?e)?\s*(?:R\$)?\s*([0-9.]+,\d{2})/i,
    ];
    for (const p of padroes) {
        const m = t.match(p);
        if (m) {
            const v = parseValorCentavos(m[1]);
            if (v != null && v > 0) return v;
        }
    }
    const valores = (t.match(/\b[0-9]{1,3}(?:\.[0-9]{3})*,\d{2}\b/g) ?? [])
        .map(parseValorCentavos)
        .filter((x): x is number => x != null && x > 0);
    return valores.length ? Math.max(...valores) : null;
}

const TIPOS_LOGRADOURO: Record<string, string> = {
    'R': 'RUA', 'R.': 'RUA', 'RUA': 'RUA', 'AV': 'AV', 'AV.': 'AV', 'AVENIDA': 'AV',
    'ALAMEDA': 'AL', 'TRAVESSA': 'TV', 'VIELA': 'VLA', 'ESTRADA': 'EST',
    'RODOVIA': 'ROD', 'PRACA': 'PCA', 'LARGO': 'LGO',
};

export interface EnderecoExtraido {
    tipo: string; logradouro: string; numero: string; complemento: string;
    bairro: string; cidade: string; uf: string; cep: string;
    confianca: 'alta' | 'media';
}

export function extrairEnderecoPrestador(texto: string): EnderecoExtraido {
    const bloco = isolarBlocoPrestador(cleanNfts(texto));
    const toks = tokens(bloco);
    let cep = ''; let cepIdx = -1;
    for (let i = 0; i < toks.length; i++) {
        const cm = toks[i].match(/\b(\d{5})[.\s-]?(\d{3})\b/);
        if (cm) { cep = cm[1] + cm[2]; cepIdx = i; break; }
    }
    let cidade = ''; let uf = '';
    const cands: Array<[number, string, string]> = [];
    for (let i = 0; i < toks.length; i++) {
        const mm = toks[i].match(/(?:CEP\s*\d{5}-?\d{3}\s*-\s*)?([A-Za-z][A-Za-z .'-]{1,48}?)\s*[-/]\s*([A-Z]{2})(?:\s*-?\s*BRASIL)?$/i);
        if (mm && !/NOTA|NFS|PREFEITURA|SERVICO|ENDERE/i.test(toks[i])) {
            cands.push([cepIdx >= 0 ? Math.abs(i - cepIdx) : i, mm[1].trim(), mm[2].toUpperCase()]);
        }
    }
    if (cands.length) {
        cands.sort((a, b) => a[0] - b[0]);
        cidade = cands[0][1]; uf = cands[0][2];
    }
    if (!cidade) {
        const mm = bloco.match(/-\s*([A-Za-z][A-Za-z .'-]{1,40})\s*-\s*(?:CEP[: ]*)?\d{5}-?\d{3}\s*-\s*([A-Z]{2})/i);
        if (mm) { cidade = mm[1].trim(); uf = mm[2].toUpperCase(); }
    }
    let endereco = ''; let bairro = ''; let numero = '0'; let tipo = 'RUA';
    for (let i = 0; i < toks.length; i++) {
        if (/^ENDER(?:ECO|EGO|E[CG]O)$/i.test(toks[i])) {
            for (const cand of toks.slice(i + 1, i + 16)) {
                if (/^(?:MUNICIPIO|CEP|COMPLEMENTO|BAIRRO)$/i.test(cand)) continue;
                if (cand.length >= 8 && /[A-Za-z]/.test(cand) && (/\d/.test(cand) || /^(?:RUA|AV|ALAMEDA|VIELA|RODOVIA|ESTRADA)/i.test(cand))) {
                    endereco = cand; break;
                }
            }
            break;
        }
    }
    if (!endereco) {
        for (const tok of toks) {
            if (/^(?:RUA|R\.?|AVENIDA|AV\.?|ALAMEDA|TRAVESSA|VIELA|ESTRADA|RODOVIA|PRACA|LARGO)\s+/i.test(tok) && tok.length > 8) {
                endereco = tok; break;
            }
        }
    }
    let logradouro = 'NAO INFORMADO';
    if (endereco) {
        const em = endereco.match(/^(RUA|R\.?|AVENIDA|AV\.?|ALAMEDA|TRAVESSA|VIELA|ESTRADA|RODOVIA|PRACA|LARGO)\s+(.+)/i);
        if (em) { tipo = TIPOS_LOGRADOURO[em[1].toUpperCase()] ?? 'RUA'; logradouro = em[2].trim(); }
        else logradouro = endereco;
        const nm = logradouro.match(/(?:,|\s)\s*(\d+[A-Z]?)\s*(?:,|$)/i);
        if (nm) {
            numero = nm[1];
            logradouro = (logradouro.slice(0, nm.index) + logradouro.slice((nm.index ?? 0) + nm[0].length)).replace(/^[\s,-]+|[\s,-]+$/g, '');
        }
    }
    for (let i = 0; i < toks.length; i++) {
        if (/^BAIRRO$/i.test(toks[i]) && i + 1 < toks.length) { bairro = toks[i + 1]; break; }
    }
    if (!bairro && cepIdx >= 0) {
        for (const tok of toks.slice(cepIdx + 1, cepIdx + 4)) {
            if (/^[A-Za-z][A-Za-z .'-]{2,40}$/.test(tok)
                && ![cidade.toUpperCase(), uf, 'TOMADOR DO SERVICO', 'TOMADOR DE SERVICOS', 'E-MAIL', 'EMAIL', 'TELEFONE'].includes(tok.toUpperCase())) {
                bairro = tok; break;
            }
        }
    }
    // Bairro contaminado por rotulo/email vira NAO INFORMADO.
    if (bairro && (/TOMADOR|PRESTADOR|SERVICO|CNPJ|CPF|CODIGO IBGE|MUNICIPIO/i.test(bairro) || /@|GMAIL|HOTMAIL|OUTLOOK|\.COM|\.BR/i.test(bairro))) bairro = '';
    return {
        tipo, logradouro: logradouro.slice(0, 50), numero: numero.slice(0, 10), complemento: '',
        bairro: (bairro || 'NAO INFORMADO').slice(0, 30), cidade: cidade.slice(0, 50), uf, cep,
        confianca: cep && cidade && uf ? 'alta' : 'media',
    };
}

// ─── Pipeline de parsing por pagina ─────────────────────────────────────────

export interface NftsParseResult {
    nota: NftsNota | null;
    pendencia: NftsPendencia | null;
}

export function parseNftsFromText(
    nomeArquivo: string,
    pagina: number,
    textoBruto: string,
    cnpjTomador = '',
): NftsParseResult {
    const t = cleanNfts(textoBruto);
    if (!t.trim()) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina, motivo: 'Pagina sem texto extraivel (provavel PDF escaneado)' } };
    }
    const { cnpj } = extrairCnpjPrestador(t, soDigitos(cnpjTomador));
    if (!cnpj) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina, motivo: 'CNPJ valido do prestador nao encontrado', trecho: t.slice(0, 800) } };
    }
    const { numero, serie, origem: origemNumero, confianca: confiancaNumero } = extrairNumeroSerie(nomeArquivo, t);
    const dataStr = first([
        /Data(?: e Hora)?(?: da)? Emissao[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i,
        /emitido em\s+(\d{2}\/\d{2}\/\d{4})/i,
    ], t) || t;
    const data = parseDataAAAAMMDD(dataStr.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? '');
    const valor = extrairValorServico(t);
    const itemRaw = first([
        /Codigo de Tributacao Nacional\s+([0-9]{1,2}[.,][0-9]{2})/i,
        /Codigo do Servico[\s\S]*?([0-9]{1,2}[.,][0-9]{2})/i,
        /\b([0-9]{1,2}[.,][0-9]{2})\s*-/,
    ], t);
    // Janela limitada apos o rotulo + exclusao de fragmentos de CEP
    // (NNNNN-NNN) e de CNPJ, que causavam codigo de servico errado no
    // gerador original (ex.: "03123" vindo do CEP da Mooca).
    const codigoRaw = first([
        /Codigo(?: Municipal)?(?: do)? Servico[\s\S]{0,200}?(?<![\d./-])(\d{4,5})(?!\s*-\s*\d{3})(?![\d.])/i,
        /Codigo tributario[\s\S]{0,200}?(?<![\d./-])(\d{4,5})(?!\s*-\s*\d{3})(?![\d.])/i,
    ], t);
    const serviceRow = selecionarCodigoSp(t, itemRaw, codigoRaw, 'PJ');
    const faltando: string[] = [];
    if (!numero) faltando.push('numero');
    if (!data) faltando.push('data');
    if (valor == null) faltando.push('valor');
    if (!serviceRow) faltando.push('codigo de servico');
    if (faltando.length) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina, motivo: 'Campos ausentes: ' + faltando.join(', '), trecho: t.slice(0, 2000) } };
    }
    const nome = extrairNomePrestador(t, cnpj);
    const end = extrairEnderecoPrestador(t);
    const email = t.match(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? '';
    const lower = t.toLowerCase();
    const regime = lower.includes('microempreendedor individual') ? '5'
        : (lower.includes('optante') && lower.includes('simples') ? '4' : '0');
    const { retido, motivo: motivoIss } = detectarIssRetido(t);
    const descricao = first([
        /Descricao do Servico\s+([\s\S]+?)(?:TRIBUTACAO|VALOR TOTAL)/i,
        /DISCRIMINACAO DOS SERVICOS\s*([\s\S]+?)(?:CODIGO DO SERVICO|VALOR TOTAL)/i,
    ], t) || 'Prestacao de servicos';
    const avisos: string[] = [];
    if (retido) avisos.push('ISS RETIDO IDENTIFICADO - ' + motivoIss);
    avisos.push(`Numero obtido de ${origemNumero} (confianca ${confiancaNumero})`);
    if (!end.cidade || !end.uf || !end.cep) avisos.push('Revisar endereco; pode gerar erro 466 na importacao');
    const nota: NftsNota = {
        arquivo: nomeArquivo,
        pagina,
        numero: numero!,
        serie,
        data,
        cnpj,
        nome,
        valorCentavos: valor!,
        codigo: serviceRow!.codigo,
        subitem: serviceRow!.subitem,
        aliquota: serviceRow!.aliquota,
        retido: retido ? '1' : '2',
        regime,
        tipoLogradouro: end.tipo,
        logradouro: end.logradouro,
        numeroEndereco: end.numero,
        complemento: end.complemento,
        bairro: end.bairro,
        cidade: end.cidade,
        uf: end.uf,
        cep: end.cep,
        email,
        descricao: descricao.replace(/\s+/g, ' ').slice(0, 900),
        aviso: avisos.join('. '),
        origemExtracao: 'pdfjs',
    };
    const { erros, avisos: avisosVal } = validarNotaNfts(nota);
    if (erros.length) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina, motivo: 'Validacao fiscal: ' + erros.join(', '), trecho: nota.aviso } };
    }
    if (avisosVal.length) nota.aviso += (nota.aviso ? '. ' : '') + avisosVal.join('. ');
    return { nota, pendencia: null };
}

/**
 * Monta uma NftsNota a partir do JSON estruturado devolvido pelo Gemini
 * para PDFs escaneados. Passa pelas mesmas validacoes do fluxo pdfjs.
 */
export function montarNotaDeGemini(
    nomeArquivo: string,
    dados: any,
    cnpjTomador = '',
): NftsParseResult {
    if (!dados || typeof dados !== 'object') {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina: 1, motivo: 'IA nao retornou dados estruturados do PDF escaneado' } };
    }
    const cnpj = soDigitos(dados.cnpjPrestador ?? '');
    if (!validarCnpj(cnpj) || cnpj === soDigitos(cnpjTomador)) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina: 1, motivo: 'IA: CNPJ do prestador invalido ou igual ao tomador' } };
    }
    const data = parseDataAAAAMMDD(dados.dataEmissao ?? '');
    const valor = parseValorCentavos(dados.valorTotal);
    const serviceRow = selecionarCodigoSp(
        String(dados.descricaoServico ?? ''),
        String(dados.itemLc116 ?? ''),
        String(dados.codigoServicoMunicipal ?? ''),
        'PJ',
    );
    const faltando: string[] = [];
    const numero = soDigitos(dados.numero ?? '');
    if (!numero) faltando.push('numero');
    if (!data) faltando.push('data');
    if (valor == null || valor <= 0) faltando.push('valor');
    if (!serviceRow) faltando.push('codigo de servico');
    if (faltando.length) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina: 1, motivo: 'IA: campos ausentes: ' + faltando.join(', ') } };
    }
    const end = dados.endereco ?? {};
    const nota: NftsNota = {
        arquivo: nomeArquivo,
        pagina: 1,
        numero,
        serie: String(dados.serie ?? '').slice(0, 5),
        data,
        cnpj,
        nome: String(dados.razaoSocial ?? '').trim() || 'PRESTADOR ' + cnpj,
        valorCentavos: valor!,
        codigo: serviceRow!.codigo,
        subitem: serviceRow!.subitem,
        aliquota: serviceRow!.aliquota,
        retido: dados.issRetido === true ? '1' : '2',
        regime: dados.mei === true ? '5' : (dados.simplesNacional === true ? '4' : '0'),
        tipoLogradouro: String(end.tipoLogradouro ?? 'RUA').slice(0, 3),
        logradouro: String(end.logradouro ?? 'NAO INFORMADO').slice(0, 50),
        numeroEndereco: String(end.numero ?? '0').slice(0, 10),
        complemento: String(end.complemento ?? '').slice(0, 30),
        bairro: String(end.bairro ?? 'NAO INFORMADO').slice(0, 30),
        cidade: String(end.cidade ?? '').slice(0, 50),
        uf: String(end.uf ?? '').slice(0, 2).toUpperCase(),
        cep: soDigitos(end.cep ?? ''),
        email: String(dados.email ?? '').slice(0, 75),
        descricao: String(dados.descricaoServico ?? 'Prestacao de servicos').replace(/\s+/g, ' ').slice(0, 900),
        aviso: '',
        origemExtracao: 'gemini',
    };
    const { erros, avisos } = validarNotaNfts(nota);
    if (erros.length) {
        return { nota: null, pendencia: { arquivo: nomeArquivo, pagina: 1, motivo: 'IA + validacao fiscal: ' + erros.join(', ') } };
    }
    nota.aviso = avisos.join('. ');
    return { nota, pendencia: null };
}
