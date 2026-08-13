/**
 * Agentes A3 — tela admin pra gerenciar API keys do agente local cfi-a3.
 *
 * O fluxo: admin clica "Nova key", escolhe colaborador, recebe a apiKey CRUA
 * uma única vez, copia, e passa pro colaborador. Depois disso, só o hash
 * fica no servidor.
 *
 * Importante: a key crua só é mostrada UMA vez. Quem perdeu, gera de novo.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { getAllUsers } from '../../services/authService';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../../services/xmlFiscalService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';
import { paraEmpresaOptions } from '../../services/empresaOption';
import {
    listarAgentKeys,
    gerarAgentKey,
    revogarAgentKey,
    marcarTipoCert,
    type AgentKey,
} from '../../services/agentesA3Service';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const formatDate = (ms: number | null) => {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

const AgentesA3: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const isAdmin = currentUser.role === 'admin';

    const [keys, setKeys] = useState<AgentKey[]>([]);
    const [colaboradores, setColaboradores] = useState<User[]>([]);
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [mostrarRevogadas, setMostrarRevogadas] = useState(false);

    // Marcar empresa A3
    const [empresaSelecionada, setEmpresaSelecionada] = useState('');
    const [novoTipoCert, setNovoTipoCert] = useState<'A1' | 'A3'>('A3');
    const [aplicandoTipo, setAplicandoTipo] = useState(false);

    // Modal "nova key"
    const [novaModalAberta, setNovaModalAberta] = useState(false);
    const [novoOwnerUid, setNovoOwnerUid] = useState('');
    const [novoLabel, setNovoLabel] = useState('');
    const [gerando, setGerando] = useState(false);

    // Resultado da geração: mostra a key crua UMA vez
    const [keyCrua, setKeyCrua] = useState<{ apiKey: string; ownerEmail: string } | null>(null);
    const [keyCopiada, setKeyCopiada] = useState(false);

    const carregar = async () => {
        setLoading(true);
        setErro(null);
        try {
            const [k, u, e] = await Promise.all([
                listarAgentKeys(),
                getAllUsers(),
                getEmpresasParaPerfilCliente(currentUser),
            ]);
            setKeys(k);
            setColaboradores(u);
            setEmpresas(e);
        } catch (err: any) {
            setErro(err.message || 'erro carregando');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) carregar();
        else setLoading(false);
    }, [isAdmin]);

    const keysVisiveis = useMemo(() => {
        return mostrarRevogadas ? keys : keys.filter((k) => !k.revoked);
    }, [keys, mostrarRevogadas]);

    const handleGerar = async () => {
        if (!novoOwnerUid) {
            onShowToast?.('Selecione um colaborador');
            return;
        }
        setGerando(true);
        try {
            const owner = colaboradores.find((c) => c.id === novoOwnerUid);
            const result = await gerarAgentKey(novoOwnerUid, novoLabel || `Agent ${new Date().toLocaleDateString('pt-BR')}`);
            setKeyCrua({ apiKey: result.apiKey, ownerEmail: owner?.email || '?' });
            setKeyCopiada(false);
            await carregar();
            setNovaModalAberta(false);
            setNovoOwnerUid('');
            setNovoLabel('');
        } catch (e: any) {
            onShowToast?.('Falha gerando key: ' + (e.message || 'erro'));
        } finally {
            setGerando(false);
        }
    };

    const handleRevogar = async (keyId: string) => {
        if (!confirm('Revogar essa key? O agente que está usando ela vai perder acesso imediatamente.')) return;
        try {
            await revogarAgentKey(keyId);
            onShowToast?.('Key revogada');
            await carregar();
        } catch (e: any) {
            onShowToast?.('Falha revogando: ' + (e.message || 'erro'));
        }
    };

    const handleCopiar = async (apiKey: string) => {
        try {
            await navigator.clipboard.writeText(apiKey);
            setKeyCopiada(true);
            onShowToast?.('Key copiada pro clipboard');
        } catch {
            onShowToast?.('Falha copiando — selecione e copie manualmente');
        }
    };

    const handleAplicarTipo = async () => {
        if (!empresaSelecionada) {
            onShowToast?.('Selecione uma empresa');
            return;
        }
        const empresa = empresas.find((e) => e.id === empresaSelecionada);
        if (novoTipoCert === 'A3') {
            const ok = confirm(
                `Marcar "${empresa?.nome || empresaSelecionada}" como A3?\n\n` +
                `Esta empresa NÃO será mais capturada pelo cron noturno do servidor. ` +
                `Captura passa a depender do agente cfi-a3 rodando no Mac de um colaborador.\n\n` +
                `Confirma?`,
            );
            if (!ok) return;
        }
        setAplicandoTipo(true);
        try {
            await marcarTipoCert(empresaSelecionada, novoTipoCert);
            onShowToast?.(`Empresa marcada como ${novoTipoCert}`);
            setEmpresaSelecionada('');
        } catch (e: any) {
            onShowToast?.('Falha: ' + (e.message || 'erro'));
        } finally {
            setAplicandoTipo(false);
        }
    };

    if (!isAdmin) {
        return (
            <div className="p-6 max-w-2xl">
                <h2 className="text-xl font-semibold mb-2">Agentes A3</h2>
                <p className="text-sm text-gray-500">Apenas administradores podem gerenciar agentes A3.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="text-xl font-semibold">Agentes A3</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        API keys para o agente local <code>cfi-a3</code>. Use uma key por colaborador/Mac.
                        Marque empresas como tipoCert=A3 na tela de certificados pra liberá-las nessas keys.
                    </p>
                </div>
                <button
                    onClick={() => setNovaModalAberta(true)}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                >
                    + Nova key
                </button>
            </div>

            {erro && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                    {erro}
                </div>
            )}

            <label className="flex items-center gap-2 mb-3 text-sm">
                <input
                    type="checkbox"
                    checked={mostrarRevogadas}
                    onChange={(e) => setMostrarRevogadas(e.target.checked)}
                />
                Mostrar keys revogadas
            </label>

            {loading ? (
                <p className="text-sm text-gray-500">Carregando...</p>
            ) : keysVisiveis.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma key cadastrada.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr className="text-left">
                                <th className="px-3 py-2">Label</th>
                                <th className="px-3 py-2">Dono</th>
                                <th className="px-3 py-2">Criada</th>
                                <th className="px-3 py-2">Último uso</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2 text-right">Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {keysVisiveis.map((k) => (
                                <tr key={k.keyId} className="border-t border-gray-200 dark:border-gray-700">
                                    <td className="px-3 py-2 font-medium">{k.label}</td>
                                    <td className="px-3 py-2">{k.ownerEmail || k.ownerUid}</td>
                                    <td className="px-3 py-2">{formatDate(k.createdAt)}</td>
                                    <td className="px-3 py-2">{formatDate(k.lastUsedAt)}</td>
                                    <td className="px-3 py-2">
                                        {k.revoked ? (
                                            <span className="text-red-600">Revogada</span>
                                        ) : (
                                            <span className="text-emerald-600">Ativa</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {!k.revoked && (
                                            <button
                                                onClick={() => handleRevogar(k.keyId)}
                                                className="px-2 py-1 rounded text-red-600 hover:bg-red-50 text-xs"
                                            >
                                                Revogar
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Seção: marcar empresa como A1/A3 */}
            <div className="mt-8 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                <h3 className="text-base font-semibold mb-1">Marcar empresa como A1 ou A3</h3>
                <p className="text-sm text-gray-500 mb-3">
                    Empresas A3 são removidas do cron noturno e capturadas apenas pelo agente local
                    <code className="mx-1">cfi-a3</code>. Já enviar o cert .pfx como A1? Use a tela atual
                    de "Certificado da empresa".
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">Empresa</label>
                        <EmpresaSearchSelect
                            empresas={paraEmpresaOptions(empresas)}
                            value={empresaSelecionada}
                            onChange={setEmpresaSelecionada}
                            placeholder="Selecione — código, nome ou CNPJ"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Tipo</label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setNovoTipoCert('A1')}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                                    novoTipoCert === 'A1'
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                A1
                            </button>
                            <button
                                type="button"
                                onClick={() => setNovoTipoCert('A3')}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                                    novoTipoCert === 'A3'
                                        ? 'bg-amber-600 text-white border-amber-600'
                                        : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                A3
                            </button>
                        </div>
                    </div>
                </div>
                <div className="mt-3 text-right">
                    <button
                        onClick={handleAplicarTipo}
                        disabled={aplicandoTipo || !empresaSelecionada}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                    >
                        {aplicandoTipo ? 'Aplicando...' : 'Aplicar'}
                    </button>
                </div>
            </div>

            {/* Modal: nova key */}
            {novaModalAberta && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-md w-full my-auto">
                        <h3 className="text-lg font-semibold mb-4">Nova API key</h3>
                        <div className="mb-3">
                            <label className="block text-sm font-medium mb-1">Colaborador</label>
                            <select
                                value={novoOwnerUid}
                                onChange={(e) => setNovoOwnerUid(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                            >
                                <option value="">Selecione...</option>
                                {colaboradores.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.email} {u.role === 'admin' ? '(admin)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1">Label (ajuda a identificar — ex: "Mac da Eunice")</label>
                            <input
                                type="text"
                                value={novoLabel}
                                onChange={(e) => setNovoLabel(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                                placeholder="Mac da Eunice"
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setNovaModalAberta(false)}
                                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleGerar}
                                disabled={gerando || !novoOwnerUid}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
                            >
                                {gerando ? 'Gerando...' : 'Gerar key'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: key crua (UMA VEZ) */}
            {keyCrua && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-2xl w-full my-auto">
                        <h3 className="text-lg font-semibold mb-2 text-amber-700">
                            Key gerada para {keyCrua.ownerEmail}
                        </h3>
                        <p className="text-sm text-amber-800 dark:text-amber-300 mb-4 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
                            ⚠ Esta key é mostrada <strong>uma única vez</strong>. Copie agora e passe pro colaborador
                            de forma segura (chat interno, papel). Depois desta tela, ela vira hash no servidor —
                            ninguém mais pode ver. Se perder, gera outra.
                        </p>
                        <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg font-mono text-xs break-all mb-4 select-all">
                            {keyCrua.apiKey}
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => handleCopiar(keyCrua.apiKey)}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
                            >
                                {keyCopiada ? '✓ Copiada' : 'Copiar key'}
                            </button>
                            <button
                                onClick={() => {
                                    if (!keyCopiada) {
                                        if (!confirm('Você ainda não copiou a key. Tem certeza que quer fechar? Não será mostrada de novo.')) return;
                                    }
                                    setKeyCrua(null);
                                    setKeyCopiada(false);
                                }}
                                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgentesA3;
