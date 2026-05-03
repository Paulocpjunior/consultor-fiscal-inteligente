import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analisar, analisarArquivos, type SageAnalise, type SageNota, type DocSentido, type DocStatus } from '../services/sageReportService';

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
    const [maxGapEntrada, setMaxGapEntrada] = useState<number>(20);
    const [incluirGapsGrandes, setIncluirGapsGrandes] = useState<boolean>(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Re-roda a analise (sem re-parsear arquivos) quando o usuario muda thresholds.
    useEffect(() => {
        if (!notasBrutas) return;
        setAnalise(analisar(notasBrutas, { maxGapEntrada, incluirGapsGrandesEntrada: incluirGapsGrandes }));
    }, [notasBrutas, maxGapEntrada, incluirGapsGrandes]);

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
                const result = await analisarArquivos(ok, { maxGapEntrada, incluirGapsGrandesEntrada: incluirGapsGrandes });
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
        [onShowToast, maxGapEntrada, incluirGapsGrandes]
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
                style={{ background: 'linear-gradient(135deg,#08007A,#1400FF)', color: '#F5F6FF' }}
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
                        <p className="text-sm" style={{ color: 'rgba(200,208,255,0.7)' }}>
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
                        borderColor: dragOver ? '#5B7FFF' : 'rgba(200,208,255,0.25)',
                        background: dragOver ? 'rgba(20,0,255,0.08)' : 'rgba(8,0,122,0.04)',
                        color: '#F5F6FF',
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
                        style={{ color: dragOver ? '#5B7FFF' : 'rgba(200,208,255,0.6)' }}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                    </svg>
                    {loading ? (
                        <p className="text-sm font-bold" style={{ color: '#5B7FFF' }}>
                            Analisando arquivos...
                        </p>
                    ) : (
                        <>
                            <p className="text-sm font-bold">Arraste o relatório SAGE aqui ou clique para selecionar</p>
                            <p className="text-xs mt-1" style={{ color: 'rgba(200,208,255,0.5)' }}>
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
                        background: 'rgba(255,68,102,0.08)',
                        border: '1px solid rgba(255,68,102,0.2)',
                        color: '#FF4466',
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
                        <CardResumo titulo="Total" valor={analise.totalNotas} cor="#5B7FFF" />
                        <CardResumo titulo="Regulares" valor={analise.resumo.regulares} cor="#00C896" />
                        <CardResumo titulo="Canceladas" valor={analise.resumo.canceladas} cor="#FF4466" onClick={() => setAba('canceladas')} />
                        <CardResumo titulo="Denegadas" valor={analise.resumo.denegadas} cor="#F5A623" onClick={() => setAba('denegadas')} />
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
                        <CardResumo titulo="Entradas" valor={analise.porSentido.entrada.length} cor="#5B7FFF" />
                        <CardResumo titulo="Saídas" valor={analise.porSentido.saida.length} cor="#1400FF" />
                        <CardResumo titulo="Sem identif. E/S" valor={analise.porSentido.desconhecido.length} cor="#888EAA" onClick={() => setAba('desconhecidas')} />
                    </div>

                    {analise.tabsLidas.length > 0 && (
                        <div className="text-xs" style={{ color: 'rgba(200,208,255,0.5)' }}>
                            Origem: {analise.tabsLidas.map((t) => `"${t}"`).join(', ')}
                        </div>
                    )}

                    {/* Configuração de detecção de gaps */}
                    <div
                        className="p-3 rounded-lg flex flex-col md:flex-row md:items-center gap-3 text-xs"
                        style={{ background: 'rgba(8,0,122,0.06)', border: '1px solid rgba(200,208,255,0.08)' }}
                    >
                        <div style={{ color: 'rgba(200,208,255,0.7)' }}>
                            <b style={{ color: '#F5F6FF' }}>Detecção de gaps em ENTRADAS:</b> só conta como "nota faltante"
                            quando o fornecedor tem ≥3 notas e o gap é pequeno (a numeração de fornecedores não é
                            sequencial entre clientes). Saídas reportam todos os gaps.
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                            <label style={{ color: 'rgba(200,208,255,0.7)' }}>Tamanho máx. de gap em entradas:</label>
                            <input
                                type="number"
                                min={1}
                                max={1000}
                                value={maxGapEntrada}
                                disabled={incluirGapsGrandes}
                                onChange={(e) => setMaxGapEntrada(Math.max(1, parseInt(e.target.value || '20', 10)))}
                                className="w-20 px-2 py-1 rounded"
                                style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(200,208,255,0.1)',
                                    color: incluirGapsGrandes ? 'rgba(200,208,255,0.3)' : '#F5F6FF',
                                }}
                            />
                            <label className="flex items-center gap-1 cursor-pointer" style={{ color: 'rgba(200,208,255,0.7)' }}>
                                <input
                                    type="checkbox"
                                    checked={incluirGapsGrandes}
                                    onChange={(e) => setIncluirGapsGrandes(e.target.checked)}
                                />
                                Reportar tudo (modo avançado)
                            </label>
                        </div>
                    </div>

                    {analise.avisos.length > 0 && (
                        <div
                            className="p-3 rounded-lg text-xs"
                            style={{
                                background: 'rgba(245,166,35,0.08)',
                                border: '1px solid rgba(245,166,35,0.25)',
                                color: '#F5A623',
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
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(200,208,255,0.1)',
                                    color: '#F5F6FF',
                                }}
                            />
                            <select
                                value={filtroSentido}
                                onChange={(e) => setFiltroSentido(e.target.value as any)}
                                className="p-2.5 rounded-lg text-sm"
                                style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(200,208,255,0.1)',
                                    color: '#F5F6FF',
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
                                    background: 'rgba(255,68,102,0.12)',
                                    border: '1px solid rgba(255,68,102,0.3)',
                                    color: '#FF4466',
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
                            style={{ background: 'rgba(8,0,122,0.06)', color: 'rgba(200,208,255,0.85)', border: '1px solid rgba(200,208,255,0.08)' }}
                        >
                            <p className="mb-2">
                                Foram processadas <b style={{ color: '#F5F6FF' }}>{analise.totalNotas}</b> notas no total.
                            </p>
                            <ul className="space-y-1 list-disc list-inside">
                                <li>
                                    Entradas: <b style={{ color: '#F5F6FF' }}>{analise.porSentido.entrada.length}</b> · Saídas:{' '}
                                    <b style={{ color: '#F5F6FF' }}>{analise.porSentido.saida.length}</b>
                                </li>
                                <li>
                                    Status — Regulares: {analise.resumo.regulares}, Canceladas:{' '}
                                    <span style={{ color: '#FF4466' }}>{analise.resumo.canceladas}</span>, Denegadas:{' '}
                                    <span style={{ color: '#F5A623' }}>{analise.resumo.denegadas}</span>, Inutilizadas:{' '}
                                    <span style={{ color: '#8E5BFF' }}>{analise.resumo.inutilizadas}</span>
                                </li>
                                <li>
                                    Numeração faltante: <b style={{ color: '#FF8A4C' }}>{analise.resumo.notasFaltantes}</b> nota(s) em{' '}
                                    {analise.resumo.gapsTotal} faixa(s).
                                </li>
                            </ul>
                            <p className="mt-3 text-xs" style={{ color: 'rgba(200,208,255,0.5)' }}>
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
            background: 'rgba(8,0,122,0.08)',
            border: '1px solid rgba(200,208,255,0.1)',
        }}
    >
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(200,208,255,0.5)' }}>
            {titulo}
        </div>
        <div className="text-2xl font-bold mt-1" style={{ color: cor }}>
            {valor.toLocaleString('pt-BR')}
        </div>
        {sub && (
            <div className="text-[10px] mt-0.5" style={{ color: 'rgba(200,208,255,0.4)' }}>
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
            background: ativo ? 'rgba(20,0,255,0.2)' : 'rgba(8,0,122,0.06)',
            border: ativo ? '1px solid rgba(91,127,255,0.5)' : '1px solid rgba(200,208,255,0.1)',
            color: ativo ? '#F5F6FF' : 'rgba(200,208,255,0.6)',
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
                style={{ background: 'rgba(8,0,122,0.06)', color: 'rgba(200,208,255,0.5)', border: '1px solid rgba(200,208,255,0.08)' }}
            >
                Nenhum gap de numeração detectado.
            </div>
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(200,208,255,0.1)' }}>
            <table className="w-full text-xs">
                <thead style={{ background: 'rgba(8,0,122,0.18)' }}>
                    <tr style={{ color: 'rgba(200,208,255,0.6)' }}>
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
                        <tr key={i} style={{ borderTop: '1px solid rgba(200,208,255,0.06)', color: '#F5F6FF' }}>
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
                <div className="p-2 text-center text-[10px]" style={{ color: 'rgba(200,208,255,0.4)' }}>
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
                style={{ background: 'rgba(8,0,122,0.06)', color: 'rgba(200,208,255,0.5)', border: '1px solid rgba(200,208,255,0.08)' }}
            >
                Nenhuma nota nesta categoria.
            </div>
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(200,208,255,0.1)' }}>
            <table className="w-full text-xs">
                <thead style={{ background: 'rgba(8,0,122,0.18)' }}>
                    <tr style={{ color: 'rgba(200,208,255,0.6)' }}>
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
                        <tr key={i} style={{ borderTop: '1px solid rgba(200,208,255,0.06)', color: '#F5F6FF' }}>
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
                <div className="p-2 text-center text-[10px]" style={{ color: 'rgba(200,208,255,0.4)' }}>
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
            return '#FF4466';
        case 'denegada':
            return '#F5A623';
        case 'inutilizada':
            return '#8E5BFF';
        case 'regular':
            return '#00C896';
        default:
            return 'rgba(200,208,255,0.5)';
    }
}

export default AnaliseRelatorioSAGE;
