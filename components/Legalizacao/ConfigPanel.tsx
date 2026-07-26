/**
 * ConfigPanel (Legalização) — status da integração Jotform/Graph e disparo
 * manual do cron (admin). Não expõe valores de secrets, só presença/ausência
 * (mesmo pacto do Diagnóstico de Configurações Operacionais).
 */
import React, { useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import type { User } from '../../types';
import {
    getStatusLegalizacao, getResumoLegalizacao, dispararCronAgora,
    type StatusLegalizacao, type ResumoLegalizacao,
} from '../../services/legalizacaoService';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const ConfigPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [status, setStatus] = useState<StatusLegalizacao | null>(null);
    const [resumo, setResumo] = useState<ResumoLegalizacao | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [disparando, setDisparando] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [s, r] = await Promise.all([getStatusLegalizacao(), getResumoLegalizacao()]);
                setStatus(s);
                setResumo(r);
            } catch (e) {
                setErro(`Não foi possível carregar o status (${e instanceof Error ? e.message : e}).`);
            }
        })();
    }, []);

    if (currentUser.role !== 'admin') {
        return <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Somente administradores.</div>;
    }
    if (erro) return <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--bg-card)', color: 'var(--danger)' }}>{erro}</div>;
    if (!status) return <LoadingSpinner />;

    const disparar = async (force: boolean) => {
        setDisparando(true);
        try {
            const r = await dispararCronAgora(force);
            onShowToast?.(r.ok ? `Cron disparado em background${force ? ' (force: re-alerta faixas já enviadas)' : ''}.` : `Falha: ${r.motivo}`);
        } finally {
            setDisparando(false);
        }
    };

    const Farol = ({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) => (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: ok ? 'var(--accent-soft)' : 'var(--warning-soft)', color: 'var(--text-primary)' }}>
            {ok ? `🟢 ${okLabel}` : `🔴 ${badLabel}`}
        </span>
    );

    return (
        <div className="space-y-4">
            <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <h3 className="text-sm font-bold m-0" style={{ color: 'var(--text-primary)' }}>🔗 Integração Jotform</h3>
                <div className="flex flex-wrap gap-2 items-center text-xs" style={{ color: 'var(--text-primary)' }}>
                    <Farol ok={status.jotformConfigured} okLabel="JOTFORM_API_KEY configurada" badLabel="JOTFORM_API_KEY ausente" />
                    <Farol ok={status.graphConfigured} okLabel="Graph (e-mail) configurado" badLabel="Graph (e-mail) ausente" />
                </div>
                {!status.jotformConfigured && (
                    <p className="text-xs m-0" style={{ color: 'var(--text-muted)' }}>
                        Como ativar: gere a API key em jotform.com → Settings → API, cadastre o secret
                        <code className="mx-1">JOTFORM_API_KEY</code> no Cloud Run (Secret Manager) e redeploye o serviço.
                        Sem ela o sync não roda — o painel avisa em vez de fingir verde.
                    </p>
                )}
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Formulários sincronizados: certidões/certificados <code>{status.forms.certidoesCertificados}</code> ·
                    parcelamentos <code>{status.forms.parcelamentos}</code> (override por env
                    <code className="ml-1">JOTFORM_FORM_CERTIDOES</code>/<code>JOTFORM_FORM_PARCELAMENTOS</code>).
                </div>
            </div>

            <div className="rounded-lg p-4 space-y-2 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                <h3 className="text-sm font-bold m-0" style={{ color: 'var(--text-primary)' }}>⏱️ Cron diário (legalizacao-cron-diario, 7h30 BRT seg-sex)</h3>
                {resumo?.ultimaSync && (
                    <div>Última sync: {resumo.ultimaSync.em ? new Date(resumo.ultimaSync.em).toLocaleString('pt-BR') : '—'} ·
                        {resumo.ultimaSync.ok ? ` 🟢 ${resumo.ultimaSync.gravados ?? 0} itens gravados` : ` 🔴 FALHOU: ${resumo.ultimaSync.erros.join(' · ')}`}
                    </div>
                )}
                {resumo?.ultimoCron && (
                    <div>Último cron: {resumo.ultimoCron.em ? new Date(resumo.ultimoCron.em).toLocaleString('pt-BR') : '—'} ·
                        {resumo.ultimoCron.ok ? ' 🟢 OK' : ` 🔴 ${resumo.ultimoCron.motivoDominante || 'falhou'}`} ·
                        e-mails: {resumo.ultimoCron.emailsEnviados} enviados / {resumo.ultimoCron.falhasEmail} falhas
                    </div>
                )}
                {!resumo?.ultimoCron && <div style={{ color: 'var(--text-muted)' }}>Nenhuma corrida registrada ainda. Lembre de criar o job: rodar <code>scripts/setup-cloud-schedulers.sh</code> (senão vira cron órfão).</div>}
                <div className="flex gap-2 pt-1">
                    <button onClick={() => void disparar(false)} disabled={disparando} className="px-3 py-1.5 text-xs font-bold rounded-md btn-press" style={{ background: 'var(--accent)', color: '#fff' }}>
                        {disparando ? 'Disparando…' : '▶️ Rodar sync + alertas agora'}
                    </button>
                    <button onClick={() => void disparar(true)} disabled={disparando} className="px-3 py-1.5 text-xs font-bold rounded-md btn-press" style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                        ⟳ Force (re-alerta faixas já enviadas)
                    </button>
                </div>
            </div>

            <div className="rounded-lg p-4 text-xs space-y-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
                <h3 className="text-sm font-bold m-0" style={{ color: 'var(--text-primary)' }}>📬 Regras de alerta</h3>
                <div>Faixas de antecedência: 30 · 15 · 7 · 3 · 1 · 0 dias + vencido (até 60 dias). Uma vez por faixa por item (idempotente).</div>
                <div>E-mail vai ao cliente do formulário com o gestor do departamento SEMPRE em cópia oculta.</div>
                <div>Itens sem e-mail cadastrado aparecem no painel como gap (⚠️) — corrigir no próprio Jotform.</div>
                <div>URL fixa deste app: <code>{`${window.location.origin}/?modulo=legalizacao`}</code></div>
            </div>
        </div>
    );
};

export default ConfigPanel;
