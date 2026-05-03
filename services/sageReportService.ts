import * as XLSX from 'xlsx';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type DocStatus = 'regular' | 'cancelada' | 'denegada' | 'inutilizada' | 'desconhecido';
export type DocSentido = 'entrada' | 'saida' | 'desconhecido';

export interface SageNota {
    sentido: DocSentido;
    status: DocStatus;
    statusCodigo: string;
    statusOriginal: string;
    numero: number | null;
    numeroRaw: string;
    serie: string;
    especie: string;
    cnpj: string;
    razaoSocial: string;
    cidade: string;
    uf: string;
    chave: string;
    cfop: string;
    valor: number;
    dataEmissao: string;
    dataEntradaSaida: string;
    sourceTab: string;
    sourceRow: number;
}

export interface GapNumeracao {
    sentido: DocSentido;
    cnpj: string;
    razaoSocial: string;
    serie: string;
    de: number;
    ate: number;
    quantidade: number;
}

export interface SageAnalise {
    totalNotas: number;
    porSentido: {
        entrada: SageNota[];
        saida: SageNota[];
        desconhecido: SageNota[];
    };
    porStatus: {
        regular: SageNota[];
        cancelada: SageNota[];
        denegada: SageNota[];
        inutilizada: SageNota[];
        desconhecido: SageNota[];
    };
    gaps: GapNumeracao[];
    resumo: {
        regulares: number;
        canceladas: number;
        denegadas: number;
        inutilizadas: number;
        gapsTotal: number;
        notasFaltantes: number;
    };
    tabsLidas: string[];
    avisos: string[];
}

// ─── Mapeamento de status SPED ───────────────────────────────────────────────

function classificarStatus(codigo: string, raw: string): { status: DocStatus; statusCodigo: string } {
    const cod = (codigo || '').trim().padStart(2, '0').slice(0, 2);
    const upper = (raw || '').toUpperCase();

    if (upper.includes('CANCELADA') || upper.includes('CANCELAD')) return { status: 'cancelada', statusCodigo: cod || '02' };
    if (upper.includes('DENEGADA') || upper.includes('DENEGAD') || upper.includes('RECUSADA')) return { status: 'denegada', statusCodigo: cod || '04' };
    if (upper.includes('INUTILIZAD')) return { status: 'inutilizada', statusCodigo: cod || '05' };

    switch (cod) {
        case '00':
        case '01':
        case '06':
        case '07':
        case '08':
            return { status: 'regular', statusCodigo: cod };
        case '02':
        case '03':
            return { status: 'cancelada', statusCodigo: cod };
        case '04':
            return { status: 'denegada', statusCodigo: cod };
        case '05':
            return { status: 'inutilizada', statusCodigo: cod };
        default:
            return { status: 'desconhecido', statusCodigo: cod };
    }
}

// ─── Detecção de coluna por header ───────────────────────────────────────────

