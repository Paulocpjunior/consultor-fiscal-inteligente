import React, { useState } from 'react';
import { cruzarNfts, type CruzamentoNftsResposta } from '../../services/nftsCruzamentoService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';

/**
 * A VOLTA DA NFTS — confere o que foi emitido no portal contra os serviços
 * tomados que o CFI capturou.
 *
 * O módulo NFTS faz a IDA (PDFs → TXT do lote pra emitir na PMSP). Faltava a
 * volta: gerar o lote não prova que a PMSP recebeu, e o ISS retido do tomador
 * não tinha fonte nenhuma dentro do app.
 *
 * DUAS COISAS QUE ESTA TELA NUNCA FAZ:
 *  · dar "tudo certo". A cobertura é PARCIAL por construção (prestador de outro
 *    município emite no portal dele, que não é distribuído), e a frase sai
 *    inclusive — principalmente — quando não há lacuna;
 *  · acusar o cliente por NFTS sem serviço correspondente: ali quem falhou foi
 *    a captura, não ele.
 */
interface Props {
    empresas: EmpresaXmlOption[];
    onClose?: () => void;
}

const brl = (v?: number | null) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const CruzamentoNftsPanel: React.FC<Props> = ({ empresas, onClose }) => {
    const [empresaId, setEmpresaId] = useState('');
    const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7));
    const [arquivo, setArquivo] = useState<File | null>(null);
    const [dados, setDados] = useState<CruzamentoNftsResposta | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const rodar = async () => {
        if (!empresaId || !arquivo) { setErro('Escolha a empresa e o arquivo exportado do portal.'); return; }
        setCarregando(true); setErro(null);
        try { setDados(await cruzarNfts(empresaId, competencia, arquivo)); }
        catch (e: any) { setErro(e?.message || 'Falha inesperada'); }
        finally { setCarregando(false); }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100">
                            Conferência da NFTS — o que foi emitido × o que foi tomado
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Suba o CSV da <strong>consulta de NFTS</strong> do portal da PMSP. Nada é gravado.
                        </p>
                    </div>
                    {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>}
                </div>

                <div className="grid gap-3 md:grid-cols-3 mt-4">
                    <div className="md:col-span-1">
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Empresa (tomadora)</label>
                        <EmpresaSearchSelect
                            empresas={empresas}
                            value={empresaId}
                            onChange={setEmpresaId}
                            permitirLimpar
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Competência</label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">CSV do portal</label>
                        <input
                            type="file"
                            accept=".csv,.txt"
                            onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                            className="w-full text-xs"
                        />
                    </div>
                </div>

                <button
                    onClick={rodar}
                    disabled={carregando}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    {carregando ? 'Conferindo…' : '🔎 Conferir'}
                </button>

                {erro && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                        {erro}
                    </div>
                )}
            </div>

            {dados && (
                <>
                    {/* DUPLICIDADE — achado do arquivo, independe do cruzamento. */}
                    {!!dados.arquivo.duplicadas?.length && (
                        <div className="rounded-xl border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-4">
                            <h4 className="font-bold text-red-800 dark:text-red-300 text-sm">
                                ⚠ {dados.arquivo.duplicadas.length} NFTS em DUPLICIDADE
                            </h4>
                            <ul className="mt-2 space-y-2 text-xs text-red-800 dark:text-red-300">
                                {dados.arquivo.duplicadas.map((d) => (
                                    <li key={d.numeros.join('-')}>
                                        NFTS <strong>{d.numeros.join(' e ')}</strong> cobrem o MESMO documento{' '}
                                        <strong>{d.numeroDocumento}</strong> de {d.nomePrestador} ({d.dataPrestacao},{' '}
                                        {brl(d.valorServicos)}). {d.acao}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {([
                            ['Serviços tomados', dados.resumo.servicosTomados, '#0f172a'],
                            ['NFTS emitidas', dados.resumo.nftsEmitidas, '#0284c7'],
                            ['Sem NFTS', dados.resumo.comLacuna, '#dc2626'],
                            ['Indeterminados', dados.resumo.indeterminados, '#b45309'],
                        ] as const).map(([rot, val, cor]) => (
                            <div key={rot} className="rounded-lg border border-slate-200 dark:border-slate-600 p-3">
                                <div className="text-[10px] uppercase tracking-wide text-slate-500">{rot}</div>
                                <div className="font-bold text-lg" style={{ color: cor }}>{val}</div>
                            </div>
                        ))}
                    </div>

                    {dados.arquivo.periodoSemNfts && (
                        <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                            {dados.arquivo.acao}
                        </div>
                    )}

                    {!!dados.semNfts.length && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                            <h4 className="font-bold text-sm text-red-700 dark:text-red-400">
                                Serviço tomado SEM NFTS — {brl(dados.resumo.totalSemNfts)}
                                {dados.resumo.issRetidoNaoDeclarado > 0 && (
                                    <span> · ISS retido não declarado: {brl(dados.resumo.issRetidoNaoDeclarado)}</span>
                                )}
                            </h4>
                            <div className="overflow-x-auto mt-2">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-left text-slate-500">
                                        <th className="py-1">Nota</th><th>Prestador</th><th>Município</th>
                                        <th className="text-right">Valor</th><th>Motivo</th>
                                    </tr></thead>
                                    <tbody>
                                        {dados.semNfts.map((s, i) => (
                                            <tr key={`${s.numero}-${i}`} className="border-t border-slate-100 dark:border-slate-700">
                                                <td className="py-1">{s.numero}</td>
                                                <td>{s.participante}</td>
                                                <td>{s.municipio || '—'}</td>
                                                <td className="text-right font-mono">{brl(s.base)}</td>
                                                <td className="text-slate-500">{s.motivo}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {!!dados.indeterminados.length && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-4 text-xs text-amber-800 dark:text-amber-300">
                            <strong>{dados.indeterminados.length} serviço(s) sem município do prestador</strong> —
                            não dá pra dizer se cabia NFTS. Eles NÃO entram como "em dia": completar o cadastro
                            do prestador resolve.
                        </div>
                    )}

                    {!!dados.nftsSemServico.length && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs text-slate-600 dark:text-slate-300">
                            <strong>{dados.nftsSemServico.length} NFTS sem serviço correspondente capturado.</strong>{' '}
                            Isso NÃO é erro do cliente — é nota de serviço que não chegou ao CFI. Confira a captura
                            antes de qualquer conclusão.
                        </div>
                    )}

                    {/* A frase que impede o falso verde. Sai SEMPRE. */}
                    <div className="rounded-md border-l-4 border-slate-400 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300">
                        <strong>Cobertura:</strong> {dados.cobertura}
                    </div>
                </>
            )}
        </div>
    );
};

export default CruzamentoNftsPanel;
