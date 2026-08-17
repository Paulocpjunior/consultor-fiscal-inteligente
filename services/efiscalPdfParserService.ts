/**
 * services/efiscalPdfParserService.ts
 *
 * Parser do relatório "Relação de NFs de Serviços Tomados/Prestados" do E-Fiscal / Office Fiscal.
 * Formato tabular, multipágina. Extração por COORDENADA X (não texto corrido)
 * — imune ao desalinhamento de colunas quando campos opcionais (Série, C.I.)
 * estão vazios.
 *
 * Layout fixo do E-Fiscal (right-edge x1 das colunas de valor):
 *   Valor da NF ~506 | Base de Cálculo ~600 | Alíquota ~637
 *   Valor do ISS ~707 | Iss Retido ~796
 *
 * Validado contra PDF real: 148 NFs, totais batem centavo a centavo.
 */

import * as pdfjsLib from 'pdfjs-dist';
// A RÉGUA DE COORDENADAS mora num módulo PURO — o parser importa `pdfjs-dist`,
// que não carrega no jest, e enquanto a régua morava aqui ela era inexercitável
// por teste. Foi assim que o defeito do PDF girado (17/08) passou.
import {
    mapearTokens, colunaPorX, parseValor, ehLinhaDeTotal, onlyDigits,
    DATA_RE, CNPJ_CPF_RE, VALOR_RE,
    FAIXA_NUMERO, FAIXA_SERIE, FAIXA_CNPJ, FAIXA_RAZAO,
} from './efiscalPdfGeometria';

if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface EfiscalNf {
    emissao: string;
    numero: string;
    serie: string;
    cnpjCpf: string;
    razaoSocial: string;
    valorNf: number;
    baseCalculo: number;
    aliquota: number;
    valorIss: number;
    issRetido: number;
    pagina: number;
}

export interface EfiscalFornecedorAgrupado {
    cnpjCpf: string;
    razaoSocial: string;
    qtdNotas: number;
    somaValorNf: number;
    somaBaseCalculo: number;
    somaValorIss: number;
    somaIssRetido: number;
}

export interface EfiscalPdfParsed {
    empresaCodigo: string;
    empresaNome: string;
    empresaCnpj: string;
    periodo: string;
    notas: EfiscalNf[];
    fornecedores: EfiscalFornecedorAgrupado[];
    totalImpresso: { valorNf: number; baseCalculo: number; valorIss: number; issRetido: number };
    totalCalculado: { valorNf: number; baseCalculo: number; valorIss: number; issRetido: number };
    /** A linha "Total" do relatório foi encontrada? Sem ela não se confere. */
    rodapeEncontrado: boolean;
    validacao: {
        ok: boolean;
        divergencias: string[];
        situacao: 'confere' | 'divergente' | 'nao-conferido';
    };
    rawTextLength: number;
}

export class EfiscalPdfParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EfiscalPdfParseError';
    }
}

interface Token { x0: number; x1: number; str: string; }
interface LinhaPdf { y: number; tokens: Token[]; pagina: number; }

async function extrairLinhas(file: File): Promise<{ linhas: LinhaPdf[]; rawLen: number }> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const linhas: LinhaPdf[] = [];
    let rawLen = 0;

    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        // O viewport é quem conhece o /Rotate da página.
        const viewport = page.getViewport({ scale: 1 });
        const porY = new Map<number, Token[]>();
        for (const tok of mapearTokens(content.items as any[], viewport.transform as any)) {
            rawLen += tok.str.length;
            if (!porY.has(tok.y)) porY.set(tok.y, []);
            porY.get(tok.y)!.push({ x0: tok.x0, x1: tok.x1, str: tok.str });
        }
        for (const [y, tokens] of porY) {
            tokens.sort((a, b) => a.x0 - b.x0);
            linhas.push({ y, tokens, pagina: p });
        }
    }
    // y CRESCENTE = de cima para baixo no espaço do viewport.
    linhas.sort((a, b) => (a.pagina - b.pagina) || (a.y - b.y));
    return { linhas, rawLen };
}