function normalize(s: string): string {
    return (s || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 /-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

interface ColunaMap {
    es?: number;
    situacao?: number;
    emissao?: number;
    entradaSaida?: number;
    numero?: number;
    especie?: number;
    serie?: number;
    cnpj?: number;
    razaoSocial?: number;
    cidade?: number;
    uf?: number;
    chave?: number;
    cfop?: number;
    valor?: number;
}

function mapearColunas(header: string[]): ColunaMap {
    const m: ColunaMap = {};
    header.forEach((h, i) => {
        const n = normalize(h);
        if (!n) return;
        if (m.es === undefined && (n === 'e/s' || n === 'es' || n === 'e s')) m.es = i;
        if (m.situacao === undefined && (n.includes('situacao') || n.includes('cod sit') || n.startsWith('sit'))) m.situacao = i;
        if (m.emissao === undefined && n.includes('emissao')) m.emissao = i;
        if (m.entradaSaida === undefined && (n === 'entrada/saida' || n === 'entrada saida' || n === 'dt entrada' || n === 'dt e/s')) m.entradaSaida = i;
        if (m.numero === undefined && (n.includes('numero da nf') || n === 'no da nf' || n === 'n da nf' || n === 'numero nf' || n === 'nro nf' || n === 'nf' || n.includes('n da nf'))) m.numero = i;
        if (m.especie === undefined && (n === 'especie' || n.includes('especie'))) m.especie = i;
        if (m.serie === undefined && n === 'serie') m.serie = i;
        if (m.cnpj === undefined && (n.includes('cnpj') || n.includes('cpf'))) m.cnpj = i;
        if (m.razaoSocial === undefined && (n.includes('razao soc') || n.includes('razao social') || n === 'razao' || n === 'nome'))
            m.razaoSocial = i;
        if (m.cidade === undefined && n === 'cidade') m.cidade = i;
        if (m.uf === undefined && (n === 'uf' || n === 'uf rem' || n === 'uf do remetente' || n === 'uf de destino'))
            m.uf = i;
        if (m.chave === undefined && (n.includes('chave nf') || n === 'chave' || n.includes('chave de acesso')))
            m.chave = i;
        if (m.cfop === undefined && n === 'cfop') m.cfop = i;
        if (m.valor === undefined && (n.includes('valor cont') || n.includes('valor contabil') || n === 'vlr nf' || n.includes('valor da nf'))) m.valor = i;
    });
    return m;
}

// ─── Inferência de sentido (entrada/saida) ───────────────────────────────────

function inferirSentido(esRaw: string, sourceTab: string, cfop: string): DocSentido {
    const es = normalize(esRaw);
    if (es === 'e' || es === 'entrada') return 'entrada';
    if (es === 's' || es === 'saida') return 'saida';

    const tab = normalize(sourceTab);
    if (tab.includes('entrada')) return 'entrada';
    if (tab.includes('saida')) return 'saida';

    // CFOP: primeiro dígito ≥ 5 = saída; 1, 2, 3 = entrada
    const cfopDigit = (cfop || '').trim().charAt(0);
    if (cfopDigit === '1' || cfopDigit === '2' || cfopDigit === '3') return 'entrada';
    if (cfopDigit === '5' || cfopDigit === '6' || cfopDigit === '7') return 'saida';

    return 'desconhecido';
}

// ─── Parse de XLSX ───────────────────────────────────────────────────────────

function parseSituacaoCell(cell: any): { codigo: string; raw: string } {
    if (cell === null || cell === undefined) return { codigo: '', raw: '' };
    const raw = String(cell).trim();
    // Formatos comuns: "00 - Regular", "02-Cancelada", "00", "Regular"
    const matchCod = raw.match(/^\s*(\d{1,2})/);
    const codigo = matchCod ? matchCod[1].padStart(2, '0') : '';
    return { codigo, raw };
}

function parseNumero(cell: any): { numero: number | null; raw: string } {
    if (cell === null || cell === undefined || cell === '') return { numero: null, raw: '' };
    const raw = String(cell).trim();
    const onlyDigits = raw.replace(/\D/g, '');
    if (!onlyDigits) return { numero: null, raw };
    const n = parseInt(onlyDigits, 10);
    return { numero: Number.isFinite(n) ? n : null, raw };
}

function parseValor(cell: any): number {
    if (cell === null || cell === undefined || cell === '') return 0;
    if (typeof cell === 'number') return cell;
    const s = String(cell).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

function parseDataCell(cell: any): string {
    if (cell === null || cell === undefined || cell === '') return '';
    if (cell instanceof Date) return cell.toLocaleDateString('pt-BR');
    if (typeof cell === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(cell);
        if (d && d.y) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
    }
    return String(cell).trim();
}

export async function parseSageXlsx(file: File): Promise<SageNota[]> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const notas: SageNota[] = [];

    wb.SheetNames.forEach((sheetName) => {
        const ws = wb.Sheets[sheetName];
        if (!ws) return;
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });
        if (rows.length < 2) return;

        // Encontra a linha de header (procura nas primeiras 5 linhas a que tenha "N da NF" ou "Numero")
        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            const concat = (rows[i] || []).map((c) => normalize(String(c ?? ''))).join('|');
            if (concat.includes('numero') || concat.includes('n da nf') || concat.includes('no da nf') || concat.includes('nf') || concat.includes('e/s')) {
                headerIdx = i;
                break;
            }
        }

        const header = (rows[headerIdx] || []).map((c) => String(c ?? ''));
        const cols = mapearColunas(header);

        for (let r = headerIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.every((c) => c === null || c === undefined || c === '')) continue;

            const sit = parseSituacaoCell(cols.situacao !== undefined ? row[cols.situacao] : '');
            const num = parseNumero(cols.numero !== undefined ? row[cols.numero] : '');
            const cfop = cols.cfop !== undefined ? String(row[cols.cfop] ?? '').trim() : '';
            const esRaw = cols.es !== undefined ? String(row[cols.es] ?? '').trim() : '';

            const { status, statusCodigo } = classificarStatus(sit.codigo, sit.raw);
            const sentido = inferirSentido(esRaw, sheetName, cfop);

            notas.push({
                sentido,
                status,
                statusCodigo,
                statusOriginal: sit.raw,
                numero: num.numero,
                numeroRaw: num.raw,
                serie: cols.serie !== undefined ? String(row[cols.serie] ?? '').trim() : '',
                especie: cols.especie !== undefined ? String(row[cols.especie] ?? '').trim() : '',
                cnpj: cols.cnpj !== undefined ? String(row[cols.cnpj] ?? '').trim() : '',
                razaoSocial: cols.razaoSocial !== undefined ? String(row[cols.razaoSocial] ?? '').trim() : '',
                cidade: cols.cidade !== undefined ? String(row[cols.cidade] ?? '').trim() : '',
                uf: cols.uf !== undefined ? String(row[cols.uf] ?? '').trim() : '',
                chave: cols.chave !== undefined ? String(row[cols.chave] ?? '').trim() : '',
                cfop,
                valor: parseValor(cols.valor !== undefined ? row[cols.valor] : 0),
                dataEmissao: parseDataCell(cols.emissao !== undefined ? row[cols.emissao] : ''),
                dataEntradaSaida: parseDataCell(cols.entradaSaida !== undefined ? row[cols.entradaSaida] : ''),
                sourceTab: sheetName,
                sourceRow: r + 1,
            });
        }
    });

    return notas;
}

