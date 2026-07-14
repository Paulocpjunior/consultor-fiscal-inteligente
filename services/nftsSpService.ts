/**
 * services/nftsSpService.ts
 *
 * Motor da NFTS (Nota Fiscal do Tomador/Intermediario de Servicos) da
 * Prefeitura de Sao Paulo: validacoes, deteccao de ISS retido e geracao
 * do arquivo TXT de importacao em lote (layout V.001).
 *
 * Layout V.001 (registro tipo 1 = header, tipo 4 = detalhe 440 posicoes
 * fixas + descricao variavel, tipo 9 = totalizador). Codificacao
 * ISO-8859-1 com CRLF, conforme aceito pelo sistema NFTS da PMSP.
 *
 * Portado do "Gerador de Lotes NFTS" (Carlos Eduardo Gomes Zerilli),
 * SEM os perfis hardcoded por CNPJ do original (valores/enderecos
 * chumbados foram descartados por risco fiscal).
 */

import { validarCnpj } from './validadorDocumento';
import { CATALOGO_POR_CODIGO, CATALOGO_POR_ITEM, CODIGOS_ENCERRADOS_2025, CODIGOS_REJEITADOS_PMSP, type CatalogoNftsRow } from './nftsCatalogoSp';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface NftsNota {
    /** Nome do arquivo PDF de origem. */
    arquivo: string;
    pagina: number;
    numero: string;
    serie: string;
    /** Data de emissao AAAAMMDD. */
    data: string;
    /** CNPJ do prestador (14 digitos). */
    cnpj: string;
    /** Razao social do prestador. */
    nome: string;
    /** Valor total do servico em CENTAVOS (inteiro). */
    valorCentavos: number;
    /** Codigo de servico municipal SP (5 digitos). */
    codigo: string;
    /** Subitem LC116 em 4 digitos (ex. 0702). */
    subitem: string;
    /** Aliquota em 4 digitos (percentual x100, ex. 0500 = 5%). */
    aliquota: string;
    /** '1' = ISS retido pelo tomador, '2' = nao retido. */
    retido: '1' | '2';
    /** Regime: '0' normal, '4' Simples Nacional, '5' MEI. */
    regime: string;
    tipoLogradouro: string;
    logradouro: string;
    numeroEndereco: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
    email: string;
    descricao: string;
    /** Avisos de conferencia (nao impedem o lote). */
    aviso: string;
    /** Origem da extracao: 'pdfjs' (texto nativo) ou 'gemini' (documento escaneado). */
    origemExtracao: 'pdfjs' | 'gemini';
}

export interface NftsPendencia {
    arquivo: string;
    pagina: number;
    motivo: string;
    trecho?: string;
}

// ─── Formatadores do layout posicional ──────────────────────────────────────

/**
 * Normaliza texto para o charset aceito pelo layout (sem acentos, sem
 * quebras de linha). Quebras viram '|' para preservar a separacao logica.
 */
export function cleanNfts(s: string | null | undefined): string {
    const str = String(s ?? '').replace(/\r\n/g, '|').replace(/[\n\r]/g, '|');
    const from = 'çÇáàãâäéèêëíìîïóòôõöúùûüÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜñÑ';
    const to = 'cCaaaaaeeeeiiiiooooouuuuAAAAAEEEEIIIIOOOOOUUUUnN';
    let out = '';
    for (const ch of str) {
        const idx = from.indexOf(ch);
        if (idx >= 0) { out += to[idx]; continue; }
        const code = ch.charCodeAt(0);
        // Mantem apenas ASCII imprimivel + latin1 imprimivel
        if (code >= 32 && code <= 126) out += ch;
        else if (ch === '–' || ch === '—') out += '-';
        // demais caracteres fora do latin1 sao descartados
    }
    return out;
}

export const soDigitos = (s: string | null | undefined): string => String(s ?? '').replace(/\D/g, '');

