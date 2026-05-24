import React, { useState, useCallback } from 'react';
import type {
    User,
    SpedFiscalParseResult,
    SpedFiscalConferenceResult,
    SpedFiscalInconsistencia,
    SpedInconsistenciaGravidade,
    SpedDocumentoC100,
    SpedDocumentoD100,
} from '../../types';
import { parseSpedFiscalFile } from '../../services/spedFiscalParserService';
import { conferXmlContraSped, type XmlConferenciaInput } from '../../services/spedFiscalConferenceService';
import { listDocumentos } from '../../services/xmlFiscalService';
import { isFirebaseConfigured } from '../../services/firebaseConfig';
import { formatCnpjCpf, formatCurrency } from '../../services/xmlParserService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type TabId = 'painel' | 'importar' | 'documentos' | 'apuracao' | 'conferencia';

const TAB_LABELS: Record<TabId, string> = {
    painel: 'Painel',
    importar: 'Importar',
    documentos: 'Documentos',
    apuracao: 'Apuração',
    conferencia: 'Conferência',
};

const GRAVITY_COLORS: Record<SpedInconsistenciaGravidade, { bg: string; text: string; border: string }> = {
    CRITICA: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
    ALTA: { bg: 'rgba(249,115,22,0.15)', text: '#f97316', border: 'rgba(249,115,22,0.4)' },
    MEDIA: { bg: 'rgba(234,179,8,0.15)', text: '#eab308', border: 'rgba(234,179,8,0.4)' },
    BAIXA: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6', border: 'rgba(59,130,246,0.4)' },
};