// ─── Parse de XML ────────────────────────────────────────────────────────────

function getText(el: Element | Document, tag: string): string {
    const found = (el as Element).getElementsByTagName(tag);
    if (found.length === 0) return '';
    return found[0].textContent?.trim() || '';
}

function parseSingleXml(xmlText: string, fileName: string): SageNota | null {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;

    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const total = doc.getElementsByTagName('total')[0];
    const icmsTot = total ? total.getElementsByTagName('ICMSTot')[0] : null;
    const infNFe = doc.getElementsByTagName('infNFe')[0];
    const protNFe = doc.getElementsByTagName('protNFe')[0];
    const cStat = protNFe ? getText(protNFe as Element, 'cStat') : '';
    const xMotivo = protNFe ? getText(protNFe as Element, 'xMotivo') : '';

    if (!ide && !infNFe) return null;

    const nNF = ide ? getText(ide as Element, 'nNF') : '';
    const serie = ide ? getText(ide as Element, 'serie') : '';
    const tpNF = ide ? getText(ide as Element, 'tpNF') : ''; // 0=entrada, 1=saída
    const dhEmi = ide ? getText(ide as Element, 'dhEmi') || getText(ide as Element, 'dEmi') : '';
    const cfop = doc.getElementsByTagName('CFOP')[0]?.textContent?.trim() || '';

    const chave = infNFe?.getAttribute('Id')?.replace('NFe', '') || '';
    const vNF = icmsTot ? parseValor(getText(icmsTot as Element, 'vNF')) : 0;

    let status: DocStatus = 'regular';
    let statusCodigo = '00';
    if (cStat === '101' || cStat === '151') {
        status = 'cancelada';
        statusCodigo = '02';
    } else if (cStat === '110' || cStat === '301' || cStat === '302') {
        status = 'denegada';
        statusCodigo = '04';
    }

    const sentidoFromTpNF: DocSentido = tpNF === '0' ? 'entrada' : tpNF === '1' ? 'saida' : 'desconhecido';
    const sentido = sentidoFromTpNF !== 'desconhecido' ? sentidoFromTpNF : inferirSentido('', '', cfop);

    return {
        sentido,
        status,
        statusCodigo,
        statusOriginal: xMotivo || `cStat ${cStat || '?'}`,
        numero: nNF ? parseInt(nNF, 10) : null,
        numeroRaw: nNF,
        serie,
        especie: 'NF-e',
        cnpj: emit ? getText(emit as Element, 'CNPJ') || getText(emit as Element, 'CPF') : '',
        razaoSocial: emit ? getText(emit as Element, 'xNome') : '',
        cidade: emit ? getText(emit as Element, 'xMun') : '',
        uf: emit ? getText(emit as Element, 'UF') : '',
        chave,
        cfop,
        valor: vNF,
        dataEmissao: dhEmi ? new Date(dhEmi).toLocaleDateString('pt-BR') : '',
        dataEntradaSaida: '',
        sourceTab: fileName,
        sourceRow: 0,
    };
}