export async function parseEfiscalPdf(file: File): Promise<EfiscalPdfParsed> {
    const { linhas, rawLen } = await extrairLinhas(file);
    if (rawLen < 100) {
        throw new EfiscalPdfParseError(
            'Não foi possível extrair texto do PDF. Pode ser um documento digitalizado (imagem).',
        );
    }

    const textoTodo = linhas.flatMap(l => l.tokens.map(t => t.str)).join(' ');
    if (!/Servi[cç]os\s+(Tomados|Prestados)/i.test(textoTodo) && !/E-?Fiscal/i.test(textoTodo) && !/Office\s+Fiscal/i.test(textoTodo)) {
        throw new EfiscalPdfParseError(
            'Documento não parece ser o relatório "Relação de NFs de Serviços" do E-Fiscal / Office Fiscal.',
        );
    }

    let empresaCodigo = '', empresaNome = '', empresaCnpj = '', periodo = '';
    for (const l of linhas) {
        const txt = l.tokens.map(t => t.str).join(' ');
        const mEmp = txt.match(/Empresa:\s*(\d+)\s*-\s*(.+?)\s+Data:/i);
        if (mEmp && !empresaCodigo) {
            empresaCodigo = mEmp[1] || '';
            empresaNome = (mEmp[2] || '').trim();
        }
        const mCnpj = txt.match(/C\.?N\.?P\.?J\.?\.?:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
        if (mCnpj && !empresaCnpj) empresaCnpj = mCnpj[1] || '';
        const mPer = txt.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*[áa]\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (mPer && !periodo) periodo = `${mPer[1] || ''} a ${mPer[2] || ''}`;
    }

    const notas: EfiscalNf[] = [];
    const totalImpresso = { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 };
    let rodapeEncontrado = false;

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha) continue;
        const toks = linha.tokens;
        if (toks.length === 0) continue;
        const primeiroTok = toks[0];
        if (!primeiroTok) continue;
        const primeiro = primeiroTok.str;

        if (!DATA_RE.test(primeiro)) {
            // 🚨 O RODAPÉ SE IDENTIFICA PELA PALAVRA "Total", não por "ser a
            // última linha com número numa coluna".
            //
            // A régua antiga pegava QUALQUER linha sem data que tivesse valor
            // numa janela, e a última vencia. Foi assim que o caso CLUDE
            // (17/08) exibiu *"PDF=R$ 5017.50"* — número que não existe no
            // documento — e mandou a colaboradora revisar uma conta que estava
            // certa. Total que o app INVENTA é pior que total que ele não acha.
            const ehRodape = ehLinhaDeTotal(toks);
            if (ehRodape) {
                for (const t of toks) {
                    const col = colunaPorX(t.x1);
                    if (!VALOR_RE.test(t.str)) continue;
                    if (col === 'valorNf') totalImpresso.valorNf = parseValor(t.str);
                    if (col === 'baseCalculo') totalImpresso.baseCalculo = parseValor(t.str);
                    if (col === 'valorIss') totalImpresso.valorIss = parseValor(t.str);
                    if (col === 'issRetido') totalImpresso.issRetido = parseValor(t.str);
                }
                rodapeEncontrado = true;
            }
            continue;
        }

        const nf: EfiscalNf = {
            emissao: primeiro, numero: '', serie: '', cnpjCpf: '', razaoSocial: '',
            valorNf: 0, baseCalculo: 0, aliquota: 0, valorIss: 0, issRetido: 0,
            pagina: linha.pagina,
        };
        const razaoTokens: string[] = [];
        for (let j = 1; j < toks.length; j++) {
            const t = toks[j];
            if (!t) continue;
            const s = t.str;
            if (CNPJ_CPF_RE.test(s) && t.x0 >= FAIXA_CNPJ.min && t.x0 <= FAIXA_CNPJ.max) { nf.cnpjCpf = s; continue; }
            if (/^\d{6,}$/.test(s) && t.x0 >= FAIXA_NUMERO.min && t.x0 <= FAIXA_NUMERO.max && !nf.numero) { nf.numero = s; continue; }
            if (t.x0 >= FAIXA_SERIE.min && t.x0 <= FAIXA_SERIE.max && !CNPJ_CPF_RE.test(s)) { nf.serie = (nf.serie + ' ' + s).trim(); continue; }
            const col = colunaPorX(t.x1);
            if (col && VALOR_RE.test(s)) {
                if (col === 'valorNf') nf.valorNf = parseValor(s);
                else if (col === 'baseCalculo') nf.baseCalculo = parseValor(s);
                else if (col === 'aliquota') nf.aliquota = parseValor(s);
                else if (col === 'valorIss') nf.valorIss = parseValor(s);
                else if (col === 'issRetido') nf.issRetido = parseValor(s);
                continue;
            }
            if (t.x0 >= FAIXA_RAZAO.min && t.x0 <= FAIXA_RAZAO.max) { razaoTokens.push(s); continue; }
        }

        const prox = linhas[i + 1];
        if (prox && prox.pagina === linha.pagina) {
            const proxToks = prox.tokens;
            const proxFirst = proxToks[0];
            const proxSemData = !!proxFirst && !DATA_RE.test(proxFirst.str);
            const proxSoRazao = proxToks.every(t => t.x0 >= FAIXA_RAZAO.min && t.x0 <= FAIXA_RAZAO.max);
            if (proxSemData && proxSoRazao && proxToks.length > 0) {
                for (const t of proxToks) razaoTokens.push(t.str);
                i++;
            }
        }

        nf.razaoSocial = razaoTokens.join(' ').replace(/\s+/g, ' ').trim();
        if (nf.cnpjCpf) notas.push(nf);
    }

    const mapaForn = new Map<string, EfiscalFornecedorAgrupado>();
    for (const nf of notas) {
        const chave = onlyDigits(nf.cnpjCpf);
        if (!mapaForn.has(chave)) {
            mapaForn.set(chave, {
                cnpjCpf: nf.cnpjCpf, razaoSocial: nf.razaoSocial, qtdNotas: 0,
                somaValorNf: 0, somaBaseCalculo: 0, somaValorIss: 0, somaIssRetido: 0,
            });
        }
        const f = mapaForn.get(chave)!;
        f.qtdNotas++;
        f.somaValorNf += nf.valorNf;
        f.somaBaseCalculo += nf.baseCalculo;
        f.somaValorIss += nf.valorIss;
        f.somaIssRetido += nf.issRetido;
        if (nf.razaoSocial.length > f.razaoSocial.length) f.razaoSocial = nf.razaoSocial;
    }
    const fornecedores = Array.from(mapaForn.values())
        .sort((a, b) => b.somaBaseCalculo - a.somaBaseCalculo);

    const totalCalculado = notas.reduce(
        (acc, nf) => ({
            valorNf: acc.valorNf + nf.valorNf,
            baseCalculo: acc.baseCalculo + nf.baseCalculo,
            valorIss: acc.valorIss + nf.valorIss,
            issRetido: acc.issRetido + nf.issRetido,
        }),
        { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 },
    );

    const divergencias: string[] = [];
    const checa = (nome: string, imp: number, calc: number) => {
        if (Math.abs(imp - calc) > 0.05) {
            divergencias.push(`${nome}: PDF=R$ ${imp.toFixed(2)} vs extraído=R$ ${calc.toFixed(2)}`);
        }
    };
    // SEM RODAPÉ NÃO SE AFIRMA DIVERGÊNCIA. Comparar contra zero acusaria o
    // relatório inteiro como divergente justamente quando a extração pode estar
    // perfeita — e é o alarme falso que aparece quando está tudo certo que
    // ensina a equipe a ignorar a conferência.
    if (rodapeEncontrado) {
        checa('Valor da NF', totalImpresso.valorNf, totalCalculado.valorNf);
        checa('Base de Cálculo', totalImpresso.baseCalculo, totalCalculado.baseCalculo);
        checa('Valor do ISS', totalImpresso.valorIss, totalCalculado.valorIss);
        checa('Iss Retido', totalImpresso.issRetido, totalCalculado.issRetido);
    }

    return {
        empresaCodigo, empresaNome, empresaCnpj, periodo,
        notas, fornecedores, totalImpresso, totalCalculado,
        rodapeEncontrado,
        validacao: {
            // `ok` continua significando CONFERIDO E BATEU — nunca "não achei
            // problema porque não procurei" (verde por omissão).
            ok: rodapeEncontrado && divergencias.length === 0,
            divergencias,
            situacao: !rodapeEncontrado
                ? 'nao-conferido'
                : (divergencias.length === 0 ? 'confere' : 'divergente'),
        },
        rawTextLength: rawLen,
    };
}
