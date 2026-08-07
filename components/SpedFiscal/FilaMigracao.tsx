/**
 * FilaMigracao — QUEM PODE MIGRAR HOJE.
 *
 * Paulo, 07/08: "precisamos acelerar". A resposta já existia espalhada em três
 * telas — 🔎 Prova de captura (entrada completa contra a SEFAZ), ✅ Aptidão da
 * saída (o cliente ligou o autXML/cofre) e 🚦 Migração (de quais blocos ele
 * precisa). Ninguém abre três abas vezes 388 clientes, então na prática
 * ninguém responde.
 *
 * Aqui é UMA fila, ordenada por ESFORÇO: quem está a um passo de migrar vem
 * antes de quem está a três. O colaborador não escolhe por onde começar — ele
 * pega o de cima. Mesmo desenho da Rotina do mês.
 *
 * Regra que a tela precisa honrar: ausência de sinal NUNCA aparece como
 * prontidão. Cliente sem prova não é "pronto", é "não sabemos" — e o backend
 * já devolve isso como bloqueio, não como silêncio verde.
 */
import React, { useState } from 'react';
import { auth } from '../../services/firebaseConfig';

interface Bloqueio { area: string; motivo: string; acao: string; codigo?: string | null }
interface Linha {
    empresaId: string; nome: string; cnpj: string; regime: string | null;
    onda: 'servico-puro' | 'efd-icms';
    pronta: boolean; esforco: number;
    bloqueios: Bloqueio[]; ressalvas: string[];
    proximoPasso: { area: string; motivo: string; acao: string; onde: string } | null;
}
interface Resp {
    ok: boolean; error?: string; competencia?: string;
    linhas?: Linha[];
    resumo?: {
        total: number; prontas: number; bloqueadas: number;
        porArea: Record<string, number>;
        gargalo: { area: string; qtd: number; onde: string } | null;
        servicoPuro: number; servicoPuroPronto: number; resumo: string;
    };
    ressalvas?: string[];
    lidos?: { documentosCompetencia: number; saidas: number; empresas: number };
}

const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const competenciaAnterior = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const AREA_ROTULO: Record<string, string> = {
    'captura-entrada': '📥 Captura de entrada',
    'captura-saida': '📤 Captura de saída',
    blocos: '🧱 Blocos do SPED',
};

const LIMITE_TELA = 80;

