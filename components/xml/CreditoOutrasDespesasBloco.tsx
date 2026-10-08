/**
 * 💳 CRÉDITO DE IPI / ICMS-ST LANÇADO EM "OUTRAS DESPESAS" (08/10).
 *
 * Paulo, FLANACAR (NF-e 419011 da HSCAR, devolução): o fornecedor informa o
 * IPI em outras despesas (Resposta à Consulta SEFAZ/SP 2020/2013 · SC COSIT
 * 159/2019) e o destinatário tem o crédito. O mesmo vale para o ICMS-ST.
 *
 * Quem escritura informa o valor ITEM A ITEM (alerta, nunca contorno: o CFI
 * não deduz do texto). Na escrituração o valor sai de "Outras despesas" e vira
 * IPI / ICMS-ST do item; o XML guardado não muda; o ajuste fica carimbado
 * (autor, data, motivo) e se desfaz.
 */
import React, { useState } from 'react';
import type { DocumentoFiscal } from '../../types';
import { formatCurrency } from '../../services/xmlParserService';
import { parseValorMoeda } from '../../services/valorDigitado';
import {
    validarAjusteCreditoOutras, sugereCreditoEmOutrasDespesas, MIN_MOTIVO_CREDITO,
} from '../../sefaz-backend/credito-outras-despesas.js';
import {
    gravarCreditoOutrasDespesas, desfazerCreditoOutrasDespesas, type AjusteCreditoOutras,
} from '../../services/creditoOutrasDespesasService';

interface Props {
    documento: DocumentoFiscal;
    /** A lista precisa reler depois de gravar/desfazer. */
    onSalvo?: () => void;
    onShowToast?: (msg: string) => void;
}

const brl = (n: number) => formatCurrency(Number(n) || 0);
const texto = (n: number | undefined) => (n ? String(n).replace('.', ',') : '');