/** Campo numerico: N posicoes, zeros a esquerda, trunca a esquerda. */
export function campoNum(v: string | number | null | undefined, n: number): string {
    return soDigitos(String(v ?? '')).slice(-n).padStart(n, '0');
}

/** Campo texto: N posicoes, maiusculo, espacos a direita. */
export function campoTexto(v: string | null | undefined, n: number): string {
    return cleanNfts(v).toUpperCase().slice(0, n).padEnd(n, ' ');
}

/** Converte "1.234,56" / "1234.56" / número em centavos (inteiro) ou null. */
export function parseValorCentavos(v: string | number | null | undefined): number | null {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
    const s = String(v).replace(/[^0-9,.-]/g, '');
    if (!s) return null;
    let normalized: string;
    if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
    else normalized = s;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Converte DD/MM/AAAA em AAAAMMDD validando o calendario. Retorna '' se invalida. */
export function parseDataAAAAMMDD(s: string | null | undefined): string {
    const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) {
        // aceita AAAAMMDD ja formatado
        const j = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
        if (!j) return '';
        const dt = new Date(Number(j[1]), Number(j[2]) - 1, Number(j[3]));
        return dt.getMonth() === Number(j[2]) - 1 ? `${j[1]}${j[2]}${j[3]}` : '';
    }
    const [, d, mo, y] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return '';
    return `${y}${mo}${d}`;
}

// ─── ISS retido ─────────────────────────────────────────────────────────────

/**
 * Detecta SOMENTE retencao de ISS/ISSQN no texto da nota. Ignora IR, INSS,
 * PIS, COFINS e CSLL. Padroes negativos tem precedencia sobre positivos.
 */
export function detectarIssRetido(texto: string): { retido: boolean; motivo: string } {
    const t = cleanNfts(texto);
    const negativos = [
        /ISSQN?\s+RETID[OA]\s*[:\-]?\s*(?:NAO|NAO RETIDO|0[,.]00)/i,
        /RETENCAO\s+DO\s+ISSQN?\s*[:\-]?\s*(?:NAO|NAO RETIDO)/i,
        /RESPONSAVEL\s+PELO\s+RECOLHIMENTO\s+DO\s+ISSQN?[\s\S]{0,80}\bPRESTADOR\b/i,
    ];
    for (const p of negativos) {
        if (p.test(t)) return { retido: false, motivo: 'ISS/ISSQN explicitamente nao retido' };
    }
    const positivosComValor = [
        /ISSQN?\s+RETIDO\s*\(R\$\)\s*[:\-]?\s*([0-9.]+,\d{2})/i,
        /VALOR\s+DO\s+ISSQN?\s+RETIDO\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,\d{2})/i,
        /ISS\s+RETIDO\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,\d{2})/i,
    ];
    for (const p of positivosComValor) {
        const m = t.match(p);
        if (m) {
            const valor = parseValorCentavos(m[1]);
            if (valor != null && valor > 0) {
                return { retido: true, motivo: `ISS/ISSQN retido no valor de R$ ${(valor / 100).toFixed(2)}` };
            }
        }
    }
    const positivosTexto = [
        /ISSQN?\s+RETID[OA]\s*[:\-]?\s*(?:SIM|YES)/i,
        /RETENCAO\s+DO\s+ISSQN?\s*[:\-]?\s*(?:SIM|RETIDO)/i,
        /RESPONSAVEL\s+PELO\s+RECOLHIMENTO\s+DO\s+ISSQN?[\s\S]{0,80}\bTOMADOR\b/i,
    ];
    for (const p of positivosTexto) {
        if (p.test(t)) return { retido: true, motivo: 'ISS/ISSQN explicitamente retido pelo tomador' };
    }
    return { retido: false, motivo: 'Sem indicacao explicita de ISS/ISSQN retido' };
}

// ─── Catalogo: selecao do codigo de servico SP ──────────────────────────────