export async function parseSageXmls(files: File[]): Promise<SageNota[]> {
    const out: SageNota[] = [];
    for (const f of files) {
        try {
            const txt = await f.text();
            const nota = parseSingleXml(txt, f.name);
            if (nota) out.push(nota);
        } catch {
            // ignora arquivo inválido
        }
    }
    return out;
}

// ─── Detecção de gaps ────────────────────────────────────────────────────────

function detectarGaps(notas: SageNota[]): GapNumeracao[] {
    // Agrupa por (sentido, cnpj, serie)
    const grupos = new Map<string, SageNota[]>();
    notas.forEach((n) => {
        if (n.numero === null) return;
        if (n.status === 'inutilizada') return; // inutilizada não é gap
        const key = `${n.sentido}::${n.cnpj || '?'}::${n.serie || '0'}`;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key)!.push(n);
    });

    const gaps: GapNumeracao[] = [];
    grupos.forEach((arr, key) => {
        const [sentido, cnpj, serie] = key.split('::');
        const nums = Array.from(new Set(arr.map((n) => n.numero!).filter((n) => n > 0))).sort((a, b) => a - b);
        if (nums.length < 2) return;
        for (let i = 1; i < nums.length; i++) {
            const prev = nums[i - 1];
            const cur = nums[i];
            if (cur - prev > 1) {
                gaps.push({
                    sentido: sentido as DocSentido,
                    cnpj,
                    razaoSocial: arr[0].razaoSocial || '',
                    serie,
                    de: prev + 1,
                    ate: cur - 1,
                    quantidade: cur - prev - 1,
                });
            }
        }
    });

    return gaps.sort((a, b) => b.quantidade - a.quantidade);
}

// ─── API pública ─────────────────────────────────────────────────────────────

export function analisar(notas: SageNota[]): SageAnalise {
    const porSentido = {
        entrada: [] as SageNota[],
        saida: [] as SageNota[],
        desconhecido: [] as SageNota[],
    };
    const porStatus = {
        regular: [] as SageNota[],
        cancelada: [] as SageNota[],
        denegada: [] as SageNota[],
        inutilizada: [] as SageNota[],
        desconhecido: [] as SageNota[],
    };
    const tabsSet = new Set<string>();

    notas.forEach((n) => {
        porSentido[n.sentido].push(n);
        porStatus[n.status].push(n);
        if (n.sourceTab) tabsSet.add(n.sourceTab);
    });

    const gaps = detectarGaps(notas);
    const notasFaltantes = gaps.reduce((acc, g) => acc + g.quantidade, 0);

    const avisos: string[] = [];
    if (porSentido.desconhecido.length > 0)
        avisos.push(`${porSentido.desconhecido.length} nota(s) sem identificação clara de Entrada/Saída.`);
    if (porStatus.desconhecido.length > 0)
        avisos.push(`${porStatus.desconhecido.length} nota(s) com status não reconhecido.`);

    return {
        totalNotas: notas.length,
        porSentido,
        porStatus,
        gaps,
        resumo: {
            regulares: porStatus.regular.length,
            canceladas: porStatus.cancelada.length,
            denegadas: porStatus.denegada.length,
            inutilizadas: porStatus.inutilizada.length,
            gapsTotal: gaps.length,
            notasFaltantes,
        },
        tabsLidas: Array.from(tabsSet),
        avisos,
    };
}

export async function analisarArquivos(files: File[]): Promise<SageAnalise> {
    const xlsxFiles = files.filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    const xmlFiles = files.filter((f) => /\.xml$/i.test(f.name));

    const notas: SageNota[] = [];
    for (const f of xlsxFiles) {
        const part = await parseSageXlsx(f);
        notas.push(...part);
    }
    if (xmlFiles.length > 0) {
        const part = await parseSageXmls(xmlFiles);
        notas.push(...part);
    }

    return analisar(notas);
}
