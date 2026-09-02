/**
 * 🏦 DerePanel — a DeRE (Declaração de Regimes Específicos, IBS/CBS) na carteira.
 *
 * Paulo, 02/09: *"crie uma nova função capaz de atender esta obrigação chamada
 * DERE"*. O que o CFI RESPONDE aqui: quem está obrigado (pelo cadastro), quem
 * PARECE estar (pelo CNAE — sugestão, não decisão), quando vence e quais
 * eventos a competência exige.
 *
 * ⚠️ O que ele faz e o que NÃO faz vai na cara da tela: monta a PRÉVIA do
 * D-1001 (do cadastro, conferida contra o XSD oficial) e não transmite nada.
 * Os leiautes 1.1.0, o manual do desenvolvedor e parte dos XSD estão LIDOS e
 * servidos aqui, mas faltam os XSD do D-1199/D-2101, o insumo dos mensais
 * (plano de contas, balancete) é contábil e a transmissão exige credencial do
 * piloto da Reforma.
 * Prometer geração aqui seria a promessa que a tela não cumpre (a lição do ✕
 * de 14/08).
 *
 * É consulta PURA — mesma figura da triagem do terceiro setor: o link leva ao
 * cadastro, e é lá que uma PESSOA marca o regime.
 */
import React, { useState } from 'react';
import { auth } from '../services/firebaseConfig';
import type { TriagemDere, LinhaDere, DeclaracaoDere } from '../sefaz-backend/dere';
import type { EventoD1001 } from '../sefaz-backend/dere-evento-d1001';
import type { ConferenciaXsd } from '../sefaz-backend/dere-xsd-bolso';

