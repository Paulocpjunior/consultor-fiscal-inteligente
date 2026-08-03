/**
 * ProntidaoMigracao — F0 automático da migração E-Fiscal → CFI (03/08).
 * As notas capturadas dizem quem tem ST, IPI/indústria e compra
 * interestadual; o painel aponta os CANDIDATOS A PILOTO do SPED e lista o
 * que só a equipe pode responder (SAT, regime de caixa, CIAP, DeSTDA).
 */
import React, { useState } from 'react';
import { auth } from '../../services/firebaseConfig';

interface Linha {
    empresaId: string; nome: string; cnpj: string; regime: string | null;
    docs: number; emiteProprio: number; stSaidas: number; stEntradas: number;
    ipiSaidas: number; entradasInterestaduais: number;
    bloqueios: string[]; atencoes: string[]; candidataPiloto: boolean;
}
interface Resp {
    ok: boolean; error?: string; competencia?: string; lidos?: number;
    linhas?: Linha[]; perguntasEquipe?: string[];
    resumo?: { comMovimento: number; candidatasPiloto: number; comStSaida: number; comIpiOuIndustria: number; comInterestadual: number };
}

const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const competenciaAnterior = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const LIMITE_TELA = 60;

const ProntidaoMigracao: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [competencia, setCompetencia] = useState(competenciaAnterior());
    const [dados, setDados] = useState<Resp | null>(null);
    const [loading, setLoading] = useState(false);

    const buscar = async () => {
        setLoading(true);
        try {
            const token = await auth?.currentUser?.getIdToken();
            const r = await fetch(`/api/admin/sped/prontidao-migracao?competencia=${competencia}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j: Resp = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDados(j);
        } catch (e: any) {
            onShowToast?.(`Falha na varredura: ${e.message}`);
            setDados(null);
        } finally {
            setLoading(false);
        }
    };

    const linhas = dados?.linhas || [];

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    🚦 Prontidão de migração (E-Fiscal → CFI)
                </h3>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    As notas capturadas da competência dizem quem tem ST em saída, IPI/indústria e compra
                    interestadual. <strong>Candidata a piloto</strong> = Lucro, com movimento e sem nenhum
                    bloqueio detectado. Mês atípico esconde sinal — na dúvida, rode mais de uma competência.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Competência</label>
                        <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <button onClick={buscar} disabled={loading}
                        className="px-5 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40"
                        style={{ background: 'var(--accent)' }}>
                        {loading ? 'Varrendo…' : '🔎 Varrer'}
                    </button>
                    {dados?.resumo && (
                        <span className="text-xs pb-1" style={{ color: 'var(--text-secondary)' }}>
                            {dados.resumo.comMovimento} empresa(s) com movimento · <strong style={{ color: 'var(--accent)' }}>
                            {dados.resumo.candidatasPiloto} candidata(s) a piloto</strong> · {dados.resumo.comStSaida} com ST em saída ·{' '}
                            {dados.resumo.comIpiOuIndustria} indústria/IPI · {dados.resumo.comInterestadual} c/ compra interestadual
                        </span>
                    )}
                </div>
            </div>

            {dados && linhas.length > 0 && (
                <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    {linhas.length > LIMITE_TELA && (
                        <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                            mostrando {LIMITE_TELA} de {linhas.length}
                        </p>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead style={{ color: 'var(--text-muted)' }}>
                                <tr className="text-left border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                                    <th className="py-1">Empresa</th><th>Regime</th>
                                    <th className="text-right">Docs</th><th className="text-right">Emissão própria</th>
                                    <th>Sinais</th><th>Veredicto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.slice(0, LIMITE_TELA).map(l => (
                                    <tr key={l.empresaId} className="border-b align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <td className="py-1.5 pr-2">
                                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{l.nome}</span>
                                            <span className="block text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{fmtCnpj(l.cnpj)}</span>
                                        </td>
                                        <td>{l.regime === 'lucro' ? 'LP/LR' : 'SN'}</td>
                                        <td className="text-right font-mono">{l.docs}</td>
                                        <td className="text-right font-mono">{l.emiteProprio}</td>
                                        <td className="max-w-[340px]">
                                            {l.bloqueios.map((b, i) => <span key={i} className="block text-[11px]" style={{ color: 'var(--danger, #dc2626)' }}>⛔ {b}</span>)}
                                            {l.atencoes.map((a, i) => <span key={i} className="block text-[11px]" style={{ color: 'var(--warning, #b45309)' }}>⚠ {a}</span>)}
                                            {!l.bloqueios.length && !l.atencoes.length && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>}
                                        </td>
                                        <td>
                                            {l.candidataPiloto
                                                ? <span className="text-[11px] font-bold" style={{ color: 'var(--success, #059669)' }}>🟢 candidata a piloto</span>
                                                : l.regime !== 'lucro'
                                                    ? <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Simples (fora do piloto)</span>
                                                    : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>com ressalvas</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {dados?.perguntasEquipe && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--accent-soft)', borderLeft: '4px solid var(--accent)' }}>
                    <p className="text-xs font-bold mb-1" style={{ color: 'var(--accent)' }}>
                        Respostas da equipe (03/08) — o que os dados não viam:
                    </p>
                    <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                        {dados.perguntasEquipe.map((p, i) => <li key={i}>• {p}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default ProntidaoMigracao;
