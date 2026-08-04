import React, { useState, useMemo, useEffect } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalImportResult, User, SimplesDetalheItem, SimplesItemCalculo } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import { ArrowLeftIcon, SaveIcon, UserIcon, HistoryIcon, EyeIcon, DownloadIcon, CalculatorIcon, GlobeIcon, DocumentTextIcon, ShieldIcon, AnimatedCheckIcon, PlusIcon, TrashIcon, TagIcon, BuildingIcon } from './Icons';
import HistoryRbt12Modal from './SimplesNacional/HistoryRbt12Modal';
import LoadingSpinner from './LoadingSpinner';
import NfseSpAdminPanel from './NfseSpAdminPanel';
import EmpresaDadosFiscaisModal from './EmpresaDadosFiscaisModal';
import CfopCorrelacaoModal from './CfopCorrelacaoModal';
import { useConfirm, usePrompt } from './dialog/DialogProvider';
import {
    emitirDasRegular, getAtividadesDeclaradas,
    getCodigoAtividadeIssFixo, salvarCodigoAtividadeIssFixo,
} from '../services/dasService';
import {
    mapPgdasPayload, avisosDoPayload, bloqueiosDoPayload, definirCodigoAtividadeIssFixo,
} from '../services/pgdasMapper';
import EmitirNfseModal from './NfseNacional/EmitirModal';
import PrevisaoDasModal from './Das/PrevisaoModal';
import PgdasConferirModal from './Pgdas/ConferirModal';

interface SimplesNacionalDetalheProps {
    empresa: SimplesNacionalEmpresa;
    notas: SimplesNacionalNota[];
    onBack: () => void;
    onImport: (empresaId: string, file: File) => Promise<SimplesNacionalImportResult>;
    onUpdateFolha12: (empresaId: string, val: number) => void;
    onSaveFaturamentoManual: (empresaId: string, faturamento: any, faturamentoDetalhado?: any) => Promise<any>;
    onUpdateEmpresa: (empresaId: string, data: Partial<SimplesNacionalEmpresa>) => Promise<any>;
    onShowClienteView: () => void;
    onShowToast: (message: string) => void;
    currentUser?: User | null;
}

interface CnaeInputState {
    valor: string;
    issRetido: boolean;
    icmsSt: boolean;
    isSup: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

const formatCnpj = (cnpj: string): string => {
    const d = String(cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
};

const CurrencyInput: React.FC<{ value: number; onChange: (val: number) => void; className?: string; placeholder?: string; label?: string }> = ({ value, onChange, className, placeholder, label }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const num = parseFloat(raw) / 100;
        onChange(isNaN(num) ? 0 : num);
    };
    const formatted = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);
    return (
        <div className={`relative ${className || ''}`}>
            {label && <label className="block text-xs font-bold text-slate-500 mb-1">{label}</label>}
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">R$</span>
                <input 
                    type="text" 
                    value={value === 0 && placeholder ? '' : formatted}
                    placeholder={placeholder}
                    onChange={handleChange} 
                    className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 font-bold dark:text-white dark:font-mono text-right text-sm"
                />
            </div>
        </div>
    );
};

