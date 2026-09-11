/**
 * 📅 Competência do acervo — a nota já gravada no mês errado.
 *
 * A metade que 03/09 deixou nomeada: os quatro trilhos passaram a gravar a
 * competência pelo FATO GERADOR, e o que já estava no banco continuou no mês da
 * EMISSÃO. Em SP a nota de 31/08 pode ser emitida até 10/09, então ela está
 * gravada em SETEMBRO justamente quando se fecha AGOSTO.
 *
 * 🚨 O QUE ESTA TELA NÃO FAZ: corrigir sozinha. Mudar o mês de uma nota mexe em
 * livro que pode já ter sido entregue — então é uma nota por clique, com motivo
 * escrito e a consequência dita ANTES.
 */
import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import EmpresaSearchSelect from './EmpresaSearchSelect';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import {
    lerFilaCompetencia, corrigirCompetencia,
    type FilaCompetenciaAcervo, type NotaNoMesErrado,
} from '../../services/competenciaAcervoService';

const mesAtual = () => new Date().toISOString().slice(0, 7);
const porExtenso = (iso: string | null) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[2]}/${m[1]}` : '—';
};
const brl = (v: number | null) =>
    typeof v === 'number' && Number.isFinite(v)
        ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '—';

interface Props {
    currentUser: User;
    onShowToast?: (m: string) => void;
}

const CompetenciaAcervoPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const empresaAtivaId = useEmpresaAtivaId();
    const [empresaId, setEmpresaId] = useState(empresaAtivaId || '');
    const [competencia, setCompetencia] = useState(mesAtual());
    const [fila, setFila] = useState<FilaCompetenciaAcervo | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [motivos, setMotivos] = useState<Record<string, string>>({});
    const [corrigindo, setCorrigindo] = useState<string | null>(null);
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);

    useEffect(() => {
        let vivo = true;
        if (currentUser) getEmpresasDisponiveis(currentUser).then((l) => { if (vivo) setEmpresas(l); });
        return () => { vivo = false; };
    }, [currentUser]);

    const carregar = async () => {
        if (!empresaId) return;
        setCarregando(true);
        setFila(null);
        const r = await lerFilaCompetencia(empresaId, competencia);
        setFila(r);
        setCarregando(false);
    };

    const corrigir = async (nota: NotaNoMesErrado) => {
        if (!nota.id) return;
        const motivo = motivos[nota.id] || '';
        setCorrigindo(nota.id);
        const r = await corrigirCompetencia(nota.id, motivo);
        setCorrigindo(null);
        if (!r.ok) { onShowToast?.(`Não deu para corrigir: ${r.erro}`); return; }
        onShowToast?.(r.aviso || `Nota movida para ${porExtenso(r.para || null)}.`);
        await carregar();
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                    📅 Competência do acervo
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
                    Em São Paulo a nota de 31/08 pode ser emitida até 10/09. Quem decide o mês é o
                    <strong> fato gerador</strong>, não a emissão. Notas capturadas até 03/09 foram gravadas
                    pela emissão e podem estar no mês errado: elas somem do Livro de Serviços e do ISS do mês
                    a que pertencem, e aparecem no mês seguinte.
                </p>
            </div>

            <div className="flex flex-wrap gap-3 items-end">
                <div className="min-w-[260px] flex-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Empresa</label>
                    <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId} />
                </div>
                <div>
                    <label htmlFor="comp-acervo" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Competência que está fechando
                    </label>
                    <input
                        id="comp-acervo" type="month" value={competencia}
                        onChange={(e) => setCompetencia(e.target.value)}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
                    />
                </div>
                <button
                    type="button" onClick={carregar} disabled={!empresaId || carregando}
                    title={!empresaId ? 'Escolha a empresa primeiro' : ''}
                    className="btn-press px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                >
                    {carregando ? 'Conferindo…' : '🔎 Conferir competências'}
                </button>
            </div>

            {fila && !fila.ok && (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
                    ⛔ {fila.erro}
                </div>
            )}

            {fila?.avisoLeitura && (
                <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-100">
                    ⚠️ {fila.avisoLeitura}
                </div>
            )}

            {fila?.ok && (
                <>
                    <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm">
                        <p className="text-gray-800 dark:text-gray-200 font-medium">{fila.resumo}</p>
                        <p className="text-gray-600 dark:text-gray-400 mt-1 text-xs">{fila.alcance}</p>
                        {fila.contagem && (
                            <p className="text-gray-600 dark:text-gray-400 mt-2 text-xs">
                                Conferem: {fila.contagem.conferem} · sem data de fato gerador: {fila.contagem.semFatoGerador}
                                {' '}· já corrigidas: {fila.contagem.jaCorrigidas} · ilegíveis: {fila.contagem.ilegiveis}
                            </p>
                        )}
                    </div>

                    {fila.paraCorrigir.map((n) => (
                        <div
                            key={n.id || n.numero}
                            className="p-4 rounded-md border-l-4 border-amber-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2"
                        >
                            <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-semibold text-gray-900 dark:text-gray-100">
                                    Nota {n.numero || '—'}
                                </span>
                                <span className="text-sm text-gray-600 dark:text-gray-400">{n.prestador || '—'}</span>
                                <span className="text-sm text-gray-600 dark:text-gray-400 ml-auto tabular-nums">{brl(n.valor)}</span>
                            </div>
                            <p className="text-sm text-gray-800 dark:text-gray-200">
                                <strong>{porExtenso(n.competenciaGravada)}</strong> → <strong>{porExtenso(n.competenciaCerta)}</strong>
                            </p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">{n.motivo}</p>
                            <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                ⚠️ {n.consequencia}
                            </p>
                            <div className="flex flex-wrap gap-2 items-end">
                                <div className="flex-1 min-w-[240px]">
                                    <label htmlFor={`motivo-${n.id}`} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                                        Por que está corrigindo? (mínimo 15 caracteres)
                                    </label>
                                    <input
                                        id={`motivo-${n.id}`} type="text"
                                        value={motivos[n.id || ''] || ''}
                                        onChange={(e) => setMotivos((m) => ({ ...m, [n.id || '']: e.target.value }))}
                                        placeholder="ex.: fato gerador 31/08 conferido no portal"
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-sm"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => corrigir(n)}
                                    disabled={corrigindo === n.id || (motivos[n.id || ''] || '').trim().length < 15}
                                    title={(motivos[n.id || ''] || '').trim().length < 15
                                        ? 'Escreva o motivo (mínimo 15 caracteres) para liberar'
                                        : `Move a nota para ${porExtenso(n.competenciaCerta)}`}
                                    className="btn-press px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                                >
                                    {corrigindo === n.id ? 'Corrigindo…' : `📅 Mover para ${porExtenso(n.competenciaCerta)}`}
                                </button>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

export default CompetenciaAcervoPanel;