const KEYWORDS_ITEM: Array<[RegExp, string]> = [
    [/agenciamento|corretagem|intermediacao/i, '10.02'],
    [/consultoria|assessoria/i, '17.01'],
    [/licenciament|cessao.*program/i, '1.05'],
    [/software|elaboracao.*program/i, '1.04'],
    [/suporte.*informat|instalacao.*program/i, '1.07'],
    [/processamento|hospedagem.*dado|armazenamento.*dado/i, '1.03'],
    [/propaganda|publicidade|promocao/i, '17.06'],
    [/extintor|recarga.*equipamento/i, '14.01'],
    [/refrigeracao|manutencao|conserto|ventilador/i, '14.01'],
    [/assistencia tecnica|reparo/i, '14.02'],
    [/cadastro|informacoes cadastrais|consulta.*credito|protecao ao credito/i, '17.01'],
    [/beneficio|vale alimentacao|vale refeicao|cartao.*beneficio|administracao.*cartao/i, '17.12'],
    [/limpeza|conservacao|servicos gerais/i, '7.10'],
    [/nutricao/i, '4.10'],
    [/psicolog/i, '4.16'],
    [/medic|medicina/i, '4.01'],
];

/** Normaliza "7,02" / "07.02" -> "7.02". */
export function normalizarItemLc116(valor: string | null | undefined): string {
    const m = String(valor ?? '').match(/(\d{1,2})[.,](\d{2})/);
    return m ? `${parseInt(m[1], 10)}.${m[2]}` : '';
}

function palavras(s: string): Set<string> {
    const ascii = cleanNfts(s).toLowerCase();
    return new Set(ascii.match(/[a-z]{4,}/g) ?? []);
}

/**
 * Seleciona a linha do catalogo SP: (1) codigo municipal exato tem
 * precedencia, (2) item LC116, (3) fallback semantico por keywords.
 * Desempate por score de natureza + item + intersecao de descricao.
 */
export function selecionarCodigoSp(
    texto: string,
    itemEncontrado = '',
    codigoEncontrado = '',
    natureza: 'PJ' | 'PF' = 'PJ',
): CatalogoNftsRow | null {
    // Nunca seleciona automaticamente codigos encerrados pela IN SF/SUREM
    // 3/2026 (invalidos para emissao a partir de 01/01/2026).
    const vigentes = (rows: CatalogoNftsRow[]) => rows.filter(r =>
        !CODIGOS_ENCERRADOS_2025.has(r.codigo) && !CODIGOS_REJEITADOS_PMSP.has(r.codigo));
    const cod = codigoEncontrado ? soDigitos(codigoEncontrado).padStart(5, '0').slice(-5) : '';
    let candidatos: CatalogoNftsRow[] = cod ? vigentes(CATALOGO_POR_CODIGO.get(cod) ?? []) : [];
    let item = normalizarItemLc116(itemEncontrado);
    if (!candidatos.length && item) candidatos = vigentes(CATALOGO_POR_ITEM.get(item) ?? []);
    if (!candidatos.length) {
        const limpo = cleanNfts(texto).toLowerCase();
        for (const [padrao, itemKw] of KEYWORDS_ITEM) {
            if (padrao.test(limpo)) {
                item = itemKw;
                candidatos = vigentes(CATALOGO_POR_ITEM.get(itemKw) ?? []);
                break;
            }
        }
    }
    if (!candidatos.length) return null;
    const pal = palavras(texto);
    const score = (r: CatalogoNftsRow): number => {
        let s = 0;
        if (r.natureza === natureza) s += 30;
        if (item && r.item === item) s += 20;
        const d = palavras(r.descricao);
        let inter = 0;
        for (const w of pal) if (d.has(w)) inter++;
        s += Math.min(40, inter * 4);
        if (r.codigo.startsWith('0')) s += 1;
        return s;
    };
    return candidatos.reduce((best, r) => (score(r) > score(best) ? r : best), candidatos[0]);
}

// ─── Validacao fiscal ───────────────────────────────────────────────────────