const FilaMigracao: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [competencia, setCompetencia] = useState(competenciaAnterior());
    const [dados, setDados] = useState<Resp | null>(null);
    const [loading, setLoading] = useState(false);
    const [filtroArea, setFiltroArea] = useState<string | null>(null);
    const [soProntas, setSoProntas] = useState(false);

    const buscar = async () => {
        setLoading(true);
        try {
            const token = await auth?.currentUser?.getIdToken();
            const r = await fetch(`/api/admin/sped/fila-migracao?competencia=${competencia}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j: Resp = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDados(j);
        } catch (e: any) {
            onShowToast?.(`Falha ao montar a fila: ${e.message}`);
            setDados(null);
        } finally {
            setLoading(false);
        }
    };

    const todas = dados?.linhas || [];
    const visiveis = todas.filter((l) => {
        if (soProntas && !l.pronta) return false;
        if (filtroArea && l.proximoPasso?.area !== filtroArea) return false;
        return true;
    });

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    🏁 Fila de migração — quem pode migrar hoje
                </h3>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    Junta as três provas numa resposta só: <strong>entrada completa</strong> contra a SEFAZ
                    (cursor do DistDFe), <strong>saída ligada</strong> pelo cliente (autXML/cofre) e os
                    <strong> blocos do SPED</strong> que o perfil dele exige. A ordem é por esforço — comece
                    pelo de cima. Cliente sem prova não aparece como pronto: aparece como “não sabemos”.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Competência</label>
                        <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
                    </div>
                    <button onClick={buscar} disabled={loading}
                        className="px-4 py-2 text-sm font-bold rounded-lg disabled:opacity-40"
                        style={{ background: 'var(--accent-primary)', color: '#fff' }}>
                        {loading ? 'Montando…' : '🏁 Montar a fila'}
                    </button>
                </div>
            </div>

            {dados?.resumo && (() => { const resumo = dados.resumo!; return (
                <div className="p-5 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{resumo.resumo}</p>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                        <button onClick={() => { setSoProntas(!soProntas); setFiltroArea(null); }}
                            className={`rounded-lg border p-2 text-left ${soProntas ? 'ring-2 ring-emerald-400' : ''}`}
                            style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Prontas p/ migrar</p>
                            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{resumo.prontas}</p>
                        </button>
                        {['captura-entrada', 'captura-saida', 'blocos'].map((a) => (
                            <button key={a} onClick={() => { setFiltroArea(filtroArea === a ? null : a); setSoProntas(false); }}
                                className={`rounded-lg border p-2 text-left ${filtroArea === a ? 'ring-2 ring-blue-400' : ''}`}
                                style={{ borderColor: 'var(--border-subtle)' }}>
                                <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>{AREA_ROTULO[a]}</p>
                                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{resumo.porArea?.[a] ?? 0}</p>
                            </button>
                        ))}
                        {/* Onda 1: serviço puro não depende de bloco nenhum do
                            SPED. Sem separar, a fila PARECE travada quando
                            metade dela já podia ter migrado. */}
                        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Onda 1 (serviço puro)</p>
                            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                {resumo.servicoPuroPronto}/{resumo.servicoPuro}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>prontas · sem bloco de ICMS</p>
                        </div>
                    </div>

                    {resumo.gargalo && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            ⚠ O gargalo da carteira é <strong>{AREA_ROTULO[resumo.gargalo.area]}</strong>
                            {' '}({resumo.gargalo.qtd} empresa(s)) — resolve-se em {resumo.gargalo.onde}.
                        </p>
                    )}
                    {(dados.ressalvas || []).map((r, i) => (
                        <p key={i} className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {r}</p>
                    ))}
                </div>
            ); })()}

            {dados?.linhas && (
                <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                                    <th className="py-1">Empresa</th>
                                    <th>Onda</th>
                                    <th>Situação</th>
                                    <th>Próximo passo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visiveis.slice(0, LIMITE_TELA).map((l) => (
                                    <tr key={l.empresaId} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <td className="py-1.5 pr-2">
                                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{l.nome}</span>
                                            <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                                {fmtCnpj(l.cnpj)} · {l.regime === 'simples' ? 'Simples' : 'Lucro'}
                                            </span>
                                            {l.ressalvas.map((r, i) => (
                                                <span key={i} className="block text-[10px] text-amber-600 dark:text-amber-400">· {r}</span>
                                            ))}
                                        </td>
                                        <td className="pr-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            {l.onda === 'servico-puro' ? 'serviço puro' : 'EFD ICMS'}
                                        </td>
                                        <td className="pr-2 whitespace-nowrap">
                                            {l.pronta ? (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                                                    ✓ pronta
                                                </span>
                                            ) : (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                                    {l.esforco} bloqueio(s)
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {l.proximoPasso ? (
                                                <>
                                                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {AREA_ROTULO[l.proximoPasso.area]}
                                                    </span>
                                                    <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                                        {l.proximoPasso.motivo}
                                                    </span>
                                                    <span className="block text-[10px] text-blue-600 dark:text-blue-400">
                                                        → {l.proximoPasso.acao} ({l.proximoPasso.onde})
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                                    Entrada completa, saída ligada e nenhum bloco pendente — pode migrar.
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Lista cortada SEMPRE diz quanto ficou de fora. */}
                    {visiveis.length > LIMITE_TELA && (
                        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            Mostrando {LIMITE_TELA} de {visiveis.length} empresa(s) neste filtro.
                        </p>
                    )}
                    {visiveis.length === 0 && (
                        <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                            Nenhuma empresa neste filtro.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default FilaMigracao;
