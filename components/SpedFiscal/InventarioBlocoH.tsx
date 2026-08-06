/**
 * InventarioBlocoH — contagem física do inventário (Bloco H da EFD ICMS/IPI).
 *
 * POR QUE ESTA TELA EXISTE (06/08): o gerador montava H010 pra todos os itens
 * com quantidade e valor unitário ZERO, e nenhum lugar do app gravava esses
 * campos. Em dezembro sairia um inventário inteiro zerado — estruturalmente
 * válido, aceito pelo PVA, e lido pela fiscalização como "declarei que não
 * tinha estoque".
 *
 * Inventário é dado que só existe FORA do sistema: é a contagem que a empresa
 * fez. Não sai das notas, não se estima do histórico de compras, não se deduz.
 * Por isso esta tela é ENTRADA DE DADO, não ferramenta de conserto — e o que
 * não for contado fica de fora do arquivo, com o aviso, em vez de virar zero.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';

interface Props {
    currentUser: User | null;
    empresas: EmpresaXmlOption[];
    onShowToast?: (msg: string) => void;
}

interface ItemInventario {
    codItem: string;
    descricao?: string;
    unidade: string;
    qtdInventario: number | '';
    vlUnitInventario: number | '';
    indPropInventario: string;
    codPartInventario: string;
}

const MOTIVOS: Array<[string, string]> = [
    ['01', '01 — No final do período'],
    ['02', '02 — Na mudança de forma de tributação da mercadoria'],
    ['03', '03 — Na solicitação de baixa cadastral, paralisação ou similar'],
    ['04', '04 — Na alteração de regime de pagamento (condição do contribuinte)'],
    ['05', '05 — Por determinação do Fisco'],
    ['06', '06 — Controle das mercadorias sujeitas a ST'],
];

const PROPRIEDADE: Array<[string, string]> = [
    ['0', 'Do informante (próprio)'],
    ['1', 'Do informante, em poder de terceiro'],
    ['2', 'De terceiro, em poder do informante'],
];

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ultimoDiaDoAno = () => `${new Date().getFullYear() - (new Date().getMonth() < 1 ? 1 : 0)}-12-31`;

const InventarioBlocoH: React.FC<Props> = ({ empresas, onShowToast }) => {
    const [empresaId, setEmpresaId] = useState('');
    const [data, setData] = useState(ultimoDiaDoAno());
    const [motInv, setMotInv] = useState('01');
    const [itens, setItens] = useState<ItemInventario[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [existe, setExiste] = useState(false);

    const token = async () => (await import('firebase/auth')).getAuth().currentUser?.getIdToken();

    const carregar = async (idOverride?: unknown) => {
        const alvo = typeof idOverride === 'string' ? idOverride : empresaId;
        if (!alvo) { onShowToast?.('Escolha a empresa.'); return; }
        setCarregando(true);
        try {
            const t = await token();
            const r = await fetch(`/api/admin/sped-fiscal/inventario?empresaId=${encodeURIComponent(alvo)}&data=${data}`, {
                headers: { Authorization: `Bearer ${t}` },
            });
            const j = await r.json();
            if (!j.ok) { onShowToast?.(j.error || 'Falha ao carregar o inventário.'); return; }
            setExiste(!!j.existe);
            setMotInv(j.motInv || '01');
            setItens((j.itens || []).map((i: any) => ({
                codItem: i.codItem, unidade: i.unidade || 'UN',
                qtdInventario: i.qtdInventario ?? '', vlUnitInventario: i.vlUnitInventario ?? '',
                indPropInventario: i.indPropInventario || '0', codPartInventario: i.codPartInventario || '',
            })));
        } catch (e: any) {
            onShowToast?.(`Falha ao carregar: ${e?.message || e}`);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { setExiste(false); setItens([]); }, [empresaId, data]);

    const salvar = async () => {
        if (!empresaId) { onShowToast?.('Escolha a empresa.'); return; }
        setSalvando(true);
        try {
            const t = await token();
            const r = await fetch('/api/admin/sped-fiscal/inventario', {
                method: 'POST',
                headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ empresaId, data, motInv, itens }),
            });
            const j = await r.json();
            if (!j.ok) { onShowToast?.(j.error || 'Falha ao gravar.'); return; }
            setExiste(true);
            // Farol honesto: o que NÃO foi contado não entra — e a frase diz.
            const fora = j.recebidos - j.gravados;
            onShowToast?.(
                `Inventário gravado: ${j.gravados} item(ns) contado(s).`
                + (fora > 0 ? ` ${fora} linha(s) sem quantidade/valor ficaram de FORA — não viram zero.` : ''),
            );
        } catch (e: any) {
            onShowToast?.(`Falha ao gravar: ${e?.message || e}`);
        } finally {
            setSalvando(false);
        }
    };

    const alterar = (i: number, campo: keyof ItemInventario, valor: any) => {
        setItens(prev => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
    };

    const contados = useMemo(
        () => itens.filter(i => i.qtdInventario !== '' && i.vlUnitInventario !== '').length,
        [itens],
    );
    const total = useMemo(
        () => itens.reduce((t, i) => t + (Number(i.qtdInventario) || 0) * (Number(i.vlUnitInventario) || 0), 0),
        [itens],
    );

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>📦 Inventário — Bloco H</h3>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    A contagem <strong>física</strong> da empresa. Este dado não existe em lugar nenhum do sistema:
                    não sai das notas, não se estima do histórico de compras. <strong>Item sem contagem fica de fora
                    do arquivo</strong> — nunca vira zero, porque inventário zerado declara ao Fisco que a empresa
                    não tinha estoque.
                </p>

                <div className="flex flex-wrap gap-3 items-end mt-3">
                    <div className="min-w-[260px] flex-1">
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Empresa</label>
                        <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId}
                            onAtivar={id => void carregar(id)} />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Data do inventário</label>
                        <input type="date" value={data} onChange={e => setData(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Motivo (MOT_INV)</label>
                        <select value={motInv} onChange={e => setMotInv(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                            {MOTIVOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                    </div>
                    <button onClick={() => void carregar()} disabled={carregando || !empresaId}
                        className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40">
                        {carregando ? 'Carregando…' : '🔎 Carregar'}
                    </button>
                </div>

                {empresaId && !carregando && !existe && itens.length === 0 && (
                    <p className="text-[11px] mt-3 text-amber-700 dark:text-amber-400">
                        ⚠ Nenhuma contagem gravada para esta empresa nesta data. Enquanto ela não existir, o
                        <strong> bloco H sai vazio</strong> na geração do SPED — e isso é de propósito.
                        Adicione as linhas abaixo com a contagem que a empresa fez.
                    </p>
                )}
            </div>

            {(itens.length > 0 || existe) && (
                <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex flex-wrap gap-3 items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>
                            <strong>{contados}</strong> de {itens.length} linha(s) com contagem · total{' '}
                            <strong>{fmtBRL(total)}</strong>
                        </span>
                        <div className="flex gap-2">
                            <button onClick={() => setItens(prev => [...prev, {
                                codItem: '', unidade: 'UN', qtdInventario: '', vlUnitInventario: '',
                                indPropInventario: '0', codPartInventario: '',
                            }])}
                                className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600">
                                + Linha
                            </button>
                            <button onClick={salvar} disabled={salvando}
                                className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                                {salvando ? 'Gravando…' : '💾 Gravar contagem'}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                                    <th className="py-1">Código do item</th><th>Un.</th>
                                    <th className="text-right">Quantidade</th>
                                    <th className="text-right">Valor unitário</th>
                                    <th className="text-right">Total</th>
                                    <th>Propriedade</th><th>Participante</th><th />
                                </tr>
                            </thead>
                            <tbody>
                                {itens.map((it, i) => {
                                    const semContagem = it.qtdInventario === '' || it.vlUnitInventario === '';
                                    const faltaParticipante = it.indPropInventario !== '0' && !it.codPartInventario;
                                    return (
                                        <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                                            <td className="py-1 pr-1">
                                                <input value={it.codItem} onChange={e => alterar(i, 'codItem', e.target.value)}
                                                    placeholder="cód. do 0200"
                                                    className="w-36 p-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-mono" />
                                            </td>
                                            <td className="pr-1">
                                                <input value={it.unidade} onChange={e => alterar(i, 'unidade', e.target.value.toUpperCase())}
                                                    className="w-14 p-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                                            </td>
                                            <td className="pr-1">
                                                <input type="number" step="0.001" value={it.qtdInventario}
                                                    onChange={e => alterar(i, 'qtdInventario', e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`w-24 p-1 rounded text-right bg-white dark:bg-slate-700 border ${semContagem ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="pr-1">
                                                <input type="number" step="0.000001" value={it.vlUnitInventario}
                                                    onChange={e => alterar(i, 'vlUnitInventario', e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`w-28 p-1 rounded text-right bg-white dark:bg-slate-700 border ${semContagem ? 'border-amber-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td className="text-right pr-2 font-semibold">
                                                {semContagem ? '—' : fmtBRL(Number(it.qtdInventario) * Number(it.vlUnitInventario))}
                                            </td>
                                            <td className="pr-1">
                                                <select value={it.indPropInventario} onChange={e => alterar(i, 'indPropInventario', e.target.value)}
                                                    className="p-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                                                    {PROPRIEDADE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                                                </select>
                                            </td>
                                            <td className="pr-1">
                                                <input value={it.codPartInventario} onChange={e => alterar(i, 'codPartInventario', e.target.value)}
                                                    disabled={it.indPropInventario === '0'}
                                                    placeholder={it.indPropInventario === '0' ? '—' : 'obrigatório'}
                                                    className={`w-28 p-1 rounded bg-white dark:bg-slate-700 border disabled:opacity-40 ${faltaParticipante ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`} />
                                            </td>
                                            <td>
                                                <button onClick={() => setItens(prev => prev.filter((_, idx) => idx !== i))}
                                                    className="px-2 text-red-600 dark:text-red-400" title="Remover linha">✕</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {contados < itens.length && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            ⚠ {itens.length - contados} linha(s) sem quantidade e valor unitário <strong>não serão
                            gravadas</strong> e ficarão de fora do arquivo. Isso é de propósito: item não contado
                            não vira zero.
                        </p>
                    )}
                    {itens.some(i => i.indPropInventario !== '0' && !i.codPartInventario) && (
                        <p className="text-[11px] text-red-700 dark:text-red-400">
                            🚨 Estoque de/em poder de terceiro exige o participante (COD_PART) — preencha ou volte
                            a propriedade para "do informante".
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default InventarioBlocoH;