const AnaliseConferencia: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [activeTab, setActiveTab] = useState<TabId>('painel');
    const [parseResult, setParseResult] = useState<SpedFiscalParseResult | null>(null);
    const [conferenceResult, setConferenceResult] = useState<SpedFiscalConferenceResult | null>(null);
    const [importing, setImporting] = useState(false);
    const [conferring, setConferring] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);

    const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.txt')) {
            setImportError('Arquivo inválido. Selecione um arquivo .txt do EFD ICMS/IPI.');
            return;
        }

        setImporting(true);
        setImportError(null);
        setConferenceResult(null);

        try {
            const result = await parseSpedFiscalFile(file, currentUser);
            setParseResult(result);
            setActiveTab('painel');
            if (onShowToast) {
                const statusMsg = result.erros.length > 0
                    ? `Importado com ${result.erros.length} erro(s)`
                    : 'Importado com sucesso';
                onShowToast(`SPED "${file.name}" — ${statusMsg}`);
            }
        } catch (err: any) {
            setImportError(err?.message || 'Erro ao processar arquivo');
        } finally {
            setImporting(false);
            e.target.value = '';
        }
    }, [currentUser, onShowToast]);

    const handleConference = useCallback(async () => {
        if (!parseResult || !currentUser) return;

        setConferring(true);
        try {
            const cnpj = parseResult.registro0000?.cnpj;
            let xmlInputs: XmlConferenciaInput[] = [];

            if (isFirebaseConfigured && cnpj) {
                const docs = await listDocumentos(currentUser, {});
                const filtered = docs.filter(d => {
                    const emitCnpj = d.emitente?.cnpjCpf?.replace(/\D/g, '') || '';
                    const destCnpj = d.destinatario?.cnpjCpf?.replace(/\D/g, '') || '';
                    return emitCnpj === cnpj || destCnpj === cnpj;
                });

                xmlInputs = filtered.map(d => ({
                    chave: d.chave?.replace(/\D/g, ''),
                    numero: d.numero,
                    valorTotal: d.totais?.vNF,
                    valorIcms: d.totais?.vICMS,
                    status: d.status,
                }));
            }

            const result = conferXmlContraSped(xmlInputs, parseResult);
            setConferenceResult(result);
            setActiveTab('conferencia');
            if (onShowToast) {
                onShowToast(`Conferência concluída — ${result.inconsistencias.length} inconsistência(s)`);
            }
        } catch (err: any) {
            if (onShowToast) onShowToast(`Erro na conferência: ${err?.message || 'Desconhecido'}`);
        } finally {
            setConferring(false);
        }
    }, [parseResult, currentUser, onShowToast]);

    const totalC100 = parseResult?.documentosC100.length || 0;
    const totalD100 = parseResult?.documentosD100.length || 0;
    const totalC170 = parseResult?.documentosC100.reduce((s, d) => s + d.itens.length, 0) || 0;
    const totalValor = parseResult?.documentosC100.reduce((s, d) => s + d.valorDocumento, 0) || 0;
    const totalIcms = parseResult?.documentosC100.reduce((s, d) => s + (d.valorIcms || 0), 0) || 0;
    const totalIpi = parseResult?.documentosC100.reduce((s, d) => s + (d.valorIpi || 0), 0) || 0;

    const allDocuments: (SpedDocumentoC100 | SpedDocumentoD100)[] = [
        ...(parseResult?.documentosC100 || []),
        ...(parseResult?.documentosD100 || []),
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Tabs */}
            <div
                className="flex gap-1 p-1 rounded-lg overflow-x-auto"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
            >
                {(Object.keys(TAB_LABELS) as TabId[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className="flex-1 min-w-[100px] py-2.5 text-xs font-bold uppercase tracking-wider rounded-md transition-colors"
                        style={{
                            background: activeTab === tab ? 'var(--accent)' : 'transparent',
                            color: activeTab === tab ? '#fff' : 'var(--text-muted)',
                        }}
                    >
                        {TAB_LABELS[tab]}
                    </button>
                ))}
            </div>

            {/* Tab: Painel */}
            {activeTab === 'painel' && (
                <div className="space-y-4">
                    {!parseResult ? (
                        <div
                            className="p-8 rounded-xl text-center"
                            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                        >
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                Nenhum arquivo SPED importado. Acesse a aba <strong>Importar</strong> para começar.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div
                                className="p-5 rounded-xl"
                                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                            >
                                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                                    Empresa
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <InfoCard label="Razão Social" value={parseResult.registro0000?.nome || '-'} />
                                    <InfoCard label="CNPJ" value={parseResult.registro0000?.cnpj ? formatCnpjCpf(parseResult.registro0000.cnpj) : '-'} />
                                    <InfoCard label="Competência" value={parseResult.arquivo.competencia || '-'} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard label="Documentos C100" value={String(totalC100)} />
                                <StatCard label="Itens C170" value={String(totalC170)} />
                                <StatCard label="Documentos D100" value={String(totalD100)} />
                                <StatCard
                                    label="Inconsistências"
                                    value={String(conferenceResult?.inconsistencias.length ?? '-')}
                                    highlight={conferenceResult != null && conferenceResult.inconsistencias.length > 0}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <StatCard label="Valor Total" value={formatCurrency(totalValor)} />
                                <StatCard label="ICMS Total" value={formatCurrency(totalIcms)} />
                                <StatCard label="IPI Total" value={formatCurrency(totalIpi)} />
                            </div>

                            {parseResult.erros.length > 0 && (
                                <div
                                    className="p-4 rounded-xl"
                                    style={{
                                        background: 'rgba(239,68,68,0.1)',
                                        border: '1px solid rgba(239,68,68,0.3)',
                                        borderLeft: '4px solid var(--danger)',
                                    }}
                                >
                                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--danger)' }}>
                                        Erros de processamento ({parseResult.erros.length})
                                    </p>
                                    <ul className="space-y-1">
                                        {parseResult.erros.slice(0, 10).map((err, i) => (
                                            <li key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{err}</li>
                                        ))}
                                        {parseResult.erros.length > 10 && (
                                            <li className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                                ... e mais {parseResult.erros.length - 10} erro(s)
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}

                            {parseResult.avisos.length > 0 && (
                                <div
                                    className="p-4 rounded-xl"
                                    style={{
                                        background: 'var(--warning-soft)',
                                        border: '1px solid var(--warning-soft-border)',
                                        borderLeft: '4px solid var(--warning)',
                                    }}
                                >
                                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--warning)' }}>
                                        Avisos ({parseResult.avisos.length})
                                    </p>
                                    <ul className="space-y-1">
                                        {parseResult.avisos.slice(0, 10).map((a, i) => (
                                            <li key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{a}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Tab: Importar */}
            {activeTab === 'importar' && (
                <div
                    className="p-6 rounded-xl"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                >
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                        Importar Arquivo EFD ICMS/IPI
                    </h3>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                        Selecione o arquivo .txt gerado pelo PVA ou exportado do sistema contábil.
                    </p>

                    <label
                        className="flex flex-col items-center justify-center p-8 rounded-xl cursor-pointer transition-colors"
                        style={{
                            background: 'var(--bg-card)',
                            border: '2px dashed var(--border-default)',
                        }}
                    >
                        <input
                            type="file"
                            accept=".txt"
                            onChange={handleFileImport}
                            disabled={importing}
                            className="hidden"
                        />
                        {importing ? (
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-5 h-5 border-2 rounded-full animate-spin"
                                    style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
                                />
                                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Processando...</span>
                            </div>
                        ) : (
                            <>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)' }}>
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                                </svg>
                                <span className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>
                                    Clique para selecionar o arquivo SPED (.txt)
                                </span>
                            </>
                        )}
                    </label>

                    {importError && (
                        <div
                            className="mt-4 p-3 rounded-lg text-xs"
                            style={{
                                background: 'rgba(239,68,68,0.1)',
                                border: '1px solid rgba(239,68,68,0.3)',
                                color: 'var(--danger)',
                            }}
                        >
                            {importError}
                        </div>
                    )}

                    {parseResult && (
                        <div
                            className="mt-4 p-3 rounded-lg text-xs"
                            style={{
                                background: 'rgba(34,197,94,0.1)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                color: 'var(--success)',
                            }}
                        >
                            Arquivo <strong>{parseResult.arquivo.nomeArquivo}</strong> importado — {parseResult.arquivo.totalRegistros} registros,{' '}
                            {totalC100} documento(s) C100, {totalD100} documento(s) D100.
                            {parseResult.erros.length > 0 && (
                                <span style={{ color: 'var(--danger)' }}> ({parseResult.erros.length} erro(s))</span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Tab: Documentos */}
            {activeTab === 'documentos' && (
                <div
                    className="rounded-xl overflow-hidden"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                >
                    <div className="p-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                            Documentos Fiscais ({allDocuments.length})
                        </h3>
                    </div>
                    {allDocuments.length === 0 ? (
                        <div className="p-8 text-center">
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhum documento encontrado. Importe um arquivo SPED primeiro.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr style={{ background: 'var(--bg-card)' }}>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tipo</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Chave</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Número</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Modelo</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Série</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Data</th>
                                        <th className="text-right p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Valor</th>
                                        <th className="text-right p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>ICMS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allDocuments.map((doc, i) => (
                                        <tr
                                            key={i}
                                            style={{ borderTop: '1px solid var(--border-subtle)' }}
                                        >
                                            <td className="p-3" style={{ color: 'var(--text-primary)' }}>
                                                <span
                                                    className="px-2 py-0.5 rounded text-[10px] font-bold"
                                                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                                                >
                                                    {doc.tipo}
                                                </span>
                                            </td>
                                            <td className="p-3 font-mono" style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                                                {doc.chave ? `${doc.chave.substring(0, 12)}...` : '-'}
                                            </td>
                                            <td className="p-3" style={{ color: 'var(--text-primary)' }}>{doc.numDoc || '-'}</td>
                                            <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{doc.codMod || '-'}</td>
                                            <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{doc.serie || '-'}</td>
                                            <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{doc.dataDoc || '-'}</td>
                                            <td className="p-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                                                {formatCurrency(doc.valorDocumento)}
                                            </td>
                                            <td className="p-3 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                                                {formatCurrency(doc.tipo === 'C100' ? ((doc as SpedDocumentoC100).valorIcms || 0) : ((doc as SpedDocumentoD100).valorIcms || 0))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Tab: Apuração */}
            {activeTab === 'apuracao' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* E110 - ICMS */}
                    <div
                        className="p-5 rounded-xl"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                            ICMS — Registro E110
                        </h3>
                        {parseResult?.apuracaoIcms ? (
                            <div className="space-y-2">
                                <ApuracaoRow label="Total Débitos" value={parseResult.apuracaoIcms.valorTotalDebitos} />
                                <ApuracaoRow label="Aj. Débitos" value={parseResult.apuracaoIcms.valorAjustesDebitos} />
                                <ApuracaoRow label="Total Aj. Débitos" value={parseResult.apuracaoIcms.valorTotalAjustesDebitos} />
                                <ApuracaoRow label="Estornos Créditos" value={parseResult.apuracaoIcms.valorEstornosCreditos} />
                                <ApuracaoRow label="Total Créditos" value={parseResult.apuracaoIcms.valorTotalCreditos} />
                                <ApuracaoRow label="Aj. Créditos" value={parseResult.apuracaoIcms.valorAjustesCreditos} />
                                <ApuracaoRow label="Total Aj. Créditos" value={parseResult.apuracaoIcms.valorTotalAjustesCreditos} />
                                <ApuracaoRow label="Estornos Débitos" value={parseResult.apuracaoIcms.valorEstornosDebitos} />
                                <ApuracaoRow label="Saldo Credor Anterior" value={parseResult.apuracaoIcms.saldoCredorAnterior} />
                                <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '8px', marginTop: '8px' }}>
                                    <ApuracaoRow label="Saldo Devedor" value={parseResult.apuracaoIcms.valorSaldoDevedor} bold />
                                    <ApuracaoRow label="Deduções" value={parseResult.apuracaoIcms.valorDeducoes} />
                                    <ApuracaoRow label="ICMS a Recolher" value={parseResult.apuracaoIcms.valorIcmsRecolher} bold accent />
                                    <ApuracaoRow label="Saldo Credor a Transportar" value={parseResult.apuracaoIcms.valorSaldoCredorTransportar} />
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Registro E110 não encontrado.</p>
                        )}
                    </div>

                    {/* E520 - IPI */}
                    <div
                        className="p-5 rounded-xl"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                            IPI — Registro E520
                        </h3>
                        {parseResult?.apuracaoIpi ? (
                            <div className="space-y-2">
                                <ApuracaoRow label="Saldo Devedor IPI" value={parseResult.apuracaoIpi.valorSaldoDevedorIpi} />
                                <ApuracaoRow label="Deduções IPI" value={parseResult.apuracaoIpi.valorDeducoesIpi} />
                                <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '8px', marginTop: '8px' }}>
                                    <ApuracaoRow label="IPI a Recolher" value={parseResult.apuracaoIpi.valorIpiRecolher} bold accent />
                                    <ApuracaoRow label="Saldo Credor IPI" value={parseResult.apuracaoIpi.valorSaldoCredorIpi} />
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Registro E520 não encontrado.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Tab: Conferência */}
            {activeTab === 'conferencia' && (
                <div className="space-y-4">
                    <div
                        className="p-5 rounded-xl"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                Conferência XML vs SPED
                            </h3>
                            <button
                                onClick={handleConference}
                                disabled={!parseResult || conferring}
                                className="px-5 py-2.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                            >
                                {conferring ? (
                                    <span className="flex items-center gap-2">
                                        <div
                                            className="w-4 h-4 border-2 rounded-full animate-spin"
                                            style={{ borderColor: '#fff', borderTopColor: 'transparent' }}
                                        />
                                        Conferindo...
                                    </span>
                                ) : 'Executar Conferência'}
                            </button>
                        </div>

                        {!parseResult && (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Importe um arquivo SPED antes de executar a conferência.
                            </p>
                        )}

                        {parseResult && !conferenceResult && !conferring && (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Clique em "Executar Conferência" para cruzar os XMLs do Firestore com o SPED importado.
                            </p>
                        )}
                    </div>

                    {conferenceResult && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard label="XMLs analisados" value={String(conferenceResult.totalXmls)} />
                                <StatCard label="Documentos SPED" value={String(conferenceResult.totalDocumentosSped)} />
                                <StatCard label="Conferidos" value={String(conferenceResult.documentosConferidos)} />
                                <StatCard
                                    label="Inconsistências"
                                    value={String(conferenceResult.inconsistencias.length)}
                                    highlight={conferenceResult.inconsistencias.length > 0}
                                />
                            </div>

                            {conferenceResult.inconsistencias.length === 0 ? (
                                <div
                                    className="p-6 rounded-xl text-center"
                                    style={{
                                        background: 'rgba(34,197,94,0.1)',
                                        border: '1px solid rgba(34,197,94,0.3)',
                                    }}
                                >
                                    <p className="text-sm font-bold" style={{ color: 'var(--success)' }}>
                                        Nenhuma inconsistência encontrada
                                    </p>
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        Todos os documentos estão compatíveis entre XML e SPED.
                                    </p>
                                </div>
                            ) : (
                                <div
                                    className="rounded-xl overflow-hidden"
                                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                                >
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr style={{ background: 'var(--bg-card)' }}>
                                                    <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Gravidade</th>
                                                    <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tipo</th>
                                                    <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Documento</th>
                                                    <th className="text-left p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Descrição</th>
                                                    <th className="text-right p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Valor XML</th>
                                                    <th className="text-right p-3 font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Valor SPED</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {conferenceResult.inconsistencias.map(inc => (
                                                    <InconsistenciaRow key={inc.id} inc={inc} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

function InfoCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        </div>
    );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div
            className="p-4 rounded-xl text-center"
            style={{
                background: highlight ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)',
                border: `1px solid ${highlight ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
            }}
        >
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p
                className="text-lg font-bold"
                style={{ color: highlight ? 'var(--danger)' : 'var(--text-primary)' }}
            >
                {value}
            </p>
        </div>
    );
}

function ApuracaoRow({
    label,
    value,
    bold,
    accent,
}: {
    label: string;
    value?: number;
    bold?: boolean;
    accent?: boolean;
}) {
    return (
        <div className="flex justify-between items-center py-1">
            <span
                className={`text-xs ${bold ? 'font-bold' : ''}`}
                style={{ color: accent ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
                {label}
            </span>
            <span
                className={`text-xs font-mono ${bold ? 'font-bold' : ''}`}
                style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}
            >
                {formatCurrency(value ?? 0)}
            </span>
        </div>
    );
}

function InconsistenciaRow({ inc }: { inc: SpedFiscalInconsistencia }) {
    const colors = GRAVITY_COLORS[inc.gravidade];
    return (
        <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td className="p-3">
                <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold"
                    style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                >
                    {inc.gravidade}
                </span>
            </td>
            <td className="p-3" style={{ color: 'var(--text-primary)' }}>
                <span className="text-[10px] font-mono">{inc.tipo}</span>
            </td>
            <td className="p-3" style={{ color: 'var(--text-secondary)' }}>
                {inc.documento || '-'}
            </td>
            <td className="p-3" style={{ color: 'var(--text-secondary)', maxWidth: '300px' }}>
                {inc.descricao}
            </td>
            <td className="p-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                {inc.valorXml !== undefined ? formatCurrency(inc.valorXml) : '-'}
            </td>
            <td className="p-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                {inc.valorSped !== undefined ? formatCurrency(inc.valorSped) : '-'}
            </td>
        </tr>
    );
}

export default AnaliseConferencia;
