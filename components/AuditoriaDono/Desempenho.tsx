/**
 * 📊 Desempenho por colaborador × empresa — o que cada um EFETIVAMENTE executou.
 *
 * Paulo, 22/09: *"crie uma auditoria completa, capaz de mapear o desempenho,
 * por colaborador x empresas, o que cada colaborador efetivamente executou nos
 * últimos 2 meses, desde importações de xml, entrega de obrigações, envio de
 * impostos, geração de guias, etc."*
 *
 * A tela EXIBE o que o backend contou dos carimbos (quem/quando/empresa). Ela
 * não recalcula, e mostra as ressalvas ANTES dos números — porque "zero atos"
 * numa trilha que só passou a carimbar mês passado não é inação.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { carregarDesempenho, RelatorioDesempenho, ColaboradorDesempenho } from '../../services/auditoriaDonoService';
import { gerarRelatorioPdf } from '../../services/relatorioPdf';

const FUSO = 'America/Sao_Paulo';
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO }) : '—');
const isoDeInput = (d: string, fim = false) => (d ? new Date(`${d}T${fim ? '23:59:59' : '00:00:00'}-03:00`).toISOString() : '');
const inputDeIso = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: FUSO });

const Desempenho: React.FC = () => {
    const [dados, setDados] = useState<RelatorioDesempenho | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [de, setDe] = useState('');
    const [ate, setAte] = useState('');
    const [aberto, setAberto] = useState<Record<string, boolean>>({});
    const [busca, setBusca] = useState('');

    const buscar = async (p?: { de?: string; ate?: string }) => {
        setCarregando(true); setErro(null);
        try {
            const r = await carregarDesempenho(p || { de: isoDeInput(de) || undefined, ate: isoDeInput(ate, true) || undefined });
            if (!r.ok) { setErro(r.error || 'Falha ao carregar o desempenho.'); return; }
            setDados(r);
            if (!de && r.periodo.de) setDe(inputDeIso(r.periodo.de));
            if (!ate && r.periodo.ate) setAte(inputDeIso(r.periodo.ate));
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar.');
        } finally { setCarregando(false); }
    };
    useEffect(() => { void buscar({}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const tipos = useMemo(() => {
        if (!dados) return [] as Array<{ id: string; rotulo: string }>;
        const base = dados.tipos.map((t) => ({ id: t.id, rotulo: t.rotulo }));
        // A NFS-e por PDF é subtipo do XML importado: entra como coluna própria.
        if (!base.some((t) => t.id === 'nfse-pdf-importada')) base.splice(1, 0, { id: 'nfse-pdf-importada', rotulo: 'NFS-e importada por PDF' });
        return base.filter((t) => (dados.totaisPorTipo[t.id] || 0) > 0 || t.id === 'tarefa-concluida' || t.id === 'imposto-enviado' || t.id === 'xml-importado');
    }, [dados]);

    const colaboradores = useMemo(() => {
        if (!dados) return [] as ColaboradorDesempenho[];
        const b = busca.trim().toLowerCase();
        if (!b) return dados.colaboradores;
        return dados.colaboradores.filter((c) => c.nome.toLowerCase().includes(b) || (c.email || '').includes(b)
            || c.empresas.some((e) => e.empresaNome.toLowerCase().includes(b)));
    }, [dados, busca]);

    const exportarPdf = async () => {
        if (!dados) return;
        const cols = tipos;
        await gerarRelatorioPdf({
            titulo: `Desempenho por colaborador × empresa — ${dia(dados.periodo.de)} a ${dia(dados.periodo.ate)}`,
            subtitulo: `${dados.totalAtos} ato(s) registrados · ${dados.colaboradores.filter((c) => c.pessoa).length} colaborador(es) · gerado por ${dados.geradoPor || '—'}`,
            colunas: [
                { titulo: 'Colaborador', largura: 16 },
                { titulo: 'Empresa', largura: 26 },
                { titulo: 'Carteira', largura: 6 },
                ...cols.map((t) => ({ titulo: t.rotulo.replace('Obrigação entregue (tarefa concluída)', 'Obrig. entregue').replace(' ao cliente', ''), largura: 8, alinhamento: 'direita' as const })),
                { titulo: 'Total', largura: 6, alinhamento: 'direita' as const },
                { titulo: 'Último ato', largura: 8 },
            ],
            linhas: dados.colaboradores.flatMap((c) => [
                [c.nome, `TOTAL DO COLABORADOR — ${c.empresasComAto} empresa(s) com ato · ${c.empresasDaCarteira} na carteira · ${c.empresasDaCarteiraSemAto.length} da carteira sem ato`, '',
                    ...cols.map((t) => c.porTipo[t.id] || 0), c.total, ''],
                ...c.empresas.map((e) => [c.nome, e.empresaNome, e.naCarteira ? 'sim' : 'não', ...cols.map((t) => e.porTipo[t.id] || 0), e.total, dia(e.ultimoEm)]),
                ...(c.empresasDaCarteiraSemAto.length
                    ? [[c.nome, `SEM ATO NO PERÍODO (carteira): ${c.empresasDaCarteiraSemAto.map((e) => e.empresaNome).join(' · ')}`, 'sim', ...cols.map(() => 0), 0, '—']]
                    : []),
            ]),
            totais: ['TOTAL GERAL', '', '', ...cols.map((t) => dados.totaisPorTipo[t.id] || 0), dados.totalAtos, ''],
            observacoes: [...dados.ressalvas, `Gerado em ${new Date(dados.geradoEm).toLocaleString('pt-BR', { timeZone: FUSO })}.`],
            fileName: `desempenho-colaboradores-${new Date().toISOString().slice(0, 10)}.pdf`,
        });
    };

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">📊 Desempenho por colaborador × empresa</h2>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            O que cada colaborador efetivamente executou, por empresa: XML e NFS-e importados, obrigações
                            entregues, guias enviadas, DAS/DARE, DCTFWeb, Reinf e fim de mês. Conta carimbos gravados —
                            não deduz autor. Padrão: últimos 2 meses.
                        </p>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                        <label className="text-[10px] text-slate-400">De
                            <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <label className="text-[10px] text-slate-400">Até
                            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <label className="text-[10px] text-slate-400">Buscar (colaborador ou empresa)
                            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="todos"
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <button onClick={() => void buscar()} disabled={carregando}
                            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                            {carregando ? '…' : '🔎 Atualizar'}
                        </button>
                        <button onClick={() => void exportarPdf()} disabled={!dados || !dados.totalAtos}
                            className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40">
                            📄 PDF
                        </button>
                    </div>
                </div>
            </div>

            {erro && <div className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-[12px] text-red-700 dark:text-red-300">{erro}</div>}
            {carregando && !dados && <p className="text-[12px] text-slate-500 p-3">Lendo as trilhas…</p>}

            {dados && (
                <>
                    {/* Ressalvas ANTES dos números: elas qualificam o total. */}
                    <div className={`rounded-xl border p-3 space-y-1 ${dados.naoLidas.length
                        ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                        : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'}`}>
                        {dados.ressalvas.map((r, i) => (
                            <p key={i} className={`text-[11px] ${dados.naoLidas.length && i === 0 ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-amber-800 dark:text-amber-300'}`}>{r}</p>
                        ))}
                    </div>

                    {/* Totais por tipo */}
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Atos no período</p>
                            <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{dados.totalAtos}</p>
                            <p className="text-[10px] text-slate-400">{dia(dados.periodo.de)} a {dia(dados.periodo.ate)}</p>
                        </div>
                        {tipos.map((t) => (
                            <div key={t.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate" title={t.rotulo}>{t.rotulo}</p>
                                <p className="text-xl font-black text-slate-800 dark:text-slate-100">{dados.totaisPorTipo[t.id] || 0}</p>
                            </div>
                        ))}
                    </div>

                    {/* Matriz */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="text-left px-3 py-2">Colaborador</th>
                                        <th className="text-right px-2 py-2">Empresas c/ ato</th>
                                        <th className="text-right px-2 py-2">Carteira</th>
                                        <th className="text-right px-2 py-2" title="Empresas da carteira sem nenhum ato no período">Sem ato</th>
                                        {tipos.map((t) => <th key={t.id} className="text-right px-2 py-2 whitespace-nowrap" title={t.rotulo}>{t.rotulo.split(' (')[0].replace(' ao cliente', '')}</th>)}
                                        <th className="text-right px-3 py-2">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {colaboradores.length === 0 && (
                                        <tr><td colSpan={6 + tipos.length} className="px-3 py-4 text-slate-500">Nenhum colaborador com ato ou carteira neste recorte — veja as ressalvas acima antes de concluir qualquer coisa.</td></tr>
                                    )}
                                    {colaboradores.map((c) => (
                                        <React.Fragment key={c.chave}>
                                            <tr className={`border-t border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/30 ${!c.pessoa ? 'opacity-70 italic' : ''}`}
                                                onClick={() => setAberto((a) => ({ ...a, [c.chave]: !a[c.chave] }))}>
                                                <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-100">
                                                    {aberto[c.chave] ? '▾' : '▸'} {c.nome}
                                                    {c.email && c.email !== c.nome && <span className="ml-1 font-normal text-slate-400">{c.email}</span>}
                                                </td>
                                                <td className="text-right px-2 py-2">{c.empresasComAto}</td>
                                                <td className="text-right px-2 py-2">{c.empresasDaCarteira || '—'}</td>
                                                <td className={`text-right px-2 py-2 ${c.empresasDaCarteiraSemAto.length ? 'text-amber-700 dark:text-amber-400 font-bold' : ''}`}>{c.empresasDaCarteira ? c.empresasDaCarteiraSemAto.length : '—'}</td>
                                                {tipos.map((t) => <td key={t.id} className="text-right px-2 py-2 font-mono">{c.porTipo[t.id] || 0}</td>)}
                                                <td className="text-right px-3 py-2 font-black">{c.total}</td>
                                            </tr>
                                            {aberto[c.chave] && (
                                                <tr className="bg-slate-50/60 dark:bg-slate-900/30">
                                                    <td colSpan={6 + tipos.length} className="px-3 py-2">
                                                        {c.empresas.length > 0 && (
                                                            <table className="w-full text-[11px] mb-2">
                                                                <thead className="text-slate-400">
                                                                    <tr>
                                                                        <th className="text-left py-1">Empresa</th>
                                                                        <th className="text-left py-1">Na carteira</th>
                                                                        {tipos.map((t) => <th key={t.id} className="text-right py-1 whitespace-nowrap">{t.rotulo.split(' (')[0].replace(' ao cliente', '')}</th>)}
                                                                        <th className="text-right py-1">Total</th>
                                                                        <th className="text-right py-1">Último ato</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {c.empresas.map((e) => (
                                                                        <tr key={e.empresaId} className="border-t border-slate-100 dark:border-slate-700/50">
                                                                            <td className="py-1 text-slate-800 dark:text-slate-100">{e.empresaNome}</td>
                                                                            <td className="py-1">{e.naCarteira ? 'sim' : <span className="text-slate-400">não</span>}</td>
                                                                            {tipos.map((t) => <td key={t.id} className="text-right py-1 font-mono">{e.porTipo[t.id] || 0}</td>)}
                                                                            <td className="text-right py-1 font-bold">{e.total}</td>
                                                                            <td className="text-right py-1 text-slate-500">{dia(e.ultimoEm)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                        {c.empresasDaCarteiraSemAto.length > 0 && (
                                                            <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                                                <strong>Da carteira, sem nenhum ato registrado no período ({c.empresasDaCarteiraSemAto.length}):</strong>{' '}
                                                                {c.empresasDaCarteiraSemAto.map((e) => e.empresaNome).join(' · ')}
                                                            </p>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default Desempenho;
