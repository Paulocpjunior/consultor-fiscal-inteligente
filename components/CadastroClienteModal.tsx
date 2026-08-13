/**
 * Cadastro do cliente — um lugar só para arrumar o cadastro E o responsável.
 *
 * Paulo, 28/07: a correção do cadastro estava espalhada (dados fiscais numa
 * tela, responsável na Carteira de Clientes, o motivo do trilho falhar em
 * terceira), e delegar um cliente a outro colaborador exigia sair do fluxo.
 * Aqui: o que falta, o que isso quebra, e a troca do responsável na hora.
 *
 * O responsável é o vínculo `principal` da carteira — trocar significa
 * substituir esse vínculo, não acumular dois donos.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { getAllUsers } from '../services/authService';
import {
    listarCarteiras, atribuir, removerVinculo,
    type VinculoCarteira, type PapelCarteira,
} from '../services/carteiraService';
import {
    conferirCadastroCliente, resumirCadastro,
    type EmpresaParaConferir,
} from '../services/cadastroClientePendencias';

interface Props {
    currentUser: User;
    /** Empresa a conferir. `id` e `regime` são obrigatórios para vincular. */
    empresa: EmpresaParaConferir & { id: string; regime: 'simples' | 'lucro' | string };
    onClose: () => void;
    onShowToast?: (msg: string) => void;
    /** Abre o modal de dados fiscais desta empresa (correção dos campos). */
    onAbrirDadosFiscais?: () => void;
    /** Avisa a tela de origem que algo mudou (para recarregar a lista). */
    onAlterado?: () => void;
}

const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const CORES_FAROL: Record<string, string> = {
    ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
    atencao: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300',
    bloqueado: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300',
};