type PreviaD1001 = { ok: boolean; evento: EventoD1001; conferenciaXsd: ConferenciaXsd | null; error?: string };

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
    // 🏦 Prévia do D-1001 por DECLARAÇÃO (raiz). Paulo, 02/09: "Fiscal, tudo
    // roda no Fiscal" — o evento nasce aqui, do cadastro, e é conferido contra
    // o XSD da Receita antes de qualquer transmissão (que ainda não existe).
    const [previas, setPrevias] = useState<Record<string, PreviaD1001 | 'carregando'>>({});
    const [tpAmb, setTpAmb] = useState<'1' | '2'>('2');

    const gerarPrevia = async (d: DeclaracaoDere) => {
        const cnpj = d.estabelecimentos[0]?.cnpj;
        if (!cnpj) return;
        setPrevias(p => ({ ...p, [d.raiz]: 'carregando' }));
        try {
            const token = await auth.currentUser?.getIdToken();
            const resp = await fetch(`/api/admin/cadastro/dere-d1001-previa?cnpj=${encodeURIComponent(cnpj)}&tpAmb=${tpAmb}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j = await resp.json();
            if (!resp.ok && !j?.evento) throw new Error(j?.error || `HTTP ${resp.status}`);
            setPrevias(p => ({ ...p, [d.raiz]: j }));
        } catch (e: any) {
            setPrevias(p => ({ ...p, [d.raiz]: { ok: false, evento: { ok: false, xml: null, id: null, pendencias: [], avisos: [], veredicto: null, resumo: null }, conferenciaXsd: null, error: e?.message || 'Falha ao montar a prévia.' } }));
        }
    };

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
                        ⚠️ <strong>O CFI monta a PRÉVIA do D-1001 e não transmite nada.</strong> A casa da geração é
                        o Fiscal (decisão do Paulo, 02/09) — o D-1001 já sai do cadastro, conferido contra o XSD
                        oficial. Os demais eventos ainda não: faltam os XSD do fechamento (D-1199), do D-2101 e de
                        dois retornos, o insumo dos mensais (plano de contas comentado, balancete) é contábil, e
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
                        {!!r.declaracoes.length && (
                            <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                <p className="font-bold text-slate-700 dark:text-slate-200">
                                    🧾 Prévia do D-1001 (Informações do Contribuinte) por declaração
                                </p>
                                <p className="text-slate-500">
                                    O evento sai do CADASTRO (Dados Fiscais → DeRE: atividades, regimes secundários, natureza tributária,
                                    UFs credenciadas, validade) e é conferido contra o <strong>XSD oficial</strong>. A prévia
                                    <strong> não assina nem transmite</strong> — o que falta no cadastro sai nomeado.
                                </p>
                                <label className="mt-1 block text-slate-500">
                                    Ambiente:{' '}
                                    <select value={tpAmb} onChange={e => setTpAmb(e.target.value as '1' | '2')} className="p-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100">
                                        <option value="2">2 — Produção restrita (piloto)</option>
                                        <option value="1">1 — Produção</option>
                                    </select>
                                </label>
                                <ul className="mt-2 space-y-2">
                                    {r.declaracoes.map(d => {
                                        const pv = previas[d.raiz];
                                        return (
                                            <li key={d.raiz} className="border-t border-slate-100 dark:border-slate-800 pt-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono">{d.raiz}</span>
                                                    <span className="text-slate-500">{d.estabelecimentos.map(e => e.nome).join(' · ')}</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); gerarPrevia(d); }}
                                                        disabled={pv === 'carregando' || d.regimesDivergem}
                                                        title={d.regimesDivergem ? 'Regimes divergentes entre os estabelecimentos — acerte o cadastro antes' : 'Monta o XML do D-1001 e confere contra o XSD'}
                                                        className="btn-press px-3 py-1 rounded-lg bg-slate-700 text-white text-xs font-bold disabled:opacity-40 whitespace-nowrap"
                                                    >{pv === 'carregando' ? 'Montando…' : '👁 Prévia do D-1001'}</button>
                                                </div>
                                                {pv && pv !== 'carregando' && (
                                                    <div className="mt-1">
                                                        {pv.error && <p className="text-red-700 dark:text-red-300">{pv.error}</p>}
                                                        {!!pv.evento.pendencias.length && (
                                                            <div className="rounded border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-2 text-red-800 dark:text-red-300">
                                                                <strong>O D-1001 não pôde ser montado — falta no cadastro:</strong>
                                                                <ul className="ml-4 list-disc">{pv.evento.pendencias.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                                            </div>
                                                        )}
                                                        {pv.evento.ok && pv.evento.xml && (
                                                            <div>
                                                                <p className={pv.conferenciaXsd?.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
                                                                    {pv.conferenciaXsd?.ok
                                                                        ? <>✓ XML conferido contra <code>{pv.evento.resumo?.xsd}</code> — nenhum erro de schema.</>
                                                                        : <>✕ O XML NÃO passa no XSD <code>{pv.evento.resumo?.xsd}</code>:</>}
                                                                </p>
                                                                {!!pv.conferenciaXsd?.erros.length && <ul className="ml-4 list-disc text-red-700 dark:text-red-300">{pv.conferenciaXsd.erros.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                                                                <p className="text-slate-500">
                                                                    Id <code>{pv.evento.id}</code> · regime principal {pv.evento.resumo?.regTribPrinc}
                                                                    {pv.evento.resumo?.regTribSecund.length ? ` · secundários ${pv.evento.resumo.regTribSecund.join(', ')}` : ''}
                                                                    {' · '}indNatTrib {pv.evento.resumo?.indNatTrib} · validade desde {pv.evento.resumo?.iniValid}
                                                                    {' · '}{pv.evento.resumo?.grupos.map(g => `${g.rotulo}: ${g.atividades.join(', ')}`).join(' · ')}
                                                                </p>
                                                                <ul className="ml-4 list-disc text-amber-700 dark:text-amber-300">{pv.evento.avisos.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                                                <details className="mt-1">
                                                                    <summary className="cursor-pointer text-slate-500">XML da prévia (sem assinatura)</summary>
                                                                    <pre className="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">{pv.evento.xml}</pre>
                                                                </details>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
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
                        <p className="mt-2 text-slate-600 dark:text-slate-300">
                            <strong>XSD (schemas) — pacote "Arquivos XSD (Nota Orientativa 2026)"</strong>, {r.xsd.length} arquivo(s):
                        </p>
                        <ul className="mt-1 ml-4 list-disc">
                            {r.xsd.map(x => (
                                <li key={x.arquivo}>
                                    <a href={`/docs/dere/xsd/${x.arquivo}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 dark:text-blue-300 underline font-mono">{x.arquivo}</a>
                                    <span className="text-slate-400"> · {x.evento ? <code>{x.evento}</code> : 'lote'} · {x.oQue}</span>
                                </li>
                            ))}
                        </ul>
                        {!!r.xsdFaltando.length && (
                            <p className="mt-1 text-amber-700 dark:text-amber-300">
                                ⚠️ Eventos do leiaute <strong>sem XSD</strong> neste pacote: {r.xsdFaltando.join(', ')} — nada se monta
                                deles por dedução.
                            </p>
                        )}
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
