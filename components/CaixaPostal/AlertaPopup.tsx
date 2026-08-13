/**
 * AlertaPopup — alerta consolidado de pendencias fiscais criticas.
 * Aparece uma vez por dia (deduplicado via localStorage).
 * Combina Caixa Postal/portais e vencimentos de obrigacoes, impostos e entregas.
 */
import React, { useEffect, useState } from 'react';
import type { User, CaixaPostalResumo, CaixaPostalFonte } from '../../types';
import { getResumo, fonteLabel, fonteDotColor } from '../../services/caixaPostalService';
import {
    fetchResumoVencimentos,
    type VencimentosResponse,
    type ProximaObrigacao,
} from '../../services/vencimentosService';
import { notifyCaixaPostalCritica } from '../../services/notificacoesService';

const STORAGE_KEY = 'monitorFiscal:lastAlertDate:v2';

interface Props {
    currentUser: User | null;
    onIrParaCaixaPostal: () => void;
    onIrParaObrigacoes: () => void;
}

const isTributo = (obrigacao?: string) => /\b(DAS|DARF|IRPJ|CSLL|PIS|COFINS|ISS|ICMS|IPI|INSS|FGTS)\b/i.test(obrigacao || '');
const isEntrega = (obrigacao?: string) => /\b(DCTF|DCTFWEB|MIT|EFD|REINF|ESOCIAL|SPED|GIA|DEFIS|ECD|ECF|DIRF|DECLARA|ENTREGA)\b/i.test(obrigacao || '');

const countMensagensCriticas = (caixa?: CaixaPostalResumo | null): number => {
    const c = caixa?.naoLidasPorCategoria || {};
    return (c.intimacao || 0)
        + (c.malha || 0)
        + (c.exclusao || 0)
        + (c.det_notificacao || 0)
        + (c.det_auto_infracao || 0)
        + (c.dec_intimacao || 0)
        + (c.dje_citacao || 0)
        + (c.dje_intimacao || 0)
        + (c.prefeitura_sp_iss || 0);
};

const countVencimentosCriticos = (venc?: VencimentosResponse | null): number => {
    const r = venc?.resumo;
    return r ? r.atrasadas + r.venceHoje + r.venceAmanha + r.vence3d + r.vence7d : 0;
};

