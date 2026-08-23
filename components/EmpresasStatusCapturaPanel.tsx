/**
 * EmpresasStatusCapturaPanel.tsx
 *
 * Tabela de TODAS as empresas com status de captura:
 *   - cert A1/A3/escritório/nenhum, validade, vencimento próximo
 *   - procuração e-CAC ativa
 *   - CCM SP autorizado
 *   - NFSe Nacional habilitada
 *   - se cada uma das 3 capturas (NFe / NFSe SP / NFSe Nacional) está OK ou bloqueada
 *
 * Filtros: por status (bloqueada, OK, cert vencendo) e busca por nome/CNPJ.
 * Admin pode togglar flags (procuração, NFSe Nacional, captura SEFAZ) inline.
 * Botão "Exportar CSV" pra usar como to-do list operacional.
 */

import CadastroClienteModal from './CadastroClienteModal';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { parsearCadastroEmpresas } from '../services/efiscalCadastroEmpresasParser';
import {
    fetchEmpresasStatusCaptura,
    toggleEmpresaFlag,
    autoPreencherUf,
    autoPreencherMunicipio,
    resetLockSefaz,
    salvarEmpresaDadosFiscais,
    corrigirRegimeEmpresa,
    arquivarEmpresa,
    excluirEmpresa,
    exportarEmpresasCsv,
    formatarErroAcaoStatusCaptura,
    formatarMotivoBloqueioCaptura,
    type EmpresaStatusCaptura,
    type EmpresaStatusResumo,
    type FlagCampo,
} from '../services/empresaStatusCapturaService';
import { captureFromSefaz, type DfeDocProcessado } from '../services/dfeCaptureService';
import EmpresaDadosFiscaisModal from './EmpresaDadosFiscaisModal';
import type { User } from '../types';

interface Props {
    currentUser: User;
}

type FiltroTipo = 'todas' | 'bloqueadas' | 'sem-uf' | 'sem-cert' | 'cert-vencendo' | 'sem-procuracao' | 'sem-ccmsp' | 'nfse-nac-inativa' | 'sem-responsavel' | 'ok-tudo';

function formatCnpj(s: string) {
    return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDate(iso: string | null) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('pt-BR');
    } catch { return iso; }
}

function diasAteVencimento(iso: string | null): number | null {
    if (!iso) return null;
    try {
        return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
    } catch { return null; }
}

