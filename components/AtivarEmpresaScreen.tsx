/**
 * AtivarEmpresaScreen — o SEGUNDO passo da sequência, e o que define o escopo.
 *
 * Paulo, 15/08: *"o começo de tudo é com a sequência: login colaborador →
 * ATIVAR EMPRESA. Ativar empresa é o que determina o que a pessoa vai ou não
 * fazer, é o que determina o que ela pode ou não fazer."*
 *
 * Esta tela não é um seletor a mais — é o portão. Enquanto não há empresa
 * ativa, os módulos que trabalham SOBRE um cliente não abrem, e a tela diz
 * isso em vez de deixar a pessoa clicar num card que responde vazio.
 *
 * O que ela NÃO faz: não filtra empresa com cadastro torto (sumir do seletor
 * faz o colaborador concluir que a empresa não existe — regra de 07/08) e não
 * ativa sozinha ao escolher na lista: o clique em ⚡ é o gesto, porque é ele
 * que troca o cliente em que a pessoa está trabalhando.
 */
import React, { useEffect, useMemo, useState } from 'react';
import EmpresaSearchSelect from './xml/EmpresaSearchSelect';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../services/xmlFiscalService';
import { fmtCnpjAtiva, type EmpresaAtiva } from '../services/empresaAtiva';
import LoadingSpinner from './LoadingSpinner';
import Logo from './Logo';
import type { User } from '../types';

interface Props {
    currentUser: User;
    /** Empresa já ativa — a tela também serve para TROCAR. */
    atual?: EmpresaAtiva | null;
    onAtivar: (e: EmpresaAtiva) => void;
    /** Só existe quando já há uma ativa: dá para voltar sem trocar. */
    onCancelar?: () => void;
}

const AtivarEmpresaScreen: React.FC<Props> = ({ currentUser, atual, onAtivar, onCancelar }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[] | null>(null);
    const [escolhida, setEscolhida] = useState('');
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        getEmpresasDisponiveis(currentUser)
            .then(l => { if (vivo) setEmpresas(l); })
            // Lista vazia por FALHA seria lida como "você não tem empresa na
            // carteira" — conclusão errada que manda procurar o admin à toa.
            .catch(e => { if (vivo) { setEmpresas([]); setErro(e?.message || 'falha ao carregar a carteira'); } });
        return () => { vivo = false; };
    }, [currentUser]);

    const lista = useMemo(() => empresas || [], [empresas]);

    const ativar = (id: string) => {
        const e = lista.find(x => x.id === id);
        if (!e) return;
        onAtivar({
            id: e.id,
            nome: e.nome,
            cnpj: String(e.cnpj || '').replace(/\D/g, ''),
            fonte: e.fonte,
            codCliente: e.codCliente,
            uf: e.uf,
            ativadaPor: currentUser.email,
            ativadaEm: Date.now(),
        });
    };

    return (
        <div className="min-h-screen flex items-start justify-center px-4 py-10" style={{ background: 'var(--bg-page)' }}>
            <div className="w-full max-w-2xl">
                <div className="flex flex-col items-center gap-3 mb-6">
                    <Logo className="h-14 w-auto" />
                    <div className="text-center">
                        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {atual ? 'Trocar de empresa' : 'Ative uma empresa para começar'}
                        </h1>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                            A empresa ativa define <strong>em qual cliente</strong> você está trabalhando —
                            e é ela que os módulos usam até você trocar.
                        </p>
                    </div>
                </div>

                <div className="rounded-xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    {empresas === null ? (
                        <div className="flex flex-col items-center gap-2 py-6">
                            <LoadingSpinner />
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Carregando a sua carteira…</p>
                        </div>
                    ) : (
                        <>
                            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                Empresa (busque por código, nome ou CNPJ)
                            </label>
                            <EmpresaSearchSelect
                                empresas={lista}
                                value={escolhida}
                                onChange={setEscolhida}
                                onAtivar={ativar}
                            />

                            {/* Carteira vazia tem DUAS causas com ações opostas: falha de
                                leitura × nenhuma empresa atribuída. Dizer só "nenhuma
                                empresa" na primeira manda a pessoa ao admin sem motivo. */}
                            {erro && (
                                <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                                    Não foi possível carregar a carteira ({erro}). Atualize a página — se persistir, avise o administrador.
                                </p>
                            )}
                            {!erro && lista.length === 0 && (
                                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                                    Você não tem nenhuma empresa na carteira. Peça ao administrador para atribuir clientes
                                    a você na tela <strong>Carteira de Clientes</strong>.
                                </p>
                            )}
                            {!erro && lista.length > 0 && (
                                <p className="mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    {lista.length} empresa(s) na sua carteira. Escolher na lista não carrega nada —
                                    o <strong>⚡ Ativar</strong> é que troca o cliente.
                                </p>
                            )}
                        </>
                    )}

                    {atual && (
                        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Ativa agora: <strong style={{ color: 'var(--text-primary)' }}>{atual.nome}</strong>{' '}
                                <span className="font-mono">{fmtCnpjAtiva(atual.cnpj)}</span>
                            </p>
                            {onCancelar && (
                                <button
                                    onClick={onCancelar}
                                    className="btn-press mt-2 text-xs px-3 py-1.5 rounded-lg"
                                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                                >
                                    ← Continuar nesta empresa
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <p className="text-center text-[11px] mt-4" style={{ color: 'var(--text-muted)' }}>
                    Consultas de tabela (CFOP, NCM, código de serviço) e as visões da carteira não dependem
                    de empresa ativa — o resto do app, sim.
                </p>
            </div>
        </div>
    );
};

export default AtivarEmpresaScreen;
