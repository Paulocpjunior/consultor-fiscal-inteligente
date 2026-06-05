/**
 * EditarViaExcel — UI do editor SPED Fiscal.
 *
 * Fluxo: sobe SPED original → baixa XLSX editavel (1 aba por tipo) → edita
 * no Excel → sobe XLSX corrigido → baixa SPED reconstruido (Bloco 9
 * recalculado). Round-trip seguro: tipos sem layout estruturado vao pra aba
 * "Outros (preservados)" e voltam intactos.
 *
 * Logica pura vive em sefaz-backend/sped-fiscal-editor-*.js (testada).
 * Aqui so I/O + downloads.
 */

import React, { useState } from 'react';
import { parseSped, exportarXlsx, aplicarEdicoesXlsx, validarEstrutura, type ValidacaoSped } from '../../services/spedFiscalExcelEditor';

type Status =
    | { fase: 'idle' }
    | { fase: 'analisando' }
    | { fase: 'pronto-edicao'; nomeOriginal: string; conteudoOriginal: string; resumo: Record<string, number>; totalLinhas: number; tipoSped: string; mismatch: Record<string, { esperado: number; real: number }>; validacao: ValidacaoSped }
    | { fase: 'aplicando' }
    | { fase: 'erro'; mensagem: string };

const downloadBlob = (blob: Blob, nome: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
};

