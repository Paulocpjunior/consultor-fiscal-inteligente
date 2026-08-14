/**
 * ServicosTomadosPanel — o R-2010 (retenção previdenciária sobre serviços
 * TOMADOS) visível antes de ser declarado.
 *
 * Paulo, 14/08: *"pode começar r-2010"*, na sequência de fechar o R-2055.
 *
 * ═══ POR QUE ESTA TELA ══════════════════════════════════════════════════════
 *
 * O núcleo (`reinf-servicos-tomados.js`) e a rota existem desde 12/08,
 * calibrados contra um `evtServTom` REAL com recibo de sucesso da Receita. Mas
 * ninguém no escritório conseguia VER o que vai ser declarado — e rota que
 * nenhuma tela chama não é funcionalidade, é código morto com cara de entrega
 * (mata-burro de 13/08).
 *
 * ═══ O QUE ELA MOSTRA, E POR QUÊ NESSA ORDEM ════════════════════════════════
 *
 * O achado que manda no módulo veio do arquivo aceito: **a BASE de retenção não
 * é o valor bruto** quando houve dedução de material/insumo (IN RFB 971, arts.
 * 121-124) — no evento de referência o bruto é 5.755,54 e a base é 4.604,43.
 * Declarar base = bruto ali seria declarar retenção sobre 25% a mais.
 *
 * Por isso a coluna BASE vem antes do total e nunca mostra número derivado como
 * se fosse o do documento: base estimada serve para CONFERIR, não para
 * declarar. Quem não tem base provada aparece com a causa do lado.
 *
 * ═══ O QUE A TELA NÃO FAZ ═══════════════════════════════════════════════════
 *
 * Conta nenhuma, e não transmite. A apuração é do núcleo; a transmissão é do
 * módulo Contábil pelo gateway. Tela de conferência que recalcula promete um
 * número diferente do que é declarado.
 */
import React, { useState } from 'react';
import { carregarServicosTomados, type PayloadR2010, type PrestadorR2010, type NotaR2010 } from '../../services/reinfServicosTomadosService';

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

const ServicosTomadosPanel: React.FC<Props> = ({ onShowToast }) => {
    const [cnpj, setCnpj] = useState('');
    const [competencia, setCompetencia] = useState(competenciaPadrao());
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [dados, setDados] = useState<PayloadR2010 | null>(null);
    const [aberto, setAberto] = useState<string | null>(null);

    const carregar = async () => {
        const d = cnpj.replace(/\D/g, '');
        if (d.length !== 14) { setErro('Informe o CNPJ do TOMADOR (14 dígitos) — é ele quem declara o R-2010.'); return; }
        setCarregando(true); setErro(null); setDados(null);
        try {
            const r = await carregarServicosTomados(d, competencia);
            setDados(r);
            onShowToast?.(`${r.resumo.prestadores} prestador(es) · ${brl(r.resumo.vlrTotalRetPrinc)} retido`);
        } catch (e: any) {
            setErro(e.message || 'Falha ao ler os serviços tomados.');
        }
        setCarregando(false);
    };

    return (
        <div className="space-y-3 animate-fade-in">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                <h3 className="text-sm font-bold mb-1">🧰 R-2010 — serviços tomados com retenção previdenciária</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                    As NFS-e <strong>tomadas</strong> com INSS retido da competência, do jeito que vão para o evento.
                    Aqui só se CONFERE: a apuração é do núcleo e a transmissão é do módulo Contábil.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[11px] font-semibold">
                        CNPJ do tomador
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
                                ['Prestadores', String(dados.resumo.prestadores)],
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
                            <strong>{dados.resumo.semRetencaoPrevidenciaria}</strong> nota(s) tomada(s) sem INSS retido
                            (a maioria não tem) e <strong>{dados.resumo.dePessoaFisica}</strong> de prestador pessoa
                            física — contribuinte individual entra pelo eSocial, não pelo R-2010.
                        </p>
                        {dados.documentosLidos === 0 && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                                ⚠️ Nenhum documento lido nesta competência. Lista vazia aqui <strong>não prova</strong> que
                                não houve retenção — confira a captura antes de dar o mês por fechado.
                            </p>
                        )}
                    </div>

                    {dados.prestadores.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Nenhum prestador com INSS retido nesta competência.
                        </p>
                    ) : (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                                    <tr className="text-left">
                                        <th className="p-2">Prestador</th>
                                        <th className="p-2 text-right">Bruto</th>
                                        <th className="p-2 text-right">Base de retenção</th>
                                        <th className="p-2 text-right">INSS retido</th>
                                        <th className="p-2">Notas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dados.prestadores.map((p: PrestadorR2010) => (
                                        <React.Fragment key={p.cnpjPrestador}>
                                            <tr className="border-t border-slate-100 dark:border-slate-700">
                                                <td className="p-2">
                                                    <span className="font-semibold text-slate-800 dark:text-slate-100">{p.nome || '—'}</span>
                                                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                                        {fmtCnpj(p.cnpjPrestador)}
                                                    </span>
                                                    {p.comPendencia > 0 && (
                                                        <span className="block text-[10px] text-amber-700 dark:text-amber-300">
                                                            {p.comPendencia} nota(s) pedem conferência
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-2 text-right font-mono text-slate-700 dark:text-slate-200">{brl(p.vlrTotalBruto)}</td>
                                                <td className="p-2 text-right font-mono">
                                                    {p.vlrTotalBaseRet === null ? (
                                                        <span className="text-amber-700 dark:text-amber-300" title="Base parcial num campo de base seria lida como a base inteira — por isso vem nula.">
                                                            não provada
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-700 dark:text-slate-200">{brl(p.vlrTotalBaseRet)}</span>
                                                    )}
                                                </td>
                                                <td className="p-2 text-right font-mono font-bold text-slate-800 dark:text-slate-100">{brl(p.vlrTotalRetPrinc)}</td>
                                                <td className="p-2">
                                                    <button
                                                        onClick={() => setAberto(aberto === p.cnpjPrestador ? null : p.cnpjPrestador)}
                                                        className="btn-press text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                                                    >
                                                        {aberto === p.cnpjPrestador ? 'ocultar' : `ver ${p.notas.length}`}
                                                    </button>
                                                </td>
                                            </tr>
                                            {aberto === p.cnpjPrestador && p.notas.map((n: NotaR2010, i: number) => (
                                                <tr key={`${p.cnpjPrestador}-${i}`} className="bg-slate-50 dark:bg-slate-900/40">
                                                    <td className="p-2 pl-6 text-[11px] text-slate-600 dark:text-slate-300" colSpan={5}>
                                                        <span className="font-semibold">nº {n.numero || '—'}</span>
                                                        {' · '}bruto {brl(n.vlrBruto)}
                                                        {' · '}retido {brl(n.inssRetido)}
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

                    {/* As ressalvas vêm do BACKEND — elas são parte do que o outro
                        app recebe, e repeti-las aqui à mão faria a tela e a
                        declaração divergirem. */}
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

export default ServicosTomadosPanel;
