import React, { useEffect, useMemo, useState } from 'react';
import { getView } from '../../services/xmlDocumentoView';
import type { User, DocumentoFiscal } from '../../types';
import {
    listDocumentos,
    applyDocumentosFilters,
    getEmpresasDisponiveis,
    type ListDocumentosFilters,
    type EmpresaXmlOption,
} from '../../services/xmlFiscalService';
import { getCompetenciaDocumento } from '../../services/xmlDocumentosFilter';
import NFeStatusCell from './NFeStatusCell';
import { formatCnpjCpf, formatCurrency, formatDate } from '../../services/xmlParserService';
import EmpresaFilterCombobox from './EmpresaFilterCombobox';

interface Props {
    currentUser: User;
    onSelect: (doc: DocumentoFiscal) => void;
    /** Quando muda, força recarregar a lista. */
    refreshKey?: number;
}

const formatCompetencia = (competencia: string): string => {
    const m = competencia.match(/^(\d{4})-(\d{2})$/);
    return m ? `${m[2]}/${m[1]}` : competencia;
};

const ultimasCompetencias = (meses = 24): string[] => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < meses; i++) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        out.push(`${y}-${m}`);
        d.setMonth(d.getMonth() - 1);
    }
    return out;
};

// Quantas linhas montar por vez no DOM (render incremental).
const PAGINA_DOCS = 200;

