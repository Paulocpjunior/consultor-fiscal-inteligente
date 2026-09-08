import type { DocumentoFiscal } from '../types';
import type { EfiscalPdfParsed, EfiscalNf, EfiscalFornecedorAgrupado } from './efiscalPdfParserService';
import { linhasServicos } from './relatoriosAgregacoes';

export interface LinhaCfiPdf { pagina: number; tokens: { str: string }[] }
export interface RecorteCfiPdf {
    empresaCnpj: string; empresaNome: string; competencia: string; direcao: 'entrada' | 'saida';
    quantidade: number;
    notas: { data: string; numero: string; nome: string; base: number; iss: number; retido: number; liquido: number; pagina: number }[];
    totais: { base: number; iss: number; retido: number };
    paginas: number;
}
const normalizarEspacos = (s: string) => s.replace(/\s+/g, ' ').trim();
const cent = (v: number) => Math.round(v * 100);
const numeroBR = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const moeda = '(?:[0-9.]+,[0-9]{2}|[0-9]+\\.[0-9]{2}†|\\?)';
const linhaRe = new RegExp('^(\\d{2}/\\d{2}/\\d{4})\\s+(\\S+)\\s+(.+?)\\s+(' + moeda + '(?:\\s+' + moeda + '){8})$');
const totalRe = new RegExp('^TOTAIS\\s*\\((\\d+)\\)\\s+(' + moeda + '(?:\\s+' + moeda + '){8})$', 'i');

export function reconhecerCfiServicosPdf(linhas: LinhaCfiPdf[]): RecorteCfiPdf | null {
    const textos = linhas.map(l => l.tokens.map(t => t.str).join(' ').trim());
    if (!textos.some(t => /Consultor Fiscal Inteligente/.test(t))) return null;
    const titulo = textos.map(t => t.match(/^Serviços (tomados|prestados)\s*[—–-]\s*(\d{2})\/(\d{4})/i)).find(Boolean);
    if (!titulo) return null;
    const identidade = textos.map(t => t.match(/^(.+?)\s*·\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*·\s*(\d+)\s*NFS-e/)).find(Boolean);
    if (!identidade) throw new Error('Relatório CFI sem identificação completa da empresa.');
    const notas: RecorteCfiPdf['notas'] = [];
    let totais: RecorteCfiPdf['totais'] | null = null;
    let quantidadeTotal = -1;
    textos.forEach((texto, i) => {
        const m = texto.match(linhaRe);
        if (m) {
            const valores = m[4]!.split(/\s+/);
            const [base, iss, retido] = valores.slice(0, 3).map(numeroBR);
            const liquido = numeroBR(valores[8]!);
            if (![base, iss, retido, liquido].every(v => Number.isFinite(v))) throw new Error('Valor ilegível no relatório CFI: NF ' + m[2]);
            notas.push({ data: m[1]!, numero: m[2]!, nome: m[3]!, base: base!, iss: iss!, retido: retido!, liquido, pagina: linhas[i]!.pagina });
        } else if (/^\d{2}\/\d{2}\/\d{4}\s/.test(texto)) {
            throw new Error('Linha de nota não reconhecida no relatório CFI: ' + texto.slice(0, 80));
        }
        const t = texto.match(totalRe);
        if (t) {
            if (totais) throw new Error('Mais de um total encontrado no relatório CFI.');
            const valores = t[2]!.split(/\s+/).slice(0, 3).map(numeroBR);
            totais = { base: valores[0]!, iss: valores[1]!, retido: valores[2]! };
            quantidadeTotal = Number(t[1]);
        }
    });
    const quantidade = Number(identidade[3]);
    if (!totais || quantidade !== notas.length || quantidadeTotal !== quantidade) throw new Error('Relatório CFI incompleto: confira a quantidade de notas e a página dos totais.');
    for (const campo of ['base', 'iss', 'retido'] as const) {
        if (notas.reduce((s, n) => s + cent(n[campo]), 0) !== cent(totais[campo])) throw new Error('Total de ' + campo + ' divergente no relatório CFI.');
    }
    return { empresaNome: identidade[1]!.trim(), empresaCnpj: identidade[2]!, competencia: `${titulo[3]}-${titulo[2]}`,
        direcao: titulo[1]!.toLowerCase() === 'tomados' ? 'entrada' : 'saida', quantidade, notas, totais,
        paginas: new Set(linhas.map(l => l.pagina)).size };
}