export function validarNotaNfts(n: NftsNota): { erros: string[]; avisos: string[] } {
    const erros: string[] = [];
    const avisos: string[] = [];
    if (!validarCnpj(n.cnpj)) erros.push('CNPJ do prestador invalido');
    if (!n.numero || !soDigitos(n.numero)) erros.push('numero da nota ausente');
    if (!/^\d{8}$/.test(n.data)) erros.push('data de emissao ausente ou invalida');
    if (!n.valorCentavos || n.valorCentavos <= 0) erros.push('valor do servico zerado ou invalido');
    if (!n.codigo || !/^\d{5}$/.test(n.codigo)) {
        erros.push('codigo de servico ausente ou invalido');
    } else if (CODIGOS_ENCERRADOS_2025.has(n.codigo)) {
        erros.push(`codigo de servico ${n.codigo} ENCERRADO em 31/12/2025 (IN SF/SUREM 3/2026) - substituir pelo codigo vigente`);
    } else if (CODIGOS_REJEITADOS_PMSP.has(n.codigo)) {
        erros.push(`codigo ${n.codigo} REJEITADO pela PMSP na importacao (erro 310, teste 07/2026) - confirmar codigo vigente na tela de emissao da NFTS`);
    } else if (!CATALOGO_POR_CODIGO.has(n.codigo)) {
        avisos.push(`codigo ${n.codigo} fora do catalogo local (pode ser codigo novo de 2026) - confirmar na tabela vigente da PMSP`);
    }
    if (/^PRESTADOR\s+\d{14}$/i.test(n.nome)) avisos.push('razao social nao localizada; usado PRESTADOR + CNPJ');
    if (n.cep && n.cep !== '00000000' && soDigitos(n.cep).length !== 8) avisos.push('CEP invalido');
    if (!n.cidade || !n.uf || !n.cep || n.cep === '00000000') avisos.push('endereco incompleto; revisar antes de importar (erro 466)');
    if (n.origemExtracao === 'gemini') avisos.push('extraido por IA de documento escaneado; conferir todos os campos');
    return { erros, avisos };
}

// ─── Enriquecimento cadastral via CNPJ (BrasilAPI/Receita) ─────────────────

/**
 * Detecta razao social contaminada por rotulo do PDF (ex.: "Prestador do
 * servico") ou fallback "PRESTADOR <cnpj>".
 */
export function nomePrestadorSuspeito(nome: string): boolean {
    const n = cleanNfts(nome).trim();
    if (!n || n.length < 3) return true;
    if (/^PRESTADOR\s+\d{14}$/i.test(n)) return true;
    if (/^(?:DADOS\s+DO\s+)?(?:PRESTADOR|TOMADOR|EMITENTE)(?:\s+D[EOA]S?)?(?:\s+SERVI[CG]OS?)?$/i.test(n)) return true;
    if (/^(?:NOME|RAZAO\s+SOCIAL|NOME\s+EMPRESARIAL)$/i.test(n)) return true;
    return false;
}

export function enderecoIncompletoNfts(n: NftsNota): boolean {
    return !n.cidade || !n.uf || !n.cep || n.cep === '00000000' || soDigitos(n.cep).length !== 8;
}

export interface DadosCadastraisCnpj {
    razaoSocial: string;
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
}

const TIPOS_LOGRADOURO_ENRIQ: Record<string, string> = {
    'RUA': 'RUA', 'R': 'RUA', 'AVENIDA': 'AV', 'AV': 'AV', 'ALAMEDA': 'AL',
    'TRAVESSA': 'TV', 'VIELA': 'VLA', 'ESTRADA': 'EST', 'RODOVIA': 'ROD',
    'PRACA': 'PCA', 'LARGO': 'LGO',
};

/**
 * Sobrescreve nome/endereco da nota com os dados cadastrais oficiais da
 * Receita (via BrasilAPI). Retorna nova nota com aviso de origem.
 */
