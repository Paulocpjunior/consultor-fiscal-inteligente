/**
 * LoteDareModal — gera o TXT do "Dare em Lote" (ICMS declarado em massa) no
 * formato documentado pela própria página do portal DARE (24/07/2026):
 *   CNPJ;servico;MM/AAAA;DD/MM/AAAA;valor;1   (máx 50/lote, ponto decimal)
 *
 * Fluxo: escolhe a competência → o app varre as fichas de TODAS as empresas
 * Lucro com ICMS informado (próprio 04601 / ST 14601) → confere a lista →
 * informa o vencimento → gera o TXT (validado no backend, auditado) → cola
 * no portal (humano resolve o reCAPTCHA) → portal devolve ZIP com os DAREs.
 * O app NUNCA calcula multa/juros estadual: flag "1" manda o portal calcular.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { LucroPresumidoEmpresa, User } from '../../types';
import * as lucroPresumidoService from '../../services/lucroPresumidoService';
import { acharFichaCompetencia } from '../../sefaz-backend/ipi-varredura.js';
import { fmtBRL } from '../../services/formatos';

interface Props {
    /**
     * O lote varre a ficha da competência em TODAS as empresas, então aqui a
     * ficha financeira é necessária mesmo — e por isso o modal a carrega
     * SOZINHO, ao abrir, em vez de a lista da tela carregar tudo o tempo todo
     * só porque este botão existe. Carga sob demanda: quem não clica não paga.
     */
    currentUser: User | null;
    onClose: () => void;
}

interface ItemLote {
    key: string;
    empresaId: string;
    cnpj: string;
    razaoSocial: string;
    codigoServico: '04601' | '14601';
    rotulo: string;
    valor: number;
    incluido: boolean;
}

