/**
 * ServicosPrestadosPanel — o R-2020 (retenção previdenciária SOFRIDA em
 * serviços PRESTADOS) visível antes de ser declarado.
 *
 * Paulo, 08/09: *"preciso gerar a REINF de INSS de serviços prestados e não
 * está habilitado, pode liberar"* — com o `evtServPrest` aceito em produção.
 *
 * É o espelho do R-2010: lá o cliente é o TOMADOR e a lista é por prestador;
 * aqui o cliente é o PRESTADOR e a lista é por TOMADOR, que é o eixo do evento
 * (`ideEstabPrest > ideTomador > nfs`).
 *
 * ═══ O QUE ELA MOSTRA ═══════════════════════════════════════════════════════
 *
 * A BASE vem antes do total e nunca mostra número derivado como se fosse o do
 * documento (IN RFB 971, arts. 121-124). E o INSS retido que veio de DECLARAÇÃO
 * (✍️ ajuste, caso FRONTINI de 04/09) sai carimbado com quem informou — quem
 * conferir precisa saber que aquele número não saiu do documento.
 *
 * ═══ O QUE A TELA NÃO FAZ ═══════════════════════════════════════════════════
 *
 * Conta nenhuma, e não transmite. A apuração é do núcleo; a transmissão é do
 * módulo Contábil pelo gateway.
 */
import React, { useState } from 'react';
import { carregarServicosPrestados, type PayloadR2020, type TomadorR2020, type NotaR2020 } from '../../services/reinfServicosPrestadosService';

interface Props { onShowToast?: (msg: string) => void }