export function aplicarDadosCnpjNaNota(n: NftsNota, d: DadosCadastraisCnpj): NftsNota {
    const nova = { ...n };
    const corrigiuNome = nomePrestadorSuspeito(n.nome) && !!d.razaoSocial;
    if (corrigiuNome) nova.nome = d.razaoSocial.slice(0, 75);
    if (d.municipio && d.uf && d.cep) {
        let logradouro = cleanNfts(d.logradouro).trim();
        const m = logradouro.match(/^([A-Za-z]+)\s+(.+)$/);
        if (m && TIPOS_LOGRADOURO_ENRIQ[m[1].toUpperCase()]) {
            nova.tipoLogradouro = TIPOS_LOGRADOURO_ENRIQ[m[1].toUpperCase()];
            logradouro = m[2];
        }
        nova.logradouro = (logradouro || 'NAO INFORMADO').slice(0, 50);
        nova.numeroEndereco = (soDigitos(d.numero) || '0').slice(0, 10);
        nova.bairro = (cleanNfts(d.bairro).trim() || 'NAO INFORMADO').slice(0, 30);
        nova.cidade = cleanNfts(d.municipio).trim().slice(0, 50);
        nova.uf = d.uf.toUpperCase().slice(0, 2);
        nova.cep = soDigitos(d.cep).slice(0, 8);
    }
    // Remove avisos que ficaram obsoletos apos o enriquecimento
    // (endereco incompleto / erro 466 / razao social nao localizada).
    const obsoleto = /466|endereco incompleto|revisar endereco|razao social nao localizada/i;
    nova.aviso = nova.aviso
        .split(/\.\s+/)
        .map(s => s.trim())
        .filter(s => s && !(obsoleto.test(s) && (corrigiuNome || !enderecoIncompletoNfts(nova))))
        .join('. ');
    nova.aviso = (nova.aviso ? nova.aviso + '. ' : '')
        + (corrigiuNome ? 'Razao social e endereco' : 'Endereco')
        + ' obtidos do cadastro da Receita Federal (BrasilAPI)';
    return nova;
}

// ─── Geracao do TXT V.001 ───────────────────────────────────────────────────

export const NFTS_DETALHE_TAMANHO_FIXO = 440;

/** Registro tipo 4 (detalhe): 440 posicoes fixas + descricao variavel. */
export function montarRegistroDetalhe(n: NftsNota): string {
    const fixed =
        '4' +                                   // tipo de registro
        '02' +                                  // tipo de documento: 02 = nota fiscal de servico
        campoTexto(n.serie, 5) +                // serie
        campoNum(n.numero, 12) +                // numero da nota
        n.data +                                // data emissao AAAAMMDD (8)
        'N' +                                   // situacao: N = normal
        'T' +                                   // tributacao: T = tributado em SP
        campoNum(n.valorCentavos, 15) +         // valor dos servicos (centavos)
        campoNum(0, 15) +                       // valor das deducoes
        campoNum(n.codigo, 5) +                 // codigo de servico municipal
        campoNum(n.subitem, 4) +                // subitem LC116
        campoNum(n.aliquota, 4) +               // aliquota (x100)
        n.retido +                              // ISS retido: 1 = sim, 2 = nao
        '2' +                                   // indicador CPF/CNPJ prestador: 2 = CNPJ
        campoNum(n.cnpj, 14) +                  // CNPJ prestador
        '00000000' +                            // inscricao municipal prestador (nao exigida)
        campoTexto(n.nome, 75) +                // razao social prestador
        campoTexto(n.tipoLogradouro, 3) +       // tipo logradouro
        campoTexto(n.logradouro, 50) +          // logradouro
        campoTexto(n.numeroEndereco, 10) +      // numero
        campoTexto(n.complemento, 30) +         // complemento
        campoTexto(n.bairro, 30) +              // bairro
        campoTexto(n.cidade, 50) +              // cidade
        campoTexto(n.uf, 2) +                   // UF
        campoNum(n.cep, 8) +                    // CEP
        campoTexto(n.email, 75) +               // email prestador
        '1' +                                   // tipo NFTS: 1 = servico tomado
        (n.regime || '0') +                     // regime de tributacao do prestador
        ' '.repeat(8);                          // reservado
    if (fixed.length !== NFTS_DETALHE_TAMANHO_FIXO) {
        throw new Error(`Registro fixo NFTS fora do tamanho ${NFTS_DETALHE_TAMANHO_FIXO} (obtido ${fixed.length})`);
    }
    return fixed + cleanNfts(n.descricao);
}

