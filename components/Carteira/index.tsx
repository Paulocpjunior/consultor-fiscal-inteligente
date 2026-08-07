/**
 * Carteira de Clientes — tela (só admin) para atribuir empresas a colaboradores.
 * Lista as empresas pelo backend de perfil cliente e os
 * colaboradores via getAllUsers. Cada vínculo vira um doc na coleção `carteiras`.
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import type { User } from '../../types';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../../services/xmlFiscalService';
import { listarEmpresasPerfilBackend } from '../../services/empresasPerfilService';
import { getAllUsers } from '../../services/authService';
import {
    listarCarteiras,
    atribuir,
    removerVinculo,
    type VinculoCarteira,
    type PapelCarteira,
} from '../../services/carteiraService';
import { testarResumoDiario } from '../../services/notificacoesService';
import { resumirCarteira, resumoCarteiraCsv } from '../../services/carteiraResumo';
import GuiaDoMes from './GuiaDoMes';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const CarteiraDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [colaboradores, setColaboradores] = useState<User[]>([]);
    const [vinculos, setVinculos] = useState<VinculoCarteira[]>([]);
    const [loading, setLoading] = useState(true);
    const [busca, setBusca] = useState('');
    const [soSemResp, setSoSemResp] = useState(false);
    // Filtro vindo do resumo: uid do colaborador, 'sem' (sem responsável) ou null.
    const [filtroColab, setFiltroColab] = useState<string | null>(null);
    const [salvando, setSalvando] = useState<string | null>(null);
    const [erroEmpresas, setErroEmpresas] = useState<string | null>(null);

    const isAdmin = currentUser.role === 'admin';
    /**
     * A tela nasceu como ATRIBUIÇÃO (admin diz quem cuida de quem) e por isso
     * era admin-only. Paulo, 07/08: ela "deve ser o guia, o norte do
     * colaborador durante o mês fiscal". Então ela tem duas caras:
     *   🧭 Guia do mês  — de TODO mundo, com escopo na própria carteira
     *   👥 Atribuição   — só admin, como sempre foi
     * O escopo de quem vê o quê é do BACKEND (getEmpresaIdsDaCarteira na rota
     * da Rotina): colaborador recebe só os clientes dele, sem filtro na tela.
     */
    const [aba, setAba] = useState<'guia' | 'atribuir'>('guia');

    // Guard contra setState apos unmount (3 fetches em paralelo - troca de aba
    // rapida deixava state stale e gerava warning React 18).
    const aliveRef = useRef(true);

    const carregar = async () => {
        setLoading(true);
        setErroEmpresas(null);
        try {
            const empresasPromise = listarEmpresasPerfilBackend(currentUser)
                .then((list) => ({ list, erro: null as string | null }))
                .catch(async (err: any) => {
                    console.warn('listarEmpresasPerfilBackend/carteira:', err?.message);
                    const fallback = await getEmpresasParaPerfilCliente(currentUser);
                    return {
                        list: fallback || [],
                        erro: err?.message || 'Falha ao carregar empresas pelo servidor.',
                    };
                });

            const [empresasResult, usrs, vincs] = await Promise.all([
                empresasPromise,
                getAllUsers(),
                listarCarteiras(currentUser),
            ]);
            if (!aliveRef.current) return;
            setEmpresas(empresasResult.list);
            setErroEmpresas(empresasResult.erro);
            setColaboradores(usrs);
            setVinculos(vincs);
        } catch (err: any) {
            if (!aliveRef.current) return;
            onShowToast?.('Falha ao carregar carteira: ' + (err?.message || 'erro'));
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        aliveRef.current = true;
        if (isAdmin) carregar();
        else setLoading(false);
        return () => { aliveRef.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const vinculosPorEmpresa = useMemo(() => {
        const m = new Map<string, VinculoCarteira[]>();
        for (const v of vinculos) {
            const arr = m.get(v.empresaId) || [];
            arr.push(v);
            m.set(v.empresaId, arr);
        }
        return m;
    }, [vinculos]);

    // Resumo por colaborador (função pura): totais, pendências de cadastro e
    // o balde "sem responsável" — a conta pedida pelo Paulo (31/07).
    const resumo = useMemo(
        () => resumirCarteira(empresas, vinculos),
        [empresas, vinculos],
    );

    const empresasFiltradas = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return empresas.filter(e => {
            if (q && !e.nome.toLowerCase().includes(q) && !e.cnpj.includes(q)) return false;
            const vincs = vinculosPorEmpresa.get(e.id) || [];
            if (soSemResp && vincs.length > 0) return false;
            if (filtroColab === 'sem' && vincs.length > 0) return false;
            if (filtroColab && filtroColab !== 'sem' && !vincs.some(v => v.colaboradorUid === filtroColab)) return false;
            return true;
        });
    }, [empresas, busca, soSemResp, filtroColab, vinculosPorEmpresa]);

    const baixarCsvResumo = () => {
        const blob = new Blob(['﻿' + resumoCarteiraCsv(resumo)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'carteira-resumo.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleAtribuir = async (emp: EmpresaPerfilOption, colaboradorUid: string, papel: PapelCarteira) => {
        const colab = colaboradores.find(c => c.id === colaboradorUid);
        if (!colab) return;
        setSalvando(emp.id);
        const r = await atribuir({
            empresaId: emp.id,
            empresaColecao: emp.fonte === 'simples' ? 'simples_empresas' : 'lucro_empresas',
            empresaNome: emp.nome,
            empresaCnpj: emp.cnpj,
            colaboradorUid: colab.id,
            colaboradorNome: colab.name,
            papel,
        });
        setSalvando(null);
        if (r.ok) {
            onShowToast?.(r.jaExistia
                ? `${colab.name} já atende ${emp.nome}.`
                : `${colab.name} atribuído a ${emp.nome}.`);
            if (!r.jaExistia) await carregar();
        } else {
            onShowToast?.('Erro: ' + (r.error || 'falha ao atribuir'));
        }
    };

    const handleRemover = async (vinculo: VinculoCarteira) => {
        setSalvando(vinculo.empresaId);
        const r = await removerVinculo(vinculo.id);
        setSalvando(null);
        if (r.ok) {
            onShowToast?.(`${vinculo.colaboradorNome} removido de ${vinculo.empresaNome}.`);
            await carregar();
        } else {
            onShowToast?.('Erro: ' + (r.error || 'falha ao remover'));
        }
    };

    const [testandoEmail, setTestandoEmail] = useState(false);
    const handleTestarEmail = async () => {
        setTestandoEmail(true);
        const r = await testarResumoDiario();
        setTestandoEmail(false);
        if (r.ok) {
            onShowToast?.(`Resumo enviado: ${r.resumo?.totalCapturas ?? 0} captura(s) nas últimas 24h. Verifique seu e-mail.`);
        } else {
            onShowToast?.('Falha no resumo: ' + (r.error || 'erro'));
        }
    };

    // Colaborador não atribui ninguém — pra ele a tela É o guia do mês.
    if (!isAdmin) {
        return (
            <div className="p-4 max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">Carteira de Clientes</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    Os clientes que respondem a você neste mês fiscal.
                </p>
                <GuiaDoMes currentUser={currentUser} onShowToast={onShowToast} />
            </div>
        );
    }

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Carteira de Clientes</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-3">
                O guia do mês de cada colaborador — e a atribuição de quem cuida de quem.
            </p>

            <div className="flex gap-2 mb-4">
                {([['guia', '🧭 Guia do mês'], ['atribuir', '👥 Atribuição']] as const).map(([id, rotulo]) => (
                    <button
                        key={id}
                        onClick={() => setAba(id)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg ${
                            aba === id
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                        }`}
                    >
                        {rotulo}
                    </button>
                ))}
            </div>

            {aba === 'guia' && <GuiaDoMes currentUser={currentUser} onShowToast={onShowToast} />}
            {aba === 'atribuir' && (
            <>

            <div className="mb-4">
                <button
                    onClick={handleTestarEmail}
                    disabled={testandoEmail}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50"
                >
                    {testandoEmail ? 'Enviando...' : 'Testar resumo diário'}
                </button>
                <span className="ml-2 text-xs text-slate-400">Diagnóstico — envia o resumo de capturas das últimas 24h para sua caixa.</span>
            </div>

            {/* ── Resumo: total por colaborador × pendências de cadastro ── */}
            {!loading && empresas.length > 0 && (
                <div className="mb-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                        <div>
                            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">📊 Resumo da carteira</h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Pendências = conferência de cadastro (campos que travam trilho). Clique numa linha para filtrar a lista abaixo.
                            </p>
                        </div>
                        <button onClick={baixarCsvResumo}
                            className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded">
                            ⬇ CSV
                        </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-3">
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xl font-bold text-slate-700 dark:text-slate-200">{resumo.totalEmpresas}</div>
                            <div className="text-[10px] uppercase text-slate-500">empresas no cadastro</div>
                        </div>
                        <button onClick={() => setFiltroColab(filtroColab === 'sem' ? null : 'sem')}
                            className={`rounded-lg border p-2 text-center ${filtroColab === 'sem' ? 'ring-2 ring-amber-400' : ''} ${resumo.semResponsavel.total > 0 ? 'border-amber-300 dark:border-amber-700' : 'border-emerald-200 dark:border-emerald-800'}`}>
                            <div className={`text-xl font-bold ${resumo.semResponsavel.total > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{resumo.semResponsavel.total}</div>
                            <div className="text-[10px] uppercase text-slate-500">sem responsável</div>
                        </button>
                        <div className={`rounded-lg border p-2 ${resumo.geral.comBloqueio > 0 ? 'border-red-300 dark:border-red-700' : 'border-emerald-200 dark:border-emerald-800'}`}>
                            <div className={`text-xl font-bold ${resumo.geral.comBloqueio > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{resumo.geral.comBloqueio}</div>
                            <div className="text-[10px] uppercase text-slate-500">com pendência que trava</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{resumo.geral.ok}</div>
                            <div className="text-[10px] uppercase text-slate-500">cadastro completo</div>
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                                    <th className="py-1.5 px-2 text-left">Colaborador</th>
                                    <th className="py-1.5 px-2 text-right">Empresas</th>
                                    <th className="py-1.5 px-2 text-right" title="Vínculo principal">Principal</th>
                                    <th className="py-1.5 px-2 text-right">🔴 Trava</th>
                                    <th className="py-1.5 px-2 text-right">🟡 Atenção</th>
                                    <th className="py-1.5 px-2 text-right">✅ Ok</th>
                                </tr>
                            </thead>
                            <tbody>
                                {resumo.porColaborador.map((l) => (
                                    <tr key={l.colaboradorUid}
                                        onClick={() => setFiltroColab(filtroColab === l.colaboradorUid ? null : l.colaboradorUid)}
                                        className={`border-t border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${filtroColab === l.colaboradorUid ? 'bg-sky-50 dark:bg-sky-900/20' : ''}`}>
                                        <td className="py-1.5 px-2 font-semibold text-slate-700 dark:text-slate-200">{l.colaboradorNome}</td>
                                        <td className="py-1.5 px-2 text-right font-mono font-bold">{l.total}</td>
                                        <td className="py-1.5 px-2 text-right font-mono text-slate-500">{l.comoPrincipal}</td>
                                        <td className={`py-1.5 px-2 text-right font-mono ${l.comBloqueio > 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-400'}`}>{l.comBloqueio}</td>
                                        <td className={`py-1.5 px-2 text-right font-mono ${l.soAtencao > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>{l.soAtencao}</td>
                                        <td className="py-1.5 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{l.ok}</td>
                                    </tr>
                                ))}
                                <tr onClick={() => setFiltroColab(filtroColab === 'sem' ? null : 'sem')}
                                    className={`border-t-2 border-slate-200 dark:border-slate-600 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/10 ${filtroColab === 'sem' ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                                    <td className="py-1.5 px-2 font-semibold text-amber-700 dark:text-amber-400">⚠ Sem responsável</td>
                                    <td className="py-1.5 px-2 text-right font-mono font-bold text-amber-700 dark:text-amber-400">{resumo.semResponsavel.total}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-400">—</td>
                                    <td className={`py-1.5 px-2 text-right font-mono ${resumo.semResponsavel.comBloqueio > 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-400'}`}>{resumo.semResponsavel.comBloqueio}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-400">{resumo.semResponsavel.soAtencao}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-400">{resumo.semResponsavel.ok}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">
                        Empresa com principal + backup conta na linha dos dois — o TOTAL GERAL ({resumo.totalEmpresas}) é a verdade, a soma das linhas pode passar dele.
                    </p>
                </div>
            )}

            <div className="flex flex-wrap gap-3 mb-4 items-center">
                <input
                    type="text"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar por nome ou CNPJ..."
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm"
                />
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={soSemResp} onChange={e => setSoSemResp(e.target.checked)} />
                    Só empresas sem responsável
                </label>
                <button
                    onClick={carregar}
                    className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700"
                >
                    Recarregar
                </button>
            </div>

            {loading && <div className="text-sm text-slate-500 py-8 text-center">Carregando...</div>}

            {!loading && (
                <div className="text-xs text-slate-500 mb-2 flex items-center gap-2 flex-wrap">
                    <span>{empresasFiltradas.length} de {empresas.length} empresa(s)</span>
                    {filtroColab && (
                        <button onClick={() => setFiltroColab(null)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 text-[11px]">
                            Filtro: {filtroColab === 'sem' ? 'sem responsável' : (resumo.porColaborador.find(l => l.colaboradorUid === filtroColab)?.colaboradorNome || filtroColab)} ✕
                        </button>
                    )}
                </div>
            )}

            {!loading && erroEmpresas && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                    Não foi possível carregar a lista completa de empresas pelo servidor. A tela tentou uma consulta alternativa; se continuar zerada, valide o perfil admin e os vínculos de carteira.
                </div>
            )}

            {!loading && !erroEmpresas && empresas.length === 0 && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Nenhuma empresa disponível para atribuição. Confira se há cadastros ativos em Simples Nacional ou Lucro Presumido/Real.
                </div>
            )}

            {!loading && empresasFiltradas.map(emp => {
                const vincs = vinculosPorEmpresa.get(emp.id) || [];
                const farol = resumo.farolPorEmpresa.get(emp.id);
                return (
                    <div key={emp.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 mb-2">
                        <div className="flex justify-between items-start gap-3">
                            <div>
                                <div className="font-semibold text-slate-800 dark:text-slate-100">{emp.nome}</div>
                                <div className="text-xs text-slate-500">{emp.cnpj} · {emp.fonte}</div>
                            </div>
                            {/* O selo diz O QUE revisar, não só quantos: número
                                sozinho fez a equipe achar que o cadastro certo
                                estava sendo acusado à toa (31/07). */}
                            {farol && (
                                <span title={farol.campos.length > 0
                                    ? `Pendências (${farol.campos.length}): ${farol.campos.join(' · ')}`
                                    : farol.resumo}
                                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold max-w-[18rem] truncate ${
                                        farol.farol === 'bloqueado' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        : farol.farol === 'atencao' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    }`}>
                                    {farol.farol === 'bloqueado'
                                        ? `🔴 trava: ${farol.motivo}${farol.total > 1 ? ` +${farol.total - 1}` : ''}`
                                        : farol.farol === 'atencao'
                                            ? `🟡 revisar: ${farol.motivo}${farol.total > 1 ? ` +${farol.total - 1}` : ''}`
                                            : '✅ completo'}
                                </span>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2 mt-2">
                            {vincs.length === 0 && (
                                <span className="text-xs text-amber-600 dark:text-amber-400">Sem responsável</span>
                            )}
                            {vincs.map(v => (
                                <span key={v.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                    {v.colaboradorNome}
                                    <span className="text-slate-400">({v.papel})</span>
                                    <button
                                        onClick={() => handleRemover(v)}
                                        disabled={salvando === emp.id}
                                        className="ml-1 text-red-500 hover:text-red-700 font-bold disabled:opacity-50"
                                        title="Remover"
                                    >×</button>
                                </span>
                            ))}
                        </div>

                        <AtribuirControle
                            colaboradores={colaboradores}
                            disabled={salvando === emp.id}
                            onAtribuir={(uid, papel) => handleAtribuir(emp, uid, papel)}
                        />
                    </div>
                );
            })}
            </>
            )}
        </div>
    );
};

const AtribuirControle: React.FC<{
    colaboradores: User[];
    disabled: boolean;
    onAtribuir: (uid: string, papel: PapelCarteira) => void;
}> = ({ colaboradores, disabled, onAtribuir }) => {
    const [uid, setUid] = useState('');
    const [papel, setPapel] = useState<PapelCarteira>('principal');

    return (
        <div className="flex flex-wrap gap-2 mt-3 items-center">
            <select
                value={uid}
                onChange={e => setUid(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs"
            >
                <option value="">Selecione um colaborador...</option>
                {colaboradores.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
            <select
                value={papel}
                onChange={e => setPapel(e.target.value as PapelCarteira)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs"
            >
                <option value="principal">Principal</option>
                <option value="backup">Backup</option>
            </select>
            <button
                onClick={() => { if (uid) { onAtribuir(uid, papel); setUid(''); } }}
                disabled={disabled || !uid}
                className="px-3 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 disabled:opacity-50"
            >
                Atribuir
            </button>
        </div>
    );
};

export default CarteiraDashboard;