const brl = (n?: number | null) =>
    n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c?: string | null) => {
    const d = String(c || '').replace(/\D/g, '');
    if (d.length !== 14) return d || '—';
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const competenciaPadrao = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Cada situação da conferência tem uma AÇÃO diferente — por isso cor própria. */
const COR_SITUACAO: Record<string, string> = {
    'base-e-o-bruto': 'text-emerald-700 dark:text-emerald-300',
    'aliquota-ambigua-cprb-ou-deducao': 'text-red-700 dark:text-red-300',
    'base-deduzida-nao-informada': 'text-amber-700 dark:text-amber-300',
    'aliquota-fora-da-regua': 'text-red-700 dark:text-red-300',
    'sem-dados': 'text-red-700 dark:text-red-300',
};

const ServicosPrestadosPanel: React.FC<Props> = ({ onShowToast }) => {
    const [cnpj, setCnpj] = useState('');
    const [competencia, setCompetencia] = useState(competenciaPadrao());
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [dados, setDados] = useState<PayloadR2020 | null>(null);
    const [aberto, setAberto] = useState<string | null>(null);

    const carregar = async () => {
        const d = cnpj.replace(/\D/g, '');
        if (d.length !== 14) { setErro('Informe o CNPJ do PRESTADOR (14 dígitos) — é ele quem declara o R-2020.'); return; }
        setCarregando(true); setErro(null); setDados(null);
        try {
            const r = await carregarServicosPrestados(d, competencia);
            setDados(r);
            onShowToast?.(`${r.resumo.tomadores} tomador(es) · ${brl(r.resumo.vlrTotalRetPrinc)} retido`);
        } catch (e: any) {
            setErro(e.message || 'Falha ao ler os serviços prestados.');
        }
        setCarregando(false);
    };

    return (
        <div className="space-y-3 animate-fade-in">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                <h3 className="text-sm font-bold mb-1">🛠️ R-2020 — serviços prestados com retenção previdenciária sofrida</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                    As NFS-e <strong>prestadas</strong> pelo cliente em que o tomador reteve o INSS (11%, art. 31 da
                    Lei 8.212/91), agrupadas por <strong>tomador</strong> — que é o eixo do evento. Aqui só se CONFERE:
                    a apuração é do núcleo e a transmissão é do módulo Contábil.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[11px] font-semibold">
                        CNPJ do prestador (o cliente)
                        <input
                            value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00"
                            className="block mt-1 w-52 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                    </label>
                    <label className="text-[11px] font-semibold">
                        Competência
                        <input
                            type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                    </label>
                    <button
                        onClick={carregar} disabled={carregando}
                        className="btn-press px-3 py-1.5 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
                    >
                        {carregando ? 'Lendo…' : '🔎 Conferir a competência'}
                    </button>
                </div>
            </div>

            {erro && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-800 dark:text-red-200">
                    {erro}
                </div>
            )}

            {dados && (
                <>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            {dados.empresa?.nome || fmtCnpj(dados.empresa?.cnpj)}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-center">
                            {[
                                ['Tomadores', String(dados.resumo.tomadores)],
                                ['Notas', String(dados.resumo.notas)],
                                ['Bruto', brl(dados.resumo.vlrTotalBruto)],
                                ['INSS retido', brl(dados.resumo.vlrTotalRetPrinc)],
                            ].map(([r, v]) => (
                                <div key={r} className="rounded bg-slate-50 dark:bg-slate-900/50 p-2">
                                    <p className="text-[10px] uppercase text-slate-500 dark:text-slate-400">{r}</p>
                                    <p className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100">{v}</p>
                                </div>
                            ))}
                        </div>
                        {/* O que ficou de FORA precisa aparecer: some da lista é o
                            que faz alguém achar que declarou tudo. */}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                            Fora desta lista, e não é ausência de obrigação:{' '}
                            <strong>{dados.resumo.semRetencaoPrevidenciaria}</strong> nota(s) prestada(s) sem INSS retido
                            (a maioria não tem), <strong>{dados.resumo.tomadorPessoaFisica}</strong> de tomador pessoa
                            física (PF não retém a contribuição do art. 31) e{' '}
                            <strong>{dados.resumo.semTomadorLegivel}</strong> sem CNPJ do tomador legível.
                            {dados.resumo.comAjuste > 0 && (
                                <> {' '}<strong>{dados.resumo.comAjuste}</strong> nota(s) com o INSS informado à mão (✍️ ajuste declarado).</>
                            )}
                        </p>
                        {dados.documentosLidos === 0 && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                                ⚠️ Nenhum documento lido nesta competência. Lista vazia aqui <strong>não prova</strong> que
                                não houve retenção — confira a captura antes de dar o mês por fechado.
                            </p>
                        )}
                    </div>

                    {dados.tomadores.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Nenhum tomador com INSS retido nesta competência.
                        </p>
                    ) : (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                                    <tr className="text-left">
                                        <th className="p-2">Tomador</th>
                                        <th className="p-2 text-right">Bruto</th>
                                        <th className="p-2 text-right">Base de retenção</th>
                                        <th className="p-2 text-right">INSS retido</th>
                                        <th className="p-2">Notas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dados.tomadores.map((t: TomadorR2020) => (
                                        <React.Fragment key={t.cnpjTomador}>
                                            <tr className="border-t border-slate-100 dark:border-slate-700">
                                                <td className="p-2">
                                                    <span className="font-semibold text-slate-800 dark:text-slate-100">{t.nome || '—'}</span>
                                                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                                        {fmtCnpj(t.cnpjTomador)}
                                                    </span>
                                                    {t.comPendencia > 0 && (
                                                        <span className="block text-[10px] text-amber-700 dark:text-amber-300">
                                                            {t.comPendencia} nota(s) pedem conferência
                                                        </span>
                                                    )}
                                                    {t.comAjuste > 0 && (
                                                        <span className="block text-[10px] text-sky-700 dark:text-sky-300">
                                                            ✍️ {t.comAjuste} nota(s) com INSS informado à mão
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-2 text-right font-mono text-slate-700 dark:text-slate-200">{brl(t.vlrTotalBruto)}</td>
                                                <td className="p-2 text-right font-mono">
                                                    {t.vlrTotalBaseRet === null ? (
                                                        <span className="text-amber-700 dark:text-amber-300" title="Base parcial num campo de base seria lida como a base inteira — por isso vem nula.">
                                                            não provada
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-700 dark:text-slate-200">{brl(t.vlrTotalBaseRet)}</span>
                                                    )}
                                                </td>
                                                <td className="p-2 text-right font-mono font-bold text-slate-800 dark:text-slate-100">{brl(t.vlrTotalRetPrinc)}</td>
                                                <td className="p-2">
                                                    <button
                                                        onClick={() => setAberto(aberto === t.cnpjTomador ? null : t.cnpjTomador)}
                                                        className="btn-press text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                                                    >
                                                        {aberto === t.cnpjTomador ? 'ocultar' : `ver ${t.notas.length}`}
                                                    </button>
                                                </td>
                                            </tr>
                                            {aberto === t.cnpjTomador && t.notas.map((n: NotaR2020, i: number) => (
                                                <tr key={`${t.cnpjTomador}-${i}`} className="bg-slate-50 dark:bg-slate-900/40">
                                                    <td className="p-2 pl-6 text-[11px] text-slate-600 dark:text-slate-300" colSpan={5}>
                                                        <span className="font-semibold">nº {n.numero || '—'}</span>
                                                        {' · '}bruto {brl(n.vlrBruto)}
                                                        {' · '}retido {brl(n.inssRetido)}
                                                        {n.inssOrigem === 'ajuste-declarado' && (
                                                            <span className="text-sky-700 dark:text-sky-300">
                                                                {' '}(✍️ informado por {n.ajuste?.autor || 'autor não gravado'}{n.ajuste?.motivo ? ` — ${n.ajuste.motivo}` : ''})
                                                            </span>
                                                        )}
                                                        {n.conferencia.aliquotaAparente !== null && (
                                                            <> {' · '}<span className="font-mono">{n.conferencia.aliquotaAparente}%</span></>
                                                        )}
                                                        <span className={`block mt-0.5 ${COR_SITUACAO[n.conferencia.situacao] || ''}`}>
                                                            {n.conferencia.motivo}
                                                        </span>
                                                        {n.conferencia.acao && (
                                                            <span className="block text-slate-500 dark:text-slate-400">→ {n.conferencia.acao}</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* As ressalvas vêm do BACKEND — repeti-las aqui à mão faria
                        a tela e a declaração divergirem. */}
                    {dados.ressalvas?.length > 0 && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                            <p className="text-xs font-bold text-amber-900 dark:text-amber-200 mb-1">
                                Antes de declarar — o que este app NÃO sabe
                            </p>
                            <ul className="space-y-1">
                                {dados.ressalvas.map((r, i) => (
                                    <li key={i} className="text-[11px] text-amber-900 dark:text-amber-200">· {r}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ServicosPrestadosPanel;
