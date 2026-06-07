import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    analisar,
    analisarArquivos,
    exportarAnalise,
    type SageAnalise,
    type SageNota,
    type DocSentido,
    type DocStatus,
} from '../services/sageReportService';

interface AnaliseRelatorioSAGEProps {
    onShowToast?: (msg: string) => void;
}

type AbaResultado = 'resumo' | 'gaps' | 'canceladas' | 'denegadas' | 'inutilizadas' | 'desconhecidas' | 'todas';

const STATUS_LABEL: Record<DocStatus, string> = {
    regular: 'Regular',
    cancelada: 'Cancelada',
    denegada: 'Denegada/Recusada',
    inutilizada: 'Inutilizada',
    desconhecido: 'Desconhecido',
};

const SENTIDO_LABEL: Record<DocSentido, string> = {
    entrada: 'Entrada',
    saida: 'Saída',
    desconhecido: '?',
};

const formatBRL = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const AnaliseRelatorioSAGE: React.FC<AnaliseRelatorioSAGEProps> = ({ onShowToast }) => {
    const [notasBrutas, setNotasBrutas] = useState<SageNota[] | null>(null);
    const [analise, setAnalise] = useState<SageAnalise | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [aba, setAba] = useState<AbaResultado>('resumo');
    const [filtroSentido, setFiltroSentido] = useState<'todos' | DocSentido>('todos');
    const [busca, setBusca] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [maxGapEntrada, setMaxGapEntrada] = useState<number>(3);
    const [maxGapSaida, setMaxGapSaida] = useState<number>(50);
    const [semLimite, setSemLimite] = useState<boolean>(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Re-roda a analise (sem re-parsear arquivos) quando o usuario muda thresholds.
    useEffect(() => {
        if (!notasBrutas) return;
        setAnalise(analisar(notasBrutas, { maxGapEntrada, maxGapSaida, semLimite }));
    }, [notasBrutas, maxGapEntrada, maxGapSaida, semLimite]);

    const processFiles = useCallback(
        async (files: FileList | File[]) => {
            setError(null);
            setLoading(true);
            try {
                const arr = Array.from(files);
                const ok = arr.filter((f) => /\.(xlsx|xls|xml)$/i.test(f.name));
                if (ok.length === 0) {
                    setError('Selecione arquivos .xlsx, .xls ou .xml.');
                    return;
                }
                const result = await analisarArquivos(ok, { maxGapEntrada, maxGapSaida, semLimite });
                setAnalise(result);
                // guarda as notas brutas para permitir re-analise rapida ao mudar thresholds
                setNotasBrutas(
                    [...result.porSentido.entrada, ...result.porSentido.saida, ...result.porSentido.desconhecido]
                );
                onShowToast?.(`Análise concluída: ${result.totalNotas} nota(s) processada(s).`);
            } catch (err: any) {
                setError(err?.message || 'Falha ao processar arquivos.');
            } finally {
                setLoading(false);
            }
        },
        [onShowToast, maxGapEntrada, maxGapSaida, semLimite]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
        },
        [processFiles]
    );

    const handleClear = () => {
        setAnalise(null);
        setNotasBrutas(null);
        setError(null);
        setBusca('');
        setFiltroSentido('todos');
        setAba('resumo');
    };

    const notasFiltradas = useMemo<SageNota[]>(() => {
        if (!analise) return [];
        let base: SageNota[] = [];
        switch (aba) {
            case 'canceladas':
                base = analise.porStatus.cancelada;
                break;
            case 'denegadas':
                base = analise.porStatus.denegada;
                break;
            case 'inutilizadas':
                base = analise.porStatus.inutilizada;
                break;
            case 'desconhecidas':
                base = analise.porStatus.desconhecido;
                break;
            case 'todas':
                base = [
                    ...analise.porSentido.entrada,
                    ...analise.porSentido.saida,
                    ...analise.porSentido.desconhecido,
                ];
                break;
            default:
                base = [];
        }
        if (filtroSentido !== 'todos') base = base.filter((n) => n.sentido === filtroSentido);
        if (busca.trim()) {
            const q = busca.toLowerCase();
            base = base.filter(
                (n) =>
                    (n.numeroRaw && n.numeroRaw.toLowerCase().includes(q)) ||
                    (n.razaoSocial && n.razaoSocial.toLowerCase().includes(q)) ||
                    (n.cnpj && n.cnpj.toLowerCase().includes(q)) ||
                    (n.chave && n.chave.toLowerCase().includes(q))
            );
        }
        return base.slice(0, 500); // cap visual
    }, [analise, aba, filtroSentido, busca]);

    const gapsFiltrados = useMemo(() => {
        if (!analise) return [];
        let g = analise.gaps;
        if (filtroSentido !== 'todos') g = g.filter((x) => x.sentido === filtroSentido);
        if (busca.trim()) {
            const q = busca.toLowerCase();
            g = g.filter(
                (x) =>
                    x.razaoSocial.toLowerCase().includes(q) ||
                    x.cnpj.toLowerCase().includes(q) ||
                    String(x.de).includes(q) ||
                    String(x.ate).includes(q)
            );
        }
        return g.slice(0, 500);
    }, [analise, filtroSentido, busca]);

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div
                className="p-5 rounded-xl"
                style={{ background: 'linear-gradient(135deg,var(--accent-hover),var(--accent))', color: 'var(--text-primary)' }}
            >
                <div className="flex items-center gap-3">
                    <div className="bg-white/15 p-2.5 rounded-lg">
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
                                d="M9 17v-2a4 4 0 014-4h6m-6 0V7m0 4h6M3 7h6a4 4 0 014 4v6"
                            />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold" style={{ fontFamily: 'Cormorant Garamond,serif' }}>
                            Análise Relatório SAGE
                        </h2>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Identifica numeração faltante, notas canceladas, denegadas, inutilizadas e separa entradas/saídas a partir de XLSX SAGE ou XMLs.
                        </p>
                    </div>
                </div>
            </div>

            {/* Drop zone (sempre visível para permitir nova análise) */}
            {!analise && (
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all`}
                    style={{
                        borderColor: dragOver ? 'var(--accent)' : 'var(--text-muted)',
                        background: dragOver ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                    }}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".xlsx,.xls,.xml"
                        multiple
                        onChange={(e) => {
                            if (e.target.files?.length) processFiles(e.target.files);
                            if (inputRef.current) inputRef.current.value = '';
                        }}
                        className="hidden"
                    />
                    <svg
                        className="w-12 h-12 mx-auto mb-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        style={{ color: dragOver ? 'var(--accent)' : 'var(--text-secondary)' }}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                    </svg>
                    {loading ? (
                        <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                            Analisando arquivos...
                        </p>
                    ) : (
                        <>
                            <p className="text-sm font-bold">Arraste o relatório SAGE aqui ou clique para selecionar</p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                Aceita .xlsx, .xls e múltiplos .xml
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* Erros */}
            {error && (
                <div
                    className="p-4 rounded-lg text-sm"
                    style={{
                        background: 'var(--danger-soft)',
                        border: '1px solid var(--danger)',
                        color: 'var(--danger)',
                    }}
                >
                    {error}
                </div>
            )}

            {/* Resultado */}
            {analise && (
                <>
                    {/* Resumo cards */}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        <CardResumo titulo="Total" valor={analise.totalNotas} cor="var(--accent)" />
                        <CardResumo titulo="Regulares" valor={analise.resumo.regulares} cor="var(--success)" />
                        <CardResumo titulo="Canceladas" valor={analise.resumo.canceladas} cor="var(--danger)" onClick={() => setAba('canceladas')} />
                        <CardResumo titulo="Denegadas" valor={analise.resumo.denegadas} cor="var(--warning)" onClick={() => setAba('denegadas')} />
                        <CardResumo titulo="Inutilizadas" valor={analise.resumo.inutilizadas} cor="#8E5BFF" onClick={() => setAba('inutilizadas')} />
                        <CardResumo
                            titulo="Notas faltantes"
                            valor={analise.resumo.notasFaltantes}
                            sub={`${analise.resumo.gapsTotal} faixa(s)`}
                            cor="#FF8A4C"
                            onClick={() => setAba('gaps')}
                        />
                    </div>

                    {/* Resumo Entrada/Saída */}
                    <div className="grid grid-cols-3 gap-3">
                        <CardResumo titulo="Entradas" valor={analise.porSentido.entrada.length} cor="var(--accent)" />
                        <CardResumo titulo="Saídas" valor={analise.porSentido.saida.length} cor="var(--accent)" />
                        <CardResumo titulo="Sem identif. E/S" valor={analise.porSentido.desconhecido.length} cor="#888EAA" onClick={() => setAba('desconhecidas')} />
                    </div>

                    {analise.tabsLidas.length > 0 && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Origem: {analise.tabsLidas.map((t) => `"${t}"`).join(', ')}
                        </div>
                    )}

                    {/* Configuração de detecção de gaps */}
                    <div
                        className="p-4 rounded-lg space-y-3 text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <div style={{ color: 'var(--text-secondary)' }}>
                            <b style={{ color: 'var(--text-primary)' }}>Como o sistema decide o que é "nota faltante":</b> uma nota
                            só é considerada faltante se o número estiver ausente <i>entre</i> notas presentes no relatório,
                            e o tamanho do salto for pequeno o suficiente para parecer real (caso contrário é só uma
                            nota fora do recorte do relatório, não algo perdido).
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                            <label className="flex flex-col gap-1">
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    Salto máx. em <b>ENTRADAS</b> (notas de fornecedores)
                                </span>
                                <input
                                    type="number"
                                    min={1}
                                    max={10000}
                                    value={maxGapEntrada}
                                    disabled={semLimite}
                                    onChange={(e) => setMaxGapEntrada(Math.max(1, parseInt(e.target.value || '3', 10)))}
                                    className="w-full px-2 py-1.5 rounded"
                                    style={{
                                        background: 'var(--bg-card)',
                                        border: '1px solid var(--border-default)',
                                        color: semLimite ? 'var(--text-muted)' : 'var(--text-primary)',
                                    }}
                                />
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                    Recomendado: 3. Fornecedores numeram para vários clientes — saltos grandes não são
                                    seus.
                                </span>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    Salto máx. em <b>SAÍDAS</b> (suas notas)
                                </span>
                                <input
                                    type="number"
                                    min={1}
                                    max={10000}
                                    value={maxGapSaida}
                                    disabled={semLimite}
                                    onChange={(e) => setMaxGapSaida(Math.max(1, parseInt(e.target.value || '50', 10)))}
                                    className="w-full px-2 py-1.5 rounded"
                                    style={{
                                        background: 'var(--bg-card)',
                                        border: '1px solid var(--border-default)',
                                        color: semLimite ? 'var(--text-muted)' : 'var(--text-primary)',
                                    }}
                                />
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                    Recomendado: 50. Saltos maiores costumam indicar relatório parcial/multi-série.
                                </span>
                            </label>
                            <label
                                className="flex items-start gap-2 cursor-pointer p-2 rounded"
                                style={{
                                    color: 'var(--text-secondary)',
                                    background: semLimite ? 'rgba(255,138,76,0.08)' : 'transparent',
                                    border: semLimite ? '1px solid rgba(255,138,76,0.3)' : '1px solid transparent',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={semLimite}
                                    onChange={(e) => setSemLimite(e.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Ignorar limites</span>
                                    <br />
                                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                        Reporta todo e qualquer pulo na numeração. Útil só pra investigação detalhada —
                                        produz números muito altos com relatórios parciais.
                                    </span>
                                </span>
                            </label>
                        </div>
                    </div>

                    {/* Botões de exportação:
                        - PDF Big4 → relatório FINAL pro cliente (não-manipulável).
                        - XLSX bruto → trabalho interno do colaborador. */}
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => exportarAnalise(analise)}
                            className="px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                            style={{
                                background: 'var(--bg-elevated)',
                                border: '1px solid var(--border-default)',
                                color: 'var(--text-secondary)',
                            }}
                            title="Planilha XLSX bruta pra trabalho interno (manipulável). NÃO entregar ao cliente."
                        >
                            ⬇ XLSX bruto (interno)
                        </button>
                        <button
                            onClick={async () => {
                                const { gerarPdfAnaliseSage } = await import('../services/sageReportPdf');
                                const blob = await gerarPdfAnaliseSage({ analise });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `analise-sage-${new Date().toISOString().slice(0, 10)}.pdf`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                            className="px-4 py-2 rounded-lg text-xs font-bold transition-colors text-white"
                            style={{ background: '#0F172A' }}
                            title="Relatório final padrão Big4 pro cliente (não-manipulável)."
                        >
                            ⬇ Relatório PDF (cliente)
                        </button>
                    </div>

                    {analise.avisos.length > 0 && (
                        <div
                            className="p-3 rounded-lg text-xs"
                            style={{
                                background: 'var(--warning-soft)',
                                border: '1px solid var(--warning-soft-border)',
                                color: 'var(--warning)',
                            }}
                        >
                            {analise.avisos.map((a, i) => (
                                <div key={i}>⚠️ {a}</div>
                            ))}
                        </div>
                    )}

                    {/* Abas */}
                    <div className="flex gap-2 flex-wrap">
                        <BotaoAba ativo={aba === 'resumo'} onClick={() => setAba('resumo')}>
                            Resumo
                        </BotaoAba>
                        <BotaoAba ativo={aba === 'gaps'} onClick={() => setAba('gaps')}>
                            Gaps de numeração ({analise.resumo.gapsTotal})
                        </BotaoAba>
                        <BotaoAba ativo={aba === 'canceladas'} onClick={() => setAba('canceladas')}>
                            Canceladas ({analise.resumo.canceladas})
                        </BotaoAba>
                        <BotaoAba ativo={aba === 'denegadas'} onClick={() => setAba('denegadas')}>
                            Denegadas ({analise.resumo.denegadas})
                        </BotaoAba>
                        <BotaoAba ativo={aba === 'inutilizadas'} onClick={() => setAba('inutilizadas')}>
                            Inutilizadas ({analise.resumo.inutilizadas})
                        </BotaoAba>
                        <BotaoAba ativo={aba === 'todas'} onClick={() => setAba('todas')}>
                            Todas ({analise.totalNotas})
                        </BotaoAba>
                    </div>

                    {/* Filtros */}
                    {aba !== 'resumo' && (
                        <div className="flex flex-col md:flex-row gap-2">
                            <input
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder="Buscar (nº NF, CNPJ, razão social, chave)"
                                className="flex-grow p-2.5 rounded-lg text-sm"
                                style={{
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border-default)',
                                    color: 'var(--text-primary)',
                                }}
                            />
                            <select
                                value={filtroSentido}
                                onChange={(e) => setFiltroSentido(e.target.value as any)}
                                className="p-2.5 rounded-lg text-sm"
                                style={{
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border-default)',
                                    color: 'var(--text-primary)',
                                }}
                            >
                                <option value="todos">Entrada e Saída</option>
                                <option value="entrada">Só Entradas</option>
                                <option value="saida">Só Saídas</option>
                                <option value="desconhecido">Sem identificação</option>
                            </select>
                            <button
                                onClick={handleClear}
                                className="px-4 py-2.5 rounded-lg text-sm font-medium"
                                style={{
                                    background: 'var(--danger-soft)',
                                    border: '1px solid var(--danger)',
                                    color: 'var(--danger)',
                                }}
                            >
                                Nova análise
                            </button>
                        </div>
                    )}

                    {/* Conteúdo da aba */}
                    {aba === 'resumo' && (
                        <div
                            className="p-5 rounded-xl text-sm"
                            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                        >
                            <p className="mb-2">
                                Foram processadas <b style={{ color: 'var(--text-primary)' }}>{analise.totalNotas}</b> notas no total.
                            </p>
                            <ul className="space-y-1 list-disc list-inside">
                                <li>
                                    Entradas: <b style={{ color: 'var(--text-primary)' }}>{analise.porSentido.entrada.length}</b> · Saídas:{' '}
                                    <b style={{ color: 'var(--text-primary)' }}>{analise.porSentido.saida.length}</b>
                                </li>
                                <li>
                                    Status — Regulares: {analise.resumo.regulares}, Canceladas:{' '}
                                    <span style={{ color: 'var(--danger)' }}>{analise.resumo.canceladas}</span>, Denegadas:{' '}
                                    <span style={{ color: 'var(--warning)' }}>{analise.resumo.denegadas}</span>, Inutilizadas:{' '}
                                    <span style={{ color: '#8E5BFF' }}>{analise.resumo.inutilizadas}</span>
                                </li>
                                <li>
                                    Numeração faltante: <b style={{ color: '#FF8A4C' }}>{analise.resumo.notasFaltantes}</b> nota(s) em{' '}
                                    {analise.resumo.gapsTotal} faixa(s).
                                </li>
                            </ul>
                            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                                Clique em qualquer card acima ou em uma das abas para ver o detalhamento.
                            </p>
                        </div>
                    )}

                    {aba === 'gaps' && (
                        <TabelaGaps gaps={gapsFiltrados} totalDetectado={analise.gaps.length} />
                    )}

                    {(aba === 'canceladas' || aba === 'denegadas' || aba === 'inutilizadas' || aba === 'desconhecidas' || aba === 'todas') && (
                        <TabelaNotas
                            notas={notasFiltradas}
                            totalDetectado={
                                aba === 'canceladas'
                                    ? analise.porStatus.cancelada.length
                                    : aba === 'denegadas'
                                    ? analise.porStatus.denegada.length
                                    : aba === 'inutilizadas'
                                    ? analise.porStatus.inutilizada.length
                                    : aba === 'desconhecidas'
                                    ? analise.porStatus.desconhecido.length
                                    : analise.totalNotas
                            }
                        />
                    )}
                </>
            )}
        </div>
    );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────────

const CardResumo: React.FC<{ titulo: string; valor: number; cor: string; sub?: string; onClick?: () => void }> = ({
    titulo,
    valor,
    cor,
    sub,
    onClick,
}) => (
    <div
        onClick={onClick}
        className={`p-3 rounded-xl ${onClick ? 'cursor-pointer hover:scale-[1.02] transition-transform' : ''}`}
        style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
        }}
    >
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {titulo}
        </div>
        <div className="text-2xl font-bold mt-1" style={{ color: cor }}>
            {valor.toLocaleString('pt-BR')}
        </div>
        {sub && (
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {sub}
            </div>
        )}
    </div>
);

const BotaoAba: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({
    ativo,
    onClick,
    children,
}) => (
    <button
        onClick={onClick}
        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
            background: ativo ? 'var(--accent-soft-border)' : 'var(--bg-elevated)',
            border: ativo ? '1px solid var(--accent-soft-border)' : '1px solid var(--border-default)',
            color: ativo ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
    >
        {children}
    </button>
);

const TabelaGaps: React.FC<{ gaps: ReturnType<typeof Object>; totalDetectado: number }> = ({ gaps, totalDetectado }) => {
    if (!gaps || gaps.length === 0) {
        return (
            <div
                className="p-6 text-center text-sm rounded-lg"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
            >
                Nenhum gap de numeração detectado.
            </div>
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border-default)' }}>
            <table className="w-full text-xs">
                <thead style={{ background: 'var(--accent-soft)' }}>
                    <tr style={{ color: 'var(--text-secondary)' }}>
                        <Th>Sentido</Th>
                        <Th>CNPJ</Th>
                        <Th>Razão Social</Th>
                        <Th>Série</Th>
                        <Th>Faixa faltante</Th>
                        <Th align="right">Qtd.</Th>
                    </tr>
                </thead>
                <tbody>
                    {(gaps as any[]).map((g, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                            <Td>{SENTIDO_LABEL[g.sentido as DocSentido]}</Td>
                            <Td>{g.cnpj || '-'}</Td>
                            <Td>{g.razaoSocial || '-'}</Td>
                            <Td>{g.serie || '0'}</Td>
                            <Td>
                                <span style={{ color: '#FF8A4C', fontWeight: 600 }}>
                                    {g.de}
                                    {g.ate !== g.de ? ` → ${g.ate}` : ''}
                                </span>
                            </Td>
                            <Td align="right">
                                <span style={{ color: '#FF8A4C', fontWeight: 700 }}>{g.quantidade}</span>
                            </Td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {gaps.length < totalDetectado && (
                <div className="p-2 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Mostrando {gaps.length} de {totalDetectado}. Use a busca/filtro para refinar.
                </div>
            )}
        </div>
    );
};

const TabelaNotas: React.FC<{ notas: SageNota[]; totalDetectado: number }> = ({ notas, totalDetectado }) => {
    if (notas.length === 0) {
        return (
            <div
                className="p-6 text-center text-sm rounded-lg"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
            >
                Nenhuma nota nesta categoria.
            </div>
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border-default)' }}>
            <table className="w-full text-xs">
                <thead style={{ background: 'var(--accent-soft)' }}>
                    <tr style={{ color: 'var(--text-secondary)' }}>
                        <Th>E/S</Th>
                        <Th>Status</Th>
                        <Th>Nº NF</Th>
                        <Th>Série</Th>
                        <Th>Emissão</Th>
                        <Th>CNPJ</Th>
                        <Th>Razão Social</Th>
                        <Th>UF</Th>
                        <Th>CFOP</Th>
                        <Th align="right">Valor</Th>
                    </tr>
                </thead>
                <tbody>
                    {notas.map((n, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                            <Td>{SENTIDO_LABEL[n.sentido]}</Td>
                            <Td>
                                <span style={{ color: corStatus(n.status), fontWeight: 600 }}>{STATUS_LABEL[n.status]}</span>
                            </Td>
                            <Td>{n.numeroRaw || '-'}</Td>
                            <Td>{n.serie || '-'}</Td>
                            <Td>{n.dataEmissao || '-'}</Td>
                            <Td>{n.cnpj || '-'}</Td>
                            <Td>{n.razaoSocial || '-'}</Td>
                            <Td>{n.uf || '-'}</Td>
                            <Td>{n.cfop || '-'}</Td>
                            <Td align="right">{formatBRL(n.valor)}</Td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {notas.length < totalDetectado && (
                <div className="p-2 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Mostrando {notas.length} de {totalDetectado}. Use a busca/filtro para refinar.
                </div>
            )}
        </div>
    );
};

const Th: React.FC<{ children: React.ReactNode; align?: 'left' | 'right' }> = ({ children, align = 'left' }) => (
    <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold" style={{ textAlign: align }}>
        {children}
    </th>
);

const Td: React.FC<{ children: React.ReactNode; align?: 'left' | 'right' }> = ({ children, align = 'left' }) => (
    <td className="px-3 py-2 whitespace-nowrap" style={{ textAlign: align }}>
        {children}
    </td>
);

function corStatus(s: DocStatus): string {
    switch (s) {
        case 'cancelada':
            return 'var(--danger)';
        case 'denegada':
            return 'var(--warning)';
        case 'inutilizada':
            return '#8E5BFF';
        case 'regular':
            return 'var(--success)';
        default:
            return 'var(--text-muted)';
    }
}

export default AnaliseRelatorioSAGE;