export interface LoteNftsResultado {
    conteudo: string;
    bytes: Uint8Array;
    quantidade: number;
    valorTotalCentavos: number;
}

/**
 * Gera o lote NFTS V.001 completo (header + detalhes + totalizador),
 * ISO-8859-1 com CRLF. `ccm` = inscricao municipal (CCM) do tomador,
 * 8 digitos.
 */
export function gerarLoteNfts(notas: NftsNota[], ccm: string): LoteNftsResultado {
    const ccmDigits = soDigitos(ccm);
    if (ccmDigits.length !== 8) throw new Error('CCM do tomador deve ter exatamente 8 digitos');
    if (!notas.length) throw new Error('Nenhuma nota aprovada para gerar o lote');
    const datas = notas.map(n => n.data).sort();
    const header = '1' + '001' + ccmDigits + datas[0] + datas[datas.length - 1];
    const detalhes = notas.map(montarRegistroDetalhe);
    const total = notas.reduce((acc, n) => acc + n.valorCentavos, 0);
    const footer = '9' + campoNum(detalhes.length, 7) + campoNum(total, 15) + campoNum(0, 15);
    const conteudo = [header, ...detalhes, footer].join('\r\n') + '\r\n';
    // ISO-8859-1: apos cleanNfts todos os chars sao <= 0xFF; charCode direto.
    const bytes = new Uint8Array(conteudo.length);
    for (let i = 0; i < conteudo.length; i++) bytes[i] = conteudo.charCodeAt(i) & 0xff;
    return { conteudo, bytes, quantidade: detalhes.length, valorTotalCentavos: total };
}

// ─── CSVs de conferencia ────────────────────────────────────────────────────

export function gerarCsvResumo(notas: NftsNota[]): string {
    const header = 'arquivo;pagina;numero;serie;data;cnpj;nome;valor;codigo;subitem;aliquota;retido;regime;cidade;uf;cep;origem;aviso';
    const rows = notas.map(n => [
        n.arquivo, n.pagina, n.numero, n.serie, n.data, n.cnpj, n.nome,
        (n.valorCentavos / 100).toFixed(2).replace('.', ','),
        n.codigo, n.subitem, n.aliquota, n.retido === '1' ? 'SIM' : 'NAO',
        n.regime, n.cidade, n.uf, n.cep, n.origemExtracao, n.aviso,
    ].map(v => String(v ?? '').replace(/;/g, ',')).join(';'));
    return '﻿' + [header, ...rows].join('\r\n');
}

export function gerarCsvPendencias(pendencias: NftsPendencia[]): string {
    const header = 'arquivo;pagina;motivo;trecho';
    const rows = pendencias.map(p => [p.arquivo, p.pagina, p.motivo, (p.trecho ?? '').slice(0, 500)]
        .map(v => String(v ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ')).join(';'));
    return '﻿' + [header, ...rows].join('\r\n');
}

/**
 * Politica de seguranca do lote: notas com ISS retido pelo tomador SAEM
 * do lote automaticamente e viram pendencia para tratamento manual.
 */
export function separarNotasIssRetido(notas: NftsNota[]): { mantidas: NftsNota[]; retidas: NftsNota[] } {
    return {
        mantidas: notas.filter(n => n.retido !== '1'),
        retidas: notas.filter(n => n.retido === '1'),
    };
}
