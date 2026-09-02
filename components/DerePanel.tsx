/**
 * 🏦 DerePanel — a DeRE (Declaração de Regimes Específicos, IBS/CBS) na carteira.
 *
 * Paulo, 02/09: *"crie uma nova função capaz de atender esta obrigação chamada
 * DERE"*. O que o CFI RESPONDE aqui: quem está obrigado (pelo cadastro), quem
 * PARECE estar (pelo CNAE — sugestão, não decisão), quando vence e quais
 * eventos a competência exige.
 *
 * ⚠️ O que ele NÃO faz vai na cara da tela: o app não gera nem transmite os
 * eventos. Os leiautes 1.1.0 e o manual do desenvolvedor estão LIDOS e
 * servidos aqui (PDF), mas o XSD não está no repo, o insumo (plano de contas,
 * balancete) é contábil e a transmissão exige credencial do piloto da Reforma.
 * Prometer geração aqui seria a promessa que a tela não cumpre (a lição do ✕
 * de 14/08).
 *
 * É consulta PURA — mesma figura da triagem do terceiro setor: o link leva ao
 * cadastro, e é lá que uma PESSOA marca o regime.
 */
import React, { useState } from 'react';
import { auth } from '../services/firebaseConfig';
import type { TriagemDere, LinhaDere } from '../sefaz-backend/dere';

const fmtCnpj = (c?: string | null) =>
    String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || '—';
const fmtIso = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

const competenciaPadrao = () => {
    // A 1ª competência da DeRE é 10/2026: antes dela a tela não tem o que
    // cobrar, então abre já nela — quem quiser outra troca no campo.
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const atual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return atual < '2026-10' ? '2026-10' : atual;
};

const ROTULO_SITUACAO: Record<string, string> = {
    obrigada: 'OBRIGADA',
    'ainda-nao-vigente': 'obrigada — a partir de 10/2026',
    candidata: 'a confirmar (CNAE sugere)',
    'regime-fora-do-leiaute': 'regime específico marcado — fora do leiaute vigente',
    'nao-se-aplica': 'não se aplica (cadastro)',
    'dispensada-simples': 'Simples Nacional — fora',
    'sem-sinal': 'sem sinal',
};