const Pill: React.FC<{ ok: boolean; label: string; title?: string }> = ({ ok, label, title }) => (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        ok ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-red-100 text-red-800 border border-red-300'
    }`}>
        {ok ? '✓' : '✗'} {label}
    </span>
);

const EmpresasStatusCapturaPanel: React.FC<Props> = ({ currentUser }) => {
    const [data, setData] = useState<{ resumo: EmpresaStatusResumo; empresas: EmpresaStatusCaptura[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<FiltroTipo>('bloqueadas');
    // '' = todos os colaboradores; nome exato = só empresas daquele responsável.
    const [filtroColaborador, setFiltroColaborador] = useState('');
    const [busca, setBusca] = useState('');
    // Cadastro do cliente (pendências + responsável) — abre pela própria linha,
    // sem mandar o colaborador pra Carteira de Clientes em outra aba.
    const [cadastroAberto, setCadastroAberto] = useState<any | null>(null);
    const [togglingCnpj, setTogglingCnpj] = useState<string | null>(null);
    const [autoUfRunning, setAutoUfRunning] = useState(false);
    const [capturandoCnpj, setCapturandoCnpj] = useState<string | null>(null);
    const [resetandoLockCnpj, setResetandoLockCnpj] = useState<string | null>(null);
    const [empresaEditando, setEmpresaEditando] = useState<EmpresaStatusCaptura | null>(null);
    const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

    const handleResetLock = async (emp: EmpresaStatusCaptura) => {
        if (!isAdmin) return;
        if (!confirm(`Apagar lock SEFAZ de ${emp.nome}?\n\nO lock impede sync na mesma janela de 1h.\nApós resetar, próximo disparo (manual ou cron) vai recriar.`)) return;
        setResetandoLockCnpj(emp.cnpj);
        setFeedback(null);
        try {
            const r = await resetLockSefaz(emp.cnpj);
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: `${emp.nome}: ${r.msg || 'lock resetado'}.` });
                setUltimaCaptura(prev => ({
                    ...prev,
                    [emp.cnpj]: { ok: true, msg: `🔓 ${r.msg || 'Lock resetado'}` },
                }));
            } else {
                setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(r, emp, 'resetar o lock SEFAZ') });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(e?.message || 'falha inesperada', emp, 'resetar o lock SEFAZ') });
        } finally {
            setResetandoLockCnpj(null);
        }
    };
    const [ultimaCaptura, setUltimaCaptura] = useState<Record<string, { ok: boolean; msg: string; docs?: DfeDocProcessado[] }>>({});
    const isAdmin = currentUser.role === 'admin';
    const [acaoCnpj, setAcaoCnpj] = useState<string | null>(null); // botão em andamento (regime/arquivar/excluir)

    // Corrigir regime: move a empresa pra coleção certa (Simples ⇄ Lucro).
    const handleCorrigirRegime = async (emp: EmpresaStatusCaptura) => {
        if (!isAdmin) return;
        const regimeNovo = emp.regime === 'simples' ? 'lucro' : 'simples';
        if (!confirm(`Corrigir o REGIME de ${emp.nome}?\n\nDe ${emp.regime.toUpperCase()} → ${regimeNovo.toUpperCase()}.\nA empresa passa a ser processada pelo pipeline fiscal do novo regime (DAS/DCTFWeb/IPI/SPED). Os documentos e certificado já capturados são preservados.`)) return;
        setAcaoCnpj(emp.cnpj);
        setFeedback(null);
        try {
            const r = await corrigirRegimeEmpresa(emp.cnpj, regimeNovo);
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: `${emp.nome}: ${r.msg || `movida para ${regimeNovo}`}.` });
                await load();
            } else {
                setFeedback({ tipo: 'erro', msg: `Falha ao corrigir regime de ${emp.nome}: ${r.error}` });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: `Falha ao corrigir regime de ${emp.nome}: ${e?.message || 'erro'}` });
        } finally {
            setAcaoCnpj(null);
        }
    };

    // Arquivar (soft, reversível) / desarquivar.
    const handleArquivar = async (emp: EmpresaStatusCaptura, desarquivar = false) => {
        if (!isAdmin) return;
        const verbo = desarquivar ? 'DESARQUIVAR' : 'ARQUIVAR';
        if (!desarquivar && !confirm(`${verbo} ${emp.nome}?\n\nA empresa some das listas e para de ser capturada, mas os dados e documentos ficam guardados. É reversível (dá pra desarquivar).`)) return;
        setAcaoCnpj(emp.cnpj);
        setFeedback(null);
        try {
            const r = await arquivarEmpresa(emp.cnpj, desarquivar);
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: `${emp.nome}: ${r.msg || (desarquivar ? 'desarquivada' : 'arquivada')}.` });
                await load();
            } else {
                setFeedback({ tipo: 'erro', msg: `Falha ao ${verbo.toLowerCase()} ${emp.nome}: ${r.error}` });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: `Falha ao ${verbo.toLowerCase()} ${emp.nome}: ${e?.message || 'erro'}` });
        } finally {
            setAcaoCnpj(null);
        }
    };

    // Excluir definitivo (só se não tiver documentos — a trava é no backend).
    const handleExcluir = async (emp: EmpresaStatusCaptura) => {
        if (!isAdmin) return;
        if (!confirm(`EXCLUIR DEFINITIVAMENTE ${emp.nome}?\n\nApaga o cadastro de vez. Só funciona se a empresa NÃO tiver nenhum documento capturado (senão o sistema recusa e sugere Arquivar). Ação irreversível.`)) return;
        setAcaoCnpj(emp.cnpj);
        setFeedback(null);
        try {
            const r = await excluirEmpresa(emp.cnpj);
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: `${emp.nome}: ${r.msg || 'excluída'}.` });
                await load();
            } else if (r.code === 'TEM_DOCUMENTOS') {
                setFeedback({ tipo: 'erro', msg: `${emp.nome} tem ${r.totalDocs} documento(s) — não pode excluir. Use "Arquivar" para preservar o histórico.` });
            } else {
                setFeedback({ tipo: 'erro', msg: `Falha ao excluir ${emp.nome}: ${r.error}` });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: `Falha ao excluir ${emp.nome}: ${e?.message || 'erro'}` });
        } finally {
            setAcaoCnpj(null);
        }
    };

    const handleCaptureOne = async (emp: EmpresaStatusCaptura, resetNSU = false) => {
        if (!isAdmin) return;
        if (resetNSU && !confirm(`Recapturar do ZERO ${emp.nome}?\n\nZera o cursor NSU e reprocessa ~90 dias de DF-e da SEFAZ. Use quando uma nota "sumiu" (passou do cursor). Pode demorar e trazer muitos documentos.`)) return;
        setCapturandoCnpj(emp.cnpj);
        try {
            const r = await captureFromSefaz({
                empresa: { id: emp.id, cnpj: emp.cnpj } as any,
                user: currentUser,
                resetNSU,
            });
            setUltimaCaptura(prev => ({
                ...prev,
                [emp.cnpj]: {
                    ok: r.sucesso,
                    msg: r.sucesso
                        ? `✓ ${r.motivo}`
                        : (r.foraDeJanela ? `⏰ ${r.motivo}` :
                           r.rateLimited ? `🚦 ${r.motivo}` :
                           `✗ ${r.motivo}`),
                    docs: r.documentosProcessados,
                },
            }));
        } catch (e: any) {
            setUltimaCaptura(prev => ({
                ...prev,
                [emp.cnpj]: { ok: false, msg: `✗ ${e.message || 'erro'}` },
            }));
        } finally {
            setCapturandoCnpj(null);
        }
    };

    const [autoMunRunning, setAutoMunRunning] = useState(false);
    const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
    const handleAutoMunicipio = async () => {
        if (!isAdmin) return;
        if (!confirm('Auto-preencher o CÓDIGO DO MUNICÍPIO (IBGE) de todas as empresas sem ele, via BrasilAPI? Roda em background (~2-4 min). A elegibilidade da NFS-e Nacional depende disso.')) return;
        setAutoMunRunning(true);
        setFeedback(null);
        try {
            const r = await autoPreencherMunicipio();
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: 'Auto-preenchimento de município iniciado. Aguarde alguns minutos e clique em Atualizar (o card NFSe Nacional do Diagnóstico reflete na sequência).' });
            } else {
                setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(r.error || 'falha ao auto-preencher município', null, 'auto-preencher o município') });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(e?.message || 'falha inesperada', null, 'auto-preencher o município') });
        } finally {
            setAutoMunRunning(false);
        }
    };

    // Carga em massa do Cod.Cliente a partir da Listagem de Empresas do
    // E-Fiscal (HTML/XFRX). O parse é local; o backend confronta por CNPJ.
    const [importandoCodigos, setImportandoCodigos] = useState(false);
    const [resultadoCodigos, setResultadoCodigos] = useState<string | null>(null);

    const importarCodigosEfiscal = async (file: File | null) => {
        if (!file || !isAdmin) return;
        setImportandoCodigos(true);
        setResultadoCodigos(null);
        try {
            // O XFRX exporta em windows-1252 — ler como utf-8 quebra acentos.
            const buf = await file.arrayBuffer();
            const htmlBruto = new TextDecoder('windows-1252').decode(buf);
            const r = parsearCadastroEmpresas(htmlBruto);
            if (r.empresas.length === 0) {
                throw new Error('Não achei fichas "Código/Nome/C.G.C./C.N.P.J." — é a Listagem do '
                    + 'Cadastro de Empresas exportada em HTML pelo E-Fiscal?');
            }
            const { getAuth } = await import('firebase/auth');
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada — entre de novo.');
            const res = await fetch('/api/admin/sefaz/importar-cod-cliente', {
                method: 'POST',
                headers: { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ empresas: r.empresas.map(e => ({ codigo: e.codigo, cnpj: e.cnpj })) }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            const linhas = [
                `Arquivo lido: ${r.empresas.length} ficha(s) válidas`
                + (r.conflitos.length ? ` · ⚠ ${r.conflitos.length} CNPJ(s) com DOIS códigos no arquivo ficaram de fora: `
                    + r.conflitos.map(c => `${c.cnpj} (${c.codigos.join('/')})`).slice(0, 3).join(' · ') : '')
                + (r.ignoradas.length ? ` · ${r.ignoradas.length} ficha(s) ignoradas` : '') + '.',
                j.mensagem,
            ];
            if (Array.isArray(j.divergentes) && j.divergentes.length > 0) {
                linhas.push('Divergências (salvo × arquivo): '
                    + j.divergentes.slice(0, 8).map((d: any) => `${d.nome}: ${d.salvo} × ${d.arquivo}`).join(' · ')
                    + (j.divergentes.length > 8 ? ' …' : ''));
            }
            setResultadoCodigos(linhas.join('\n'));
            setFeedback({ tipo: 'sucesso', msg: `Cod.Cliente: ${j.gravadas} empresa(s) atualizadas.` });
        } catch (e: any) {
            setResultadoCodigos(`✕ ${e?.message || e}`);
            setFeedback({ tipo: 'erro', msg: `Importação de códigos não concluída: ${e?.message || e}` });
        } finally {
            setImportandoCodigos(false);
        }
    };

    const handleAutoUf = async () => {
        if (!isAdmin) return;
        if (!confirm(`Auto-preencher UF de ${data?.resumo.semUf || 0} empresas via BrasilAPI? Roda em background, leva ~1-3 min.`)) return;
        setAutoUfRunning(true);
        setFeedback(null);
        try {
            const r = await autoPreencherUf();
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: 'Auto-preenchimento iniciado. Aguarde 1 a 3 minutos e clique em Atualizar.' });
                if (autoUfTimeoutRef.current) clearTimeout(autoUfTimeoutRef.current);
                autoUfTimeoutRef.current = setTimeout(() => {
                    if (aliveRef.current) load();
                }, 60000);
            } else {
                setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(r.error || 'falha ao auto-preencher UF', null, 'auto-preencher a UF') });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(e?.message || 'falha inesperada', null, 'auto-preencher a UF') });
        } finally {
            setAutoUfRunning(false);
        }
    };

    // Guard contra setState apos unmount + cleanup do setTimeout em handleAutoUf
    const aliveRef = useRef(true);
    const autoUfTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const d = await fetchEmpresasStatusCaptura(mostrarArquivadas);
            if (aliveRef.current) setData(d);
        } catch (e: any) {
            if (aliveRef.current) setErro(e.message || 'Falha ao carregar');
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [mostrarArquivadas]);

    useEffect(() => {
        aliveRef.current = true;
        load();
        return () => {
            aliveRef.current = false;
            if (autoUfTimeoutRef.current) {
                clearTimeout(autoUfTimeoutRef.current);
                autoUfTimeoutRef.current = null;
            }
        };
    }, [load]);

    const empresasFiltradas = useMemo(() => {
        if (!data) return [];
        const buscaLow = busca.toLowerCase().replace(/\D/g, '');
        const buscaTxt = busca.toLowerCase().trim();
        // Quando ha busca ativa, ela PREVALECE sobre o filtro de status —
        // achar a empresa especifica importa mais que respeitar o filtro
        // (UX padrao de qualquer 'find' — encontra independente de outro
        // criterio). Sem isso o usuario digitava o CNPJ da empresa, o
        // filtro 'Bloqueadas' excluia ela e a busca parecia quebrada.
        if (buscaTxt) {
            return data.empresas.filter(e => {
                if (buscaLow && e.cnpj.includes(buscaLow)) return true;
                if (buscaTxt && e.nome.toLowerCase().includes(buscaTxt)) return true;
                return false;
            });
        }
        const passaStatus = (e: EmpresaStatusCaptura): boolean => {
            switch (filtro) {
                case 'bloqueadas': return e.motivosBloqueio.length > 0;
                case 'sem-uf': return !e.uf;
                case 'sem-cert': return e.tipoCert === 'nenhum';
                case 'cert-vencendo': {
                    const d = diasAteVencimento(e.certVenceEm);
                    return d !== null && d < 30;
                }
                // Usa flag BRUTA pra filtro: empresa sem procuração REAL marcada
                // no e-CAC. Cert A1/A3 próprio não conta como procuração.
                case 'sem-procuracao': return !e.procuracaoEcacFlagBruta;
                // Só conta como pendente quem o trilho SP-capital de fato
                // se aplica — empresa de outro município (ADN) fica fora.
                case 'sem-ccmsp': return e.nfseSpAplicavel !== false && !e.nfseSpAutorizado;
                case 'nfse-nac-inativa': return !e.nfseNacionalDfeAtivo;
                case 'sem-responsavel': return !e.responsaveis || e.responsaveis.length === 0;
                case 'ok-tudo': return e.capturaNfeOk && e.capturaNfseSpOk && e.capturaNfseNacionalOk;
                case 'todas':
                default: return true;
            }
        };
        // Filtro por colaborador (responsável na carteira) COMBINA com o de
        // status (E, não OU) — "bloqueadas do Carlos" é o caso de uso.
        const passaColaborador = (e: EmpresaStatusCaptura): boolean => {
            if (!filtroColaborador) return true;
            return (e.responsaveis || []).some(r => r.nome === filtroColaborador);
        };
        return data.empresas.filter(e => passaStatus(e) && passaColaborador(e));
    }, [data, filtro, busca, filtroColaborador]);

    // Colaboradores distintos presentes na carteira (para o dropdown de filtro).
    const colaboradores = useMemo(() => {
        const nomes = new Set<string>();
        for (const e of data?.empresas || []) {
            for (const r of e.responsaveis || []) if (r.nome) nomes.add(r.nome);
        }
        return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }, [data]);

    const handleToggle = async (cnpj: string, campo: FlagCampo, valorAtual: boolean) => {
        if (!isAdmin) return;
        setTogglingCnpj(cnpj + '-' + campo);
        setFeedback(null);
        const emp = data?.empresas.find(e => e.cnpj === cnpj) || null;
        try {
            const r = await toggleEmpresaFlag(cnpj, campo, !valorAtual);
            if (r.ok) {
                setFeedback({ tipo: 'sucesso', msg: `${emp?.nome || 'Empresa'}: alteração salva.` });
                await load();
            } else {
                setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(r, emp, 'salvar a alteração') });
            }
        } catch (e: any) {
            setFeedback({ tipo: 'erro', msg: formatarErroAcaoStatusCaptura(e?.message || 'falha inesperada', emp, 'salvar a alteração') });
        } finally {
            setTogglingCnpj(null);
        }
    };

    const handleExportCsv = () => {
        if (!data) return;
        const csv = exportarEmpresasCsv(empresasFiltradas);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `empresas-status-captura-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading && !data) return <div className="p-6 text-center text-gray-500">Carregando…</div>;
    if (erro) return (
        <div className="p-6 border border-red-300 bg-red-50 rounded">
            <p className="text-red-700 font-semibold">Erro: {erro}</p>
            <button onClick={load} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Tentar de novo</button>
        </div>
    );
    if (!data) return null;

    const r = data.resumo;

    // Card-filtro: clicar aplica o filtro correspondente na tabela e mostra um
    // anel de "selecionado". Ajuda o colaborador a atacar a pendência direto.
    const cardFiltro = (f: FiltroTipo, base: string) => ({
        className: `${base} cursor-pointer transition hover:shadow-md ${filtro === f && !busca ? 'ring-2 ring-offset-1 ring-slate-500 dark:ring-slate-300' : ''}`,
        role: 'button' as const,
        tabIndex: 0,
        title: 'Filtrar a tabela por esta pendência',
        onClick: () => { setBusca(''); setFiltro(f); },
        onKeyDown: (ev: React.KeyboardEvent) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setBusca(''); setFiltro(f); }
        },
    });

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">📋 Status de Captura por Empresa</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Identifica empresas bloqueadas por A1/A3, UF, procuração e-CAC ou autorização NFSe.
                </p>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 border border-blue-300 rounded-lg p-3">
                    <div className="text-xs text-blue-700 font-semibold">Total empresas</div>
                    <div className="text-2xl font-bold text-blue-900">{r.total}</div>
                </div>
                <div {...cardFiltro('bloqueadas', 'bg-green-50 border border-green-300 rounded-lg p-3')}>
                    <div className="text-xs text-green-700 font-semibold">Captura NFe OK</div>
                    <div className="text-2xl font-bold text-green-900">{r.capturaNfeOk}</div>
                    <div className="text-xs text-red-700">{r.capturaNfeBloqueada} bloqueadas ›</div>
                </div>
                <div {...cardFiltro('cert-vencendo', 'bg-yellow-50 border border-yellow-300 rounded-lg p-3')}>
                    <div className="text-xs text-yellow-700 font-semibold">Cert vencendo &lt;30d / Expirado ›</div>
                    <div className="text-2xl font-bold text-yellow-900">{r.certVenceEm30d} / {r.certExpirado}</div>
                </div>
                <div {...cardFiltro('sem-cert', 'bg-purple-50 border border-purple-300 rounded-lg p-3')}>
                    <div className="text-xs text-purple-700 font-semibold">Sem A1/A3 para captura ›</div>
                    <div className="text-2xl font-bold text-purple-900">{r.semCertNenhum}</div>
                </div>
                <div {...cardFiltro('sem-uf', 'bg-orange-50 border border-orange-300 rounded-lg p-3')}>
                    <div className="text-xs text-orange-700 font-semibold">Sem UF cadastrada</div>
                    <div className="text-2xl font-bold text-orange-900">{r.semUf}</div>
                    {isAdmin && r.semUf > 0 && (
                        <button
                            onClick={(ev) => { ev.stopPropagation(); handleAutoUf(); }}
                            disabled={autoUfRunning}
                            className="mt-1 text-[10px] px-2 py-0.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                            title="Busca a UF de cada CNPJ na BrasilAPI e preenche em massa"
                        >
                            {autoUfRunning ? '⏳ rodando…' : '🔧 Auto-preencher via BrasilAPI'}
                        </button>
                    )}
                    {!isAdmin && <div className="text-xs text-orange-600">bloqueia captura NFe</div>}
                    {isAdmin && (
                        <button
                            onClick={(ev) => { ev.stopPropagation(); handleAutoMunicipio(); }}
                            disabled={autoMunRunning}
                            className="mt-1 text-[10px] px-2 py-0.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 block"
                            title="Preenche o código IBGE do município (dadosFiscais.codMunIBGE) de todas as empresas sem ele — a elegibilidade da NFS-e Nacional depende disso"
                        >
                            {autoMunRunning ? '⏳ rodando…' : '🏙️ Auto-preencher município'}
                        </button>
                    )}
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">Cert A1 próprio</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comCertA1}</div>
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">Cert A3</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comCertA3}</div>
                </div>
                <div {...cardFiltro('sem-procuracao', 'bg-gray-50 border border-gray-300 rounded-lg p-3')}>
                    <div className="text-xs text-gray-700 font-semibold">Procuração e-CAC ativa</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comProcuracaoEcac}</div>
                    <div className="text-xs text-red-700">{r.semProcuracaoEcac} sem ›</div>
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">NFSe SP autorizado / Nacional ativo</div>
                    <div className="text-lg font-bold text-gray-900">{r.ccmSpAutorizado} / {r.nfseNacionalAtivo}</div>
                </div>
            </div>

            {/* Carga em massa do Cod.Cliente — a chave da migração do PG12
                (Paulo, 05/08: exportou o Cadastro de Empresas em HTML). */}
            {isAdmin && (
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                🔢 Importar códigos das empresas do E-Fiscal (Cod.Cliente)
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">
                                Suba a <b>Listagem do Cadastro de Empresas</b> exportada pelo E-Fiscal em <b>HTML</b>.
                                O confronto é por CNPJ: cada empresa do CFI recebe o código de lá (o que aparece antes
                                do nome). Código já salvo que <b>divirja</b> do arquivo NÃO é alterado — vira lista
                                pra decisão. Empresas do arquivo que não existem no CFI (carteira antiga) só contam
                                no relatório.
                            </p>
                        </div>
                        <label className={`px-3 py-2 text-sm rounded-lg font-semibold cursor-pointer ${importandoCodigos ? 'bg-slate-200 text-slate-500' : 'bg-blue-700 hover:bg-blue-800 text-white'}`}>
                            {importandoCodigos ? 'Importando…' : '📥 Escolher HTML'}
                            <input type="file" accept=".html,.htm" className="hidden" disabled={importandoCodigos}
                                onChange={e => { void importarCodigosEfiscal(e.target.files?.[0] || null); e.target.value = ''; }} />
                        </label>
                    </div>
                    {resultadoCodigos && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line border-t border-slate-100 dark:border-slate-700 pt-2">
                            {resultadoCodigos}
                        </div>
                    )}
                </div>
            )}

            {/* Filtros */}
            <div className="flex flex-wrap gap-2 items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                <select value={filtro} onChange={e => setFiltro(e.target.value as FiltroTipo)} className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600">
                    <option value="bloqueadas">🚨 Bloqueadas (qualquer motivo)</option>
                    <option value="sem-uf">Sem UF cadastrada (dadosFiscais.uf)</option>
                    <option value="sem-cert">Sem certificado A1/A3</option>
                    <option value="cert-vencendo">Certificado vence em &lt;30d</option>
                    <option value="sem-procuracao">Sem procuração e-CAC</option>
                    <option value="sem-ccmsp">Sem autorização NFSe SP</option>
                    <option value="nfse-nac-inativa">NFSe Nacional desativada</option>
                    <option value="sem-responsavel">👤 Sem responsável na carteira</option>
                    <option value="ok-tudo">✅ Captura sem bloqueio</option>
                    <option value="todas">Todas</option>
                </select>
                <select
                    value={filtroColaborador}
                    onChange={e => setFiltroColaborador(e.target.value)}
                    title="Filtrar pelas empresas de um colaborador (responsável na carteira)"
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600"
                >
                    <option value="">👥 Todos os colaboradores</option>
                    {colaboradores.map(nome => (
                        <option key={nome} value={nome}>👤 {nome}</option>
                    ))}
                </select>
                <input
                    type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600 placeholder-gray-400 dark:placeholder-slate-500 min-w-[240px]"
                />
                <span className="text-sm text-gray-600 dark:text-gray-300 ml-2">
                    {empresasFiltradas.length} de {data.empresas.length}
                    {busca && filtro !== 'todas' && (
                        <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">(filtro de status ignorado durante busca)</span>
                    )}
                </span>
                <div className="ml-auto flex gap-2 items-center">
                    {isAdmin && (
                        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none" title="Mostra empresas arquivadas (soft-delete) para poder desarquivar">
                            <input
                                type="checkbox"
                                checked={mostrarArquivadas}
                                onChange={e => setMostrarArquivadas(e.target.checked)}
                            />
                            🗄️ arquivadas
                        </label>
                    )}
                    <button onClick={load} className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-100 rounded">↻ Atualizar</button>
                    <button onClick={handleExportCsv} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700">⬇ Exportar CSV</button>
                </div>
            </div>

            {feedback && (
                <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                        feedback.tipo === 'sucesso'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                    role="status"
                >
                    <div className="flex items-start justify-between gap-3">
                        <span>{feedback.msg}</span>
                        <button
                            type="button"
                            onClick={() => setFeedback(null)}
                            className="text-xs opacity-70 hover:opacity-100"
                            aria-label="Fechar mensagem"
                        >
                            fechar
                        </button>
                    </div>
                </div>
            )}

            {/* Tabela */}
            <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full text-xs">
                    <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                        <tr>
                            <th className="px-2 py-2 text-left">CNPJ</th>
                            <th className="px-2 py-2 text-left">Razão Social</th>
                            <th className="px-2 py-2 text-left">Responsável</th>
                            <th className="px-2 py-2 text-center">Cert</th>
                            <th className="px-2 py-2 text-center">Procuração e-CAC</th>
                            <th className="px-2 py-2 text-center">NFSe SP</th>
                            <th className="px-2 py-2 text-center">NFSe Nacional</th>
                            <th className="px-2 py-2 text-center">Capturas</th>
                            <th className="px-2 py-2 text-left" title="Só o que impede a CAPTURA. A conferência do cadastro completo fica em &quot;Completar cadastro&quot;.">Bloqueios de captura</th>
                            <th className="px-2 py-2 text-center sticky right-0 z-10 bg-slate-100 dark:bg-slate-700">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {empresasFiltradas.map(e => {
                            const dias = diasAteVencimento(e.certVenceEm);
                            const certCor =
                                e.tipoCert === 'nenhum' ? 'bg-red-100 text-red-800 border-red-300' :
                                !e.certValido ? 'bg-red-100 text-red-800 border-red-300' :
                                dias !== null && dias < 30 ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                                'bg-green-100 text-green-800 border-green-300';
                            return (
                                <tr key={e.cnpj} className="border-t hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-2 py-1.5 font-mono">{formatCnpj(e.cnpj)}</td>
                                    <td className="px-2 py-1.5">
                                        <div className="font-semibold">{e.nome}</div>
                                        <div className="text-[10px] text-gray-500">{e.regime}</div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {(e.responsaveis && e.responsaveis.length > 0) ? (
                                            <div className="flex flex-col gap-0.5">
                                                {e.responsaveis.map((r, i) => (
                                                    <div key={i} className="text-[11px]">
                                                        <span className="font-medium">{r.nome}</span>
                                                        {r.papel === 'backup' && <span className="ml-1 text-[9px] text-gray-500 uppercase">backup</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">⚠ sem responsável</span>
                                        )}
                                        <button
                                            onClick={(ev) => { ev.stopPropagation(); setCadastroAberto(e); }}
                                            className="mt-1 text-[10px] text-sky-600 dark:text-sky-400 hover:underline"
                                            title="Cadastro do cliente: o que falta, o que isso quebra e a troca de responsável."
                                        >
                                            ✏️ cadastro / responsável
                                        </button>
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${certCor}`}>
                                            {e.tipoCert === 'nenhum' ? '✗ sem cert' :
                                             e.tipoCert === 'A1-raiz' ? 'A1 raiz' :
                                             e.tipoCert === 'escritorio' ? 'escritório' :
                                             e.tipoCert}
                                        </span>
                                        {e.certVenceEm && (
                                            <div className="text-[10px] text-gray-500 mt-1">
                                                vence {formatDate(e.certVenceEm)}
                                                {dias !== null && dias < 30 && dias >= 0 && <span className="text-yellow-700"> ({dias}d)</span>}
                                                {dias !== null && dias < 0 && <span className="text-red-700"> (vencido)</span>}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {isAdmin ? (
                                            <>
                                                <button
                                                    disabled={togglingCnpj === e.cnpj + '-procuracaoEcacAtiva'}
                                                    onClick={() => handleToggle(e.cnpj, 'procuracaoEcacAtiva', e.procuracaoEcacFlagBruta)}
                                                    title="Marque APENAS se a procuração e-CAC está realmente cadastrada na Receita. Para NFe DistDFe, use A1 próprio/mesma raiz ou agente A3 local."
                                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                                        e.procuracaoEcacFlagBruta ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'
                                                    } hover:opacity-80 disabled:opacity-50`}
                                                >
                                                    {togglingCnpj === e.cnpj + '-procuracaoEcacAtiva' ? '…' : e.procuracaoEcacFlagBruta ? '✓ marcada' : '✗ não marcada'}
                                                </button>
                                                {/* Compatibilidade com dados antigos que ainda venham inferidos. */}
                                                {!e.procuracaoEcacFlagBruta && e.procuracaoEcacAtiva && (
                                                    <div
                                                        className="text-[9px] text-gray-500 mt-0.5 italic"
                                                        title="Procuração e-CAC só deve ficar marcada quando existir de verdade no e-CAC."
                                                    >
                                                        ○ inferida
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <Pill ok={e.procuracaoEcacFlagBruta} label={e.procuracaoEcacFlagBruta ? 'marcada' : 'não marcada'} />
                                                {!e.procuracaoEcacFlagBruta && e.procuracaoEcacAtiva && (
                                                    <div className="text-[9px] text-gray-500 mt-0.5 italic">○ inferida</div>
                                                )}
                                            </>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {/* Trilho da capital só pra quem É da capital (codMunIBGE).
                                            Empresa de outro município mostra "ADN" — nunca fica
                                            "pendente" de um portal que não se aplica a ela. */}
                                        {e.nfseSpAplicavel === false ? (
                                            <>
                                                <span
                                                    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                                    title={`${e.municipioNfse ? `Município: ${e.municipioNfse}. ` : ''}O portal da Prefeitura de SP não se aplica — a NFS-e desta empresa vem pelo Padrão Nacional (ADN).`}
                                                >
                                                    — ADN
                                                </span>
                                                {e.ccmSp && (
                                                    <div className="text-[10px] text-amber-600 mt-1" title="CCM é específico da capital — se este número é a inscrição municipal local, mova para 'Inscrição Municipal' no Completar cadastro.">
                                                        ⚠ CCM: {e.ccmSp}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <Pill ok={e.nfseSpAutorizado} label={e.nfseSpAutorizado ? 'autorizado' : 'pendente'} />
                                                {e.ccmSp && <div className="text-[10px] text-gray-500 mt-1">CCM: {e.ccmSp}</div>}
                                            </>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {isAdmin ? (
                                            <button
                                                disabled={togglingCnpj === e.cnpj + '-nfseNacionalDfeAtivo'}
                                                onClick={() => handleToggle(e.cnpj, 'nfseNacionalDfeAtivo', e.nfseNacionalDfeAtivo)}
                                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                                    e.nfseNacionalDfeAtivo ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-700 border-gray-300'
                                                } hover:opacity-80 disabled:opacity-50`}
                                            >
                                                {togglingCnpj === e.cnpj + '-nfseNacionalDfeAtivo' ? '…' : e.nfseNacionalDfeAtivo ? '✓ ativa' : '✗ inativa'}
                                            </button>
                                        ) : (
                                            <Pill ok={e.nfseNacionalDfeAtivo} label={e.nfseNacionalDfeAtivo ? 'ativa' : 'inativa'} />
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <div className="flex flex-col gap-1 items-center">
                                            <Pill ok={e.capturaNfeOk} label="NFe" />
                                            <Pill ok={e.capturaNfseSpOk} label="NFSe SP" />
                                            <Pill
                                                ok={e.capturaNfseNacionalOk}
                                                label={e.capturaNfseNacionalVia === 'a3-local' ? 'NFSe Nac A3' : 'NFSe Nac'}
                                                title={e.capturaNfseNacionalVia === 'a3-local'
                                                    ? 'Coberta por certificado A3. Captura depende do agente local cfi-a3, fora do cron em nuvem.'
                                                    : undefined}
                                            />
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {/* "Tudo OK" lido como "cadastro perfeito"
                                            era a origem da dúvida da equipe
                                            (31/07): esta coluna só olha o que
                                            BLOQUEIA A CAPTURA. Campos como CNAE,
                                            e-mail, IE e data de abertura não
                                            travam captura nenhuma e por isso
                                            aparecem só na conferência de
                                            cadastro (botão "Completar cadastro"
                                            ao lado, e o selo da Carteira). */}
                                        {/* 🚨 A EMPRESA A3 NÃO PODE DIZER "✓ Captura OK".
                                            Ela não é capturada pelo cron em nuvem — quem a captura
                                            é o agente local cfi-a3 —, e o verde saía de um campo do
                                            CADASTRO (tipoCert === 'A3'), nunca de um documento ter
                                            chegado. Status lido como resultado, em 202 empresas.
                                            Agora a linha diz se o agente ENTREGOU, e quando. */}
                                        {e.motivosBloqueio.length === 0 && e.coberturaA3?.ehA3 ? (
                                            <span
                                                className={e.coberturaA3.situacao === 'a3-sem-entrega'
                                                    ? 'text-amber-700 text-xs'
                                                    : 'text-green-700 text-xs'}
                                                title={e.coberturaA3.acao || 'Entrega registrada pelo agente local cfi-a3.'}
                                            >
                                                {e.coberturaA3.situacao === 'a3-sem-entrega' ? '⚠ ' : '✓ '}
                                                {e.coberturaA3.texto}
                                            </span>
                                        ) : e.motivosBloqueio.length === 0 ? (
                                            <span
                                                className="text-green-700 text-xs"
                                                title={'Nada bloqueia a CAPTURA desta empresa. Não é atestado de cadastro completo: '
                                                    + 'CNAE, e-mail, Inscrição Estadual, anexo e data de abertura não travam captura e são conferidos em "Completar cadastro".'}
                                            >
                                                ✓ Captura OK
                                            </span>
                                        ) : (
                                            <ul className="text-[10px] text-red-700 space-y-0.5">
                                                {e.motivosBloqueio.map((m, i) => <li key={i}>• {formatarMotivoBloqueioCaptura(m)}</li>)}
                                            </ul>
                                        )}
                                    </td>
                                    {/* Ações: "Completar cadastro" vale pra QUALQUER
                                        usuário — preencher UF/CCM/IE é trabalho da
                                        equipe, e quem enxerga a pendência tem de poder
                                        corrigi-la (27/07). As ações de captura e as
                                        destrutivas seguem admin-only. */}
                                    <td className="px-2 py-1.5 text-center align-top sticky right-0 z-10 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700">
                                        <div className="flex flex-col gap-1 items-stretch">
                                            {isAdmin && (
                                                <>
                                                <button
                                                    onClick={() => handleCaptureOne(e)}
                                                    disabled={capturandoCnpj === e.cnpj}
                                                    className="px-2 py-1 text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                    title="Captura NFe DistDFe a partir do cursor NSU atual"
                                                >
                                                    {capturandoCnpj === e.cnpj ? '⏳…' : '▶ Capturar'}
                                                </button>
                                                <button
                                                    onClick={() => handleCaptureOne(e, true)}
                                                    disabled={capturandoCnpj === e.cnpj}
                                                    className="px-2 py-1 text-[10px] font-semibold bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                    title="Zera o cursor NSU e reprocessa ~90 dias — use quando uma nota sumiu (passou do cursor)"
                                                >
                                                    {capturandoCnpj === e.cnpj ? '⏳…' : '⟲ Recapturar do zero'}
                                                </button>
                                                <button
                                                    onClick={() => handleResetLock(e)}
                                                    disabled={resetandoLockCnpj === e.cnpj || capturandoCnpj === e.cnpj}
                                                    className="px-2 py-1 text-[10px] font-semibold bg-slate-600 hover:bg-slate-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                    title="Apaga o lock SEFAZ de 1h dessa empresa — útil pra rerun imediato após ajuste de certificado"
                                                >
                                                    {resetandoLockCnpj === e.cnpj ? '⏳…' : '🔓 Reset lock'}
                                                </button>
                                                </>
                                            )}
                                                <button
                                                    onClick={() => setEmpresaEditando(e)}
                                                    className="px-2 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors whitespace-nowrap"
                                                    title="Preencher UF, CCM, IE e demais campos do cadastro sem sair desta tela"
                                                >
                                                    ✏️ Completar cadastro
                                                </button>
                                                {isAdmin && (
                                                    <button
                                                        onClick={() => handleCorrigirRegime(e)}
                                                        disabled={acaoCnpj === e.cnpj}
                                                        className="px-2 py-1 text-[10px] font-semibold bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                        title="Mover a empresa entre Simples e Lucro — corrige o pipeline fiscal quando o regime foi cadastrado errado"
                                                    >
                                                        {acaoCnpj === e.cnpj ? '⏳…' : `🔀 Regime → ${e.regime === 'simples' ? 'Lucro' : 'Simples'}`}
                                                    </button>
                                                )}
                                                {isAdmin && !e.arquivada && (
                                                    <button
                                                        onClick={() => handleArquivar(e)}
                                                        disabled={acaoCnpj === e.cnpj}
                                                        className="px-2 py-1 text-[10px] font-semibold bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                        title="Arquivar (reversível): some das listas e para a captura, mas mantém os dados"
                                                    >
                                                        {acaoCnpj === e.cnpj ? '⏳…' : '🗄️ Arquivar'}
                                                    </button>
                                                )}
                                                {isAdmin && e.arquivada && (
                                                    <button
                                                        onClick={() => handleArquivar(e, true)}
                                                        disabled={acaoCnpj === e.cnpj}
                                                        className="px-2 py-1 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                        title="Desarquivar: religa a empresa nas listas e na captura"
                                                    >
                                                        {acaoCnpj === e.cnpj ? '⏳…' : '♻️ Desarquivar'}
                                                    </button>
                                                )}
                                                {isAdmin && (
                                                    <button
                                                        onClick={() => handleExcluir(e)}
                                                        disabled={acaoCnpj === e.cnpj}
                                                        className="px-2 py-1 text-[10px] font-semibold bg-red-700 hover:bg-red-800 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                        title="Excluir definitivo — só se a empresa não tiver nenhum documento capturado"
                                                    >
                                                        {acaoCnpj === e.cnpj ? '⏳…' : '🗑️ Excluir'}
                                                    </button>
                                                )}
                                            </div>
                                            {ultimaCaptura[e.cnpj] && (
                                                <div className={`mt-1 text-[10px] font-mono break-words ${
                                                    ultimaCaptura[e.cnpj].ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                                }`}>
                                                    {ultimaCaptura[e.cnpj].msg}
                                                </div>
                                            )}
                                            {ultimaCaptura[e.cnpj]?.docs && ultimaCaptura[e.cnpj].docs!.length > 0 && (
                                                <details className="mt-1 text-left">
                                                    <summary className="text-[10px] text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                                                        Ver {ultimaCaptura[e.cnpj].docs!.length} doc(s) processado(s)
                                                    </summary>
                                                    <div className="mt-1 space-y-1 max-h-[200px] overflow-y-auto">
                                                        {ultimaCaptura[e.cnpj].docs!.map((d, i) => {
                                                            const cor = d.status === 'ok' ? 'text-emerald-700' :
                                                                d.status === 'duplicado' ? 'text-amber-700' :
                                                                'text-red-600';
                                                            return (
                                                                <div key={i} className="text-[9px] font-mono border-l-2 border-slate-300 pl-1 py-0.5">
                                                                    <div className="flex gap-1 items-baseline">
                                                                        <span className={`font-bold ${cor}`}>{d.status}</span>
                                                                        <span className="text-slate-500">{d.schema || '?'}</span>
                                                                    </div>
                                                                    {d.chave && <div className="text-slate-700 dark:text-slate-300 break-all">{d.chave}</div>}
                                                                    {d.motivo && <div className="text-red-600 dark:text-red-400 break-words">{d.motivo}</div>}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </details>
                                            )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {empresasFiltradas.length === 0 && (
                    <div className="p-6 text-center text-gray-500 text-sm">Nenhuma empresa com esse filtro.</div>
                )}
            </div>

            {isAdmin && (
                <div className="text-xs text-gray-500 mt-2 p-3 bg-gray-50 rounded">
                    💡 Você é admin — pode ligar/desligar <strong>Procuração e-CAC</strong> e <strong>NFSe Nacional</strong> clicando nos botões.
                    Para NFe DistDFe, use <strong>A1 próprio/mesma raiz CNPJ</strong> ou <strong>agente A3 local</strong>. Pra subir certificado A1, vá em <strong>Empresas Monitoradas → coluna Certificado</strong>.
                </div>
            )}

            {/* Ponte "Completar cadastro": corrige a pendência (UF, CCM, IE…)
                sem sair da tela. Semeia com o dadosFiscais atual e salva por
                merge (não clobbera outros campos). */}
            {empresaEditando && (
                <EmpresaDadosFiscaisModal
                    isOpen={true}
                    empresaNome={empresaEditando.nome}
                    valoresAtuais={empresaEditando.dadosFiscais}
                    onClose={() => setEmpresaEditando(null)}
                    onSave={async (dados) => {
                        const r = await salvarEmpresaDadosFiscais(empresaEditando.cnpj, dados);
                        if (r.ok) {
                            setFeedback({ tipo: 'sucesso', msg: `${empresaEditando.nome}: cadastro salvo.` });
                            setEmpresaEditando(null);
                            await load();
                        } else {
                            setFeedback({ tipo: 'erro', msg: r.error || 'Falha ao salvar o cadastro.' });
                            throw new Error(r.error || 'falha ao salvar');
                        }
                    }}
                />
            )}

            {cadastroAberto && (
                <CadastroClienteModal
                    currentUser={currentUser}
                    empresa={{
                        id: cadastroAberto.id,
                        nome: cadastroAberto.nome,
                        cnpj: cadastroAberto.cnpj,
                        regime: cadastroAberto.regime,
                        uf: cadastroAberto.uf,
                        codMunIBGE: cadastroAberto.dadosFiscais?.codMunIBGE,
                        inscricaoEstadual: cadastroAberto.dadosFiscais?.inscricaoEstadual,
                        inscricaoMunicipal: cadastroAberto.dadosFiscais?.inscricaoMunicipal,
                        ccmSp: cadastroAberto.ccmSp,
                        email: cadastroAberto.dadosFiscais?.email,
                        telefone: cadastroAberto.dadosFiscais?.telefone,
                        respLegalNome: cadastroAberto.dadosFiscais?.respLegalNome,
                        contadorNome: cadastroAberto.dadosFiscais?.contadorNome,
                        contadorCrc: cadastroAberto.dadosFiscais?.contadorCrc,
                        responsaveis: cadastroAberto.responsaveis,
                    }}
                    onClose={() => setCadastroAberto(null)}
                    onShowToast={(msg) => setFeedback({ tipo: 'sucesso', msg })}
                    onAlterado={load}
                />
            )}
        </div>
    );
};

export default EmpresasStatusCapturaPanel;
