import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { User } from '../../types';
import {
    getEmpresasParaPerfilCliente,
    type EmpresaPerfilOption,
} from '../../services/xmlFiscalService';
import {
    consultarNfseSp,
    type NfseSpItem,
    type NfseSpConsultaResult,
} from '../../services/nfseSpService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = [
    { v: 1, l: '01 - Janeiro' },
    { v: 2, l: '02 - Fevereiro' },
    { v: 3, l: '03 - Março' },
    { v: 4, l: '04 - Abril' },
    { v: 5, l: '05 - Maio' },
    { v: 6, l: '06 - Junho' },
    { v: 7, l: '07 - Julho' },
    { v: 8, l: '08 - Agosto' },
    { v: 9, l: '09 - Setembro' },
    { v: 10, l: '10 - Outubro' },
    { v: 11, l: '11 - Novembro' },
    { v: 12, l: '12 - Dezembro' },
];

const fmtCnpj = (v: string) => {
    const d = (v || '').replace(/\D/g, '');
    if (d.length !== 14) return v || '-';
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const fmtMoeda = (v: number | null | undefined) =>
    v != null
        ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'R$ 0,00';

const fmtPct = (v: number | null | undefined) =>
    v != null ? `${(v * 100).toFixed(2)}%` : '-';

const fmtData = (iso: string) => {
    if (!iso) return '-';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const fmtNum2 = (v: number | null | undefined) =>
    v != null ? v.toFixed(2).replace('.', ',') : '0,00';

type SortKey =
    | 'numero'
    | 'dhEmi'
    | 'contraparte'
    | 'valorServicos'
    | 'aliquotaServicos'
    | 'valorIss'
    | 'issRetido';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const XmlNfseSp: React.FC<Props> = ({ currentUser, onShowToast }) => {
    // ─── State ────────────────────────────────────────────────────────────────
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [loadingEmpresas, setLoadingEmpresas] = useState(true);
    const [empresaSel, setEmpresaSel] = useState('');
    const [tipo, setTipo] = useState<'recebidas' | 'emitidas'>('recebidas');
    const [mes, setMes] = useState(() => {
        const m = new Date().getMonth(); // 0-based, previous month
        return m === 0 ? 12 : m;
    });
    const [ano, setAno] = useState(() => {
        const d = new Date();
        return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    });

    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState('');
    const [resultado, setResultado] = useState<NfseSpConsultaResult | null>(null);

    const [sortKey, setSortKey] = useState<SortKey>('dhEmi');
    const [sortAsc, setSortAsc] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    const [exportingPdf, setExportingPdf] = useState(false);

    // ─── Load empresas ────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoadingEmpresas(true);
            try {
                const list = await getEmpresasParaPerfilCliente(currentUser);
                if (!cancelled) setEmpresas(list);
            } catch {
                // silently fail
            } finally {
                if (!cancelled) setLoadingEmpresas(false);
            }
        })();
        return () => { cancelled = true; };
    }, [currentUser]);

    const empresaObj = useMemo(
        () => empresas.find((e) => e.id === empresaSel) || null,
        [empresas, empresaSel]
    );

    // ─── Consulta ─────────────────────────────────────────────────────────────
    const handleConsultar = useCallback(async () => {
        if (!empresaObj) return;
        if (!empresaObj.ccmSp) {
            setErro(
                'Esta empresa não possui Inscrição Municipal de SP (CCM) cadastrada. ' +
                'Cadastre o campo "ccmSp" na ficha da empresa para habilitar a consulta NFS-e SP.'
            );
            return;
        }

        setLoading(true);
        setErro('');
        setResultado(null);
        setExpandedRow(null);

        try {
            const r = await consultarNfseSp({
                cnpj: empresaObj.cnpj.replace(/\D/g, ''),
                inscricaoMunicipal: empresaObj.ccmSp,
                tipo,
                mes,
                ano,
            });

            if (!r.sucesso) {
                if (r.erros?.length) {
                    setErro(r.erros.map((e) => `[${e.codigo || '?'}] ${e.descricao || ''}`).join('\n'));
                } else if (r.alertas?.length) {
                    setErro('Alertas do portal SP:\n' + r.alertas.map((a: any) => `[${a.codigo || '?'}] ${a.descricao || ''}`).join('\n'));
                } else {
                    setErro('Portal SP retornou sucesso=false mas sem erros nem alertas. Resposta crua: ' + JSON.stringify(r).slice(0, 500));
                }
            } else if (r.sucesso && (!r.nfes || r.nfes.length === 0)) {
                setErro(`Portal SP retornou sucesso=true mas 0 NFs no período ${mes}/${ano}. Confirme se a empresa realmente emitiu/recebeu NFs nesse mês (ou se a Inscrição Municipal ${empresaObj.ccmSp} está correta no cadastro).`);
            }
            setResultado(r);
        } catch (e: any) {
            setErro(e.message || 'Erro ao consultar NFS-e SP');
        } finally {
            setLoading(false);
        }
    }, [empresaObj, tipo, mes, ano]);

    // ─── Sort ─────────────────────────────────────────────────────────────────
    const sortedNfes = useMemo(() => {
        if (!resultado?.nfes?.length) return [];
        const list = [...resultado.nfes];
        const dir = sortAsc ? 1 : -1;
        list.sort((a, b) => {
            switch (sortKey) {
                case 'numero':
                    return (Number(a.numero) - Number(b.numero)) * dir;
                case 'dhEmi':
                    return (a.dhEmi || '').localeCompare(b.dhEmi || '') * dir;
                case 'contraparte': {
                    const nameA =
                        tipo === 'recebidas'
                            ? a.razaoSocialPrestador || a.cnpjPrestador
                            : a.razaoSocialTomador || a.cnpjTomador;
                    const nameB =
                        tipo === 'recebidas'
                            ? b.razaoSocialPrestador || b.cnpjPrestador
                            : b.razaoSocialTomador || b.cnpjTomador;
                    return (nameA || '').localeCompare(nameB || '') * dir;
                }
                case 'valorServicos':
                    return ((a.valorServicos ?? 0) - (b.valorServicos ?? 0)) * dir;
                case 'aliquotaServicos':
                    return ((a.aliquotaServicos ?? 0) - (b.aliquotaServicos ?? 0)) * dir;
                case 'valorIss':
                    return ((a.valorIss ?? 0) - (b.valorIss ?? 0)) * dir;
                case 'issRetido':
                    return ((a.issRetido ? 1 : 0) - (b.issRetido ? 1 : 0)) * dir;
                default:
                    return 0;
            }
        });
        return list;
    }, [resultado, sortKey, sortAsc, tipo]);

    // ─── Summary ──────────────────────────────────────────────────────────────
    const summary = useMemo(() => {
        if (!resultado?.nfes?.length)
            return { total: 0, valorTotal: 0, issTotal: 0, issRetidoTotal: 0 };
        const nfes = resultado.nfes;
        return {
            total: nfes.length,
            valorTotal: nfes.reduce((s, n) => s + (n.valorServicos ?? 0), 0),
            issTotal: nfes.reduce((s, n) => s + (n.valorIss ?? 0), 0),
            issRetidoTotal: nfes
                .filter((n) => n.issRetido)
                .reduce((s, n) => s + (n.valorIss ?? 0), 0),
        };
    }, [resultado]);

    // ─── Column header click ──────────────────────────────────────────────────
    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else {
            setSortKey(key);
            setSortAsc(true);
        }
    };

    const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => {
        if (sortKey !== col) return <span className="opacity-30 ml-0.5">&#8597;</span>;
        return <span className="ml-0.5">{sortAsc ? '&#9650;' : '&#9660;'}</span>;
    };

    // ─── CSV Export ───────────────────────────────────────────────────────────
    const exportarCsv = useCallback(() => {
        if (!sortedNfes.length || !empresaObj) return;
        const sep = ';';
        const header = [
            'Numero',
            'Data Emissao',
            'CNPJ Prestador',
            'Prestador',
            'CNPJ Tomador',
            'Tomador',
            'Codigo Servico',
            'Discriminacao',
            'Valor Servicos',
            'Valor Deducoes',
            'Aliquota',
            'ISS',
            'ISS Retido',
            'PIS',
            'COFINS',
            'INSS',
            'IR',
            'CSLL',
            'Codigo Verificacao',
            'Cancelado',
        ].join(sep);

        const rows = sortedNfes.map((n) => {
            const fields = [
                n.numero,
                fmtData(n.dhEmi),
                fmtCnpj(n.cnpjPrestador),
                (n.razaoSocialPrestador || '').replace(/;/g, ','),
                fmtCnpj(n.cnpjTomador),
                (n.razaoSocialTomador || '').replace(/;/g, ','),
                n.codigoServico,
                (n.discriminacao || '').replace(/[\r\n;]/g, ' '),
                fmtNum2(n.valorServicos),
                fmtNum2(n.valorDeducoes),
                fmtNum2(n.aliquotaServicos != null ? n.aliquotaServicos * 100 : null),
                fmtNum2(n.valorIss),
                n.issRetido ? 'Sim' : 'Nao',
                fmtNum2(n.valorPis),
                fmtNum2(n.valorCofins),
                fmtNum2(n.valorInss),
                fmtNum2(n.valorIr),
                fmtNum2(n.valorCsll),
                n.codigoVerificacao,
                n.cancelado ? 'Sim' : 'Nao',
            ];
            return fields.join(sep);
        });

        const bom = '﻿';
        const csv = bom + [header, ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const cnpjClean = empresaObj.cnpj.replace(/\D/g, '');
        a.href = url;
        a.download = `nfse-sp-${cnpjClean}-${String(mes).padStart(2, '0')}-${ano}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onShowToast?.('CSV exportado com sucesso');
    }, [sortedNfes, empresaObj, mes, ano, onShowToast]);

    // ─── PDF Export ───────────────────────────────────────────────────────────
    const exportarPdf = useCallback(async () => {
        if (!sortedNfes.length || !empresaObj) return;
        setExportingPdf(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth(); // 297
            const pageH = pdf.internal.pageSize.getHeight(); // 210
            const margin = 12;
            const contentW = pageW - margin * 2;
            let y = margin;
            let pageNum = 1;

            const periodoLabel = `${String(mes).padStart(2, '0')}/${ano}`;
            const tipoLabel = tipo === 'recebidas' ? 'Servicos Tomados (Recebidas)' : 'Servicos Prestados (Emitidas)';
            const dataHoje = new Date().toLocaleDateString('pt-BR');

            const addFooter = () => {
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(7);
                pdf.setTextColor(150, 150, 150);
                pdf.text(`SP Assessoria Contabil — Gerado em ${dataHoje}`, margin, pageH - 6);
                pdf.text(`Pagina ${pageNum}`, pageW - margin, pageH - 6, { align: 'right' });
            };

            const checkPage = (needed: number) => {
                if (y + needed > pageH - 14) {
                    addFooter();
                    pdf.addPage();
                    pageNum += 1;
                    y = margin;
                }
            };

            // ===== HEADER =====
            pdf.setFillColor(30, 58, 95);
            pdf.rect(0, 0, pageW, 32, 'F');

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(255, 255, 255);
            pdf.text('Relatorio NFS-e Sao Paulo', margin, 14);

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(200, 215, 235);
            pdf.text(`${empresaObj.nome} — CNPJ ${fmtCnpj(empresaObj.cnpj)} — Periodo: ${periodoLabel}`, margin, 22);
            pdf.text(tipoLabel, margin, 28);

            y = 40;

            // ===== SUMMARY CARDS =====
            const cardW = contentW / 4 - 3;
            const cards = [
                { label: 'Total NFS-e', value: String(summary.total) },
                { label: 'Valor Total', value: fmtMoeda(summary.valorTotal) },
                { label: 'ISS Total', value: fmtMoeda(summary.issTotal) },
                { label: 'ISS Retido Total', value: fmtMoeda(summary.issRetidoTotal) },
            ];
            cards.forEach((c, i) => {
                const x = margin + i * (cardW + 4);
                pdf.setFillColor(245, 245, 245);
                pdf.roundedRect(x, y, cardW, 16, 2, 2, 'F');
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(7);
                pdf.setTextColor(120, 120, 120);
                pdf.text(c.label, x + 4, y + 6);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(10);
                pdf.setTextColor(30, 30, 30);
                pdf.text(c.value, x + 4, y + 13);
            });

            y += 24;

            // ===== TABLE =====
            const cols = [
                { label: 'Numero', w: 18, x: margin },
                { label: 'Data', w: 22, x: 0 },
                { label: tipo === 'recebidas' ? 'Prestador' : 'Tomador', w: 70, x: 0 },
                { label: 'Discriminacao', w: 72, x: 0 },
                { label: 'Valor', w: 22, x: 0 },
                { label: 'Aliquota', w: 18, x: 0 },
                { label: 'ISS', w: 20, x: 0 },
                { label: 'Retido', w: 16, x: 0 },
            ];
            // calculate x positions
            for (let i = 1; i < cols.length; i++) {
                cols[i].x = cols[i - 1].x + cols[i - 1].w + 1;
            }

            // Header row
            pdf.setFillColor(30, 58, 95);
            pdf.rect(margin, y - 4, contentW, 8, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(7);
            pdf.setTextColor(255, 255, 255);
            cols.forEach((c) => pdf.text(c.label, c.x, y));
            y += 7;

            // Data rows
            sortedNfes.forEach((nfe, idx) => {
                checkPage(8);
                if (idx % 2 === 0) {
                    pdf.setFillColor(248, 250, 252);
                    pdf.rect(margin, y - 3.5, contentW, 6, 'F');
                }
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(7);
                pdf.setTextColor(50, 50, 50);

                const contraparte =
                    tipo === 'recebidas'
                        ? nfe.razaoSocialPrestador || fmtCnpj(nfe.cnpjPrestador)
                        : nfe.razaoSocialTomador || fmtCnpj(nfe.cnpjTomador);
                const discr = (nfe.discriminacao || '').slice(0, 80) + ((nfe.discriminacao || '').length > 80 ? '...' : '');

                pdf.text(nfe.numero || '-', cols[0].x, y, { maxWidth: cols[0].w });
                pdf.text(fmtData(nfe.dhEmi), cols[1].x, y, { maxWidth: cols[1].w });
                pdf.text(contraparte.slice(0, 40), cols[2].x, y, { maxWidth: cols[2].w });
                pdf.text(discr, cols[3].x, y, { maxWidth: cols[3].w });
                pdf.text(fmtMoeda(nfe.valorServicos), cols[4].x, y, { maxWidth: cols[4].w });
                pdf.text(fmtPct(nfe.aliquotaServicos), cols[5].x, y, { maxWidth: cols[5].w });
                pdf.text(fmtMoeda(nfe.valorIss), cols[6].x, y, { maxWidth: cols[6].w });
                pdf.text(nfe.issRetido ? 'Sim' : 'Nao', cols[7].x, y, { maxWidth: cols[7].w });

                y += 6;
            });

            addFooter();

            const cnpjClean = empresaObj.cnpj.replace(/\D/g, '');
            pdf.save(`nfse-sp-${cnpjClean}-${String(mes).padStart(2, '0')}-${ano}.pdf`);
            onShowToast?.('PDF exportado com sucesso');
        } catch (e: any) {
            console.error('Erro ao gerar PDF:', e);
            onShowToast?.('Erro ao gerar PDF: ' + (e.message || ''));
        } finally {
            setExportingPdf(false);
        }
    }, [sortedNfes, empresaObj, mes, ano, tipo, summary, onShowToast]);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4">
            {/* Header */}
            <div
                style={{
                    background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
                    padding: '1.25rem',
                    borderRadius: '0.75rem',
                    color: '#fff',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                        style={{
                            background: 'rgba(255,255,255,0.2)',
                            padding: '0.625rem',
                            borderRadius: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <svg
                            className="w-6 h-6"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                            />
                        </svg>
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
                            NFS-e Sao Paulo Capital
                        </h2>
                        <p style={{ fontSize: '0.8rem', opacity: 0.85, margin: '0.125rem 0 0' }}>
                            Consulta de Notas Fiscais de Servico via Prefeitura de SP
                        </p>
                    </div>
                    <span
                        style={{
                            marginLeft: 'auto',
                            background: 'rgba(255,255,255,0.15)',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                        }}
                    >
                        nfews.prefeitura.sp.gov.br
                    </span>
                </div>
            </div>

            {/* Form */}
            <div
                style={{
                    background: 'var(--bg-card, #fff)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '0.75rem',
                    padding: '1.25rem',
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '1rem',
                        alignItems: 'end',
                    }}
                >
                    {/* Empresa */}
                    <div style={{ gridColumn: 'span 2' }}>
                        <label
                            style={{
                                display: 'block',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary, #64748b)',
                                marginBottom: '0.25rem',
                            }}
                        >
                            Empresa
                        </label>
                        {loadingEmpresas ? (
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)' }}>
                                Carregando empresas...
                            </p>
                        ) : (
                            <select
                                value={empresaSel}
                                onChange={(e) => {
                                    setEmpresaSel(e.target.value);
                                    setResultado(null);
                                    setErro('');
                                }}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    fontSize: '0.8rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid var(--border, #e2e8f0)',
                                    background: 'var(--bg-input, #fff)',
                                    color: 'var(--text-primary, #1e293b)',
                                }}
                            >
                                <option value="">Selecione a empresa...</option>
                                {empresas.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.nome} — {fmtCnpj(e.cnpj)}
                                    </option>
                                ))}
                            </select>
                        )}
                        {empresaObj && (
                            <div
                                style={{
                                    marginTop: '0.375rem',
                                    fontSize: '0.7rem',
                                    color: 'var(--text-muted, #94a3b8)',
                                    display: 'flex',
                                    gap: '1rem',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span>CNPJ: {fmtCnpj(empresaObj.cnpj)}</span>
                                <span>
                                    CCM SP:{' '}
                                    {empresaObj.ccmSp || (
                                        <span style={{ color: '#ef4444', fontWeight: 600 }}>
                                            nao cadastrado
                                        </span>
                                    )}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Tipo */}
                    <div>
                        <label
                            style={{
                                display: 'block',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary, #64748b)',
                                marginBottom: '0.25rem',
                            }}
                        >
                            Tipo
                        </label>
                        <select
                            value={tipo}
                            onChange={(e) => setTipo(e.target.value as 'recebidas' | 'emitidas')}
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                fontSize: '0.8rem',
                                borderRadius: '0.5rem',
                                border: '1px solid var(--border, #e2e8f0)',
                                background: 'var(--bg-input, #fff)',
                                color: 'var(--text-primary, #1e293b)',
                            }}
                        >
                            <option value="recebidas">Recebidas (Servicos Tomados)</option>
                            <option value="emitidas">Emitidas (Servicos Prestados)</option>
                        </select>
                    </div>

                    {/* Mes */}
                    <div>
                        <label
                            style={{
                                display: 'block',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary, #64748b)',
                                marginBottom: '0.25rem',
                            }}
                        >
                            Mes
                        </label>
                        <select
                            value={mes}
                            onChange={(e) => setMes(Number(e.target.value))}
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                fontSize: '0.8rem',
                                borderRadius: '0.5rem',
                                border: '1px solid var(--border, #e2e8f0)',
                                background: 'var(--bg-input, #fff)',
                                color: 'var(--text-primary, #1e293b)',
                            }}
                        >
                            {MESES.map((m) => (
                                <option key={m.v} value={m.v}>
                                    {m.l}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Ano */}
                    <div>
                        <label
                            style={{
                                display: 'block',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary, #64748b)',
                                marginBottom: '0.25rem',
                            }}
                        >
                            Ano
                        </label>
                        <input
                            type="number"
                            min={2000}
                            max={2100}
                            value={ano}
                            onChange={(e) => setAno(Number(e.target.value))}
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                fontSize: '0.8rem',
                                borderRadius: '0.5rem',
                                border: '1px solid var(--border, #e2e8f0)',
                                background: 'var(--bg-input, #fff)',
                                color: 'var(--text-primary, #1e293b)',
                            }}
                        />
                    </div>

                    {/* Botao Consultar */}
                    <div>
                        <button
                            onClick={handleConsultar}
                            disabled={loading || !empresaSel}
                            style={{
                                width: '100%',
                                padding: '0.5rem 1rem',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                borderRadius: '0.5rem',
                                border: 'none',
                                background: loading
                                    ? '#94a3b8'
                                    : 'var(--accent, #2563eb)',
                                color: '#fff',
                                cursor: loading || !empresaSel ? 'not-allowed' : 'pointer',
                                opacity: !empresaSel ? 0.5 : 1,
                                transition: 'background 0.2s',
                            }}
                        >
                            {loading ? 'Consultando...' : 'Consultar'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Error */}
            {erro && (
                <div
                    style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '0.75rem',
                        padding: '1rem',
                    }}
                >
                    <p style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600, margin: '0 0 0.25rem' }}>
                        Erro na consulta
                    </p>
                    <p
                        style={{
                            fontSize: '0.75rem',
                            color: '#b91c1c',
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                        }}
                    >
                        {erro}
                    </p>
                </div>
            )}

            {/* Results */}
            {resultado && resultado.sucesso && (
                <>
                    {/* Summary Cards */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            gap: '0.75rem',
                        }}
                    >
                        {[
                            { label: 'Total NFS-e', value: String(summary.total), color: '#2563eb' },
                            { label: 'Valor Total', value: fmtMoeda(summary.valorTotal), color: '#059669' },
                            { label: 'ISS Total', value: fmtMoeda(summary.issTotal), color: '#d97706' },
                            {
                                label: 'ISS Retido Total',
                                value: fmtMoeda(summary.issRetidoTotal),
                                color: '#dc2626',
                            },
                        ].map((c) => (
                            <div
                                key={c.label}
                                style={{
                                    background: 'var(--bg-card, #fff)',
                                    border: '1px solid var(--border, #e2e8f0)',
                                    borderRadius: '0.75rem',
                                    padding: '1rem',
                                    borderLeft: `4px solid ${c.color}`,
                                }}
                            >
                                <p
                                    style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        color: 'var(--text-muted, #94a3b8)',
                                        margin: '0 0 0.25rem',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                    }}
                                >
                                    {c.label}
                                </p>
                                <p
                                    style={{
                                        fontSize: '1.125rem',
                                        fontWeight: 700,
                                        color: c.color,
                                        margin: 0,
                                    }}
                                >
                                    {c.value}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Export Buttons + Table */}
                    {sortedNfes.length > 0 ? (
                        <>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={exportarPdf}
                                    disabled={exportingPdf}
                                    style={{
                                        padding: '0.4rem 1rem',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        borderRadius: '0.5rem',
                                        border: 'none',
                                        background: exportingPdf ? '#94a3b8' : '#991b1b',
                                        color: '#fff',
                                        cursor: exportingPdf ? 'wait' : 'pointer',
                                    }}
                                >
                                    {exportingPdf ? 'Gerando...' : 'Exportar PDF'}
                                </button>
                                <button
                                    onClick={exportarCsv}
                                    style={{
                                        padding: '0.4rem 1rem',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        borderRadius: '0.5rem',
                                        border: 'none',
                                        background: '#166534',
                                        color: '#fff',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Exportar CSV
                                </button>
                            </div>

                            {/* Table */}
                            <div
                                style={{
                                    background: 'var(--bg-card, #fff)',
                                    border: '1px solid var(--border, #e2e8f0)',
                                    borderRadius: '0.75rem',
                                    overflow: 'hidden',
                                }}
                            >
                                <div style={{ overflowX: 'auto' }}>
                                    <table
                                        style={{
                                            width: '100%',
                                            borderCollapse: 'collapse',
                                            fontSize: '0.75rem',
                                        }}
                                    >
                                        <thead>
                                            <tr
                                                style={{
                                                    background: '#1e3a5f',
                                                    color: '#fff',
                                                }}
                                            >
                                                {(
                                                    [
                                                        ['numero', 'Numero'],
                                                        ['dhEmi', 'Data Emissao'],
                                                        [
                                                            'contraparte',
                                                            tipo === 'recebidas'
                                                                ? 'Prestador'
                                                                : 'Tomador',
                                                        ],
                                                        [null, 'Discriminacao'],
                                                        ['valorServicos', 'Valor Servico'],
                                                        ['aliquotaServicos', 'Aliquota'],
                                                        ['valorIss', 'ISS'],
                                                        ['issRetido', 'Retido'],
                                                    ] as [SortKey | null, string][]
                                                ).map(([key, label]) => (
                                                    <th
                                                        key={label}
                                                        onClick={key ? () => handleSort(key) : undefined}
                                                        style={{
                                                            padding: '0.5rem 0.625rem',
                                                            textAlign: 'left',
                                                            fontWeight: 600,
                                                            fontSize: '0.7rem',
                                                            cursor: key ? 'pointer' : 'default',
                                                            whiteSpace: 'nowrap',
                                                            userSelect: 'none',
                                                        }}
                                                    >
                                                        {label}
                                                        {key && <SortIcon col={key} />}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedNfes.map((nfe, idx) => {
                                                const rowKey = nfe.chave || `${nfe.numero}-${idx}`;
                                                const isExpanded = expandedRow === rowKey;
                                                const contraparte =
                                                    tipo === 'recebidas'
                                                        ? {
                                                              cnpj: nfe.cnpjPrestador,
                                                              nome: nfe.razaoSocialPrestador,
                                                          }
                                                        : {
                                                              cnpj: nfe.cnpjTomador,
                                                              nome: nfe.razaoSocialTomador,
                                                          };

                                                return (
                                                    <React.Fragment key={rowKey}>
                                                        <tr
                                                            onClick={() =>
                                                                setExpandedRow(
                                                                    isExpanded ? null : rowKey
                                                                )
                                                            }
                                                            style={{
                                                                background:
                                                                    idx % 2 === 0
                                                                        ? 'var(--bg-card, #fff)'
                                                                        : 'var(--bg-row-alt, #f8fafc)',
                                                                cursor: 'pointer',
                                                                borderBottom:
                                                                    '1px solid var(--border, #e2e8f0)',
                                                                transition: 'background 0.15s',
                                                            }}
                                                            onMouseEnter={(e) =>
                                                                (e.currentTarget.style.background =
                                                                    'var(--bg-hover, #eff6ff)')
                                                            }
                                                            onMouseLeave={(e) =>
                                                                (e.currentTarget.style.background =
                                                                    idx % 2 === 0
                                                                        ? 'var(--bg-card, #fff)'
                                                                        : 'var(--bg-row-alt, #f8fafc)')
                                                            }
                                                        >
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    fontWeight: 600,
                                                                    whiteSpace: 'nowrap',
                                                                }}
                                                            >
                                                                {nfe.numero || '-'}
                                                                {nfe.cancelado && (
                                                                    <span
                                                                        style={{
                                                                            marginLeft: '0.25rem',
                                                                            fontSize: '0.6rem',
                                                                            color: '#dc2626',
                                                                            fontWeight: 700,
                                                                        }}
                                                                    >
                                                                        CANCELADA
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    whiteSpace: 'nowrap',
                                                                }}
                                                            >
                                                                {fmtData(nfe.dhEmi)}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    maxWidth: '200px',
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        fontWeight: 600,
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                    title={contraparte.nome}
                                                                >
                                                                    {contraparte.nome || '-'}
                                                                </div>
                                                                <div
                                                                    style={{
                                                                        fontSize: '0.65rem',
                                                                        color: 'var(--text-muted, #94a3b8)',
                                                                    }}
                                                                >
                                                                    {fmtCnpj(contraparte.cnpj)}
                                                                </div>
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    maxWidth: '220px',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap',
                                                                }}
                                                                title={nfe.discriminacao}
                                                            >
                                                                {(nfe.discriminacao || '-').slice(0, 60)}
                                                                {(nfe.discriminacao || '').length > 60
                                                                    ? '...'
                                                                    : ''}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    fontWeight: 600,
                                                                    whiteSpace: 'nowrap',
                                                                    textAlign: 'right',
                                                                }}
                                                            >
                                                                {fmtMoeda(nfe.valorServicos)}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    whiteSpace: 'nowrap',
                                                                    textAlign: 'right',
                                                                }}
                                                            >
                                                                {fmtPct(nfe.aliquotaServicos)}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    whiteSpace: 'nowrap',
                                                                    textAlign: 'right',
                                                                }}
                                                            >
                                                                {fmtMoeda(nfe.valorIss)}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    padding: '0.5rem 0.625rem',
                                                                    whiteSpace: 'nowrap',
                                                                }}
                                                            >
                                                                {nfe.issRetido ? (
                                                                    <span
                                                                        style={{
                                                                            background: '#fef2f2',
                                                                            color: '#dc2626',
                                                                            padding: '0.125rem 0.5rem',
                                                                            borderRadius: '999px',
                                                                            fontSize: '0.65rem',
                                                                            fontWeight: 700,
                                                                        }}
                                                                    >
                                                                        Sim
                                                                    </span>
                                                                ) : (
                                                                    <span
                                                                        style={{
                                                                            color: 'var(--text-muted, #94a3b8)',
                                                                            fontSize: '0.65rem',
                                                                        }}
                                                                    >
                                                                        Nao
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>

                                                        {/* Expanded row */}
                                                        {isExpanded && (
                                                            <tr>
                                                                <td
                                                                    colSpan={8}
                                                                    style={{
                                                                        padding: '0.75rem 1rem',
                                                                        background:
                                                                            'var(--bg-hover, #eff6ff)',
                                                                        borderBottom:
                                                                            '1px solid var(--border, #e2e8f0)',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            display: 'grid',
                                                                            gridTemplateColumns:
                                                                                'repeat(auto-fit, minmax(180px, 1fr))',
                                                                            gap: '0.5rem',
                                                                            fontSize: '0.72rem',
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            <strong>Cod. Verificacao:</strong>{' '}
                                                                            {nfe.codigoVerificacao || '-'}
                                                                        </div>
                                                                        <div>
                                                                            <strong>Cod. Servico:</strong>{' '}
                                                                            {nfe.codigoServico || '-'}
                                                                        </div>
                                                                        <div>
                                                                            <strong>Municipio Prestacao:</strong>{' '}
                                                                            {nfe.municipioPrestacao || '-'}
                                                                        </div>
                                                                        <div>
                                                                            <strong>PIS:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorPis)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>COFINS:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorCofins)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>INSS:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorInss)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>IR:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorIr)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>CSLL:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorCsll)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>Deducoes:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorDeducoes)}
                                                                        </div>
                                                                        <div>
                                                                            <strong>Credito:</strong>{' '}
                                                                            {fmtMoeda(nfe.valorCredito)}
                                                                        </div>
                                                                    </div>
                                                                    {nfe.discriminacao && (
                                                                        <div
                                                                            style={{
                                                                                marginTop: '0.5rem',
                                                                                padding: '0.5rem',
                                                                                background:
                                                                                    'var(--bg-card, #fff)',
                                                                                borderRadius: '0.375rem',
                                                                                fontSize: '0.72rem',
                                                                                whiteSpace: 'pre-wrap',
                                                                                lineHeight: 1.5,
                                                                                border: '1px solid var(--border, #e2e8f0)',
                                                                            }}
                                                                        >
                                                                            <strong>Discriminacao completa:</strong>
                                                                            <br />
                                                                            {nfe.discriminacao}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div
                            style={{
                                background: 'var(--bg-card, #fff)',
                                border: '1px solid var(--border, #e2e8f0)',
                                borderRadius: '0.75rem',
                                padding: '2rem',
                                textAlign: 'center',
                            }}
                        >
                            <p
                                style={{
                                    fontSize: '0.85rem',
                                    color: 'var(--text-muted, #94a3b8)',
                                    fontWeight: 600,
                                }}
                            >
                                Nenhuma NFS-e encontrada no periodo{' '}
                                {String(mes).padStart(2, '0')}/{ano}
                            </p>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)' }}>
                                Verifique se o periodo esta correto e se a empresa possui NFS-e{' '}
                                {tipo === 'recebidas' ? 'recebidas' : 'emitidas'} neste mes.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default XmlNfseSp;