const DerePanel: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [competencia, setCompetencia] = useState(competenciaPadrao());
    const [r, setR] = useState<TriagemDere | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const rodar = async () => {
        setErro(null);
        setCarregando(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const resp = await fetch(`/api/admin/cadastro/dere-carteira?competencia=${encodeURIComponent(competencia)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j = await resp.json();
            if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
            setR(j);
            onShowToast?.(`DeRE ${j.competencia}: ${j.resumo.obrigadas} obrigada(s) · ${j.resumo.candidatas} a confirmar.`);
        } catch (e: any) {
            // Falha de leitura NÃO vira "ninguém está na DeRE" — lista vazia por
            // erro seria lida como carteira limpa.
            setErro(e?.message || 'Falha ao consultar. A lista abaixo pode estar incompleta.');
        } finally {
            setCarregando(false);
        }
    };

    const Tabela: React.FC<{ linhas: LinhaDere[]; comPrazo?: boolean }> = ({ linhas, comPrazo }) => (
        <table className="w-full text-xs mt-2">
            <thead className="text-slate-500">
                <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                    <th className="py-1 pr-2">Empresa</th>
                    <th className="py-1 pr-2">CNPJ</th>
                    <th className="py-1 pr-2">Regime específico</th>
                    <th className="py-1 pr-2">{comPrazo ? 'Vence' : 'Por quê / o que fazer'}</th>
                </tr>
            </thead>
            <tbody>
                {linhas.map(l => (
                    <tr key={l.id || l.cnpj || l.nome} className="border-b border-slate-100 dark:border-slate-800 align-top">
                        <td className="py-1 pr-2">{l.nome}
                            <span className="block text-[10px] text-slate-400">{l.regimeTributario || 'regime deduzido'}{l.cnae ? ` · CNAE ${l.cnae}` : ''}</span>
                        </td>
                        <td className="py-1 pr-2 font-mono whitespace-nowrap">{fmtCnpj(l.cnpj)}</td>
                        <td className="py-1 pr-2">{l.regimeEspecificoRotulo || (l.sinalCnae ? <span className="text-amber-600">sugere: {l.sinalCnae}</span> : '—')}</td>
                        <td className="py-1 pr-2 text-slate-600 dark:text-slate-300">
                            {comPrazo
                                ? <strong>{l.prazoTexto || '—'}</strong>
                                : <>{l.motivo}{l.acao ? <span className="block text-blue-700 dark:text-blue-300 mt-0.5">→ {l.acao}</span> : null}</>}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );

    return (
        <div className="text-xs">
            <h4 className="font-bold text-slate-700 dark:text-slate-200">🏦 DeRE — Declaração de Regimes Específicos (IBS/CBS)</h4>
            <p className="mt-1 text-slate-500">
                Obrigação mensal da reforma tributária (LC 214/2025) para quem fornece sob <strong>regime
                específico</strong> de IBS/CBS — serviços financeiros, planos de saúde, loterias e afins.
                Vence no <strong>dia 15 do mês seguinte</strong>; a primeira competência é <strong>10/2026</strong>
                (entrega até 15/11/2026). Optante do Simples fica fora.
            </p>
            <p className="mt-1 text-slate-500">
                O app <strong>não deduz</strong> quem está na DeRE: quem afirma é o cadastro
                (Empresas → Dados Fiscais → <strong>Regime específico de IBS/CBS</strong>). O que ele faz é
                a fila — quem está, quem <em>parece</em> estar pelo CNAE, e quando vence.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-slate-500">Competência</label>
                <input
                    type="month"
                    value={competencia}
                    onChange={e => setCompetencia(e.target.value)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                />
                <button
                    onClick={rodar}
                    disabled={carregando || !competencia}
                    className="btn-press px-4 py-2 rounded-lg bg-blue-700 text-white font-bold disabled:opacity-40 whitespace-nowrap"
                >{carregando ? 'Consultando…' : '🔎 Levantar a carteira'}</button>
            </div>

            {erro && (
                <div className="mt-2 rounded-lg border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-2 text-red-700 dark:text-red-300">
                    {erro}
                </div>
            )}

            {r && (
                <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                        <p className="text-slate-600 dark:text-slate-300">
                            Competência <strong>{r.competencia}</strong> ·{' '}
                            {r.vigente
                                ? <>vence em <strong>{r.prazoTexto}</strong> (dia 15 do mês seguinte, antecipado se não for dia útil)</>
                                : <>a DeRE <strong>ainda não vigora</strong> nesta competência — começa em {r.vigenciaDesde}</>}
                        </p>
                        <p className="mt-1 text-slate-600 dark:text-slate-300">
                            <strong>{r.resumo.obrigadas}</strong> obrigada(s) · <strong>{r.resumo.candidatas}</strong> a confirmar ·{' '}
                            {r.resumo.foraDoLeiaute} com regime fora do leiaute · {r.resumo.naoSeAplica} marcada(s) "não se aplica" ·{' '}
                            {r.resumo.dispensadasSimples} do Simples (fora) · {r.resumo.semSinal} sem sinal · de {r.resumo.total}.
                        </p>
                    </div>

                    <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-2 text-amber-800 dark:text-amber-300">
                        ⚠️ <strong>O CFI não gera nem transmite os eventos da DeRE.</strong> Os leiautes
                        oficiais e o manual do desenvolvedor estão lidos e servidos abaixo — mas o XSD não está
                        no app, o insumo dos eventos (plano de contas comentado, balancete mensal) é contábil, e
                        a transmissão exige credencial do piloto da Reforma (procuração no e-CAC + portal da
                        produção restrita). A entrega é por fora; o mês do cliente passa a cobrar a obrigação,
                        e ela se registra em Vencimentos como entregue fora do app.
                    </div>

                    <div>
                        <h5 className="font-bold text-slate-700 dark:text-slate-200">
                            Obrigadas ({r.obrigadas.length} estabelecimento(s) · <strong>{r.resumo.declaracoes} declaração(ões)</strong>)
                        </h5>
                        <p className="text-slate-500">
                            A declaração é por <strong>CNPJ raiz</strong> ({'{'}nrInsc{'}'} tem 8 posições): matriz e filiais
                            entram numa só. O número que importa é o de declarações.
                        </p>
                        {r.obrigadas.length
                            ? <Tabela linhas={r.obrigadas} comPrazo />
                            : <p className="text-slate-500 mt-1">Nenhuma empresa com regime específico obrigado marcado no cadastro.</p>}
                        {r.declaracoes.some(d => d.regimesDivergem) && (
                            <p className="mt-1 text-red-700 dark:text-red-300">
                                ⚠️ Há raiz com estabelecimentos em regimes específicos DIFERENTES no cadastro — o D-1001 é um por
                                raiz, então um dos cadastros está errado. O app não escolhe: confira em Dados Fiscais.
                            </p>
                        )}
                        {!!r.obrigadasSemRaiz.length && (
                            <p className="mt-1 text-amber-700 dark:text-amber-300">
                                ⚠️ {r.obrigadasSemRaiz.length} obrigada(s) com CNPJ ilegível no cadastro — não dá para dizer a qual
                                declaração pertencem.
                            </p>
                        )}
                    </div>

                    <div>
                        <h5 className="font-bold text-slate-700 dark:text-slate-200">A confirmar — o CNAE sugere ({r.candidatas.length})</h5>
                        {r.candidatas.length
                            ? <Tabela linhas={r.candidatas} />
                            : <p className="text-slate-500 mt-1">Nenhuma empresa sem cadastro com CNAE de serviços financeiros, planos de saúde ou loterias.</p>}
                    </div>

                    {!!r.foraDoLeiaute.length && (
                        <div>
                            <h5 className="font-bold text-slate-700 dark:text-slate-200">Regime específico marcado, mas FORA do leiaute vigente ({r.foraDoLeiaute.length})</h5>
                            <p className="text-slate-500">
                                O D-1001 só tem grupo para serviços financeiros, planos de saúde e concursos de prognósticos. Estes
                                regimes não têm como ser declarados hoje — nada a entregar; se uma versão futura do leiaute os
                                incluir, o app passa a cobrar sozinho.
                            </p>
                            <Tabela linhas={r.foraDoLeiaute} />
                        </div>
                    )}

                    {!!r.naoSeAplica.length && (
                        <details>
                            <summary className="cursor-pointer text-slate-500">{r.naoSeAplica.length} marcada(s) "não se aplica" no cadastro</summary>
                            <Tabela linhas={r.naoSeAplica} />
                        </details>
                    )}

                    <details>
                        <summary className="cursor-pointer text-slate-500">Cronograma oficial e eventos da competência</summary>
                        <ul className="mt-1 space-y-1 text-slate-600 dark:text-slate-300">
                            {r.cronograma.map(m => (
                                <li key={m.dataIso}><strong>{fmtIso(m.dataIso)}</strong> — {m.marco} <span className="text-slate-400">{m.detalhe}</span></li>
                            ))}
                        </ul>
                        {r.vigente && (
                            <div className="mt-2">
                                <p className="text-slate-600 dark:text-slate-300"><strong>Eventos de tabela</strong> (uma vez, antes da 1ª escrituração):</p>
                                <ul className="ml-4 list-disc">{r.eventos.tabela.map(e => <li key={e.codigo}><code>{e.codigo}</code> {e.nome}{e.nota ? <span className="text-slate-400"> — {e.nota}</span> : null}</li>)}</ul>
                                <p className="mt-1 text-slate-600 dark:text-slate-300"><strong>Eventos mensais</strong> desta competência:</p>
                                <ul className="ml-4 list-disc">{r.eventos.mensais.map(e => (
                                    <li key={e.codigo}>
                                        <code>{e.codigo}</code> {e.nome}
                                        {e.condicional ? <span className="text-amber-700 dark:text-amber-300"> — condicional: {e.condicional.texto}</span> : null}
                                        {e.nota ? <span className="text-slate-400"> — {e.nota}</span> : null}
                                    </li>
                                ))}</ul>
                            </div>
                        )}
                    </details>

                    <details>
                        <summary className="cursor-pointer text-slate-500">📚 Documentação oficial (PDF) e o que falta</summary>
                        <p className="mt-1 text-slate-500">
                            Os documentos abaixo vieram do Paulo em 02/09/2026 e são servidos pelo próprio app — abrem em nova aba.
                        </p>
                        <ul className="mt-1 ml-4 list-disc">
                            {r.documentos.map(d => (
                                <li key={d.pdf}>
                                    <a href={d.pdf} target="_blank" rel="noopener noreferrer" className="text-blue-700 dark:text-blue-300 underline">{d.titulo}</a>
                                    <span className="text-slate-400"> · v{d.versao} · {d.data}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-slate-500"><strong>Ainda NÃO lido</strong> — o app não afirma nada que dependa disto:</p>
                        <ul className="ml-4 list-disc text-slate-500">{r.documentosFaltando.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </details>

                    <details>
                        <summary className="cursor-pointer text-slate-500">🔌 Como se transmite (Manual do Desenvolvedor) — referência, o app não transmite</summary>
                        <ul className="mt-1 ml-4 list-disc text-slate-600 dark:text-slate-300">
                            <li>{r.integracao.autenticacao.padrao} — <code>{r.integracao.autenticacao.tokenUrl}</code>, token de {r.integracao.autenticacao.validadeMin} min.</li>
                            <li>{r.integracao.ambiente}: base <code>{r.integracao.urlBase}</code>
                                <ul className="ml-4 list-disc">{r.integracao.endpoints.map(e => <li key={e.caminho}><code>{e.metodo} {e.caminho}</code> — {e.oQue}</li>)}</ul>
                            </li>
                            <li>Assinatura: {r.integracao.assinatura.padrao}. Certificado: {r.integracao.assinatura.certificado}.</li>
                            <li>{r.integracao.namespaces}</li>
                            <li><strong>Antes de qualquer código, do dono:</strong>
                                <ul className="ml-4 list-disc">{r.integracao.preRequisitos.map((t, i) => <li key={i}>{t}</li>)}</ul>
                            </li>
                            <li className="text-amber-700 dark:text-amber-300">{r.integracao.protocoloNaoEhRecibo}</li>
                        </ul>
                    </details>

                    <details>
                        <summary className="cursor-pointer text-slate-500">Ressalvas e fontes</summary>
                        <ul className="mt-1 ml-4 list-disc text-slate-500">{r.ressalvas.map((t, i) => <li key={i}>{t}</li>)}</ul>
                        <ul className="mt-2 ml-4 list-disc text-slate-400">{Object.values(r.fontes).map((f, i) => <li key={i}>{f}</li>)}</ul>
                    </details>
                </div>
            )}
        </div>
    );
};

export default DerePanel;