// O PDF resume nomes e omite CNPJ e valor bruto. Recuperacao somente por
// correspondencia unica com os documentos que alimentam o mesmo relatorio.
export function completarCfiServicosPdf(recorte: RecorteCfiPdf, documentos: DocumentoFiscal[], rawTextLength: number): EfiscalPdfParsed {
    const candidatos = documentos.flatMap(d => linhasServicos([d], recorte.direcao).map(linha => ({ d, linha })));
    const usados = new Set<number>();
    const notas: EfiscalNf[] = recorte.notas.map(n => {
        const nome = normalizarEspacos(n.nome.split('…')[0]!);
        const matches = candidatos.map((c, i) => ({ ...c, i })).filter(c => !usados.has(c.i)
            && c.linha.numero === n.numero && c.linha.data === n.data && normalizarEspacos(c.linha.participante).startsWith(nome)
            && cent(c.linha.base) === cent(n.base) && cent(c.linha.iss) === cent(n.iss) && cent(c.linha.issRetido) === cent(n.retido) && cent(c.linha.liquido) === cent(n.liquido));
        if (matches.length !== 1) throw new Error(`NF ${n.numero}: ${matches.length ? 'correspondência ambígua' : 'não localizada com os mesmos dados'} no CFI. Confira a empresa, competência e eventual alteração após gerar o PDF.`);
        const { d, linha, i } = matches[0]!;
        const fonte = d as unknown as { valorServicos?: number; valores?: { valorServicos?: number }; valorTotal?: number };
        const valor = [fonte.valorServicos, fonte.valores?.valorServicos, fonte.valorTotal].find(v => v != null);
        if (!/^(\d{11}|\d{14})$/.test(linha.doc) || typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
            throw new Error(`NF ${n.numero}: CNPJ/CPF ou valor bruto ausente no documento do CFI. Complete a origem antes de analisar créditos.`);
        }
        usados.add(i);
        return { emissao: n.data, numero: n.numero, serie: '', cnpjCpf: linha.doc, razaoSocial: linha.participante,
            valorNf: valor, baseCalculo: n.base, aliquota: 0, valorIss: n.iss, issRetido: n.retido, pagina: n.pagina };
    });
    const mapa = new Map<string, EfiscalFornecedorAgrupado>();
    for (const n of notas) {
        const f = mapa.get(n.cnpjCpf) || { cnpjCpf: n.cnpjCpf, razaoSocial: n.razaoSocial, qtdNotas: 0, somaValorNf: 0, somaBaseCalculo: 0, somaValorIss: 0, somaIssRetido: 0 };
        f.qtdNotas++; f.somaValorNf += n.valorNf; f.somaBaseCalculo += n.baseCalculo; f.somaValorIss += n.valorIss; f.somaIssRetido += n.issRetido;
        mapa.set(n.cnpjCpf, f);
    }
    const bruto = notas.reduce((s, n) => s + cent(n.valorNf), 0) / 100;
    const total = { valorNf: bruto, baseCalculo: recorte.totais.base, valorIss: recorte.totais.iss, issRetido: recorte.totais.retido };
    const [ano, mes] = recorte.competencia.split('-');
    const ultimo = new Date(Number(ano), Number(mes), 0).getDate();
    return { empresaCodigo: '', empresaNome: recorte.empresaNome, empresaCnpj: recorte.empresaCnpj,
        periodo: `01/${mes}/${ano} a ${ultimo}/${mes}/${ano}`, notas, fornecedores: Array.from(mapa.values()).sort((a,b) => b.somaBaseCalculo-a.somaBaseCalculo),
        totalImpresso: total, totalCalculado: total, rodapeEncontrado: true, rawTextLength,
        origem: 'CFI_PDF_CONFERIDO_DOCUMENTOS',
        diagnostico: { paginas: recorte.paginas, linhasComData: recorte.notas.length, notasLidas: notas.length, rodapeEncontrado: true },
        validacao: { ok: true, divergencias: [], situacao: 'confere' } };
}