const fmtCnpj = (c: string) => c.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const competenciaAnterior = (): string => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const LoteDareModal: React.FC<Props> = ({ currentUser, onClose }) => {
    const [empresas, setEmpresas] = useState<LucroPresumidoEmpresa[] | null>(null);
    const [erroCarga, setErroCarga] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        lucroPresumidoService.getEmpresas(currentUser)
            .then(e => { if (vivo) setEmpresas(e); })
            // Lista vazia aqui seria lida como "ninguém tem DARE nesta
            // competência" — conclusão errada sobre imposto a recolher.
            .catch(e => { if (vivo) setErroCarga(e?.message || 'falha ao carregar as empresas'); });
        return () => { vivo = false; };
    }, [currentUser]);
    const [competencia, setCompetencia] = useState(competenciaAnterior());
    const [vencimento, setVencimento] = useState('');
    const [itens, setItens] = useState<ItemLote[] | null>(null);
    const [texto, setTexto] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const [copiado, setCopiado] = useState(false);

    const varrer = () => {
        setErro(null); setTexto(null);
        const achados: ItemLote[] = [];
        for (const emp of (empresas || [])) {
            const cnpj = String(emp.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) continue;
            // RÉGUA ÚNICA (`acharFichaCompetencia`): `mesReferencia` aparece em
            // 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' — igualdade estrita deixaria
            // a empresa FORA do lote sem dizer por quê (guia que não sai).
            const ficha = acharFichaCompetencia(emp.fichaFinanceira, competencia);
            if (!ficha) continue;
            if ((ficha.icmsProprioRecolher || 0) > 0) {
                achados.push({
                    key: `${emp.id}-04601`, empresaId: emp.id, cnpj, razaoSocial: emp.nome || cnpj,
                    codigoServico: '04601', rotulo: 'ICMS Próprio (046-2)',
                    valor: ficha.icmsProprioRecolher || 0, incluido: true,
                });
            }
            if ((ficha.icmsStRecolher || 0) > 0) {
                achados.push({
                    key: `${emp.id}-14601`, empresaId: emp.id, cnpj, razaoSocial: emp.nome || cnpj,
                    codigoServico: '14601', rotulo: 'ICMS-ST (146-6)',
                    valor: ficha.icmsStRecolher || 0, incluido: true,
                });
            }
        }
        setItens(achados);
        if (!achados.length) setErro(`Nenhuma empresa com ICMS informado na ficha de ${competencia.split('-').reverse().join('/')}.`);
    };

    const selecionados = useMemo(() => (itens || []).filter(i => i.incluido), [itens]);
    const totalValor = useMemo(() => Math.round(selecionados.reduce((s, i) => s + i.valor * 100, 0)) / 100, [selecionados]);

    const gerar = async () => {
        setOcupado(true); setErro(null); setTexto(null);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada');
            const token = await u.getIdToken();
            const res = await fetch('/api/admin/dare/lote-txt', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itens: selecionados.map(i => ({
                        cnpj: i.cnpj, razaoSocial: i.razaoSocial, codigoServico: i.codigoServico,
                        referencia: competencia, valor: i.valor, vencimento,
                        empresaId: i.empresaId,
                    })),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setTexto(data.texto);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao gerar o lote.');
        } finally {
            setOcupado(false);
        }
    };

    const baixarTxt = () => {
        if (!texto) return;
        const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lote-dare-${competencia}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto my-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">🧾 Lote DARE-SP (ICMS declarado em massa)</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
                </div>

                <div className="flex gap-3 items-end flex-wrap">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Competência
                        <input type="month" value={competencia} onChange={e => { setCompetencia(e.target.value); setItens(null); setTexto(null); }}
                            className="mt-1 block p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Vencimento do imposto
                        <input type="date" value={vencimento} onChange={e => { setVencimento(e.target.value); setTexto(null); }}
                            className="mt-1 block p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm" />
                    </label>
                    {/* Varrer antes das fichas chegarem devolveria ZERO — e zero
                        aqui se lê como "ninguém tem DARE nesta competência", que é
                        conclusão errada sobre imposto a recolher. */}
                    <button
                        onClick={varrer}
                        disabled={empresas === null || !!erroCarga}
                        className="px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                    >
                        {empresas === null && !erroCarga ? '⏳ carregando fichas…' : '🔎 Varrer fichas'}
                    </button>
                </div>

                {erroCarga && (
                    <div className="text-xs text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
                        Não foi possível carregar as fichas ({erroCarga}). <strong>A varredura está bloqueada de propósito</strong> —
                        com a carga incompleta ela diria que ninguém tem DARE, e isso é o contrário de estar em dia. Feche e abra de novo.
                    </div>
                )}

                {erro && <div className="text-xs text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">{erro}</div>}

                {itens && itens.length > 0 && (
                    <>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-100 dark:bg-slate-700">
                                    <tr>
                                        <th className="px-2 py-1.5"></th>
                                        <th className="px-2 py-1.5 text-left">Empresa</th>
                                        <th className="px-2 py-1.5 text-left">Guia</th>
                                        <th className="px-2 py-1.5 text-right">Valor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {itens.map((i, idx) => (
                                        <tr key={i.key} className="border-t dark:border-slate-700">
                                            <td className="px-2 py-1 text-center">
                                                <input type="checkbox" checked={i.incluido}
                                                    onChange={() => setItens(prev => prev!.map((p, j) => j === idx ? { ...p, incluido: !p.incluido } : p))} />
                                            </td>
                                            <td className="px-2 py-1">
                                                <div className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[240px]">{i.razaoSocial}</div>
                                                <div className="font-mono text-[10px] text-slate-400">{fmtCnpj(i.cnpj)}</div>
                                            </td>
                                            <td className="px-2 py-1">{i.rotulo}</td>
                                            <td className="px-2 py-1 text-right font-mono font-bold">{fmtBRL(i.valor)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-slate-700 dark:text-slate-200">
                            <span>{selecionados.length} guia(s) selecionada(s) {selecionados.length > 50 && <span className="text-red-600">— máx 50/lote!</span>}</span>
                            <span>{fmtBRL(totalValor)}</span>
                        </div>

                        {!texto && (
                            <button onClick={gerar} disabled={ocupado || !vencimento || selecionados.length === 0 || selecionados.length > 50}
                                className="w-full px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                                title={!vencimento ? 'Informe a data de vencimento do imposto' : ''}>
                                {ocupado ? '⏳ Validando e gerando…' : '🧾 Gerar TXT do lote (valida tudo + registra auditoria)'}
                            </button>
                        )}
                    </>
                )}

                {texto && (
                    <div className="space-y-2">
                        <pre className="bg-slate-900 text-emerald-300 text-[11px] p-3 rounded-lg overflow-x-auto max-h-40">{texto}</pre>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={() => { navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }}
                                className="flex-1 px-3 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white">
                                {copiado ? '✓ Copiado!' : '📋 Copiar TXT'}
                            </button>
                            <button onClick={baixarTxt} className="px-3 py-2 text-sm font-bold rounded-lg bg-slate-600 hover:bg-slate-700 text-white">⬇ .txt</button>
                            <a href="https://www4.fazenda.sp.gov.br/DareICMS/DareLote" target="_blank" rel="noreferrer"
                                className="px-3 py-2 text-sm font-bold rounded-lg border border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30">
                                🌐 Dare em Lote
                            </a>
                        </div>
                        <p className="text-[10px] text-slate-400">
                            No portal: "Você já tem todos os dados e quer apenas copiar e colar de um documento .txt? CLIQUE AQUI" →
                            cola o texto → Gerar Dare → baixa o ZIP com todos os DAREs. Acréscimos por atraso (se houver) o
                            portal calcula (flag ";1"). Guias emitidas ficam registradas na auditoria do app.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoteDareModal;
