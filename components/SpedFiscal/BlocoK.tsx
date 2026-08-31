/**
 * BlocoK — apontamento de produção e estoque (Bloco K da EFD ICMS/IPI).
 *
 * POR QUE ESTA TELA EXISTE (29/08, Paulo: *"pode fazer o bloco k"*): a
 * quantidade produzida e o saldo de estoque NÃO saem das notas. Vêm do
 * controle de produção da empresa — e o app não tem nenhum.
 *
 * É exatamente o caso do Bloco H (06/08): sem esta entrada, um gerador
 * "esperto" montaria K200 para todos os itens com quantidade ZERO, e o arquivo
 * sairia estruturalmente válido, aceito pelo PVA, declarando ao Fisco que a
 * empresa **não produziu e não tem estoque**.
 *
 * Por isso esta tela é ENTRADA DE DADO, não ferramenta de conserto — e o que
 * não for apontado fica de fora do arquivo, com o aviso, em vez de virar zero.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';

interface Props {
    currentUser: User | null;
    empresas: EmpresaXmlOption[];
    onShowToast?: (msg: string) => void;
}

interface LinhaEstoque {
    codItem: string;
    qtd: number | '';
    indEst: string;
    codPart: string;
}
interface LinhaInsumo {
    dtSaida: string;
    codItem: string;
    qtd: number | '';
    codInsSubst: string;
}
interface LinhaProducao {
    dtIniOp: string;
    dtFinOp: string;
    codDocOp: string;
    codItem: string;
    qtdEnc: number | '';
    insumos: LinhaInsumo[];
}
// 📖 K220 — OUTRAS MOVIMENTAÇÕES INTERNAS ENTRE MERCADORIAS (a BAIXA de
// estoque, 30/08). O Guia 3.2.3 dá 6 campos: REG · DT_MOV · COD_ITEM_ORI ·
// COD_ITEM_DEST · QTD_ORI · QTD_DEST — e exige que o destino SEJA DIFERENTE da
// origem e que as duas quantidades sejam maiores que zero.
interface LinhaMovimentacao {
    dtMov: string;
    codItemOri: string;
    codItemDest: string;
    qtdOri: number | '';
    qtdDest: number | '';
}

// 📖 Guia 3.2.3, K200 campo 05 — Valores Válidos [0, 1, 2].
const IND_EST: Array<[string, string]> = [
    ['0', 'Escriturado pelo informante (próprio)'],
    ['1', 'Escriturado pelo informante, em poder de terceiro'],
    ['2', 'De terceiro, em poder do informante'],
];

const competenciaAtual = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const BlocoK: React.FC<Props> = ({ onShowToast }) => {
    // A EMPRESA É A ATIVA DA SESSÃO — este painel não pergunta de novo
    // (Paulo, 15/08: *"tira os seletores internos"*).
    const empresaId = useEmpresaAtivaId();
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [estoques, setEstoques] = useState<LinhaEstoque[]>([]);
    const [producao, setProducao] = useState<LinhaProducao[]>([]);
    const [movimentacoes, setMovimentacoes] = useState<LinhaMovimentacao[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [existe, setExiste] = useState(false);

    const token = async () => (await import('firebase/auth')).getAuth().currentUser?.getIdToken();

    const carregar = async () => {
        if (!empresaId) { onShowToast?.('Escolha a empresa.'); return; }
        setCarregando(true);
        try {
            const t = await token();
            const r = await fetch(
                `/api/admin/sped-fiscal/bloco-k?empresaId=${encodeURIComponent(empresaId)}&competencia=${competencia}`,
                { headers: { Authorization: `Bearer ${t}` } },
            );
            const j = await r.json();
            if (!j.ok) { onShowToast?.(j.error || 'Falha ao carregar o apontamento.'); return; }
            setExiste(!!j.existe);
            setEstoques((j.estoques || []).map((e: Record<string, unknown>) => ({
                codItem: String(e.codItem || ''), qtd: (e.qtd as number) ?? '',
                indEst: String(e.indEst || '0'), codPart: String(e.codPart || ''),
            })));
            setProducao((j.producao || []).map((p: Record<string, unknown>) => ({
                dtIniOp: String(p.dtIniOp || ''), dtFinOp: String(p.dtFinOp || ''),
                codDocOp: String(p.codDocOp || ''), codItem: String(p.codItem || ''),
                qtdEnc: (p.qtdEnc as number) ?? '',
                insumos: ((p.insumos as Record<string, unknown>[]) || []).map((i) => ({
                    dtSaida: String(i.dtSaida || ''), codItem: String(i.codItem || ''),
                    qtd: (i.qtd as number) ?? '', codInsSubst: String(i.codInsSubst || ''),
                })),
            })));
            setMovimentacoes((j.movimentacoes || []).map((m: Record<string, unknown>) => ({
                dtMov: String(m.dtMov || ''),
                codItemOri: String(m.codItemOri || ''), codItemDest: String(m.codItemDest || ''),
                qtdOri: (m.qtdOri as number) ?? '', qtdDest: (m.qtdDest as number) ?? '',
            })));
        } catch (e) {
            onShowToast?.(`Falha ao carregar: ${(e as Error)?.message || e}`);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => {
        setExiste(false); setEstoques([]); setProducao([]); setMovimentacoes([]);
    }, [empresaId, competencia]);

    const salvar = async () => {
        if (!empresaId) { onShowToast?.('Escolha a empresa.'); return; }
        setSalvando(true);
        try {
            const t = await token();
            const r = await fetch('/api/admin/sped-fiscal/bloco-k', {
                method: 'POST',
                headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ empresaId, competencia, estoques, producao, movimentacoes }),
            });
            const j = await r.json();
            if (!j.ok) { onShowToast?.(j.error || 'Falha ao gravar.'); return; }
            setExiste(true);
            // Farol honesto: o que NÃO foi apontado não entra — e a frase diz.
            // ⚠️ A baixa (K220) entra na MESMA conta: deixá-la de fora do número
            // faria a pessoa ler "2 gravadas" e concluir que a baixa passou.
            const fora = (j.estoquesRecebidos - j.estoquesGravados)
                + (j.producaoRecebida - j.producaoGravada)
                + ((j.movimentacoesRecebidas || 0) - (j.movimentacoesGravadas || 0));
            onShowToast?.(
                `Bloco K gravado: ${j.estoquesGravados} linha(s) de estoque, ${j.producaoGravada} de produção`
                + ` e ${j.movimentacoesGravadas || 0} de baixa/movimentação.`
                + (fora > 0 ? ` ${fora} linha(s) incompleta(s) ficaram de FORA — não viram zero.` : ''),
            );
        } catch (e) {
            onShowToast?.(`Falha ao gravar: ${(e as Error)?.message || e}`);
        } finally {
            setSalvando(false);
        }
    };

    const estOk = useMemo(() => estoques.filter((e) => e.codItem && e.qtd !== '').length, [estoques]);
    const prodOk = useMemo(() => producao.filter((p) => p.codItem && p.qtdEnc !== '').length, [producao]);
    // ⚠️ A MESMA régua do backend e do gerador, campo a campo — se a tela
    // contar por um critério e o arquivo por outro, ela promete linha que não
    // sai (a réplica de CFOP no modal, 12/08).
    const movCompleta = (m: LinhaMovimentacao) => !!m.dtMov && !!m.codItemOri && !!m.codItemDest
        && m.codItemOri.trim() !== m.codItemDest.trim()
        && m.qtdOri !== '' && Number(m.qtdOri) > 0 && m.qtdDest !== '' && Number(m.qtdDest) > 0;
    const movOk = useMemo(() => movimentacoes.filter(movCompleta).length, [movimentacoes]);

    const alterarEstoque = (i: number, campo: keyof LinhaEstoque, valor: unknown) =>
        setEstoques((prev) => prev.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
    const alterarProducao = (i: number, campo: keyof LinhaProducao, valor: unknown) =>
        setProducao((prev) => prev.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
    const alterarMovimentacao = (i: number, campo: keyof LinhaMovimentacao, valor: unknown) =>
        setMovimentacoes((prev) => prev.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
    const alterarInsumo = (p: number, i: number, campo: keyof LinhaInsumo, valor: unknown) =>
        setProducao((prev) => prev.map((l, idx) => (idx === p
            ? { ...l, insumos: l.insumos.map((s, si) => (si === i ? { ...s, [campo]: valor } : s)) }
            : l)));

    const inputCls = 'p-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600';

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>🏭 Bloco K — produção e estoque</h3>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    O apontamento do <strong>controle de produção</strong> da empresa. Este dado não existe em lugar
                    nenhum do sistema: não sai das notas, não se estima do histórico. <strong>Linha sem quantidade
                    fica de fora do arquivo</strong> — nunca vira zero, porque bloco K zerado declara ao Fisco que a
                    empresa não produziu e não tem estoque.
                </p>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    Quem entrega o bloco e qual <strong>leiaute</strong> (K010) usa é o cadastro:
                    Empresas → Dados Fiscais. Optante do Simples Nacional é <strong>dispensado</strong>
                    {' '}(Resolução CGSN 94).
                </p>

                <div className="flex flex-wrap gap-3 items-end mt-3">
                    <div className="min-w-[260px] flex-1">
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Empresa</label>
                        <EmpresaAtivaFixa />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Competência</label>
                        <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                    </div>
                    <button onClick={() => void carregar()} disabled={carregando || !empresaId}
                        className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40">
                        {carregando ? 'Carregando…' : '🔎 Carregar'}
                    </button>
                    <button onClick={salvar} disabled={salvando || !empresaId}
                        className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                        {salvando ? 'Gravando…' : '💾 Gravar apontamento'}
                    </button>
                </div>

                {empresaId && !carregando && !existe && !estoques.length && !producao.length && !movimentacoes.length && (
                    <p className="text-[11px] mt-3 text-amber-700 dark:text-amber-400">
                        ⚠ Nenhum apontamento gravado nesta competência. Enquanto ele não existir, o
                        <strong> bloco K sai vazio</strong> na geração do SPED — e isso é de propósito.
                    </p>
                )}
            </div>

            {/* ── K200 — saldo de estoque ─────────────────────────────────── */}
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-wrap gap-3 items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>
                        <strong>K200</strong> — saldo de estoque escriturado ·{' '}
                        <strong>{estOk}</strong> de {estoques.length} linha(s) com quantidade
                    </span>
                    <button onClick={() => setEstoques((p) => [...p, { codItem: '', qtd: '', indEst: '0', codPart: '' }])}
                        className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600">
                        + Linha de estoque
                    </button>
                </div>
                {estoques.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                                    <th className="py-1">Código do item</th>
                                    <th className="text-right">Quantidade</th>
                                    <th>Propriedade (IND_EST)</th><th>Participante</th><th />
                                </tr>
                            </thead>
                            <tbody>
                                {estoques.map((l, i) => {
                                    const semQtd = l.qtd === '';
                                    const faltaPart = ['1', '2'].includes(l.indEst) && !l.codPart;
                                    return (
                                        <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                                            <td className="py-1 pr-1">
                                                <input value={l.codItem} onChange={(e) => alterarEstoque(i, 'codItem', e.target.value)}
                                                    placeholder="cód. do 0200" className={`w-40 font-mono ${inputCls}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input type="number" step="0.001" value={l.qtd}
                                                    onChange={(e) => alterarEstoque(i, 'qtd', e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`w-28 text-right p-1 rounded bg-white dark:bg-slate-700 border ${semQtd ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <select value={l.indEst} onChange={(e) => alterarEstoque(i, 'indEst', e.target.value)} className={inputCls}>
                                                    {IND_EST.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                                                </select>
                                            </td>
                                            <td className="pr-1">
                                                <input value={l.codPart} onChange={(e) => alterarEstoque(i, 'codPart', e.target.value)}
                                                    disabled={l.indEst === '0'}
                                                    placeholder={l.indEst === '0' ? '—' : 'obrigatório'}
                                                    className={`w-32 p-1 rounded bg-white dark:bg-slate-700 border disabled:opacity-40 ${faltaPart ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td>
                                                <button onClick={() => setEstoques((p) => p.filter((_, idx) => idx !== i))}
                                                    className="px-2 text-red-600 dark:text-red-400" title="Remover linha">✕</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {estoques.some((l) => ['1', '2'].includes(l.indEst) && !l.codPart) && (
                    <p className="text-[11px] text-red-700 dark:text-red-400">
                        🚨 Estoque de/em poder de terceiro exige o participante (COD_PART, e ele precisa estar no
                        0150) — preencha ou volte a propriedade para &quot;do informante&quot;.
                    </p>
                )}
            </div>

            {/* ── K220 — baixa / movimentação interna de estoque ──────────── */}
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-wrap gap-3 items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>
                        <strong>K220</strong> — baixa de estoque (movimentação interna entre mercadorias) ·{' '}
                        <strong>{movOk}</strong> de {movimentacoes.length} linha(s) completa(s)
                    </span>
                    <button onClick={() => setMovimentacoes((p) => [...p, {
                        dtMov: '', codItemOri: '', codItemDest: '', qtdOri: '', qtdDest: '',
                    }])}
                        className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600">
                        + Baixa de estoque
                    </button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    É a baixa que <strong>não passa por ordem de produção</strong>: um item sai do estoque e outro
                    entra no lugar (reclassificação, fracionamento, troca de embalagem). Por isso ela tem as
                    <strong> duas pontas</strong> — o que saiu e o que entrou —, e o item de destino precisa ser
                    <strong> diferente</strong> do de origem. Consumo de insumo em produção é o K235, ali embaixo;
                    perda e quebra não entram aqui.
                </p>
                {movimentacoes.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                                    <th className="py-1">Data</th>
                                    <th>Item que SAIU (origem)</th><th className="text-right">Qtd. saída</th>
                                    <th>Item que ENTROU (destino)</th><th className="text-right">Qtd. entrada</th><th />
                                </tr>
                            </thead>
                            <tbody>
                                {movimentacoes.map((m, i) => {
                                    const mesmoItem = !!m.codItemOri && m.codItemOri.trim() === m.codItemDest.trim();
                                    const qtdRuim = (v: number | '') => v === '' || Number(v) <= 0;
                                    return (
                                        <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                                            <td className="py-1 pr-1">
                                                <input type="date" value={m.dtMov}
                                                    onChange={(e) => alterarMovimentacao(i, 'dtMov', e.target.value)}
                                                    className={`p-1 rounded bg-white dark:bg-slate-700 border ${m.dtMov ? 'border-slate-200 dark:border-slate-600' : 'border-amber-400'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input value={m.codItemOri} onChange={(e) => alterarMovimentacao(i, 'codItemOri', e.target.value)}
                                                    placeholder="cód. do 0200" className={`w-40 font-mono p-1 rounded bg-white dark:bg-slate-700 border ${mesmoItem ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input type="number" step="0.001" value={m.qtdOri}
                                                    onChange={(e) => alterarMovimentacao(i, 'qtdOri', e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`w-24 text-right p-1 rounded bg-white dark:bg-slate-700 border ${qtdRuim(m.qtdOri) ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input value={m.codItemDest} onChange={(e) => alterarMovimentacao(i, 'codItemDest', e.target.value)}
                                                    placeholder="cód. do 0200" className={`w-40 font-mono p-1 rounded bg-white dark:bg-slate-700 border ${mesmoItem ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input type="number" step="0.001" value={m.qtdDest}
                                                    onChange={(e) => alterarMovimentacao(i, 'qtdDest', e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`w-24 text-right p-1 rounded bg-white dark:bg-slate-700 border ${qtdRuim(m.qtdDest) ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td>
                                                <button onClick={() => setMovimentacoes((p) => p.filter((_, idx) => idx !== i))}
                                                    className="px-2 text-red-600 dark:text-red-400" title="Remover linha">✕</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {movimentacoes.some((m) => !!m.codItemOri && m.codItemOri.trim() === m.codItemDest.trim()) && (
                    <p className="text-[11px] text-red-700 dark:text-red-400">
                        🚨 O item de destino tem de ser <strong>diferente</strong> do de origem (Guia 3.2.3, K220
                        campo 04) — item saindo e entrando nele mesmo não é movimentação, e o PVA recusa.
                    </p>
                )}
            </div>

            {/* ── K230/K235 — produção e o consumo dela ───────────────────── */}
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-wrap gap-3 items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>
                        <strong>K230/K235</strong> — produção acabada e os insumos consumidos ·{' '}
                        <strong>{prodOk}</strong> de {producao.length} apontamento(s) com quantidade
                    </span>
                    <button onClick={() => setProducao((p) => [...p, {
                        dtIniOp: '', dtFinOp: '', codDocOp: '', codItem: '', qtdEnc: '', insumos: [],
                    }])}
                        className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600">
                        + Ordem de produção
                    </button>
                </div>

                {producao.map((p, pi) => (
                    <div key={pi} className="p-3 rounded-lg space-y-2" style={{ border: '1px solid var(--border-subtle)' }}>
                        <div className="flex flex-wrap gap-2 items-end text-xs">
                            <div>
                                <label className="text-[10px] uppercase font-bold block" style={{ color: 'var(--text-muted)' }}>Início da OP</label>
                                <input type="date" value={p.dtIniOp} onChange={(e) => alterarProducao(pi, 'dtIniOp', e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold block" style={{ color: 'var(--text-muted)' }}>Fim da OP</label>
                                <input type="date" value={p.dtFinOp} onChange={(e) => alterarProducao(pi, 'dtFinOp', e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold block" style={{ color: 'var(--text-muted)' }}>Nº da OP</label>
                                <input value={p.codDocOp} onChange={(e) => alterarProducao(pi, 'codDocOp', e.target.value)} className={`w-28 ${inputCls}`} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold block" style={{ color: 'var(--text-muted)' }}>Item produzido</label>
                                <input value={p.codItem} onChange={(e) => alterarProducao(pi, 'codItem', e.target.value)}
                                    placeholder="cód. do 0200" className={`w-40 font-mono ${inputCls}`} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold block" style={{ color: 'var(--text-muted)' }}>Qtd. produzida</label>
                                <input type="number" step="0.001" value={p.qtdEnc}
                                    onChange={(e) => alterarProducao(pi, 'qtdEnc', e.target.value === '' ? '' : Number(e.target.value))}
                                    className={`w-28 text-right p-1 rounded bg-white dark:bg-slate-700 border ${p.qtdEnc === '' ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                            </div>
                            <button onClick={() => setProducao((prev) => prev.filter((_, idx) => idx !== pi))}
                                className="px-2 py-1 text-red-600 dark:text-red-400" title="Remover ordem">✕</button>
                        </div>

                        <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-600 space-y-1">
                            <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                <span>Insumos consumidos (K235) — só no leiaute <strong>completo</strong></span>
                                <button onClick={() => alterarProducao(pi, 'insumos', [...p.insumos, { dtSaida: '', codItem: '', qtd: '', codInsSubst: '' }])}
                                    className="px-2 py-1 text-[11px] font-bold rounded border border-slate-300 dark:border-slate-600">
                                    + Insumo
                                </button>
                            </div>
                            {p.insumos.map((s, si) => (
                                <div key={si} className="flex flex-wrap gap-2 items-center text-xs">
                                    <input type="date" value={s.dtSaida} onChange={(e) => alterarInsumo(pi, si, 'dtSaida', e.target.value)} className={inputCls} />
                                    <input value={s.codItem} onChange={(e) => alterarInsumo(pi, si, 'codItem', e.target.value)}
                                        placeholder="cód. do insumo" className={`w-40 font-mono ${inputCls}`} />
                                    <input type="number" step="0.001" value={s.qtd}
                                        onChange={(e) => alterarInsumo(pi, si, 'qtd', e.target.value === '' ? '' : Number(e.target.value))}
                                        className={`w-24 text-right ${inputCls}`} />
                                    <input value={s.codInsSubst} onChange={(e) => alterarInsumo(pi, si, 'codInsSubst', e.target.value)}
                                        placeholder="substituto (opcional)" className={`w-40 font-mono ${inputCls}`} />
                                    <button onClick={() => alterarProducao(pi, 'insumos', p.insumos.filter((_, idx) => idx !== si))}
                                        className="px-2 text-red-600 dark:text-red-400" title="Remover insumo">✕</button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {(estOk < estoques.length || prodOk < producao.length || movOk < movimentacoes.length) && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ {(estoques.length - estOk) + (producao.length - prodOk) + (movimentacoes.length - movOk)}{' '}
                    linha(s) incompleta(s) <strong>não serão gravadas</strong> e ficarão de fora do arquivo.
                    Isso é de propósito: apontamento que ninguém fez não vira zero.
                </p>
            )}
        </div>
    );
};

export default BlocoK;