const SimplesNacionalDetalhe: React.FC<SimplesNacionalDetalheProps> = ({
    empresa, notas, onBack, onImport, onUpdateFolha12, onSaveFaturamentoManual, onUpdateEmpresa, onShowClienteView, onShowToast, currentUser
}) => {
    const confirm = useConfirm();
    const pedirTexto = usePrompt();
    const [consultandoAtividades, setConsultandoAtividades] = useState(false);

    // O código da atividade "ISS fixo (SUP)" mora no BANCO, não no bundle:
    // cadastrar destrava a emissão sem esperar deploy. Falha de leitura NÃO
    // libera nada — o mapper segue com null e o bloqueio continua de pé.
    useEffect(() => {
        let vivo = true;
        getCodigoAtividadeIssFixo(currentUser ?? null).then((id) => {
            if (vivo) definirCodigoAtividadeIssFixo(id);
        });
        return () => { vivo = false; };
    }, [currentUser]);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isDadosFiscaisModalOpen, setIsDadosFiscaisModalOpen] = useState(false);
    const [isCfopCorrelacaoModalOpen, setIsCfopCorrelacaoModalOpen] = useState(false);
    const [emitindoDas, setEmitindoDas] = useState(false);
    const [isEmitirNfseOpen, setIsEmitirNfseOpen] = useState(false);
    const [isPrevisaoOpen, setIsPrevisaoOpen] = useState(false);
    const [isConferirPgdasOpen, setIsConferirPgdasOpen] = useState(false);
    const [folha12Input, setFolha12Input] = useState(empresa.folha12);
    
    // Estados de Apuração Mensal
    const [mesApuracao, setMesApuracao] = useState(new Date());
    const [faturamentoPorCnae, setFaturamentoPorCnae] = useState<Record<string, CnaeInputState>>({});
    
    // Filiais Detalhadas (LEGADO: buckets consolidados na matriz)
    const [filialComercio, setFilialComercio] = useState<number>(0);
    const [filialIndustria, setFilialIndustria] = useState<number>(0);
    const [filialServico, setFilialServico] = useState<number>(0);

    // NOVO (declaração por estabelecimento): receita própria de cada filial na
    // competência, keyed por CNPJ (14 díg). Persistido em faturamentoMensalDetalhado
    // sob as chaves filial::<cnpj>::comercio|industria|servico.
    const [filiaisReceita, setFiliaisReceita] = useState<Record<string, { comercio: number; industria: number; servico: number }>>({});
    const [novaFilialCnpj, setNovaFilialCnpj] = useState('');
    const [novaFilialApelido, setNovaFilialApelido] = useState('');

    const [icmsVendas, setIcmsVendas] = useState<number>(0);
    
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showCnaeSelector, setShowCnaeSelector] = useState(false);

    // Manual RBT12 editing state
    const [manualRbtHistory, setManualRbtHistory] = useState<Record<string, number>>(empresa.faturamentoManual || {});

    // Carrega dados ao mudar o mês
    useEffect(() => {
        const mesChave = `${mesApuracao.getFullYear()}-${(mesApuracao.getMonth() + 1).toString().padStart(2, '0')}`;
        const detalheMes = empresa.faturamentoMensalDetalhado?.[mesChave] || {};
        
        const novoFaturamentoPorCnae: Record<string, CnaeInputState> = {};
        
        // Helper para criar estado inicial ou carregar
        const getOrCreateState = (key: string, storedItem: any): CnaeInputState => {
            if (storedItem && typeof storedItem === 'object') {
                const item = storedItem as SimplesDetalheItem;
                return {
                    valor: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(item.valor),
                    issRetido: item.issRetido || false,
                    icmsSt: item.icmsSt || false,
                    isSup: item.isSup || false,
                    isMonofasico: item.isMonofasico || false,
                    isImune: item.isImune || false,
                    isExterior: item.isExterior || false
                };
            }
            return { valor: '0,00', issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
        };

        // Verifica se já existem dados salvos completos (incluindo itens extras adicionados manualmente)
        const keysSalvas = Object.keys(detalheMes).filter(k => !k.startsWith('filial_') && !k.startsWith('filial::') && k !== 'icms_vendas');
        
        if (keysSalvas.length > 0) {
            keysSalvas.forEach(key => {
                novoFaturamentoPorCnae[key] = getOrCreateState(key, detalheMes[key]);
            });
        } else {
            // Inicializa com padrão (Principal + Secundários)
            const keyPrincipal = `principal::0::${empresa.cnae}::${empresa.anexo}`;
            const storedPrincipal = detalheMes[keyPrincipal] || detalheMes[empresa.cnae];
            novoFaturamentoPorCnae[keyPrincipal] = getOrCreateState(keyPrincipal, storedPrincipal);

            if (empresa.atividadesSecundarias) {
                empresa.atividadesSecundarias.forEach((ativ, index) => {
                    const keySec = `secundario::${index}::${ativ.cnae}::${ativ.anexo}`;
                    const storedSec = detalheMes[keySec] || detalheMes[ativ.cnae];
                    novoFaturamentoPorCnae[keySec] = getOrCreateState(keySec, storedSec);
                });
            }
        }

        setFaturamentoPorCnae(novoFaturamentoPorCnae);

        // Carrega Filiais (LEGADO consolidado)
        setFilialComercio(detalheMes['filial_comercio']?.valor || 0);
        setFilialIndustria(detalheMes['filial_industria']?.valor || 0);
        setFilialServico(detalheMes['filial_servico']?.valor || 0);

        // Carrega receita por estabelecimento (NOVO)
        const novaFiliaisReceita: Record<string, { comercio: number; industria: number; servico: number }> = {};
        (empresa.filiais || []).forEach((filial) => {
            const cnpj = String(filial.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            novaFiliaisReceita[cnpj] = {
                comercio: detalheMes[`filial::${cnpj}::comercio`]?.valor || 0,
                industria: detalheMes[`filial::${cnpj}::industria`]?.valor || 0,
                servico: detalheMes[`filial::${cnpj}::servico`]?.valor || 0,
            };
        });
        setFiliaisReceita(novaFiliaisReceita);

        // Carrega ICMS
        setIcmsVendas(detalheMes['icms_vendas']?.valor || 0);

        setManualRbtHistory(empresa.faturamentoManual || {});

    }, [mesApuracao, empresa.id, empresa.faturamentoManual, empresa.faturamentoMensalDetalhado, empresa.cnae, empresa.anexo, empresa.atividadesSecundarias, empresa.filiais]);

    // Recalcula o Resumo em Tempo Real com base nos Inputs
    const resumo = useMemo(() => {
        const itensCalculo: SimplesItemCalculo[] = [];
        
        Object.entries(faturamentoPorCnae).forEach(([key, value]) => {
            const state = value as CnaeInputState;
            const parts = key.split('::');
            const cnaeCode = parts.length >= 3 ? parts[2] : key;
            const anexoCode = parts.length >= 4 ? parts[3] : empresa.anexo;
            
            const val = parseFloat(state.valor.replace(/\./g, '').replace(',', '.') || '0');
            
            itensCalculo.push({
                cnae: cnaeCode,
                anexo: anexoCode as any,
                valor: val,
                issRetido: state.issRetido,
                icmsSt: state.icmsSt,
                isSup: state.isSup,
                isMonofasico: state.isMonofasico,
                isImune: state.isImune,
                isExterior: state.isExterior
            });
        });

        // Filiais: quando há receita por estabelecimento (NOVO), usa-a e IGNORA os
        // buckets consolidados legados (evita dupla contagem). Caso contrário, usa
        // os buckets consolidados na matriz (compat com empresas sem filial cadastrada).
        const anexoServicoFilial = ['III', 'IV', 'V'].includes(empresa.anexo) ? empresa.anexo : 'III';
        const totalFiliaisReceita = Object.values(filiaisReceita)
            .reduce((acc, r) => acc + (r.comercio || 0) + (r.industria || 0) + (r.servico || 0), 0);
        const usarPerFilial = totalFiliaisReceita > 0;

        if (usarPerFilial) {
            Object.entries(filiaisReceita).forEach(([cnpj, r]) => {
                if (r.comercio > 0) {
                    itensCalculo.push({ cnae: `Filial ${cnpj} Comércio`, anexo: 'I', valor: r.comercio, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
                }
                if (r.industria > 0) {
                    itensCalculo.push({ cnae: `Filial ${cnpj} Indústria`, anexo: 'II', valor: r.industria, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
                }
                if (r.servico > 0) {
                    itensCalculo.push({ cnae: `Filial ${cnpj} Serviço`, anexo: anexoServicoFilial as any, valor: r.servico, issRetido: true, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
                }
            });
        } else {
            if (filialComercio > 0) {
                itensCalculo.push({ cnae: 'Filial Comércio', anexo: 'I', valor: filialComercio, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
            }
            if (filialIndustria > 0) {
                itensCalculo.push({ cnae: 'Filial Indústria', anexo: 'II', valor: filialIndustria, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
            }
            if (filialServico > 0) {
                itensCalculo.push({
                    cnae: 'Filial Serviço',
                    anexo: anexoServicoFilial as any,
                    valor: filialServico,
                    issRetido: true,  // ISS NÃO compõe o DAS da matriz (é municipal, pago na filial)
                    icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false
                });
            }
        }

        // Simula a empresa com os dados atuais de input para o cálculo
        const empresaTemp = {
            ...empresa,
            faturamentoManual: manualRbtHistory,
            folha12: folha12Input
        };

        return simplesService.calcularResumoEmpresa(empresaTemp, notas, mesApuracao, { itensCalculo });
    }, [empresa, notas, mesApuracao, faturamentoPorCnae, filialComercio, filialIndustria, filialServico, filiaisReceita, manualRbtHistory, folha12Input]);

    // Calculate total RBT12 from manual inputs
    const totalRbt12Manual = useMemo(() => {
        let total = 0;
        const today = new Date(mesApuracao); 
        for (let i = 1; i <= 12; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            total += (manualRbtHistory[k] || 0);
        }
        return total;
    }, [manualRbtHistory, mesApuracao]);

    const handleFaturamentoChange = (key: string, rawValue: string) => {
        const digits = rawValue.replace(/\D/g, '');
        const numberValue = parseInt(digits, 10) / 100;
        const formatted = isNaN(numberValue) ? '0,00' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue);

        setFaturamentoPorCnae((prev) => ({
            ...prev,
            [key]: { ...prev[key], valor: formatted }
        }));
    };

    /**
     * "ISS Retido" e "ISS fixo (SUP)" são naturezas EXCLUDENTES do mesmo ISS —
     * marcar as duas descreveria a receita de dois jeitos ao mesmo tempo. Ligar
     * uma desliga a outra; o efeito no DAS (ISS fora) é igual nas duas.
     */
    const handleIssExclusivo = (key: string, field: 'issRetido' | 'isSup') => {
        const oposto = field === 'issRetido' ? 'isSup' : 'issRetido';
        setFaturamentoPorCnae((prev) => {
            const ligando = !prev[key][field];
            return {
                ...prev,
                [key]: { ...prev[key], [field]: ligando, ...(ligando ? { [oposto]: false } : {}) },
            };
        });
    };

    const handleOptionToggle = (key: string, field: keyof CnaeInputState) => {
        setFaturamentoPorCnae((prev) => ({
            ...prev,
            [key]: { ...prev[key], [field]: !prev[key][field] }
        }));
    };

    const cnaesDisponiveis = [
        { cnae: empresa.cnae, anexo: empresa.anexo, label: 'Atividade Principal' },
        ...( empresa.atividadesSecundarias?.map((a, i) => ({
            cnae: a.cnae, anexo: a.anexo, label: `Atividade Secundária ${i + 1}`
        })) || [] )
    ];

    const handleAddRevenueItem = (cnae: string, anexo: string, tipo: string) => {
        const id = Date.now();
        const key = `extra::${id}::${cnae}::${anexo}`;
        setFaturamentoPorCnae(prev => ({
            ...prev,
            [key]: { valor: '0,00', issRetido: tipo === 'ISS Retido', icmsSt: tipo === 'ST', isSup: false, isMonofasico: tipo === 'Monofasico', isImune: false, isExterior: false }
        }));
        setShowCnaeSelector(false);
    };

    const handleRemoveRevenueItem = (key: string) => {
        setFaturamentoPorCnae(prev => {
            const newState = { ...prev };
            delete newState[key];
            return newState;
        });
    };

    /**
     * Lê as atividades de uma declaração PGDAS-D JÁ transmitida desta empresa.
     * Consulta pura — não declara nada. Existe porque a tabela de atividades do
     * SERPRO não é acessível de dentro do app: quando falta o código de uma
     * atividade (ex.: ISS fixo do escritório contábil, caso S&P), a fonte
     * confiável é o que a Receita já aceitou desta própria empresa.
     */
    const handleVerAtividadesDeclaradas = async () => {
        const sugestao = (() => {
            const d = new Date(mesApuracao.getFullYear(), mesApuracao.getMonth() - 1, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const competencia = await pedirTexto({
            title: 'Atividades de uma declaração já transmitida',
            message: (
                <>
                    Informe a competência (AAAA-MM) de um mês <b>já declarado</b> desta empresa.
                    O app mostra os <b>códigos de atividade</b> que constam na declaração aceita
                    pela Receita. Nada é transmitido — é só consulta.
                </>
            ),
            defaultValue: sugestao,
            placeholder: 'AAAA-MM',
            confirmLabel: 'Consultar',
        });
        if (!competencia) return;

        setConsultandoAtividades(true);
        try {
            const r = await getAtividadesDeclaradas(currentUser ?? null, empresa.cnpj, competencia.trim());
            await confirm({
                title: `Atividades declaradas em ${competencia.trim()}`,
                message: (
                    <div style={{ fontSize: 13 }}>
                        {r.detalhamentoIndisponivel ? (
                            <p>
                                A consulta respondeu, mas <b>não veio o detalhamento por atividade</b> —
                                a Receita devolveu só o recibo/valores. Tente outra competência; se
                                repetir, o código precisa vir da tabela de atividades do SERPRO.
                            </p>
                        ) : (
                            <>
                                <p style={{ marginBottom: 8 }}>
                                    Códigos que a Receita <b>já aceitou</b> desta empresa:
                                </p>
                                <ul style={{ margin: '0 0 8px 16px' }}>
                                    {r.atividades.map((a) => (
                                        <li key={a.idAtividade}>
                                            <b>{a.idAtividade}</b>
                                            {a.rotulo ? ` — ${a.rotulo}` : ''}
                                            {' · '}R$ {a.valorAtividade.toFixed(2).replace('.', ',')}
                                            {!a.rotulo && <b style={{ color: '#7c3aed' }}> ← ainda não mapeado no app</b>}
                                        </li>
                                    ))}
                                </ul>
                                {r.resumo.temNova && (
                                    <p style={{ padding: 8, borderRadius: 6, background: '#F5F3FF', color: '#5B21B6' }}>
                                        Achado: {r.resumo.novas.map((a) => a.idAtividade).join(', ')} —
                                        código(s) que esta empresa usa e o app ainda não monta. Mande
                                        este número ao Paulo para cadastrarmos a atividade.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                ),
                variant: 'info',
                confirmLabel: 'Fechar',
            });

            // A trava do ISS fixo (SUP) morre aqui: o admin cadastra o número
            // LIDO da declaração, sem esperar deploy. Só oferece quando há
            // código novo — cadastrar de memória é o que não pode acontecer.
            if (currentUser?.role === 'admin' && r.resumo?.temNova) {
                const digitado = await pedirTexto({
                    title: 'Cadastrar o código do ISS fixo (SUP)',
                    message: (
                        <>
                            Se um destes códigos é a atividade <b>"Escritórios de serviços contábeis
                            autorizados pela legislação municipal a pagar o ISS em valor fixo em guia
                            do Município"</b>, informe o número: {r.resumo.novas.map((a) => a.idAtividade).join(', ')}.
                            <br /><br />
                            Ele passa a valer para <b>todas as empresas</b> e destrava a emissão do DAS
                            dessas receitas. Deixe em branco se não for nenhum.
                        </>
                    ),
                    defaultValue: '',
                    placeholder: 'ex.: 16',
                    confirmLabel: 'Cadastrar',
                });
                const idNum = Number(String(digitado || '').trim());
                if (Number.isInteger(idNum) && idNum > 0) {
                    try {
                        await salvarCodigoAtividadeIssFixo(currentUser ?? null, {
                            id: idNum,
                            origem: 'declaracao',
                            cnpjOrigem: empresa.cnpj,
                            competenciaOrigem: competencia.trim(),
                            idsDeclarados: r.atividades.map((a) => a.idAtividade),
                        });
                        definirCodigoAtividadeIssFixo(idNum);
                        onShowToast(`Código ${idNum} cadastrado — o DAS com ISS fixo (SUP) está liberado.`);
                    } catch (e: any) {
                        onShowToast(e?.message || 'Não foi possível cadastrar o código.');
                    }
                }
            }
        } catch (err: any) {
            onShowToast(err?.message || 'Falha ao consultar as atividades declaradas.');
        } finally {
            setConsultandoAtividades(false);
        }
    };

    const handleEmitirDasRegular = async () => {
        if (!resumo?.das_mensal || resumo.das_mensal < 10) {
            onShowToast('DAS calculado é menor que R\$ 10,00 — verifique a apuração antes de emitir.');
            return;
        }
        const competencia = `${mesApuracao.getFullYear()}-${String(mesApuracao.getMonth() + 1).padStart(2, '0')}`;
        // Natureza que o app ainda não sabe declarar: RECUSA em vez de mandar
        // errado pro Simples (Paulo, 03/08 — caso do ISS fixo da S&P).
        const bloqueios = bloqueiosDoPayload(faturamentoPorCnae as Record<string, any>);
        if (bloqueios.length > 0) {
            await confirm({
                title: 'Não dá pra transmitir esta competência ainda',
                message: (
                    <div style={{ fontSize: 13 }}>
                        {bloqueios.map((b, i) => <p key={i} style={{ marginBottom: 8 }}>{b}</p>)}
                    </div>
                ),
                variant: 'warning',
                confirmLabel: 'Entendi',
                cancelLabel: 'Fechar',
            });
            return;
        }

        // Marcações que reduzem o DAS aqui mas ainda não viajam na declaração —
        // aparecem ANTES de transmitir (a entrega ao PGDAS-D não se desfaz).
        const avisos = avisosDoPayload(faturamentoPorCnae as Record<string, any>);
        const ok = await confirm({
            title: 'Emitir DAS Regular?',
            message: (
                <>
                    Empresa: <b>{empresa.nome}</b><br />
                    Competência: <b>{competencia}</b><br />
                    Valor: <b>R$ {resumo.das_mensal.toFixed(2).replace('.', ',')}</b>
                    {avisos.length > 0 && (
                        <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: '#FEF3C7', color: '#92400E', fontSize: 12 }}>
                            <b>⚠ Confira antes de transmitir</b>
                            <ul style={{ margin: '4px 0 0 16px' }}>
                                {avisos.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                        </div>
                    )}
                </>
            ),
            variant: avisos.length > 0 ? 'warning' : 'info',
            confirmLabel: 'Emitir',
        });
        if (!ok) return;

        setEmitindoDas(true);
        try {
            const dadosPgdas = mapPgdasPayload({
                empresa: {
                    ...empresa,
                    folha12: folha12Input,
                },
                resumo,
                mesApuracao,
                faturamentoPorCnae,
                filialComercio,
                filialIndustria,
                filialServico,
                filiaisReceita: Object.entries(filiaisReceita).map(([cnpj, r]) => ({
                    cnpj,
                    comercio: r.comercio || 0,
                    industria: r.industria || 0,
                    servico: r.servico || 0,
                })),
                icmsVendas,
            });
            const dasEmitido = await emitirDasRegular(currentUser ?? null, {
                empresaId: empresa.id,
                empresaCnpj: empresa.cnpj,
                empresaNome: empresa.nome,
                competencia,
                valor: resumo.das_mensal,
                dadosPgdas,
            });
            onShowToast(dasEmitido.pgdasTipoDeclaracao === 2
                ? 'DAS emitido com PGDAS retificador. Veja em Central de DAS.'
                : 'DAS Regular emitido com sucesso! Veja em Central de DAS.');
        } catch (err: any) {
            onShowToast(`Erro ao emitir: ${err.message}`);
        } finally {
            setEmitindoDas(false);
        }
    };

    const handleSaveMesVigente = async () => {
        setIsSaving(true);
        try {
            const detalheMes: Record<string, SimplesDetalheItem> = {};
            let totalMes: number = 0;

            // 1. Processa Itens Normais e Extras
            Object.entries(faturamentoPorCnae).forEach(([key, value]) => {
                const state = value as CnaeInputState;
                const valString = state.valor.replace(/\./g, '').replace(',', '.') || '0';
                const val = parseFloat(valString);
                const safeVal = isNaN(val) ? 0 : val;
                
                totalMes += safeVal;
                
                detalheMes[key] = {
                    valor: safeVal,
                    issRetido: state.issRetido,
                    icmsSt: state.icmsSt,
                    isSup: state.isSup,
                    isMonofasico: state.isMonofasico,
                    isImune: state.isImune,
                    isExterior: state.isExterior
                };
            });

            // 2a. Filiais consolidadas LEGADO (só entram no total quando NÃO há
            // receita por estabelecimento, para não duplicar).
            const totalFiliaisReceita = Object.values(filiaisReceita)
                .reduce((acc, r) => acc + (r.comercio || 0) + (r.industria || 0) + (r.servico || 0), 0);
            const usarPerFilial = totalFiliaisReceita > 0;

            const safeFilialComercio = Number(filialComercio) || 0;
            const safeFilialIndustria = Number(filialIndustria) || 0;
            const safeFilialServico = Number(filialServico) || 0;

            if (!usarPerFilial) {
                totalMes += safeFilialComercio + safeFilialIndustria + safeFilialServico;
            }

            detalheMes['filial_comercio'] = { valor: safeFilialComercio, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
            detalheMes['filial_industria'] = { valor: safeFilialIndustria, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
            detalheMes['filial_servico'] = { valor: safeFilialServico, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };

            // 2b. Receita por estabelecimento (NOVO) — uma chave por tipo/CNPJ.
            Object.entries(filiaisReceita).forEach(([cnpj, r]) => {
                const c = Number(r.comercio) || 0;
                const i = Number(r.industria) || 0;
                const s = Number(r.servico) || 0;
                totalMes += c + i + s;
                detalheMes[`filial::${cnpj}::comercio`] = { valor: c, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
                detalheMes[`filial::${cnpj}::industria`] = { valor: i, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
                detalheMes[`filial::${cnpj}::servico`] = { valor: s, issRetido: true, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
            });

            // 3. Salva ICMS Informativo
            detalheMes['icms_vendas'] = { valor: icmsVendas || 0, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };

            const mesChave = `${mesApuracao.getFullYear()}-${(mesApuracao.getMonth() + 1).toString().padStart(2, '0')}`;
            
            // Atualiza histórico manual com o total do mês (Matriz + Filiais)
            const novoHistorico = { ...manualRbtHistory, [mesChave]: totalMes };
            setManualRbtHistory(novoHistorico);

            // Atualiza detalhamento do mês
            const novoDetalhamento = { ...(empresa.faturamentoMensalDetalhado || {}), [mesChave]: detalheMes };

            await onUpdateEmpresa(empresa.id, {
                faturamentoManual: novoHistorico,
                faturamentoMensalDetalhado: novoDetalhamento,
                folha12: folha12Input
            });

            setSaveSuccess(true);
            onShowToast('Apuração salva com sucesso!');
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            console.error(error);
            onShowToast(`Erro ao salvar apuração: ${error?.message || 'falha desconhecida'}. Os valores NÃO foram gravados.`);
        } finally {
            setIsSaving(false);
        }
    };

    const raizMatriz = String(empresa.cnpj || '').replace(/\D/g, '').slice(0, 8);

    const setFilialReceitaCampo = (cnpj: string, campo: 'comercio' | 'industria' | 'servico', valor: number) => {
        setFiliaisReceita(prev => ({
            ...prev,
            [cnpj]: {
                comercio: prev[cnpj]?.comercio || 0,
                industria: prev[cnpj]?.industria || 0,
                servico: prev[cnpj]?.servico || 0,
                [campo]: valor,
            },
        }));
    };

    const handleAddFilial = async () => {
        const cnpj = novaFilialCnpj.replace(/\D/g, '');
        if (cnpj.length !== 14) {
            onShowToast('CNPJ da filial deve ter 14 dígitos.');
            return;
        }
        if (raizMatriz && cnpj.slice(0, 8) !== raizMatriz) {
            onShowToast('A filial deve ter a mesma raiz de CNPJ da matriz.');
            return;
        }
        if (cnpj === String(empresa.cnpj || '').replace(/\D/g, '')) {
            onShowToast('Este é o CNPJ da matriz, não de uma filial.');
            return;
        }
        if ((empresa.filiais || []).some(f => String(f.cnpj || '').replace(/\D/g, '') === cnpj)) {
            onShowToast('Filial já cadastrada.');
            return;
        }
        const novasFiliais = [...(empresa.filiais || []), { cnpj, apelido: novaFilialApelido.trim() || undefined }];
        try {
            await onUpdateEmpresa(empresa.id, { filiais: novasFiliais });
            setFiliaisReceita(prev => ({ ...prev, [cnpj]: { comercio: 0, industria: 0, servico: 0 } }));
            setNovaFilialCnpj('');
            setNovaFilialApelido('');
            onShowToast('Filial cadastrada.');
        } catch (e: any) {
            onShowToast(`Erro ao cadastrar filial: ${e?.message || 'falha'}`);
        }
    };

    const handleRemoveFilial = async (cnpj: string) => {
        const ok = await confirm({
            title: 'Remover filial',
            message: `Remover o estabelecimento ${formatCnpj(cnpj)} desta empresa? A receita já lançada nos meses não será apagada, mas a filial deixará de aparecer.`,
            variant: 'danger',
            confirmLabel: 'Remover',
        });
        if (!ok) return;
        const novasFiliais = (empresa.filiais || []).filter(f => String(f.cnpj || '').replace(/\D/g, '') !== cnpj);
        try {
            await onUpdateEmpresa(empresa.id, { filiais: novasFiliais });
            setFiliaisReceita(prev => {
                const { [cnpj]: _removed, ...rest } = prev;
                return rest;
            });
            onShowToast('Filial removida.');
        } catch (e: any) {
            onShowToast(`Erro ao remover filial: ${e?.message || 'falha'}`);
        }
    };

    const handleSaveHistory = async () => {
        await onSaveFaturamentoManual(empresa.id, manualRbtHistory);
        setIsHistoryModalOpen(false);
        onShowToast("Histórico de faturamento atualizado!");
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const res = await onImport(empresa.id, file);
            if (res.faturamentoManual) {
                setManualRbtHistory(res.faturamentoManual);
            }
            if (res.errors.length > 0) {
                onShowToast(`Importação com avisos: ${res.errors[0]}`);
            } else {
                onShowToast(`Importado com sucesso!`);
            }
        }
    };

    return (
        <div className="animate-fade-in pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{empresa.nome}</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{empresa.cnpj} • Anexo {empresa.anexo}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={onShowClienteView} className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-100 text-sky-700 font-bold rounded-lg hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50">
                        <EyeIcon className="w-5 h-5" />
                        Visão Cliente
                    </button>
                    <button onClick={() => setIsDadosFiscaisModalOpen(true)} className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 font-bold rounded-lg hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" title="Dados fiscais para SPED, DCTFWeb e outras obrigacoes">
                        <BuildingIcon className="w-5 h-5" />
                        Dados Fiscais
                    </button>
                    <button onClick={() => setIsCfopCorrelacaoModalOpen(true)} className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 font-bold rounded-lg hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" title="Correlacao automatica/manual de CFOPs no SPED Fiscal">
                        🔄 Correlacao CFOP
                    </button>
                    <button
                        onClick={handleVerAtividadesDeclaradas}
                        disabled={consultandoAtividades}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-violet-100 text-violet-700 font-bold rounded-lg hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
                        title="Mostra os códigos de atividade que a Receita já aceitou nas declarações desta empresa (consulta, não declara nada)"
                    >
                        {consultandoAtividades ? '⏳ Consultando...' : '🔎 Atividades declaradas'}
                    </button>
                    <button
                        onClick={handleEmitirDasRegular}
                        disabled={emitindoDas}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        title="Emitir DAS Regular do mes em apuracao"
                    >
                        {emitindoDas ? '⏳ Emitindo...' : '📤 Emitir DAS'}
                    </button>
                    <button
                        onClick={() => setIsEmitirNfseOpen(true)}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700"
                        title="Emitir NFS-e Nacional (CGSN 189/2026)"
                    >
                        📑 Emitir NFSe
                    </button>
                    <button
                        onClick={() => setIsPrevisaoOpen(true)}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 font-bold rounded-lg hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                        title="Previsão DAS dos próximos 3 meses (estatística + IA)"
                    >
                        📈 Prever DAS
                    </button>
                    <button
                        onClick={() => setIsConferirPgdasOpen(true)}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-cyan-100 text-cyan-700 font-bold rounded-lg hover:bg-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:hover:bg-cyan-900/50"
                        title="Conferir PGDAS-D vs nossa apuração (IA detecta divergências)"
                    >
                        🔍 Conferir PGDAS
                    </button>
                    <label className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 cursor-pointer">
                        <DownloadIcon className="w-5 h-5" />
                        Importar NFe/PGDAS
                        <input type="file" accept=".xml,.pdf,.xls,.xlsx" className="hidden" onChange={handleFileUpload} />
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Right Column (Main): Inputs & Calculation */}
                <div className="lg:col-span-2 space-y-6 order-1 lg:order-2">
                    
                    {currentUser?.role === 'admin' && (
                        <NfseSpAdminPanel
                            empresaId={empresa.id}
                            colecao="simples_empresas"
                            ccmSpAtual={empresa.dadosFiscais?.ccmSp || empresa.ccmSp}
                            nfseSpAutorizadoEmAtual={empresa.nfseSpAutorizadoEm}
                            onSalvarConfig={async ({ ccmSp, nfseSpAutorizadoEm }) => {
                                // Grava no cadastro UNICO (dadosFiscais.ccmSp). Passa o
                                // dadosFiscais completo (spread do existente) pra nao
                                // apagar uf/IE/codMunIBGE no merge nem no cache local.
                                await onUpdateEmpresa(empresa.id, {
                                    dadosFiscais: { ...empresa.dadosFiscais, ccmSp },
                                    nfseSpAutorizadoEm,
                                });
                            }}
                            onShowToast={onShowToast}
                        />
                    )}
                    
                    {/* Month Selection & Summary */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-6">
                            <div className="w-full sm:w-auto">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Competência (Mês/Ano)</label>
                                <input 
                                    type="month" 
                                    value={mesApuracao.toISOString().substring(0, 7)} 
                                    onChange={(e) => { 
                                        if(e.target.value) { 
                                            const [y, m] = e.target.value.split('-'); 
                                            setMesApuracao(new Date(parseInt(y), parseInt(m)-1, 1)); 
                                        } 
                                    }} 
                                    className="w-full p-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 font-bold dark:text-white" 
                                />
                            </div>
                            
                            <div className="flex gap-4">
                                <div className="text-center">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase">Apuração do Mês</p>
                                    <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                        R$ {(Object.values(faturamentoPorCnae).reduce((acc: number, curr) => {
                                            const state = curr as CnaeInputState;
                                            return acc + parseFloat(state.valor.replace(/\./g,'').replace(',','.') || '0');
                                        }, 0) + (filialComercio || 0) + (filialIndustria || 0) + (filialServico || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="text-center px-4 py-1 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-100 dark:border-sky-800">
                                    <p className="text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase">DAS Estimado</p>
                                    <p className="text-xl font-mono font-bold text-sky-700 dark:text-sky-300">
                                        R$ {resumo.das_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase mb-4 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-2">
                            <CalculatorIcon className="w-4 h-4 text-sky-600" /> Discriminativo de Receitas por CNAE (Matriz)
                        </h3>

                        <div className="space-y-4">
                            {Object.entries(faturamentoPorCnae).map(([key, value]) => {
                                const state = value as CnaeInputState;
                                const parts = key.split('::');
                                const type = parts.length >= 2 ? parts[0] : 'activity';
                                const cnaeCode = parts.length >= 3 ? parts[2] : 'UNKNOWN';
                                const anexoCode = parts.length >= 4 ? parts[3] : empresa.anexo;
                                const isExtra = type === 'extra';
                                const label = isExtra ? 'Receita Adicional' : (type === 'principal' ? 'Atividade Principal' : 'Atividade Secundária');

                                return (
                                    <div key={key} className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20 hover:border-sky-300 transition-colors relative group">
                                        
                                        {/* Botão de Remover para Itens Extras */}
                                        {isExtra && (
                                            <button 
                                                onClick={() => handleRemoveRevenueItem(key)}
                                                className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 bg-white dark:bg-slate-800 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Remover este item"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        )}

                                        <div className="flex flex-col md:flex-row justify-between gap-4 mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-white dark:bg-slate-800 rounded text-sky-600 dark:text-sky-400 border border-slate-100 dark:border-slate-600">
                                                    <DocumentTextIcon className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">{cnaeCode}</span>
                                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${isExtra ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}>
                                                            {label}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">Anexo {anexoCode}</p>
                                                </div>
                                            </div>
                                            <div className="w-full md:w-48">
                                                <CurrencyInput 
                                                    value={parseFloat(state.valor.replace(/\./g,'').replace(',','.') || '0')} 
                                                    onChange={(val) => handleFaturamentoChange(key, (val * 100).toFixed(0))}
                                                    className="w-full"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                                            <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isExterior ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                <input type="checkbox" checked={state.isExterior} onChange={() => handleOptionToggle(key, 'isExterior')} className="hidden" />
                                                <GlobeIcon className="w-3 h-3" /> Serviço no Exterior
                                            </label>
                                            
                                            {['III', 'IV', 'V', 'III_V'].includes(anexoCode) && (
                                                <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.issRetido ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                    <input type="checkbox" checked={state.issRetido} onChange={() => handleIssExclusivo(key, 'issRetido')} className="hidden" />
                                                    ISS Retido
                                                </label>
                                            )}

                                            {/* ISS fixo em guia do município (escritório contábil — LC 123
                                                art. 18 §22-A). Sem esta marcação a equipe só tinha "ISS
                                                Retido" pra tirar o ISS do DAS, e a declaração saía com a
                                                natureza errada (caso S&P, 03/08/2026). */}
                                            {['III', 'IV', 'V', 'III_V'].includes(anexoCode) && (
                                                <label
                                                    title="Escritórios de serviços contábeis autorizados pela legislação municipal a pagar o ISS em valor fixo em guia do Município (LC 123, art. 18, §22-A). Usa o Anexo III sem o percentual do ISS."
                                                    className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isSup ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}
                                                >
                                                    <input type="checkbox" checked={state.isSup} onChange={() => handleIssExclusivo(key, 'isSup')} className="hidden" />
                                                    ISS fixo (SUP)
                                                </label>
                                            )}

                                            {['I', 'II'].includes(anexoCode) && (
                                                <>
                                                    <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.icmsSt ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                        <input type="checkbox" checked={state.icmsSt} onChange={() => handleOptionToggle(key, 'icmsSt')} className="hidden" />
                                                        ICMS ST
                                                    </label>
                                                    <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isMonofasico ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                        <input type="checkbox" checked={state.isMonofasico} onChange={() => handleOptionToggle(key, 'isMonofasico')} className="hidden" />
                                                        <TagIcon className="w-3 h-3" /> PIS/COFINS Monofásico
                                                    </label>
                                                </>
                                            )}
                                            
                                            <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isImune ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                <input type="checkbox" checked={state.isImune} onChange={() => handleOptionToggle(key, 'isImune')} className="hidden" />
                                                Imunidade
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}

                            <div className="relative">
                                <button
                                    onClick={() => setShowCnaeSelector(prev => !prev)}
                                    className="w-full py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-slate-500 dark:text-slate-400 hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors flex items-center justify-center gap-2 font-bold text-sm"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    Adicionar Receita / Segregar (ST/Normal)
                                </button>
                                {showCnaeSelector && (
                                    <div className="absolute bottom-full mb-2 left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl z-10 overflow-hidden">
                                        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Selecione o CNAE desta receita</p>
                                        </div>
                                        {cnaesDisponiveis.map((item) => {
                                            const isServico = ['III','IV','V'].includes(item.anexo);
                                            const tipos = isServico ? ['Normal','ISS Retido'] : ['Normal','ST','Monofasico'];
                                            return (
                                                <div key={item.cnae + item.label} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                                                    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{item.cnae}</span>
                                                        <span className="ml-2 text-xs text-slate-500">Anexo {item.anexo}</span>
                                                        <span className="ml-1 text-xs text-slate-400"> — {item.label}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 px-4 py-2">
                                                        {tipos.map(tipo => (
                                                            <button key={tipo} onClick={() => handleAddRevenueItem(item.cnae, item.anexo, tipo)}
                                                                className="px-3 py-1 rounded-full text-xs font-bold border border-sky-400 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                                                                + {tipo}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 mt-6 border-t border-slate-100 dark:border-slate-700">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase mb-1 flex items-center gap-2">
                                    <BuildingIcon className="w-4 h-4 text-sky-600" /> Faturamento por Estabelecimento (Filiais)
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                    Cada filial é declarada no PGDAS-D com o <b>próprio CNPJ</b> e suas próprias atividades — igual ao e-CAC.
                                </p>

                                {(empresa.filiais || []).length > 0 ? (
                                    <div className="space-y-4">
                                        {(empresa.filiais || []).map((filial) => {
                                            const cnpj = String(filial.cnpj || '').replace(/\D/g, '');
                                            const receita = filiaisReceita[cnpj] || { comercio: 0, industria: 0, servico: 0 };
                                            return (
                                                <div key={cnpj} className="bg-slate-50 dark:bg-slate-700/40 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div>
                                                            <p className="font-mono font-bold text-sm text-slate-800 dark:text-slate-200">{formatCnpj(cnpj)}</p>
                                                            {filial.apelido && <p className="text-xs text-slate-500 dark:text-slate-400">{filial.apelido}</p>}
                                                        </div>
                                                        <button
                                                            onClick={() => handleRemoveFilial(cnpj)}
                                                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                                                            title="Remover filial"
                                                        >
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                        <CurrencyInput
                                                            label="Comércio (Anexo I)"
                                                            value={receita.comercio}
                                                            onChange={(v) => setFilialReceitaCampo(cnpj, 'comercio', v)}
                                                        />
                                                        <CurrencyInput
                                                            label="Indústria (Anexo II)"
                                                            value={receita.industria}
                                                            onChange={(v) => setFilialReceitaCampo(cnpj, 'industria', v)}
                                                        />
                                                        <CurrencyInput
                                                            label="Serviço"
                                                            value={receita.servico}
                                                            onChange={(v) => setFilialReceitaCampo(cnpj, 'servico', v)}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 italic mb-3">
                                        Nenhuma filial cadastrada. Cadastre o CNPJ do estabelecimento para declará-lo separadamente.
                                    </p>
                                )}

                                <div className="mt-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                                    <div className="flex-1">
                                        <label className="block text-xs font-bold text-slate-500 mb-1">CNPJ da filial</label>
                                        <input
                                            type="text"
                                            value={novaFilialCnpj}
                                            onChange={(e) => setNovaFilialCnpj(e.target.value)}
                                            placeholder="00.000.000/0000-00"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 dark:text-white text-sm font-mono"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-xs font-bold text-slate-500 mb-1">Apelido (opcional)</label>
                                        <input
                                            type="text"
                                            value={novaFilialApelido}
                                            onChange={(e) => setNovaFilialApelido(e.target.value)}
                                            placeholder="Ex.: Filial SP"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 dark:text-white text-sm"
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddFilial}
                                        className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                        <PlusIcon className="w-4 h-4" /> Adicionar filial
                                    </button>
                                </div>

                                {(empresa.filiais || []).length === 0 && (filialComercio > 0 || filialIndustria > 0 || filialServico > 0) && (
                                    <div className="mt-6 pt-4 border-t border-dashed border-amber-300 dark:border-amber-700">
                                        <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase mb-2">
                                            ⚠ Consolidação legada (sem CNPJ da filial)
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                            Estes valores foram lançados no modelo antigo (agregados na matriz). Cadastre a filial acima e relance a receita no CNPJ correto.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <CurrencyInput label="Filial Comércio" value={filialComercio} onChange={setFilialComercio} />
                                            <CurrencyInput label="Filial Indústria" value={filialIndustria} onChange={setFilialIndustria} />
                                            <CurrencyInput label="Filial Serviço" value={filialServico} onChange={setFilialServico} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                                <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Informações Adicionais</h3>
                                <CurrencyInput 
                                    label="ICMS sobre Vendas (Informativo)"
                                    value={icmsVendas}
                                    onChange={setIcmsVendas}
                                    placeholder="Valor destacado em nota"
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex gap-3">
                            <button 
                                onClick={handleSaveMesVigente} 
                                disabled={isSaving} 
                                className={`flex-1 py-4 font-bold text-lg rounded-xl transition-all flex justify-center items-center gap-2 shadow-lg ${
                                    saveSuccess 
                                    ? 'bg-green-500 hover:bg-green-600 text-white' 
                                    : 'bg-sky-600 hover:bg-sky-700 text-white'
                                }`}
                            >
                                {isSaving ? (
                                    <LoadingSpinner small />
                                ) : saveSuccess ? (
                                    <><AnimatedCheckIcon className="text-white" size="w-6 h-6" /><span>Salvo!</span></>
                                ) : (
                                    <><SaveIcon className="w-5 h-5" /><span>Calcular e Salvar</span></>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Alíquota Efetiva Info */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-sky-600 dark:text-sky-400">
                                <CalculatorIcon className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Alíquota Efetiva Atual</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Baseado no RBT12 e Anexo</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Alíquota Nominal</p>
                                <p className="text-2xl font-mono font-bold text-slate-800 dark:text-slate-200">{resumo.aliq_nom}%</p>
                            </div>
                            <div className="bg-sky-50 dark:bg-sky-900/20 p-4 rounded-lg border border-sky-100 dark:border-sky-800">
                                <p className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase mb-1">Alíquota Efetiva</p>
                                <p className="text-3xl font-mono font-bold text-sky-600 dark:text-sky-400">{resumo.aliq_eff.toFixed(2)}%</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Left Column (Sidebar): History & Setup */}
                <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
                    {/* RBT12 Card */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                            <HistoryIcon className="w-4 h-4 text-sky-600" /> RBT12 (Histórico 12m)
                        </h3>
                        <button onClick={() => setIsHistoryModalOpen(true)} className="text-[10px] text-sky-600 hover:underline font-bold w-full text-right mb-2">Editar Manual</button>
                        <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg mb-3">
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Receita Bruta Acumulada</p>
                            <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">R$ {totalRbt12Manual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                            
                            {/* Exibição Segregada */}
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between text-[10px] font-bold">
                                <div className="text-slate-600 dark:text-slate-400">
                                    <span className="block uppercase text-[9px] text-slate-400">Interno</span>
                                    R$ {resumo.rbt12Interno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="text-indigo-600 dark:text-indigo-400 text-right">
                                    <span className="block uppercase text-[9px] text-indigo-400">Externo</span>
                                    R$ {resumo.rbt12Externo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                            </div>
                            <p className="text-[9px] text-slate-400 mt-2 italic text-center">* Base de cálculo segregada para faixa</p>
                        </div>

                        {/* RBT12 proporcionalizada — empresa em início de atividade */}
                        {resumo.inicioAtividade && (
                            <div className="p-3 rounded-lg mb-1 border" style={{
                                background: 'var(--warning-soft)',
                                borderColor: 'var(--warning-soft-border)'
                            }}>
                                <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--warning)' }}>
                                    RBT12 Proporcionalizada (Início de Atividade)
                                </p>
                                <p className="text-[10px] mb-2" style={{ color: 'var(--warning)' }}>
                                    Empresa com {resumo.mesesAtividade ?? 0} {((resumo.mesesAtividade ?? 0) === 1) ? 'mês' : 'meses'} de atividade.
                                    Por força da Resolução CGSN 140/2018 art. 21, o RBT12 é proporcionalizado:
                                    <span className="font-mono"> RBT12 / {resumo.mesesAtividade || 1} × 12</span>.
                                </p>
                                <div className="flex justify-between text-[10px] font-bold">
                                    <div>
                                        <span className="block uppercase text-[9px]" style={{ color: 'var(--warning)' }}>Interno (p)</span>
                                        <span style={{ color: 'var(--text-primary)' }}>
                                            R$ {(resumo.rbt12pInterno ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="block uppercase text-[9px]" style={{ color: 'var(--warning)' }}>Externo (p)</span>
                                        <span style={{ color: 'var(--text-primary)' }}>
                                            R$ {(resumo.rbt12pExterno ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>
                                <p className="text-[9px] mt-2" style={{ color: 'var(--warning)' }}>
                                    Esse é o valor usado para enquadramento na faixa do Anexo (não o RBT12 acima).
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Folha Card */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                            <UserIcon className="w-4 h-4 text-sky-600" /> Folha de Salários (12m)
                        </h3>
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <CurrencyInput value={folha12Input} onChange={setFolha12Input} className="flex-1" />
                                <button onClick={() => onUpdateFolha12(empresa.id, folha12Input)} className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 p-2 rounded-lg text-slate-600 dark:text-slate-300"><SaveIcon className="w-4 h-4" /></button>
                            </div>
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">Fator R Calculado</label>
                                    <span className={`text-xs font-bold ${resumo.fator_r >= 0.28 ? 'text-green-600' : 'text-orange-600'}`}>
                                        {(resumo.fator_r * 100).toFixed(2)}%
                                    </span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${resumo.fator_r >= 0.28 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(resumo.fator_r * 100, 100)}%` }}></div>
                                </div>
                                <p className="text-[9px] text-slate-400 mt-1">Meta: 28% para Anexo III (se aplicável)</p>
                            </div>
                        </div>
                    </div>

                    {/* Notas Recentes */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">Notas Importadas</h3>
                        {notas.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {notas.slice(0, 5).map(nota => (
                                            <tr key={nota.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-2">{new Date(nota.data).toLocaleDateString()}</td>
                                                <td className="px-4 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    {nota.valor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-slate-500 dark:text-slate-400 text-sm text-center py-4">Nenhuma nota importada.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Histórico Manual */}
            {isHistoryModalOpen && (
                <HistoryRbt12Modal
                    mesApuracao={mesApuracao}
                    manualRbtHistory={manualRbtHistory}
                    setManualRbtHistory={setManualRbtHistory}
                    onSalvar={handleSaveHistory}
                    onFechar={() => setIsHistoryModalOpen(false)}
                    CurrencyInput={CurrencyInput}
                />
            )}
        
            <EmpresaDadosFiscaisModal
                isOpen={isDadosFiscaisModalOpen}
                onClose={() => setIsDadosFiscaisModalOpen(false)}
                empresaNome={empresa.nome}
                valoresAtuais={{
                    cnae: (empresa as any).cnae,
                    dataAbertura: (empresa as any).dataAbertura,
                    ...empresa.dadosFiscais,
                }}
                onSave={async (dados) => {
                    // Cadastro UNICO: ccmSp vive em dadosFiscais.ccmSp (igual aos
                    // demais campos). Backend le esse caminho (fallback top-level).
                    // CNAE/data de abertura espelham no top-level (apuração/DAS).
                    await onUpdateEmpresa(empresa.id, {
                        dadosFiscais: dados,
                        ...(dados.cnae !== undefined ? { cnae: dados.cnae } : {}),
                        ...(dados.dataAbertura !== undefined ? { dataAbertura: dados.dataAbertura } : {}),
                    } as any);
                    onShowToast('Dados fiscais salvos com sucesso!');
                }}
            />

            <CfopCorrelacaoModal
                isOpen={isCfopCorrelacaoModalOpen}
                onClose={() => setIsCfopCorrelacaoModalOpen(false)}
                empresaId={empresa.id}
                empresaNome={empresa.nome}
                empresaCnpj={empresa.cnpj}
                user={currentUser ?? null}
                valoresAtuais={empresa.dadosFiscais}
                onSave={async (dados) => {
                    await onUpdateEmpresa(empresa.id, { dadosFiscais: dados });
                    onShowToast('Correlacao de CFOP salva com sucesso!');
                }}
            />

            {isEmitirNfseOpen && (
                <EmitirNfseModal
                    empresa={empresa}
                    currentUser={currentUser ?? null}
                    onClose={() => setIsEmitirNfseOpen(false)}
                    onShowToast={onShowToast}
                />
            )}
            {isPrevisaoOpen && (
                <PrevisaoDasModal
                    empresaId={empresa.id}
                    empresaNome={empresa.nome}
                    currentUser={currentUser ?? null}
                    onClose={() => setIsPrevisaoOpen(false)}
                    onShowToast={onShowToast}
                />
            )}
            {isConferirPgdasOpen && (
                <PgdasConferirModal
                    empresaId={empresa.id}
                    empresaNome={empresa.nome}
                    currentUser={currentUser ?? null}
                    onClose={() => setIsConferirPgdasOpen(false)}
                    onShowToast={onShowToast}
                />
            )}
</div>
    );
};

export default SimplesNacionalDetalhe;