const EditarViaExcel: React.FC = () => {
    const [status, setStatus] = useState<Status>({ fase: 'idle' });

    const handleSpedUpload = async (file: File) => {
        setStatus({ fase: 'analisando' });
        try {
            const txt = await file.text();
            const parsed = await parseSped(txt);
            const validacao = await validarEstrutura(parsed);
            setStatus({
                fase: 'pronto-edicao',
                nomeOriginal: file.name,
                conteudoOriginal: txt,
                resumo: parsed.resumo.registrosPorTipo,
                totalLinhas: parsed.resumo.totalLinhas,
                tipoSped: parsed.tipoSped,
                mismatch: parsed.resumo.layoutMismatch || {},
                validacao,
            });
        } catch (err: any) {
            setStatus({ fase: 'erro', mensagem: err?.message || 'Falha ao ler SPED' });
        }
    };

    const baixarXlsx = async () => {
        if (status.fase !== 'pronto-edicao') return;
        try {
            const parsed = await parseSped(status.conteudoOriginal);
            const blob = await exportarXlsx(parsed, status.nomeOriginal);
            const nomeXlsx = status.nomeOriginal.replace(/\.txt$/i, '') + '.editavel.xlsx';
            downloadBlob(blob, nomeXlsx);
        } catch (err: any) {
            setStatus({ fase: 'erro', mensagem: err?.message || 'Falha ao exportar XLSX' });
        }
    };

    const handleXlsxUpload = async (file: File) => {
        if (status.fase !== 'pronto-edicao') return;
        setStatus({ fase: 'aplicando' });
        try {
            const ab = await file.arrayBuffer();
            const spedNovo = await aplicarEdicoesXlsx(status.conteudoOriginal, ab);
            // Valida o arquivo CORRIGIDO antes de entregar — confirma que a
            // edição + recálculo do Bloco 9 mantiveram a integridade do PVA.
            const parsedNovo = await parseSped(spedNovo);
            const valNovo = await validarEstrutura(parsedNovo);
            if (!valNovo.valido) {
                setStatus({
                    fase: 'erro',
                    mensagem: 'O arquivo corrigido ficou inválido — NÃO foi baixado. Erros: '
                        + valNovo.erros.slice(0, 5).join(' · '),
                });
                return;
            }
            const nomeSpedNovo = status.nomeOriginal.replace(/\.txt$/i, '') + '.corrigido.txt';
            downloadBlob(new Blob([spedNovo], { type: 'text/plain' }), nomeSpedNovo);
            setStatus(s => s.fase === 'aplicando' ? { fase: 'idle' } : s);
        } catch (err: any) {
            setStatus({ fase: 'erro', mensagem: err?.message || 'Falha ao aplicar edições' });
        }
    };

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-xs">
                <b className="text-amber-800 dark:text-amber-200">Edição de SPED Fiscal via Excel — round-trip seguro</b>
                <ul className="mt-2 list-disc list-inside space-y-1 text-amber-900 dark:text-amber-300/90">
                    <li>Apenas tipos editáveis (0150, 0200, C100, C170, C190, E110, H010) ficam em abas com colunas nomeadas.</li>
                    <li>Demais tipos voltam <b>intactos</b> via aba "Outros (preservados)".</li>
                    <li>Bloco 9 (R9900/R9990/R9999) é <b>recalculado automaticamente</b> — não edite essa aba.</li>
                    <li>Não troque a coluna <code>_idx_NAO_MEXER</code> — é o vínculo entre Excel e SPED.</li>
                </ul>
            </div>

            <div
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>1. Sobe o SPED original (.txt)</h3>
                <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSpedUpload(f); }}
                    className="block text-xs"
                />
                {status.fase === 'analisando' && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Analisando…</p>}
            </div>

            {status.fase === 'pronto-edicao' && (
                <>
                    <div
                        className="p-5 rounded-xl"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            2. Resumo do SPED — {status.totalLinhas.toLocaleString('pt-BR')} linhas
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                                {status.tipoSped === 'contribuicoes' ? 'EFD Contribuições (PIS/COFINS)' : 'EFD ICMS/IPI'}
                            </span>
                        </h3>
                        {Object.keys(status.mismatch).length > 0 && (
                            <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-[11px] text-amber-800 dark:text-amber-300">
                                ⚠️ Registros com layout divergente do esperado — mantidos <b>somente leitura</b> (round-trip preserva, não corrompe):{' '}
                                {Object.entries(status.mismatch).map(([t, m]) => `${t} (${m.real}≠${m.esperado} campos)`).join(', ')}
                            </div>
                        )}

                        {/* Validação estrutural (tipo PVA) do arquivo subido. */}
                        {status.validacao.valido ? (
                            <div className="mb-3 p-2 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 text-[11px] text-emerald-800 dark:text-emerald-300">
                                ✓ Estrutura válida (0000/9999, blocos, Bloco 9 conferem){status.validacao.avisos.length ? ` · ${status.validacao.avisos.length} aviso(s)` : ''}
                            </div>
                        ) : (
                            <div className="mb-3 p-2 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 text-[11px] text-red-700 dark:text-red-300">
                                <b>⚠️ {status.validacao.erros.length} erro(s) de estrutura no arquivo subido</b> (corrija na origem; mesmo assim dá pra editar e baixar):
                                <ul className="mt-1 list-disc list-inside">
                                    {status.validacao.erros.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                                    {status.validacao.erros.length > 6 && <li>… +{status.validacao.erros.length - 6}</li>}
                                </ul>
                            </div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
                            {Object.entries(status.resumo).sort().map(([tipo, qtd]) => (
                                <div key={tipo} className="px-2 py-1 rounded" style={{ background: 'var(--bg-card)' }}>
                                    <span className="font-mono font-bold">{tipo}</span>
                                    <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{qtd}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={baixarXlsx}
                            className="mt-4 px-4 py-2 text-xs font-bold rounded-lg"
                            style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                            ⬇ Baixar XLSX editável
                        </button>
                    </div>

                    <div
                        className="p-5 rounded-xl"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    >
                        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>3. Sobe o XLSX corrigido</h3>
                        <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleXlsxUpload(f); }}
                            className="block text-xs"
                        />
                        <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            Vou aplicar as edições no SPED original e baixar o arquivo corrigido (Bloco 9 recalculado).
                        </p>
                    </div>
                </>
            )}

            {status.fase === 'aplicando' && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aplicando edições e gerando SPED corrigido…</p>
            )}

            {status.fase === 'erro' && (
                <div className="p-3 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 text-xs text-red-700 dark:text-red-300">
                    <b>Erro:</b> {status.mensagem}
                </div>
            )}
        </div>
    );
};

export default EditarViaExcel;