const XmlDocumentosList: React.FC<Props> = ({ currentUser, onSelect, refreshKey }) => {
    // ANTES: cada tecla no campo "Buscar" disparava listDocumentos → fetchAllDocs
    // (5k+ docs pela rede) → filtro em memoria → setDocs. Resultado: digitação
    // travada e custo absurdo.
    // AGORA: fetch UMA vez por [currentUser, refreshKey] em allDocs; filtro
    // (busca/direção/competência/tipo/status/origem) roda em memoria via useMemo
    // a cada tecla, sem rede.
    const [allDocs, setAllDocs] = useState<DocumentoFiscal[]>([]);
    const [catalogoEmpresas, setCatalogoEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<ListDocumentosFilters>({});
    const [busca, setBusca] = useState('');
    const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
    // Render incremental: monta só as primeiras N linhas no DOM e cresce sob
    // demanda ("Carregar mais"). Antes o .map montava TODAS as linhas (milhares
    // numa competência grande) → travava a rolagem. Export CSV/PDF continua sobre
    // o conjunto filtrado inteiro (docs), não sobre o recorte visível.
    const [visibleCount, setVisibleCount] = useState(PAGINA_DOCS);
    const tableRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        // listDocumentos sem filtros = busca todos os docs visiveis ao usuario
        // (ja aplica createdBy pra colaborador, allow-all pra admin).
        // Em paralelo: catalogo completo de empresas (simples + lucro). Necessario
        // pra mostrar no combobox empresas SEM XMLs capturados (cert expirado,
        // procuracao inativa) — caso real: FASTWELD aparece em "Status por
        // Empresa" mas sumia daqui porque o dropdown vinha so de allDocs.
        Promise.all([
            listDocumentos(currentUser, {}),
            getEmpresasDisponiveis(currentUser),
        ]).then(([docs, empresas]) => {
            if (alive) {
                setAllDocs(docs);
                setCatalogoEmpresas(empresas);
                setLoading(false);
            }
        });
        return () => { alive = false; };
    }, [currentUser, refreshKey]);

    const docs = useMemo(
        () => applyDocumentosFilters(allDocs, { ...filters, busca }),
        [allDocs, filters, busca],
    );

    // Recorte visível no DOM. Ao mudar o filtro (docs muda de identidade),
    // volta pro topo e reseta a contagem — senão um filtro novo herdaria o
    // "carregar mais" do anterior.
    const docsVisiveis = useMemo(() => docs.slice(0, visibleCount), [docs, visibleCount]);
    useEffect(() => {
        setVisibleCount(PAGINA_DOCS);
        if (tableRef.current) tableRef.current.scrollTop = 0;
    }, [docs]);

    const competencias = useMemo(() => {
        const set = new Set<string>(ultimasCompetencias());
        const filtrosBase: ListDocumentosFilters = {
            ...filters,
            direcao: undefined,
            competencia: undefined,
        };
        const docsBase = applyDocumentosFilters(allDocs, { ...filtrosBase, busca });
        docsBase.forEach(d => {
            const comp = getCompetenciaDocumento(d);
            if (comp) set.add(comp);
        });
        return Array.from(set).sort().reverse();
    }, [allDocs, filters, busca]);

    // Lista de empresas distintas (CNPJ → nome) pro combobox. Combina:
    //  1. CATALOGO COMPLETO (simples_empresas + lucro_empresas) — fonte de
    //     verdade. Inclui empresas cadastradas SEM XMLs (cert expirado etc).
    //     Marcadas com `temXmls=false` pro usuário entender o gap.
    //  2. CNPJs presentes em allDocs — pode haver XML capturado de empresa
    //     ainda não cadastrada formalmente (raro, mas acontece em importação
    //     manual antes do cadastro).
    //
    // Estratégia de nome (em ordem de preferência):
    //  1. nome do catálogo (cadastro oficial)
    //  2. empresaNome (campo já populado no doc)
    //  3. Nome do emitente — quando a empresa É o emitente (direcao=saida)
    //  4. Nome do destinatário/tomador — quando a empresa É o dest (direcao=entrada)
    const empresasDropdown = useMemo(() => {
        const normCnpj = (s: any) => String(s ?? '').replace(/\D/g, '');

        // Set de CNPJs que aparecem em pelo menos um documento capturado.
        const cnpjsComDocs = new Set<string>();
        for (const d of allDocs) {
            const c = normCnpj(d.empresaCnpj);
            if (c.length === 14) cnpjsComDocs.add(c);
        }

        // 1. Semeia com o catalogo (nome oficial do cadastro).
        const map = new Map<string, string>();
        for (const emp of catalogoEmpresas) {
            const cnpj = normCnpj(emp.cnpj);
            if (cnpj.length !== 14) continue;
            if (emp.nome) map.set(cnpj, emp.nome);
        }

        // 2. Mescla com nomes derivados dos docs (fallback pra CNPJs sem
        //    cadastro OU pra completar nomes vazios).
        for (const d of allDocs) {
            const cnpj = normCnpj(d.empresaCnpj);
            if (cnpj.length !== 14) continue;

            const atual = map.get(cnpj);
            // Se já tem nome bom (≠ CNPJ raw), mantém.
            if (atual && atual !== cnpj && !/^\d+$/.test(atual)) continue;

            let nome = d.empresaNome || '';
            if (!nome) {
                const e = d as any;
                if (d.direcao === 'saida') {
                    nome = e.emitente?.nome || e.prestador?.nome || '';
                } else if (d.direcao === 'entrada') {
                    nome = e.destinatario?.nome || e.tomador?.nome || '';
                }
                if (!nome) {
                    for (const bloco of [e.emitente, e.prestador, e.destinatario, e.tomador]) {
                        if (bloco && normCnpj(bloco.cnpj) === cnpj && bloco.nome) {
                            nome = bloco.nome;
                            break;
                        }
                    }
                }
            }

            map.set(cnpj, nome || cnpj);
        }

        return Array.from(map.entries())
            .map(([cnpj, nome]) => ({
                cnpj,
                nome,
                temXmls: cnpjsComDocs.has(cnpj),
            }))
            .sort((a, b) => {
                // Empresas com XMLs primeiro (fluxo principal), depois sem XMLs.
                if (a.temXmls !== b.temXmls) return a.temXmls ? -1 : 1;
                // Empresas com nome de verdade antes de CNPJ-only. Nome pode
                // vir undefined em docs de captura server-side — trata como ''.
                const aNome = a.nome || '';
                const bNome = b.nome || '';
                const aTemNome = !/^\d+$/.test(aNome) && aNome !== '';
                const bTemNome = !/^\d+$/.test(bNome) && bNome !== '';
                if (aTemNome !== bTemNome) return aTemNome ? -1 : 1;
                return aNome.localeCompare(bNome);
            });
    }, [allDocs, catalogoEmpresas]);

    // Empresa selecionada no combobox — usado pra mostrar hint quando a empresa
    // existe no cadastro mas nao tem XMLs capturados (caso FASTWELD).
    const empresaSelecionadaInfo = useMemo(() => {
        if (!filters.empresaCnpj) return null;
        const cnpj = filters.empresaCnpj.replace(/\D/g, '');
        return empresasDropdown.find(e => e.cnpj === cnpj) || null;
    }, [filters.empresaCnpj, empresasDropdown]);

    // Slug dos filtros ativos pra usar no nome do arquivo exportado.
    // Ex: 'todos' (sem filtro) ou 'entrada-2026-05-autorizado'.
    const filtroSlug = useMemo(() => {
        const empresaSlug = filters.empresaCnpj
            ? `empresa-${filters.empresaCnpj.replace(/\D/g, '').slice(0, 14)}`
            : null;
        const partes = [
            empresaSlug,
            filters.tipoDoc,
            filters.direcao,
            filters.competencia,
            filters.status,
            filters.origem,
            busca ? `busca-${busca.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 20)}` : null,
        ].filter(Boolean);
        return partes.length === 0 ? 'todos' : partes.join('-');
    }, [filters, busca]);

    const exportCsv = () => {
        setExporting('csv');
        try {
            const headers = [
                'Data', 'Empresa', 'CNPJ Empresa', 'Tipo', 'Número', 'Série',
                'Direção', 'Competência', 'Contraparte', 'CNPJ Contraparte', 'Valor', 'Status',
            ];
            const escape = (v: string | number | undefined | null) => {
                const s = (v ?? '').toString();
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };
            const rows = docs.map(d => {
                const view = getView(d);
                // view.direcao ja faz fallback (PR pós-cStat138). Usa ela como fonte.
                const direcao = view.direcao || '';
                const contraparte = direcao === 'entrada' ? view.emitente : view.destinatario;
                return [
                    formatDate(d.dhEmi).split(' ')[0],
                    d.empresaNome || formatCnpjCpf(d.empresaCnpj || '') || '—',
                    formatCnpjCpf(d.empresaCnpj || ''),
                    d.tipo,
                    view.numero || '',
                    view.serie || '',
                    direcao,
                    getCompetenciaDocumento(d),
                    contraparte.nome || '',
                    formatCnpjCpf(contraparte.cnpj || ''),
                    view.valores.total ?? 0,
                    d.status || '',
                ].map(escape).join(',');
            });
            const csv = '﻿' + [headers.join(','), ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `xmls-${filtroSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setExporting(null);
        }
    };

    const exportPdf = async () => {
        setExporting('pdf');
        try {
            const { default: jsPDF } = await import('jspdf');
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const W = pdf.internal.pageSize.getWidth();   // 297
            const H = pdf.internal.pageSize.getHeight();  // 210
            const M = 10;                                  // margem
            const colorBrand: [number, number, number] = [30, 64, 175];    // sp-blue (#1E40AF, --accent do index.css)
            const colorOk: [number, number, number]    = [16, 122, 87];    // verde semantico pra 'autorizado'
            const colorMuted: [number, number, number] = [100, 116, 139]; // slate-500
            const colorRed: [number, number, number]   = [220, 38, 38];   // red-600
            const colorAmber: [number, number, number] = [217, 119, 6];   // amber-600
            const colorBorder: [number, number, number]= [203, 213, 225]; // slate-300

            // ─── Helpers ───────────────────────────────────────────────────
            const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const truncate = (s: string, max: number) => (s || '').length > max ? (s || '').slice(0, max - 1) + '…' : (s || '');

            // ─── Stats ─────────────────────────────────────────────────────
            const docsView = docs.map(d => ({ d, v: getView(d) }));
            const valorTotal = docsView.reduce((acc, { v }) => acc + (v.valores.total || 0), 0);
            const porStatus: Record<string, { qtd: number; valor: number }> = {};
            const porDirecao: Record<string, { qtd: number; valor: number }> = {};
            let dataMin = '';
            let dataMax = '';
            docsView.forEach(({ d, v }) => {
                const st = (d.status || 'desconhecido').toLowerCase();
                porStatus[st] = porStatus[st] || { qtd: 0, valor: 0 };
                porStatus[st].qtd++;
                porStatus[st].valor += v.valores.total || 0;
                const dir = (v.direcao || 'desconhecida').toLowerCase();
                porDirecao[dir] = porDirecao[dir] || { qtd: 0, valor: 0 };
                porDirecao[dir].qtd++;
                porDirecao[dir].valor += v.valores.total || 0;
                const dia = formatDate(d.dhEmi).split(' ')[0];
                if (dia && /^\d{2}\/\d{2}\/\d{4}$/.test(dia)) {
                    if (!dataMin || dia < dataMin) dataMin = dia;
                    if (!dataMax || dia > dataMax) dataMax = dia;
                }
            });
            const cancelados = porStatus['cancelado']?.qtd || 0;
            const autorizados = porStatus['autorizado']?.qtd || 0;
            const denegados = porStatus['denegado']?.qtd || 0;
            const rejeitados = porStatus['rejeitado']?.qtd || 0;
            const entradas = porDirecao['entrada'] || { qtd: 0, valor: 0 };
            const saidas = porDirecao['saida'] || { qtd: 0, valor: 0 };
            const valorLiquido = (porStatus['autorizado']?.valor || 0); // exclui cancelado/denegado/rejeitado

            // ─── Cabeçalho da página (chamado em toda nova página) ─────────
            const drawHeader = () => {
                pdf.setFillColor(...colorBrand);
                pdf.rect(0, 0, W, 18, 'F');
                pdf.setTextColor(255, 255, 255);
                pdf.setFontSize(14);
                pdf.setFont('helvetica', 'bold');
                pdf.text('Central de Documentos Fiscais', M, 8);
                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'normal');
                pdf.text('Relatório · XMLs NFe (Entrada/Saída)', M, 14);
                pdf.setFontSize(8);
                pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, W - M, 8, { align: 'right' });
                pdf.text('SP Assessoria Contábil', W - M, 14, { align: 'right' });
            };

            // ─── Rodapé (chamado no fim, escreve número da página) ─────────
            const drawFooter = (pageNum: number, totalPages: number) => {
                pdf.setTextColor(...colorMuted);
                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'normal');
                pdf.text(`Página ${pageNum} de ${totalPages}`, W / 2, H - 5, { align: 'center' });
                pdf.text('Documento gerado automaticamente — Confira com as fontes oficiais.', M, H - 5);
            };

            // ─── Página 1: header + filtros + KPIs ─────────────────────────
            drawHeader();
            let y = 24;

            // Bloco de Filtros aplicados
            pdf.setTextColor(40);
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Filtros aplicados', M, y);
            y += 4;
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(...colorMuted);
            const filtrosTxt = [
                `Busca: ${busca || '—'}`,
                `Direção: ${filters.direcao || 'todas'}`,
                `Competência: ${filters.competencia || 'todas'}`,
                `Status: ${filters.status || 'todos'}`,
                `Origem: ${filters.origem || 'todas'}`,
                `Período dos docs: ${dataMin || '—'} → ${dataMax || '—'}`,
            ].join('   ·   ');
            pdf.text(filtrosTxt, M, y);
            y += 6;

            // KPI Cards (4 colunas)
            const kpiW = (W - 2 * M - 9) / 4;
            const kpiH = 18;
            const kpis: { label: string; valor: string; sub: string; color: [number, number, number] }[] = [
                { label: 'Total de Docs', valor: String(docs.length), sub: `${entradas.qtd} entrada · ${saidas.qtd} saída`, color: colorBrand },
                { label: 'Valor Bruto', valor: fmtBRL(valorTotal), sub: `Autorizado: ${fmtBRL(valorLiquido)}`, color: [40, 40, 40] },
                { label: 'Autorizadas', valor: String(autorizados), sub: cancelados ? `${cancelados} canceladas` : 'sem cancelamentos', color: colorOk },
                { label: 'Canceladas / Rejeitadas', valor: String(cancelados + denegados + rejeitados), sub: `${cancelados} canc · ${denegados} den · ${rejeitados} rej`, color: cancelados > 0 ? colorRed : colorMuted },
            ];
            kpis.forEach((k, i) => {
                const x = M + i * (kpiW + 3);
                pdf.setDrawColor(...colorBorder);
                pdf.setFillColor(248, 250, 252);
                pdf.roundedRect(x, y, kpiW, kpiH, 1.5, 1.5, 'FD');
                pdf.setTextColor(...colorMuted);
                pdf.setFontSize(7);
                pdf.setFont('helvetica', 'bold');
                pdf.text(k.label.toUpperCase(), x + 3, y + 4);
                pdf.setTextColor(...k.color);
                pdf.setFontSize(13);
                pdf.text(k.valor, x + 3, y + 11);
                pdf.setTextColor(...colorMuted);
                pdf.setFontSize(7);
                pdf.setFont('helvetica', 'normal');
                pdf.text(k.sub, x + 3, y + 15);
            });
            y += kpiH + 6;

            // ─── Tabela ────────────────────────────────────────────────────
            const cols = [
                { key: 'data',         label: 'Data',        w: 18,  align: 'left' as const },
                { key: 'empresa',      label: 'Empresa',     w: 50,  align: 'left' as const },
                { key: 'tipo',         label: 'Tipo',        w: 14,  align: 'left' as const },
                { key: 'numero',       label: 'Nº',          w: 22,  align: 'left' as const },
                { key: 'direcao',      label: 'Direção',     w: 16,  align: 'left' as const },
                { key: 'contraparte',  label: 'Contraparte', w: 70,  align: 'left' as const },
                { key: 'valor',        label: 'Valor',       w: 28,  align: 'right' as const },
                { key: 'status',       label: 'Status',      w: 22,  align: 'left' as const },
            ];
            const tableX = M;
            const rowH = 5;
            const headerH = 6;

            const drawTableHeader = () => {
                pdf.setFillColor(241, 245, 249); // slate-100
                pdf.rect(tableX, y, W - 2 * M, headerH, 'F');
                pdf.setTextColor(...colorMuted);
                pdf.setFontSize(7);
                pdf.setFont('helvetica', 'bold');
                let cx = tableX + 2;
                cols.forEach(c => {
                    const xText = c.align === 'right' ? cx + c.w - 2 : cx;
                    pdf.text(c.label.toUpperCase(), xText, y + 4, { align: c.align });
                    cx += c.w;
                });
                pdf.setDrawColor(...colorBorder);
                pdf.line(tableX, y + headerH, tableX + (W - 2 * M), y + headerH);
                y += headerH;
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(7);
            };

            drawTableHeader();
            const totalDocsRender = docsView.length;
            let pageNum = 1;
            const usableBottom = H - 12;

            docsView.forEach(({ d, v }, idx) => {
                if (y + rowH > usableBottom) {
                    drawFooter(pageNum, 0); // 0 = placeholder, vamos atualizar no fim
                    pdf.addPage();
                    pageNum++;
                    drawHeader();
                    y = 22;
                    drawTableHeader();
                }
                if (idx % 2 === 1) {
                    pdf.setFillColor(250, 250, 252);
                    pdf.rect(tableX, y, W - 2 * M, rowH, 'F');
                }
                const contraparte = d.direcao === 'entrada' ? v.emitente : v.destinatario;
                const status = (d.status || 'desconhecido');
                const statusColor: [number, number, number] =
                    status === 'cancelado' ? colorRed :
                    status === 'denegado' || status === 'rejeitado' ? colorAmber :
                    status === 'autorizado' ? colorOk : colorMuted;

                const cells = [
                    { txt: formatDate(d.dhEmi).split(' ')[0] || '—', color: [40,40,40] as [number,number,number] },
                    { txt: truncate(d.empresaNome || formatCnpjCpf(d.empresaCnpj || '') || '—', 32), color: [40,40,40] as [number,number,number] },
                    { txt: d.tipo || '—', color: [40,40,40] as [number,number,number] },
                    { txt: `${v.numero || '—'}/${v.serie || '—'}`, color: [40,40,40] as [number,number,number] },
                    { txt: v.direcao || '—', color: [40,40,40] as [number,number,number] },
                    { txt: truncate(`${contraparte.nome || '—'} ${contraparte.cnpj ? `(${formatCnpjCpf(contraparte.cnpj)})` : ''}`, 50), color: [40,40,40] as [number,number,number] },
                    { txt: fmtBRL(v.valores.total || 0), color: [40,40,40] as [number,number,number] },
                    { txt: status, color: statusColor },
                ];

                let cx = tableX + 2;
                cells.forEach((cell, i) => {
                    pdf.setTextColor(...cell.color);
                    const col = cols[i];
                    const xText = col.align === 'right' ? cx + col.w - 2 : cx;
                    pdf.text(cell.txt, xText, y + 3.5, { align: col.align });
                    cx += col.w;
                });
                y += rowH;
            });

            // ─── Bloco final: linha de totais ──────────────────────────────
            if (y + 8 > usableBottom) {
                drawFooter(pageNum, 0);
                pdf.addPage();
                pageNum++;
                drawHeader();
                y = 22;
            }
            pdf.setDrawColor(...colorBorder);
            pdf.line(tableX, y + 1, tableX + (W - 2 * M), y + 1);
            y += 3;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(40);
            pdf.text(`Totalizando ${totalDocsRender} documentos`, tableX, y + 3);
            pdf.text(fmtBRL(valorTotal), W - M, y + 3, { align: 'right' });

            // ─── Atualiza rodapés com o total de páginas ───────────────────
            const totalPages = pageNum;
            for (let p = 1; p <= totalPages; p++) {
                pdf.setPage(p);
                drawFooter(p, totalPages);
            }

            pdf.save(`xmls-${filtroSlug}-${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (e) {
            console.error('[exportPdf]', e);
        } finally {
            setExporting(null);
        }
    };

    return (
        <div className="space-y-3">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                    <input
                        placeholder="Buscar (nº, chave, contraparte)"
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        title='Busca em número/chave/nome da contraparte (emit/dest/prestador/tomador). Pra filtrar por EMPRESA dona, use o campo ao lado.'
                    />
                    <EmpresaFilterCombobox
                        opcoes={empresasDropdown}
                        valor={filters.empresaCnpj}
                        onChange={(cnpj) => setFilters(f => ({ ...f, empresaCnpj: cnpj }))}
                    />
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.tipoDoc || ''}
                        onChange={(e) => setFilters(f => ({ ...f, tipoDoc: e.target.value || undefined }))}
                    >
                        <option value="">Tipo (todos)</option>
                        <option value="NFe">📄 NFe</option>
                        <option value="NFCe">🧾 NFCe</option>
                        <option value="NFSe">🏛️ NFSe</option>
                        <option value="CTe">📦 CT-e</option>
                        <option value="MDFe">🚚 MDF-e</option>
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.direcao || ''}
                        onChange={(e) => setFilters(f => ({ ...f, direcao: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Direção (todas)</option>
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.competencia || ''}
                        onChange={(e) => setFilters(f => ({ ...f, competencia: e.target.value || undefined }))}
                    >
                        <option value="">Competência (todas)</option>
                        {competencias.map(c => <option key={c} value={c}>{formatCompetencia(c)}</option>)}
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.status || ''}
                        onChange={(e) => setFilters(f => ({ ...f, status: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Status (todos)</option>
                        <option value="autorizado">Autorizado</option>
                        <option value="cancelado">Cancelado</option>
                        <option value="denegado">Denegado</option>
                        <option value="rejeitado">Rejeitado</option>
                        <option value="desconhecido">Desconhecido</option>
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.origem || ''}
                        onChange={(e) => setFilters(f => ({ ...f, origem: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Origem (todas)</option>
                        <option value="manual">Manual</option>
                        <option value="sefaz">SEFAZ</option>
                        <option value="sharepoint">SharePoint</option>
                        <option value="email">E-mail</option>
                        <option value="api">API</option>
                    </select>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center gap-3 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        XMLs Capturados ({docs.length})
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={exportCsv}
                            disabled={exporting !== null || docs.length === 0}
                            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Baixa os XMLs filtrados em CSV (Excel)"
                        >
                            {exporting === 'csv' ? 'Gerando…' : '⬇ CSV'}
                        </button>
                        <button
                            onClick={exportPdf}
                            disabled={exporting !== null || docs.length === 0}
                            className="px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Baixa relatório em PDF com o layout do app"
                        >
                            {exporting === 'pdf' ? 'Gerando…' : '⬇ PDF'}
                        </button>
                    </div>
                </div>
                {loading ? (
                    <p className="text-center text-xs text-slate-400 py-6">Carregando...</p>
                ) : docs.length === 0 ? (
                    empresaSelecionadaInfo && empresaSelecionadaInfo.temXmls === false ? (
                        <div className="text-center py-6 px-4">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                <strong>{empresaSelecionadaInfo.nome}</strong> não tem XMLs capturados.
                            </p>
                            <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                Verifique certificado e procuração na aba <strong>📋 Status por Empresa</strong>.
                            </p>
                        </div>
                    ) : filters.direcao === 'saida' ? (
                        <div className="text-center py-6 px-4 space-y-1">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Nenhuma nota de <strong>saída</strong> encontrada para este filtro.
                            </p>
                            <p className="text-[11px] text-amber-700 dark:text-amber-300 max-w-2xl mx-auto">
                                A captura automática usa a Distribuição DF-e da SEFAZ, que entrega apenas notas onde a
                                empresa é <strong>destinatária</strong> (entrada) e eventos. NF-e <strong>emitidas</strong> pela
                                empresa não são distribuídas por esse canal — importe-as pela aba{' '}
                                <strong>Importação Manual</strong> (XML do sistema emissor) ou via SharePoint.
                            </p>
                        </div>
                    ) : (
                        <p className="text-center text-xs text-slate-400 py-6">Nenhum documento encontrado.</p>
                    )
                ) : (
                    <div ref={tableRef} className="overflow-x-auto max-h-[520px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Data</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Empresa</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Tipo</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Nº</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Direção</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Contraparte</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Valor</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {docsVisiveis.map(d => (
                                    <tr
                                        key={d.id}
                                        onClick={() => onSelect(d)}
                                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                                    >
                                        <td className="px-3 py-1.5 text-slate-500">{formatDate(d.dhEmi).split(' ')[0]}</td>
                                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[180px] truncate" title={d.empresaNome || formatCnpjCpf(d.empresaCnpj) || ''}>{d.empresaNome || formatCnpjCpf(d.empresaCnpj) || '—'}</td>
                                        <td className="px-3 py-1.5 text-slate-500">{d.tipo}{getView(d).resumoOnly && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 py-0.5 rounded font-bold">Resumo</span>}</td>
                                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 font-mono">{getView(d).numero || '—'}/{getView(d).serie || '—'}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                                getView(d).direcao === 'entrada' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                                : getView(d).direcao === 'saida' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                            }`}>
                                                {getView(d).direcao || '—'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-600 dark:text-slate-300" title={`${getView(d).emitente.nome || '—'} → ${getView(d).destinatario.nome || '—'}`}>
                                            {d.direcao === 'entrada'
                                                ? (getView(d).emitente.nome || '—')
                                                : (getView(d).destinatario.nome || '—')}
                                            <span className="text-[10px] text-slate-400 ml-1">{formatCnpjCpf(d.direcao === 'entrada'
                                                ? getView(d).emitente.cnpj
                                                : getView(d).destinatario.cnpj)}</span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-bold text-slate-700 dark:text-slate-200">{formatCurrency(getView(d).valores.total)}</td>
                                        <td className="px-3 py-1.5"><NFeStatusCell doc={d} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {docs.length > visibleCount && (
                            <div className="sticky bottom-0 bg-white/95 dark:bg-slate-800/95 border-t border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center justify-between gap-3">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Mostrando {visibleCount.toLocaleString('pt-BR')} de {docs.length.toLocaleString('pt-BR')}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setVisibleCount(c => c + PAGINA_DOCS)}
                                        className="px-3 py-1 text-xs font-bold bg-sky-600 text-white rounded hover:bg-sky-700"
                                    >
                                        Carregar mais (+{PAGINA_DOCS})
                                    </button>
                                    <button
                                        onClick={() => setVisibleCount(docs.length)}
                                        className="px-3 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
                                    >
                                        Todos
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default XmlDocumentosList;