const CadastroClienteModal: React.FC<Props> = ({
    currentUser, empresa, onClose, onShowToast, onAbrirDadosFiscais, onAlterado,
}) => {
    const [colaboradores, setColaboradores] = useState<User[]>([]);
    const [vinculos, setVinculos] = useState<VinculoCarteira[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [novoUid, setNovoUid] = useState('');
    const [papel, setPapel] = useState<PapelCarteira>('principal');

    const isAdmin = currentUser.role === 'admin';
    const colecao = empresa.regime === 'simples' ? 'simples_empresas' : 'lucro_empresas';

    const carregar = useCallback(async () => {
        setCarregando(true);
        try {
            const [usrs, vincs] = await Promise.all([getAllUsers(), listarCarteiras(currentUser)]);
            setColaboradores(usrs || []);
            setVinculos((vincs || []).filter((v) => v.empresaId === empresa.id));
        } finally {
            setCarregando(false);
        }
    }, [currentUser, empresa.id]);

    useEffect(() => { carregar(); }, [carregar]);

    const principal = vinculos.find((v) => v.papel === 'principal') || null;
    const backups = vinculos.filter((v) => v.papel === 'backup');

    // As pendências enxergam o responsável REAL (recém-carregado), não o que a
    // tela de origem tinha em mãos — senão o modal continuaria cobrando um
    // responsável que acabou de ser atribuído.
    const pendencias = useMemo(
        () => conferirCadastroCliente({
            ...empresa,
            responsaveis: vinculos.map((v) => ({ nome: v.colaboradorNome, papel: v.papel })),
        }),
        [empresa, vinculos],
    );
    const resumo = resumirCadastro(pendencias);

    const salvarResponsavel = async () => {
        const colab = colaboradores.find((c) => c.id === novoUid);
        if (!colab) { onShowToast?.('Escolha o colaborador.'); return; }
        setSalvando(true);
        try {
            // Trocar o PRINCIPAL substitui: dois "donos" deixa a cobrança sem
            // destinatário claro. Backup, sim, pode somar.
            if (papel === 'principal' && principal && principal.colaboradorUid !== colab.id) {
                await removerVinculo(principal.id);
            }
            const r = await atribuir({
                empresaId: empresa.id,
                empresaColecao: colecao as any,
                empresaNome: empresa.nome || '',
                empresaCnpj: String(empresa.cnpj || '').replace(/\D/g, ''),
                colaboradorUid: colab.id,
                colaboradorNome: colab.name || colab.email || colab.id,
                papel,
            });
            if (!r.ok) { onShowToast?.(r.error || 'Falha ao atribuir.'); return; }
            onShowToast?.(r.jaExistia
                ? `${colab.name || colab.email} já era ${papel} desta empresa.`
                : `${colab.name || colab.email} agora é ${papel === 'principal' ? 'o responsável' : 'backup'} de ${empresa.nome}.`);
            setNovoUid('');
            await carregar();
            onAlterado?.();
        } catch (e: any) {
            onShowToast?.(`Falha: ${e?.message || e}`);
        } finally {
            setSalvando(false);
        }
    };

    const remover = async (v: VinculoCarteira) => {
        setSalvando(true);
        try {
            const r = await removerVinculo(v.id);
            if (!r.ok) { onShowToast?.(r.error || 'Falha ao remover.'); return; }
            await carregar();
            onAlterado?.();
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5 space-y-4 my-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{empresa.nome || '—'}</h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {fmtCnpj(String(empresa.cnpj || ''))} · {empresa.regime === 'simples' ? 'Simples Nacional' : 'Lucro Presumido/Real'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
                </div>

                <div className={`rounded-lg border p-3 text-sm font-bold ${CORES_FAROL[resumo.farol]}`}>
                    {resumo.resumo}
                </div>

                {/* ── RESPONSÁVEL ────────────────────────────────────────── */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">👤 Responsável</h4>

                    {carregando ? (
                        <p className="text-xs text-slate-400">Carregando vínculos…</p>
                    ) : (
                        <>
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                {principal
                                    ? <>Titular hoje: <strong>{principal.colaboradorNome}</strong></>
                                    : <span className="text-red-600 dark:text-red-400 font-semibold">Sem responsável atribuído.</span>}
                            </p>
                            {backups.length > 0 && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Backup: {backups.map((b) => b.colaboradorNome).join(', ')}
                                </p>
                            )}

                            {isAdmin ? (
                                <>
                                    <div className="flex gap-2 flex-wrap items-end pt-1">
                                        <div className="flex-1 min-w-[180px]">
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Colaborador</label>
                                            <select
                                                value={novoUid}
                                                onChange={(e) => setNovoUid(e.target.value)}
                                                className="w-full text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                            >
                                                <option value="">Selecione…</option>
                                                {colaboradores.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.name || c.email}{c.role === 'admin' ? ' (admin)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Papel</label>
                                            <select
                                                value={papel}
                                                onChange={(e) => setPapel(e.target.value as PapelCarteira)}
                                                className="text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                            >
                                                <option value="principal">Responsável</option>
                                                <option value="backup">Backup</option>
                                            </select>
                                        </div>
                                        <button
                                            onClick={salvarResponsavel}
                                            disabled={salvando || !novoUid}
                                            className="px-4 py-2 text-sm font-bold rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40"
                                        >
                                            {salvando ? 'Salvando…' : (principal && papel === 'principal' ? 'Trocar' : 'Atribuir')}
                                        </button>
                                    </div>
                                    {principal && papel === 'principal' && (
                                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                            Trocar o responsável <strong>substitui</strong> {principal.colaboradorNome} — a empresa sai da carteira
                                            dele e entra na do novo. Para manter os dois, use <em>Backup</em>.
                                        </p>
                                    )}

                                    {vinculos.length > 0 && (
                                        <ul className="pt-1 space-y-1">
                                            {vinculos.map((v) => (
                                                <li key={v.id} className="flex items-center justify-between gap-2 text-[11px]">
                                                    <span className="text-slate-600 dark:text-slate-300">
                                                        {v.colaboradorNome} — {v.papel === 'principal' ? 'responsável' : 'backup'}
                                                    </span>
                                                    <button
                                                        onClick={() => remover(v)}
                                                        disabled={salvando}
                                                        className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-40"
                                                    >
                                                        remover
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </>
                            ) : (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Só administradores atribuem ou trocam responsável.
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* ── PENDÊNCIAS DO CADASTRO ─────────────────────────────── */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">📋 Cadastro</h4>
                        {onAbrirDadosFiscais && (
                            <button
                                onClick={onAbrirDadosFiscais}
                                className="text-[11px] px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            >
                                Abrir dados fiscais
                            </button>
                        )}
                    </div>

                    {pendencias.length === 0 ? (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                            Nada pendente: cadastro completo e com responsável.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {pendencias.map((p, i) => (
                                <li key={i} className="border-l-2 pl-2"
                                    style={{ borderColor: p.gravidade === 'bloqueia' ? '#dc2626' : '#d97706' }}>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                        {p.gravidade === 'bloqueia' ? '✕' : '!'} {p.campo}
                                    </p>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300">{p.impacto}</p>
                                    <p className="text-[11px] text-sky-600 dark:text-sky-400">→ {p.onde}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CadastroClienteModal;