const CreditoOutrasDespesasBloco: React.FC<Props> = ({ documento: d, onSalvo, onShowToast }) => {
    // undefined = ainda vale o que veio no documento; null = desfeito agora.
    const [ajusteLocal, setAjusteLocal] = useState<AjusteCreditoOutras | null | undefined>(undefined);
    const [aberto, setAberto] = useState(false);
    const [entrada, setEntrada] = useState<Record<number, { ipi: string; st: string }>>({});
    const [motivo, setMotivo] = useState('');
    const [gravando, setGravando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const doc: any = d;
    const itens: any[] = Array.isArray(doc.itens) ? doc.itens : [];
    const ajuste: AjusteCreditoOutras | null = ajusteLocal !== undefined ? ajusteLocal : (doc.ajusteCreditoOutrasDespesas || null);
    const outrasDaNota = Number(doc.totais?.vOutro) || 0;
    if (outrasDaNota <= 0 && !ajuste) return null;
    const sugere = !ajuste && sugereCreditoEmOutrasDespesas(doc);

    // Itens com outras despesas próprias primeiro; se nenhum tiver, todos.
    const comOutras = itens.map((it, indice) => ({ it, indice })).filter(({ it }) => Number(it.vOutro) > 0);
    const linhas = comOutras.length ? comOutras : itens.map((it, indice) => ({ it, indice }));

    const lido = linhas.map(({ indice }) => {
        const e = entrada[indice] || { ipi: '', st: '' };
        return { indice, ipi: e.ipi.trim() ? parseValorMoeda(e.ipi) : 0, st: e.st.trim() ? parseValorMoeda(e.st) : 0 };
    });
    const ilegivel = lido.some((l) => l.ipi === null || l.st === null);
    const conf = ilegivel
        ? { ok: false as const, erros: ['Valor ilegível — use o formato 4,19.'] }
        : validarAjusteCreditoOutras(doc, { itens: lido as Array<{ indice: number; ipi: number; st: number }>, motivo });

    const abrir = () => {
        const base: Record<number, { ipi: string; st: string }> = {};
        for (const l of ajuste?.itens || []) base[l.indice] = { ipi: texto(l.ipi), st: texto(l.st) };
        setEntrada(base);
        setMotivo(ajuste?.motivo || '');
        setErro(null);
        setAberto(true);
    };

    const gravar = async () => {
        if (!conf.ok) return;
        setGravando(true); setErro(null);
        try {
            const r = await gravarCreditoOutrasDespesas(d.id, { itens: conf.ajuste.itens, motivo });
            if (!r.ok) { setErro(r.erro); return; }
            setAjusteLocal(r.ajuste || null);
            setAberto(false);
            onShowToast?.(`💳 Crédito de ${brl(conf.ajuste.total)} lançado — sai de outras despesas e entra como IPI/ICMS-ST na escrituração.`);
            onSalvo?.();
        } finally {
            setGravando(false);
        }
    };

    const desfazer = async () => {
        if (!window.confirm('Desfazer o crédito? A nota volta a ser escriturada como veio no XML (tudo em outras despesas).')) return;
        setGravando(true); setErro(null);
        try {
            const r = await desfazerCreditoOutrasDespesas(d.id);
            if (!r.ok) { setErro(r.erro); return; }
            setAjusteLocal(null);
            setAberto(false);
            onShowToast?.('↩ Crédito desfeito — a nota volta a seguir o XML.');
            onSalvo?.();
        } finally {
            setGravando(false);
        }
    };

    return (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                💳 <strong>Crédito de IPI / ICMS-ST lançado em Outras despesas:</strong>{' '}
                {ajuste
                    ? <strong>{brl(ajuste.total)} creditado nesta nota{ajuste.autor?.email ? ` · por ${ajuste.autor.email}` : ''}{ajuste.em ? ` em ${new Date(ajuste.em).toLocaleString('pt-BR')}` : ''}</strong>
                    : <span>a nota traz {brl(outrasDaNota)} em outras despesas.</span>}
            </p>
            {sugere && (
                <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    ⚠️ As informações adicionais citam IPI/ST e há valor em outras despesas. Na devolução, o fornecedor pode informar o
                    imposto ali (RC SEFAZ/SP 2020/2013 · SC COSIT 159/2019) — confira e, se for o caso, lance o crédito abaixo.
                </p>
            )}
            {ajuste && (
                <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                    {ajuste.itens.map((l) => (
                        <div key={l.indice}>
                            Item {l.indice + 1} ({itens[l.indice]?.xProd || '—'}):
                            {l.ipi > 0 ? ` IPI ${brl(l.ipi)}` : ''}{l.st > 0 ? ` · ICMS-ST ${brl(l.st)}` : ''}
                        </div>
                    ))}
                    <div className="text-slate-400 dark:text-slate-500">Motivo: {ajuste.motivo}</div>
                </div>
            )}
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                Na escrituração o valor sai de outras despesas e vira IPI / ICMS-ST do item (CST IPI 00 — entrada com crédito): C100,
                C170, C190, E510 e E520. O total da nota não muda e o XML guardado fica como veio. O E210 (devolução de ST) não é somado
                sozinho — o SPED avisa.
            </p>
            {!aberto ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    <button
                        onClick={abrir}
                        className="text-xs rounded-md border border-indigo-300 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 btn-press whitespace-nowrap"
                    >💳 {ajuste ? 'Alterar o crédito' : 'Lançar crédito de IPI/ST'}</button>
                    {ajuste && (
                        <button onClick={desfazer} disabled={gravando}
                            className="text-xs rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 btn-press whitespace-nowrap disabled:opacity-50"
                        >↩ desfazer</button>
                    )}
                </div>
            ) : (
                <div className="mt-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/10 p-3">
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead>
                                <tr className="text-left text-indigo-900 dark:text-indigo-300">
                                    <th className="px-1.5 py-1">Item</th>
                                    <th className="px-1.5 py-1">Produto</th>
                                    <th className="px-1.5 py-1 text-right">Outras desp.</th>
                                    <th className="px-1.5 py-1">IPI (R$)</th>
                                    <th className="px-1.5 py-1">ICMS-ST (R$)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(({ it, indice }) => (
                                    <tr key={indice}>
                                        <td className="px-1.5 py-1 text-slate-400">{indice + 1}</td>
                                        <td className="px-1.5 py-1 max-w-[180px] truncate" title={it.xProd}>{it.xProd || '—'}</td>
                                        <td className="px-1.5 py-1 text-right">{Number(it.vOutro) > 0 ? brl(it.vOutro) : '—'}</td>
                                        {(['ipi', 'st'] as const).map((k) => (
                                            <td key={k} className="px-1.5 py-1">
                                                <input
                                                    value={entrada[indice]?.[k] || ''}
                                                    onChange={(e) => setEntrada((x) => ({
                                                        ...x, [indice]: { ipi: x[indice]?.ipi || '', st: x[indice]?.st || '', [k]: e.target.value },
                                                    }))}
                                                    className="w-24 rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1 text-xs"
                                                    placeholder="0,00"
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <label className="mt-2 block text-[11px] text-indigo-900 dark:text-indigo-300">
                        Motivo (mínimo {MIN_MOTIVO_CREDITO} caracteres)
                        <textarea
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={2}
                            className="mt-0.5 block w-full rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1.5 text-xs"
                            placeholder='Ex.: devolução — IPI informado em outras despesas ("VALOR DO IPI R$ 4,19" nas inf. complementares), RC SEFAZ/SP 2020/2013'
                        />
                    </label>
                    {!conf.ok && (
                        <ul className="mt-2 text-[11px] text-red-700 dark:text-red-300 list-disc pl-4">
                            {conf.erros.map((e) => <li key={e}>{e}</li>)}
                        </ul>
                    )}
                    {conf.ok && (
                        <p className="mt-2 text-[11px] text-indigo-900 dark:text-indigo-300">
                            Crédito: {brl(conf.ajuste.total)} de {brl(outrasDaNota)} em outras despesas.
                        </p>
                    )}
                    {erro && <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erro}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                            onClick={gravar}
                            disabled={gravando || !conf.ok}
                            className="text-xs rounded-md bg-indigo-600 text-white px-3 py-1.5 font-semibold hover:bg-indigo-700 disabled:opacity-50 btn-press whitespace-nowrap"
                        >{gravando ? 'gravando…' : '💳 Gravar crédito'}</button>
                        <button onClick={() => { setAberto(false); setErro(null); }}
                            className="text-xs underline text-slate-500 btn-press">cancelar</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreditoOutrasDespesasBloco;
