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
    const [salvando, setSalvando] = useState<string | null>(null);
    const [erroEmpresas, setErroEmpresas] = useState<string | null>(null);

    const isAdmin = currentUser.role === 'admin';

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

    const empresasFiltradas = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return empresas.filter(e => {
            if (q && !e.nome.toLowerCase().includes(q) && !e.cnpj.includes(q)) return false;
            if (soSemResp && (vinculosPorEmpresa.get(e.id)?.length || 0) > 0) return false;
            return true;
        });
    }, [empresas, busca, soSemResp, vinculosPorEmpresa]);

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

    if (!isAdmin) {
        return (
            <div className="p-6 text-center text-slate-600 dark:text-slate-400">
                A Carteira de Clientes é restrita a administradores.
            </div>
        );
    }

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Carteira de Clientes</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-4">
                Atribua cada empresa a um ou mais colaboradores responsáveis.
            </p>

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
                <div className="text-xs text-slate-500 mb-2">
                    {empresasFiltradas.length} de {empresas.length} empresa(s)
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
                return (
                    <div key={emp.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 mb-2">
                        <div className="flex justify-between items-start gap-3">
                            <div>
                                <div className="font-semibold text-slate-800 dark:text-slate-100">{emp.nome}</div>
                                <div className="text-xs text-slate-500">{emp.cnpj} · {emp.fonte}</div>
                            </div>
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