const AlertaPopup: React.FC<Props> = ({ currentUser, onIrParaCaixaPostal, onIrParaObrigacoes }) => {
    const [resumo, setResumo] = useState<CaixaPostalResumo | null>(null);
    const [vencimentos, setVencimentos] = useState<VencimentosResponse | null>(null);
    const [dispensado, setDispensado] = useState(false);

    useEffect(() => {
        // Liberado a qualquer usuario autenticado (colaboradores cobrem
        // empresas uns dos outros). Filtro por carteira vira depois.
        if (!currentUser) return;

        const hoje = new Date().toISOString().slice(0, 10);
        try {
            const lastDate = localStorage.getItem(STORAGE_KEY);
            if (lastDate === hoje) {
                setDispensado(true);
                return;
            }
        } catch { /* ignore */ }

        Promise.allSettled([
            getResumo(currentUser),
            fetchResumoVencimentos(),
        ])
            .then(([caixaResult, vencResult]) => {
                const caixa = caixaResult.status === 'fulfilled' ? caixaResult.value : null;
                const venc = vencResult.status === 'fulfilled' ? vencResult.value : null;

                const mensagensCriticas = countMensagensCriticas(caixa);
                const vencimentosCriticos = countVencimentosCriticos(venc);
                const empresasComMensagens = caixa?.empresasComCriticas || 0;

                if (empresasComMensagens > 0) setResumo(caixa);
                if (vencimentosCriticos > 0) setVencimentos(venc);

                if (empresasComMensagens > 0 || vencimentosCriticos > 0) {
                    notifyCaixaPostalCritica(mensagensCriticas + vencimentosCriticos);
                }
            })
            .catch(() => { /* silencioso, modulo opcional */ });
    }, [currentUser]);

    const handleDispensar = () => {
        try {
            localStorage.setItem(STORAGE_KEY, new Date().toISOString().slice(0, 10));
        } catch { /* ignore */ }
        setDispensado(true);
    };

    const handleIr = () => {
        handleDispensar();
        if (totalVencimentosCriticos > 0) onIrParaObrigacoes();
        else onIrParaCaixaPostal();
    };

    const resumoVenc = vencimentos?.resumo;
    const totalVencimentosCriticos = countVencimentosCriticos(vencimentos);
    const temMensagens = !!resumo && resumo.empresasComCriticas > 0;
    const temVencimentos = totalVencimentosCriticos > 0;

    if (dispensado || (!temMensagens && !temVencimentos)) return null;

    const categorias = resumo?.naoLidasPorCategoria || {};
    const intimacoes = categorias.intimacao || 0;
    const malha = categorias.malha || 0;
    const exclusoes = categorias.exclusao || 0;
    const detNotif = (categorias.det_notificacao || 0) + (categorias.det_auto_infracao || 0);
    const decIntim = categorias.dec_intimacao || 0;
    const djeCit = (categorias.dje_citacao || 0) + (categorias.dje_intimacao || 0);
    const issPrefeitura = categorias.prefeitura_sp_iss || 0;
    const mensagensCriticas = countMensagensCriticas(resumo);

    const proximasCriticas: ProximaObrigacao[] = (vencimentos?.proximas || [])
        .filter(o => o.diasAteVencimento <= 7);
    const tributos = proximasCriticas.filter(o => isTributo(o.obrigacao)).length;
    const entregas = proximasCriticas.filter(o => isEntrega(o.obrigacao)).length;
    const outrasObrigacoes = Math.max(0, proximasCriticas.length - tributos - entregas);

    // Per-fonte breakdown
    const fontes: CaixaPostalFonte[] = ['ecac', 'det', 'dec', 'dje', 'emac', 'prefeitura_sp'];
    const naoLidasPorFonte: Partial<Record<CaixaPostalFonte, number>> = resumo?.naoLidasPorFonte || {};

    return (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] animate-fade-in overflow-y-auto">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 my-auto">
                <div className="flex items-start gap-4 mb-4">
                    <div className="text-4xl">&#9888;&#65039;</div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                            Monitor fiscal com pendencias criticas
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            Varredura encontrou mensagens, obrigacoes, impostos ou entregas mensais que exigem acompanhamento.
                        </p>
                    </div>
                </div>

                {/* Visao consolidada */}
                <div className="space-y-1 text-sm bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 mb-3">
                    {temMensagens && (
                        <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2 mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-200">Mensagens fiscais nao lidas</span>
                            <span className="font-bold">{mensagensCriticas}</span>
                        </div>
                    )}
                    {temVencimentos && (
                        <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2 mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-200">Obrigacoes, impostos e entregas</span>
                            <span className="font-bold">{totalVencimentosCriticos}</span>
                        </div>
                    )}
                    {resumoVenc && resumoVenc.atrasadas > 0 && (
                        <div className="flex justify-between">
                            <span className="text-red-700 dark:text-red-400">Atrasadas</span>
                            <span className="font-bold">{resumoVenc.atrasadas}</span>
                        </div>
                    )}
                    {resumoVenc && resumoVenc.venceHoje > 0 && (
                        <div className="flex justify-between">
                            <span className="text-red-700 dark:text-red-400">Vencem hoje</span>
                            <span className="font-bold">{resumoVenc.venceHoje}</span>
                        </div>
                    )}
                    {resumoVenc && (resumoVenc.venceAmanha + resumoVenc.vence3d + resumoVenc.vence7d) > 0 && (
                        <div className="flex justify-between">
                            <span className="text-orange-700 dark:text-orange-400">Vencem em ate 7 dias</span>
                            <span className="font-bold">{resumoVenc.venceAmanha + resumoVenc.vence3d + resumoVenc.vence7d}</span>
                        </div>
                    )}
                    {tributos > 0 && (
                        <div className="flex justify-between">
                            <span className="text-emerald-700 dark:text-emerald-400">Tributos/guias</span>
                            <span className="font-bold">{tributos}</span>
                        </div>
                    )}
                    {entregas > 0 && (
                        <div className="flex justify-between">
                            <span className="text-sky-700 dark:text-sky-400">Declaracoes/entregas</span>
                            <span className="font-bold">{entregas}</span>
                        </div>
                    )}
                    {outrasObrigacoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-slate-700 dark:text-slate-300">Demais obrigacoes</span>
                            <span className="font-bold">{outrasObrigacoes}</span>
                        </div>
                    )}
                    {intimacoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-red-700 dark:text-red-400">Intimacoes (Receita)</span>
                            <span className="font-bold">{intimacoes}</span>
                        </div>
                    )}
                    {malha > 0 && (
                        <div className="flex justify-between">
                            <span className="text-amber-700 dark:text-amber-400">Malha Fiscal</span>
                            <span className="font-bold">{malha}</span>
                        </div>
                    )}
                    {exclusoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">Exclusao do Simples</span>
                            <span className="font-bold">{exclusoes}</span>
                        </div>
                    )}
                    {detNotif > 0 && (
                        <div className="flex justify-between">
                            <span className="text-orange-700 dark:text-orange-400">Notificacoes Trabalhistas (DET)</span>
                            <span className="font-bold">{detNotif}</span>
                        </div>
                    )}
                    {decIntim > 0 && (
                        <div className="flex justify-between">
                            <span className="text-emerald-700 dark:text-emerald-400">Intimacoes Estaduais (DEC)</span>
                            <span className="font-bold">{decIntim}</span>
                        </div>
                    )}
                    {djeCit > 0 && (
                        <div className="flex justify-between">
                            <span className="text-violet-700 dark:text-violet-400">Citacoes/Intimacoes Judiciais (DJE)</span>
                            <span className="font-bold">{djeCit}</span>
                        </div>
                    )}
                    {issPrefeitura > 0 && (
                        <div className="flex justify-between">
                            <span className="text-sky-800 dark:text-sky-300">ISS / Prefeitura SP</span>
                            <span className="font-bold">{issPrefeitura}</span>
                        </div>
                    )}
                </div>

                {/* Breakdown por canal */}
                {resumo?.naoLidasPorFonte && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {fontes.map(f => {
                            const count = naoLidasPorFonte[f] || 0;
                            if (count === 0) return null;
                            return (
                                <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                    <span className={`inline-block w-2 h-2 rounded-full ${fonteDotColor(f)}`}></span>
                                    {fonteLabel(f)}: {count}
                                </span>
                            );
                        })}
                    </div>
                )}

                {resumo?.mode === 'mock' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                        Modo teste -- dados sinteticos para desenvolvimento. Ative producao via env CAIXA_POSTAL_MODE=serpro quando o Integra Contador estiver contratado.
                    </p>
                )}

                <div className="flex gap-2 justify-end">
                    <button
                        onClick={handleDispensar}
                        className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Ver depois
                    </button>
                    {temMensagens && temVencimentos && (
                        <button
                            onClick={() => {
                                handleDispensar();
                                onIrParaCaixaPostal();
                            }}
                            className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            Caixa Postal
                        </button>
                    )}
                    <button
                        onClick={handleIr}
                        className="btn-press px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                    >
                        {temVencimentos ? 'Ver obrigacoes' : 'Ver mensagens'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertaPopup;
