/**
 * DipamProdutorRuralPanel — compra de produtor rural: o que declarar de DIPAM
 * e quanto recolher de FUNRURAL, sem digitar nota a nota no SAGE.
 *
 * Paulo, 31/07/2026: "essa nota é de FUNRURAL, temos que lançar manualmente
 * esses campos, pois o sistema não entende" — e no caso paulista ainda tem de
 * entrar no cadastro, confirmar o município, voltar e informar o DIPAM na
 * frente da nota. Aqui a leitura já vem pronta: agrupada por município (que é
 * como a DIPAM é declarada) e com o Registro 1400 do SPED montado.
 *
 * Farol honesto: nota de fornecedor que não dá pra provar como produtor rural
 * PF fica FORA do total e aparece na lista de pendências com a ação — lançar
 * PJ no código 1.1 é o erro que a SEFAZ desconsidera (Manual da DIPAM 2026).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    carregarPainelDipam, varrerDipam, salvarProdutorRural, textoRegistro1400, relerMunicipiosDipam,
    type DipamPainel, type DipamVarreduraLinha,
} from '../../services/dipamService';
import { validarCpf, formatarCpf } from '../../services/validadorDocumento';

const fmtBRL = (v: number | undefined) =>
    (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpjCpf = (d: string) => {
    const s = String(d || '').replace(/\D/g, '');
    if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    return s || '—';
};
const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const FAROL_BOX: Record<string, string> = {
    ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
    atencao: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300',
    falha: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300',
    neutro: 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300',
};
const FAROL_ICONE: Record<string, string> = { ok: '✓', atencao: '!', falha: '✕', neutro: '·' };

const Caixa: React.FC<{ titulo: string; children: React.ReactNode; extra?: React.ReactNode }> = ({ titulo, children, extra }) => (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{titulo}</h4>
            {extra}
        </div>
        {children}
    </div>
);

const DipamProdutorRuralPanel: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [varredura, setVarredura] = useState<any>(null);
    const [carregandoVarredura, setCarregandoVarredura] = useState(false);
    const [empresaId, setEmpresaId] = useState<string | null>(null);
    const [painel, setPainel] = useState<DipamPainel | null>(null);
    const [carregandoPainel, setCarregandoPainel] = useState(false);
    const [copiado, setCopiado] = useState(false);

    const rodarVarredura = useCallback(async () => {
        setCarregandoVarredura(true);
        setPainel(null);
        setEmpresaId(null);
        try { setVarredura(await varrerDipam(competencia)); } finally { setCarregandoVarredura(false); }
    }, [competencia]);

    const abrirEmpresa = useCallback(async (id: string) => {
        setEmpresaId(id);
        setCarregandoPainel(true);
        try { setPainel(await carregarPainelDipam(id, competencia)); } finally { setCarregandoPainel(false); }
    }, [competencia]);

    // O detalhe do cliente renderiza DEPOIS da lista (que tem até 60 linhas), então
    // clicar "abrir" no fim da lista abria o painel ABAIXO da dobra — parecia que o
    // botão não fazia nada. Rola até ele assim que carrega.
    const detalheRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (painel?.ok && empresaId && !carregandoPainel) {
            detalheRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [painel, empresaId, carregandoPainel]);

    useEffect(() => { setVarredura(null); setPainel(null); setEmpresaId(null); }, [competencia]);

    const copiar1400 = async () => {
        if (!painel) return;
        try {
            await navigator.clipboard.writeText(textoRegistro1400(painel));
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
        } catch { /* clipboard bloqueado: o texto continua visível na tela */ }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">🌾 DIPAM / Produtor rural</h3>
                    {/* Guia do colaborador: HTML estático servido pelo próprio app
                        (public/ → dist/) — link estável pra equipe toda, mesmo
                        padrão do guia da saída mod 55. */}
                    <a
                        href="/guia-dipam-produtor-rural.html"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                    >
                        📗 Guia do colaborador
                    </a>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Compra de produtor rural gera DUAS obrigações a partir da mesma nota: o <strong>DIPAM 1.1</strong>{' '}
                    (valor mensal por município paulista de origem, na GIA e no Registro 1400 da EFD — Manual da
                    DIPAM 2026) e o <strong>FUNRURAL por sub-rogação</strong> (previdenciária + GILRAT + SENAR, que a
                    empresa recolhe no lugar do produtor PF). Produtor de fora de SP gera FUNRURAL, mas não gera DIPAM.
                </p>
                <div className="flex flex-wrap items-end gap-2 mt-3">
                    <div>
                        <label className="text-[10px] uppercase font-medium block mb-1 text-slate-500">Competência</label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={e => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100"
                        />
                    </div>
                    <button
                        onClick={rodarVarredura}
                        disabled={carregandoVarredura}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-semibold disabled:opacity-40"
                    >
                        {carregandoVarredura ? 'Varrendo…' : '🔎 Quem tem DIPAM neste mês'}
                    </button>
                </div>
            </div>

            {varredura && !varredura.ok && (
                <p className="text-sm text-red-600 dark:text-red-400">{varredura.error}</p>
            )}

            {varredura?.ok && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                            Clientes com compra de produtor rural ({varredura.escopo === 'carteira' ? 'sua carteira' : 'todas'})
                        </h4>
                        <span className="text-[11px] text-slate-500">
                            {varredura.linhas.length} de {varredura.total}
                            {varredura.truncado > 0 && ` · ${varredura.truncado} não analisado(s) neste lote`}
                        </span>
                    </div>
                    {varredura.linhas.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Nenhum cliente com compra de produtor rural em {competencia.split('-').reverse().join('/')}.
                            Se você esperava algum, confira antes se a captura do mês está completa.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <tr>
                                        <th className="text-left py-1.5 pr-2">Cliente</th>
                                        <th className="text-right px-2">DIPAM 1.1</th>
                                        <th className="text-right px-2">Municípios</th>
                                        <th className="text-right px-2">FUNRURAL</th>
                                        <th className="text-left px-2">Situação</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {varredura.linhas.map((l: DipamVarreduraLinha) => (
                                        <tr key={l.empresaId} className="border-b border-slate-100 dark:border-slate-700/50">
                                            <td className="py-1.5 pr-2">
                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{l.nome}</span>
                                                <span className="block text-[10px] text-slate-400">
                                                    {fmtCnpjCpf(l.cnpj)}
                                                    {!l.marcadoNoCadastro && (
                                                        <span className="ml-1 text-amber-500">⚠ não marcado no cadastro</span>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="text-right px-2 font-mono">{fmtBRL(l.dipamTotal)}</td>
                                            <td className="text-right px-2">{l.municipios}</td>
                                            <td className="text-right px-2 font-mono">{fmtBRL(l.funruralTotal)}</td>
                                            <td className={`px-2 ${l.farol.cor === 'falha' ? 'text-red-600 dark:text-red-400' : l.farol.cor === 'atencao' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                                                {FAROL_ICONE[l.farol.cor]} {l.farol.resumo}
                                            </td>
                                            <td className="text-right">
                                                <button
                                                    onClick={() => abrirEmpresa(l.empresaId)}
                                                    className="px-2 py-1 text-[11px] rounded bg-sky-600 hover:bg-sky-700 text-white font-semibold"
                                                >
                                                    abrir
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {carregandoPainel && <p className="text-sm text-slate-500">Montando a DIPAM do cliente…</p>}

            {painel && !painel.ok && <p className="text-sm text-red-600 dark:text-red-400">{painel.error}</p>}

            {painel?.ok && empresaId && (
                <div ref={detalheRef} className="scroll-mt-4">
                    <DetalheEmpresa painel={painel} isAdmin={isAdmin} onCopiar1400={copiar1400} copiado={copiado} onRecarregar={() => abrirEmpresa(empresaId)} empresaId={empresaId} />
                </div>
            )}
        </div>
    );
};

const DetalheEmpresa: React.FC<{
    painel: DipamPainel;
    isAdmin: boolean;
    copiado: boolean;
    onCopiar1400: () => void;
    onRecarregar: () => void;
    empresaId: string;
}> = ({ painel, isAdmin, copiado, onCopiar1400, onRecarregar, empresaId }) => {
    const farol = painel.farol!;
    const [relendo, setRelendo] = useState(false);
    const [resultadoReler, setResultadoReler] = useState<string | null>(null);

    // "nota sem código IBGE do município" NÃO é erro de cadastro: o município
    // está no XML guardado no Storage. Reler a FONTE é recuperação — mandar
    // digitar centenas de municípios seria pedir trabalho por um dado que já
    // existe no arquivo.
    const semMunicipio = (painel.pendencias || []).filter(p => p.codigo === 'municipio-ausente').length;
    // Nota que chegou sem participante nenhum: o mesmo ♻️ resolve, porque ele
    // relê emitente E destinatário do XML guardado.
    const semContraparte = (painel.pendencias || []).filter(p => p.codigo === 'contraparte-ausente').length;

    // Produtor inscrito por CNPJ e ainda sem o CPF do titular no cadastro: é o
    // que o R-2055 precisa e a nota não tem. Um por produtor, não por nota.
    const produtoresSemCpfTitular = Object.values(
        (painel.funrural?.notas || []).reduce((acc: Record<string, { doc: string; nome: string }>, n: any) => {
            const doc = String(n.doc || '').replace(/\D/g, '');
            if (doc.length === 14 && !n.cpfTitular && !acc[doc]) acc[doc] = { doc, nome: n.fornecedor || '—' };
            return acc;
        }, {}),
    );
    // O CPF já gravado precisa APARECER. Sem isso, gravar e ver o campo sumir é
    // indistinguível de não ter salvado — foi exatamente a leitura do Paulo em
    // 13/08 ("parece que não salva"), e naquele caso ele estava certo: a
    // gravação parcial apagava o cadastro. Corrigido o defeito, fica a prova.
    const produtoresComCpfTitular = Object.values(
        (painel.funrural?.notas || []).reduce((acc: Record<string, { doc: string; nome: string; cpf: string }>, n: any) => {
            const doc = String(n.doc || '').replace(/\D/g, '');
            if (doc.length === 14 && n.cpfTitular && !acc[doc]) {
                acc[doc] = { doc, nome: n.fornecedor || '—', cpf: String(n.cpfTitular) };
            }
            return acc;
        }, {}),
    );
    const relerMunicipios = async () => {
        if (!empresaId || !painel.competencia) return;
        setRelendo(true); setResultadoReler(null);
        try {
            const r: any = await relerMunicipiosDipam(empresaId, painel.competencia);
            if (r?.ok === false) { setResultadoReler(`Falha: ${r.error}`); return; }
            setResultadoReler(
                `${r.preenchidas} nota(s) recuperadas do XML · ${r.jaTinham} já tinham · `
                + `${r.semXml} sem arquivo guardado.` + (r.acao ? ` ${r.acao}` : ''),
            );
            onRecarregar();
        } catch (e: any) {
            setResultadoReler(`Falha: ${e?.message || e}`);
        } finally {
            setRelendo(false);
        }
    };
    return (
        <div className="space-y-3">
            <div className={`rounded-lg border p-3 ${FAROL_BOX[farol.cor]}`}>
                <p className="text-sm font-bold">{FAROL_ICONE[farol.cor]} {farol.resumo}</p>
                {painel.cadastro?.divergencia && (
                    <p className="text-[11px] mt-1">
                        <strong>{painel.cadastro.divergencia.mensagem}</strong> → {painel.cadastro.divergencia.acao}
                    </p>
                )}
            </div>

            {(painel.avisos || []).map((a, i) => (
                <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">⚠ {a}</p>
            ))}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Caixa
                    titulo={`DIPAM ${painel.codigo} — por município (${fmtBRL(painel.dipam?.total)})`}
                    extra={
                        (painel.dipam?.registro1400.length || 0) > 0 ? (
                            <button onClick={onCopiar1400} className="text-[11px] px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600">
                                {copiado ? '✓ copiado' : '📋 copiar Registro 1400'}
                            </button>
                        ) : null
                    }
                >
                    {(painel.dipam?.municipios.length || 0) === 0 ? (
                        <p className="text-xs text-slate-500">Nada a declarar nesta competência.</p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="text-left py-1">Município (IBGE)</th>
                                    <th className="text-right px-2">Notas</th>
                                    <th className="text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {painel.dipam!.municipios.map(m => (
                                    <tr key={m.codMunIBGE} className="border-b border-slate-100 dark:border-slate-700/50">
                                        <td className="py-1">
                                            {m.municipio || '—'} <span className="text-slate-400">({m.codMunIBGE})</span>
                                        </td>
                                        <td className="text-right px-2">
                                            {m.compras}
                                            {m.devolucoes > 0 && <span className="text-amber-500"> −{m.devolucoes}</span>}
                                        </td>
                                        <td className="text-right font-mono">{fmtBRL(m.valor)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {(painel.dipam?.registro1400.length || 0) > 0 && (
                        <pre className="mt-2 p-2 text-[11px] rounded bg-slate-900 text-emerald-300 overflow-x-auto">
                            {textoRegistro1400(painel)}
                        </pre>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                        Vai na ficha "Informações para a DIPAM B" da GIA E no Registro 1400 da EFD — o preenchimento
                        num não dispensa o outro (Manual, pág. 29). O SPED gerado pelo app já sai com estas linhas.
                    </p>
                </Caixa>

                <Caixa titulo={`FUNRURAL sub-rogação — ${fmtBRL(painel.funrural?.total)}`}>
                    {(painel.funrural?.notas.length || 0) === 0 ? (
                        <p className="text-xs text-slate-500">Nenhuma nota com sub-rogação nesta competência.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-4 gap-2 text-center mb-2">
                                {[
                                    ['Base', painel.funrural!.base],
                                    ['Seguro Social', painel.funrural!.inss],
                                    ['GILRAT', painel.funrural!.gilrat],
                                    ['SENAR', painel.funrural!.senar],
                                ].map(([rot, v]) => (
                                    <div key={rot as string} className="rounded bg-slate-50 dark:bg-slate-900/40 p-2">
                                        <p className="text-[10px] uppercase text-slate-500">{rot as string}</p>
                                        <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200">{fmtBRL(v as number)}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                        <tr>
                                            <th className="text-left py-1">Nota / produtor</th>
                                            <th className="text-right px-2">Base</th>
                                            <th className="text-right px-2">S. Social</th>
                                            <th className="text-right px-2">GILRAT</th>
                                            <th className="text-right px-2">SENAR</th>
                                            <th className="text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {painel.funrural!.notas.map(n => (
                                            <tr key={n.chave} className="border-b border-slate-100 dark:border-slate-700/50">
                                                <td className="py-1">
                                                    <span className="font-semibold">nº {n.numero}</span> · {n.fornecedor}
                                                    <span className="block text-[10px] text-slate-400">
                                                        {fmtCnpjCpf(n.doc)} · {n.uf || '—'} · {n.aliquotas.inss}% / {n.aliquotas.gilrat}% / {n.aliquotas.senar}%
                                                    </span>
                                                    {n.divergencia && (
                                                        <span className="block text-[10px] text-red-500">
                                                            ⚠ a nota declara {fmtBRL(n.divergencia.declarado)} — diferença de {fmtBRL(n.divergencia.diferenca)}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="text-right px-2 font-mono">{fmtBRL(n.base)}</td>
                                                <td className="text-right px-2 font-mono">{fmtBRL(n.inss)}</td>
                                                <td className="text-right px-2 font-mono">{fmtBRL(n.gilrat)}</td>
                                                <td className="text-right px-2 font-mono">{fmtBRL(n.senar)}</td>
                                                <td className="text-right font-mono font-bold">{fmtBRL(n.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                                Os três valores saem separados porque é assim que o lançamento pede (Impostos Retidos →
                                Seguro Social s/ Produção Rural Sub-rogação). Centavos são desprezados, como na guia.
                            </p>
                            {/* O R-2055 identifica a PESSOA (tpInscProd=2, CPF), e a nota do
                                produtor inscrito por CNPJ traz o CNPJ do estabelecimento rural.
                                O CPF sai do CADESP e mora no cadastro do produtor — sem ele o
                                EFD-Reinf trava, mesmo com o FUNRURAL apurado aqui. */}
                            {isAdmin && produtoresSemCpfTitular.length > 0 && (
                                <div className="mt-3 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3">
                                    <p className="text-[11px] text-indigo-900 dark:text-indigo-200">
                                        <strong>{produtoresSemCpfTitular.length} produtor(es) inscritos por CNPJ</strong> — o FUNRURAL
                                        deles já está calculado aqui, mas o <strong>R-2055 identifica a pessoa pelo CPF</strong> (é a única
                                        forma provada contra evento aceito). Consulte o CPF do titular no{' '}
                                        <a className="underline" href="https://www.cadesp.fazenda.sp.gov.br/" target="_blank" rel="noreferrer">CADESP</a>{' '}
                                        e grave aqui — nada é deduzido, e fica registrado quem confirmou.
                                    </p>
                                    <div className="mt-2 space-y-2">
                                        {produtoresSemCpfTitular.map(p => (
                                            <CpfTitularProdutor key={p.doc} doc={p.doc} nome={p.nome} onSalvo={onRecarregar} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {produtoresComCpfTitular.length > 0 && (
                                <div className="mt-3 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-2">
                                    <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                                        ✓ CPF do titular já gravado — o R-2055 declara por CPF (tpInscProd=2)
                                    </p>
                                    {produtoresComCpfTitular.map(p => (
                                        <p key={p.doc} className="text-[11px] text-emerald-900 dark:text-emerald-200">
                                            {p.nome} · <span className="font-mono">{fmtCnpjCpf(p.doc)}</span>
                                            {' → '}<span className="font-mono font-bold">{formatarCpf(p.cpf)}</span>
                                        </p>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    {(painel.funrural?.excluidasArt136?.length || 0) > 0 && (
                        <div className="mt-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2">
                            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                🧾 {painel.funrural!.excluidasArt136!.length} NF-e do produtor FORA do total — documento de origem (art. 136 / RC 33068)
                            </p>
                            <p className="text-[10px] text-amber-700 dark:text-amber-400 mb-1">
                                A escriturada é a nota de ENTRADA própria; a nota do produtor não conta (senão dobraria a FUNRURAL).
                            </p>
                            {painel.funrural!.excluidasArt136!.map(n => (
                                <div key={n.chave} className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                    nº {n.numero} · {n.fornecedor} · {fmtCnpjCpf(n.doc)} · {fmtBRL(Math.abs(n.valor || 0))}
                                </div>
                            ))}
                        </div>
                    )}
                </Caixa>
            </div>

            {(painel.pendencias?.length || 0) > 0 && (
                <Caixa titulo={`Pendências (${painel.pendencias!.length}) — resolva antes de fechar a competência`}>
                    {/* O DINHEIRO parado, por causa. "736 notas fora do total"
                        não diz se falta R$ 200 ou R$ 200 mil — e sem isso não
                        há por onde começar. Paulo, 13/08: o app apurou
                        R$ 17.089,31 e o certo eram R$ 27.832,92; a diferença
                        estava aqui, invisível. O potencial NUNCA soma no total:
                        resolver a pendência é que soma, com a prova do lado. */}
                    {(painel.foraDoTotal?.length || 0) > 0 && (
                        <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                                💰 O que está esperando conferência — e quanto vale
                            </p>
                            <table className="mt-2 w-full text-[11px]">
                                <thead className="text-amber-800 dark:text-amber-400">
                                    <tr>
                                        <th className="text-left font-semibold">Causa</th>
                                        <th className="text-right font-semibold">Notas</th>
                                        <th className="text-right font-semibold">Compras</th>
                                        <th className="text-right font-semibold">FUNRURAL que entraria</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {painel.foraDoTotal!.map(f => (
                                        <tr key={f.codigo} className="border-t border-amber-200 dark:border-amber-800">
                                            <td className="py-1 pr-2 text-amber-900 dark:text-amber-200">
                                                {f.rotulo}
                                                {f.fornecedores > 0 && f.codigo === 'fornecedor-indefinido' && (
                                                    <span className="text-amber-700 dark:text-amber-400">
                                                        {' '}· {f.fornecedores} fornecedor(es) a confirmar
                                                    </span>
                                                )}
                                            </td>
                                            <td className="text-right font-mono">{f.notas}</td>
                                            <td className="text-right font-mono">{fmtBRL(f.valor)}</td>
                                            <td className="text-right font-mono font-bold">{fmtBRL(f.funruralPotencial)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-2 text-[10px] text-amber-800 dark:text-amber-400">
                                Esse FUNRURAL é <strong>potencial</strong>, não apurado: é o que entraria se a pendência
                                fosse resolvida. Ele nunca é somado sozinho — cada nota entra quando a prova chega.
                            </p>
                        </div>
                    )}
                    {/* Registro de EVENTO que estava contando como nota. Some da
                        conta, não da tela: total que muda sozinho faz desconfiar
                        do número certo. */}
                    {(painel.registrosDeEvento || 0) > 0 && (
                        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
                            {painel.registrosDeEvento} documento(s) da competência são <strong>eventos</strong> (cancelamento,
                            carta de correção), não notas — eles não têm fornecedor porque evento não carrega participante.
                            Ficaram fora da conta e não geram pendência.
                        </p>
                    )}
                    {/* O município NÃO se digita: ele está no XML. E o mesmo
                        botão recupera o FORNECEDOR quando a nota chegou sem
                        participante — caso VINCENZO 07/2026, em que a pendência
                        dizia "—: vende gênero agropecuário" e mandava consultar
                        o CADESP de ninguém. */}
                    {(semMunicipio > 0 || semContraparte > 0) && (
                        <div className="mb-3 rounded-lg border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20 p-3">
                            <p className="text-xs text-sky-900 dark:text-sky-200">
                                <strong>
                                    {[
                                        semMunicipio > 0 && `${semMunicipio} pendência(s) de "nota sem código IBGE do município"`,
                                        semContraparte > 0 && `${semContraparte} pendência(s) de "nota sem o fornecedor"`,
                                    ].filter(Boolean).join(' e ')}
                                </strong>{' '}
                                — esses dados estão no XML guardado, não no cadastro. Reler o arquivo resolve em massa;
                                digitar um a um seria trabalho por dado que já existe.
                            </p>
                            <button
                                onClick={relerMunicipios}
                                disabled={relendo}
                                className="mt-2 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                            >
                                {relendo ? 'Relendo os XMLs…' : '♻️ Reler participante e município dos XMLs'}
                            </button>
                            {resultadoReler && (
                                <p className="mt-2 text-[11px] text-sky-900 dark:text-sky-200">{resultadoReler}</p>
                            )}
                        </div>
                    )}
                    <ul className="space-y-2">
                        {painel.pendencias!.map((p, i) => (
                            <li key={`${p.codigo}-${i}`} className="text-xs border-l-2 border-amber-400 pl-2">
                                {/* O DINHEIRO na própria linha, e a lista já vem
                                    ordenada por ele. 293 conferências de CADESP
                                    em ordem qualquer é impossível de atacar;
                                    ordenadas por valor, a primeira costuma
                                    resolver o mês. */}
                                {p.valor != null && (
                                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                                        {fmtBRL(p.valor)} em compras
                                        {p.notas && p.notas > 1 ? ` · ${p.notas} notas` : ''}
                                        {p.funruralPotencial ? ` · FUNRURAL ${fmtBRL(p.funruralPotencial)}` : ''}
                                    </p>
                                )}
                                <p className="text-slate-700 dark:text-slate-200 font-semibold">{p.mensagem}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">→ {p.acao}</p>
                                {p.doc && p.codigo === 'fornecedor-indefinido' && isAdmin && (
                                    <ConfirmarProdutor doc={p.doc} nome={p.fornecedor || ''} onSalvo={onRecarregar} />
                                )}
                            </li>
                        ))}
                    </ul>
                </Caixa>
            )}
        </div>
    );
};

/**
 * CPF do titular do produtor inscrito por CNPJ.
 *
 * Caso VINCENZO × ANTONIO DIAS DA SILVA (12/08): o FUNRURAL sai certo aqui, e o
 * R-2055 do Consultor Contábil trava porque o `ideProdutor` identifica a PESSOA
 * (tpInscProd=2, CPF — a única forma provada contra evento aceito). A nota traz
 * o CNPJ do estabelecimento rural; o CPF vem do CADESP.
 *
 * NÃO é contorno: é o cadastro trazendo o que a nota não traz, como o segurado
 * especial e a opção pela folha. Ninguém deduz — alguém digita, e fica gravado
 * quem foi.
 */
const CpfTitularProdutor: React.FC<{ doc: string; nome: string; onSalvo: () => void }> = ({ doc, nome, onSalvo }) => {
    const [cpf, setCpf] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const salvar = async () => {
        const limpo = cpf.replace(/\D/g, '');
        if (limpo.length !== 11) { setErro('O CPF do titular tem 11 dígitos.'); return; }
        // O backend também recusa (a trava que vale é a de lá), mas dizer aqui
        // evita a ida e volta e mostra o número formatado, que é como ele está
        // no CADESP — é olhando assim que se acha o dígito trocado.
        if (!validarCpf(limpo)) {
            setErro(`${formatarCpf(limpo)} não passa no dígito verificador. Confira no CADESP.`);
            return;
        }
        setSalvando(true); setErro(null);
        const r = await salvarProdutorRural({ doc, nome, cpfTitular: limpo } as any);
        setSalvando(false);
        if (!r.ok) { setErro(r.error || 'Falha ao gravar.'); return; }
        onSalvo();
    };

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-indigo-900 dark:text-indigo-200 font-semibold">{nome}</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{fmtCnpjCpf(doc)}</span>
            <input
                value={cpf}
                onChange={e => setCpf(e.target.value)}
                placeholder="CPF do titular"
                inputMode="numeric"
                className="px-2 py-1 text-[11px] rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 dark:text-slate-100 w-36"
            />
            <button
                onClick={salvar}
                disabled={salvando}
                className="px-2 py-1 text-[10px] rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-40"
            >
                {salvando ? 'Gravando…' : 'Gravar CPF'}
            </button>
            {erro && <span className="text-[10px] text-red-500">{erro}</span>}
        </div>
    );
};

/**
 * Confirmação do fornecedor direto na pendência: é o passo que hoje obriga a
 * sair da nota, abrir o cadastro e voltar. Só admin grava (a natureza jurídica
 * muda o que é declarado à SEFAZ).
 */
const ConfirmarProdutor: React.FC<{ doc: string; nome: string; onSalvo: () => void }> = ({ doc, nome, onSalvo }) => {
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const marcar = async (natureza: 'produtor_rural_pf' | 'pessoa_juridica', seguradoEspecial = false) => {
        setSalvando(true);
        setErro(null);
        const r = await salvarProdutorRural({ doc, nome, natureza, seguradoEspecial });
        setSalvando(false);
        if (!r.ok) { setErro(r.error || 'Falha ao gravar.'); return; }
        onSalvo();
    };

    return (
        <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-slate-400">No CADESP este fornecedor é:</span>
            <button
                onClick={() => marcar('produtor_rural_pf')}
                disabled={salvando}
                className="px-2 py-0.5 text-[10px] rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-40"
            >
                Produtor Rural (PF)
            </button>
            {/* Segurado especial (agricultura familiar) ficou em 1,5% quando a
                LC 224/2025 subiu o geral para 1,63% — e isso não está na nota. */}
            <button
                onClick={() => marcar('produtor_rural_pf', true)}
                disabled={salvando}
                title="Agricultura familiar: entra no DIPAM 1.1 igual, mas o FUNRURAL continua em 1,5% (LC 224/2025 não alterou o segurado especial)."
                className="px-2 py-0.5 text-[10px] rounded bg-emerald-800 hover:bg-emerald-900 text-white font-semibold disabled:opacity-40"
            >
                PF · segurado especial (1,5%)
            </button>
            <button
                onClick={() => marcar('pessoa_juridica')}
                disabled={salvando}
                className="px-2 py-0.5 text-[10px] rounded bg-slate-500 hover:bg-slate-600 text-white font-semibold disabled:opacity-40"
            >
                Pessoa Jurídica
            </button>
            <a
                href="https://www.cadesp.fazenda.sp.gov.br/"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-sky-500 hover:underline"
            >
                consultar CADESP ↗
            </a>
            {erro && <span className="text-[10px] text-red-500">{erro}</span>}
        </div>
    );
};

export default DipamProdutorRuralPanel;
