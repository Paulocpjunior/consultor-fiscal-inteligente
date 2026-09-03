/**
 * ConciliarFaturamento — concilia faturamento de SAÍDA do SPED Fiscal contra
 * o que o contador declarou (faturamentoManual do Simples; receitas do Lucro).
 *
 * Pega a empresa + competência, busca o declarado, sobe o SPED, compara:
 *   - SPED > declarado por >1% -> ERRO (DAS/DARF a menor — risco fiscal alto)
 *   - SPED > declarado por <1% -> AVISO (provável arredondamento)
 *   - declarado > SPED          -> AVISO (DAS/DARF a maior — perda, não malha)
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';
import { auth } from '../../services/firebaseConfig';
import { formatCnpjCpf } from '../../services/xmlParserService';
import { parseSped, conciliarFaturamento, type ConciliacaoFaturamento } from '../../services/spedFiscalExcelEditor';
import { parseValorMoeda } from '../../services/valorDigitado';

interface Props { currentUser: User | null; }

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function getCompetenciaAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const ConciliarFaturamento: React.FC<Props> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    // A EMPRESA É A ATIVA DA SESSÃO (Paulo, 15/08 — "tira os seletores
    // internos"): módulo por-cliente não pergunta de novo em qual cliente
    // está. O cartão fixo diz, e a troca é uma só, no topo.
    const empresaId = useEmpresaAtivaId();
    const [competencia, setCompetencia] = useState(getCompetenciaAtual());
    const [arqSped, setArqSped] = useState<File | null>(null);
    const [declaradoOverride, setDeclaradoOverride] = useState('');
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<ConciliacaoFaturamento | null>(null);
    const [origemDeclarado, setOrigemDeclarado] = useState<string | null>(null);
    const [declaradoBackend, setDeclaradoBackend] = useState<number | null>(null);

    useEffect(() => {
        if (!currentUser) return;
        getEmpresasDisponiveis(currentUser).then(list => {
            setEmpresas(list);
        }).catch((e: any) => {
            // Lista vazia sem causa se lê como "não há empresas"; a falha vai DITA.
            setErro(`Não deu para listar as empresas: ${e?.message || 'falha desconhecida'}`);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    const handleConciliar = async () => {
        if (!empresaId) { setErro('Selecione a empresa.'); return; }
        if (!arqSped) { setErro('Selecione o SPED Fiscal (.txt).'); return; }
        setLoading(true); setErro(null); setData(null); setDeclaradoBackend(null); setOrigemDeclarado(null);
        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada');

            // 1. Busca o declarado se o admin não informou override
            // Override digitado passa pelo dono; ilegível RECUSA (cai no catch
            // e vira o erro da tela) em vez de conciliar contra NaN.
            let declarado = 0;
            if (declaradoOverride.trim()) {
                const lido = parseValorMoeda(declaradoOverride);
                if (lido === null) throw new Error(`Não entendi o declarado informado "${declaradoOverride}" — use 1234,56.`);
                declarado = lido;
            }
            if (!declaradoOverride.trim()) {
                const qs = new URLSearchParams({ empresaId, competencia });
                const resp = await fetch(`/api/admin/sped-fiscal/faturamento-declarado?${qs}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${resp.status}`);
                }
                const j = await resp.json();
                declarado = j.faturamentoDeclarado;
                setDeclaradoBackend(declarado);
                setOrigemDeclarado(j.origem);
            }

            // 2. Parse SPED e concilia
            const txt = await arqSped.text();
            const parsed = await parseSped(txt);
            const r = await conciliarFaturamento(parsed, declarado);
            setData(r);
            if (!r.aplicavel) setErro(r.motivo || 'Não aplicável');
        } catch (e: any) {
            setErro(e?.message || 'Falha na conciliação');
        } finally {
            setLoading(false);
        }
    };

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };
    const sevCor: Record<string, string> = { ok: 'var(--success)', aviso: 'var(--warning)', erro: 'var(--danger)' };
    const sevLabel: Record<string, string> = {
        ok: 'OK', aviso: 'Conferir', erro: 'RISCO FISCAL',
    };

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="p-4 rounded-xl" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-soft)', borderLeft: '4px solid var(--accent)' }}>
                <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Conciliação SPED × Faturamento Declarado</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Compara a <b>soma das NF-e de saída</b> do SPED Fiscal contra o
                    <b> faturamento que o contador declarou</b> (base do DAS/DARF).
                    Divergência onde o SPED é MAIOR = DAS pago a menor = malha. Onde o
                    declarado é maior = DAS pago a mais = perda. Notas canceladas ficam fora.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl" style={card}>
                    <EmpresaAtivaFixa rotulo="Empresa" />
                </div>
                <div className="p-4 rounded-xl" style={card}>
                    <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>Competência</label>
                    <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-lg outline-none"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                </div>
            </div>

            <div className="p-4 rounded-xl" style={card}>
                <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>
                    Faturamento declarado (opcional — deixa vazio pra puxar do cadastro)
                </label>
                <input type="text" value={declaradoOverride}
                    onChange={e => setDeclaradoOverride(e.target.value)}
                    placeholder="ex.: 15000,00 — se vazio, usa o faturamentoManual da empresa"
                    className="w-full p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>

            <label className="flex flex-col items-center justify-center gap-1 p-5 rounded-xl cursor-pointer border-2 border-dashed"
                style={{ borderColor: arqSped ? 'var(--accent)' : 'var(--border-default)', background: 'var(--bg-card)' }}>
                <span className="text-2xl">{arqSped ? '✅' : '📄'}</span>
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>SPED Fiscal (EFD ICMS/IPI)</span>
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{arqSped?.name || 'clique para selecionar o .txt'}</span>
                <input type="file" accept=".txt" className="hidden" onChange={e => { setArqSped(e.target.files?.[0] || null); setData(null); }} />
            </label>

            <div className="flex justify-center">
                <button onClick={handleConciliar} disabled={loading || !empresaId || !arqSped}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}>
                    {loading
                        ? <span className="flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Conciliando…</span>
                        : 'Conciliar'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            {data?.aplicavel && (
                <>
                    <div className="p-5 rounded-xl text-center" style={{ background: sevCor[data.severidade] + '15', border: `2px solid ${sevCor[data.severidade]}` }}>
                        <p className="text-xs font-bold uppercase" style={{ color: sevCor[data.severidade] }}>{sevLabel[data.severidade]}</p>
                        <p className="text-3xl font-bold font-mono mt-1" style={{ color: 'var(--text-primary)' }}>
                            {data.diferenca === 0 ? '— sem divergência —' : brl(data.diferenca)}
                        </p>
                        {data.diferencaPct !== 0 && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                {Math.abs(data.diferencaPct).toFixed(2)}% — {data.sentido === 'sped-maior'
                                    ? 'SPED maior que declarado (DAS a menor)'
                                    : 'declarado maior que SPED (DAS a maior)'}
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Kpi label="SPED saída (Σ NF-e)" value={brl(data.totalSpedSaida)} />
                        <Kpi label="Faturamento declarado" value={brl(data.faturamentoDeclarado)} />
                        <Kpi label="Qtd NF-e saída" value={String(data.resumoSped.qtdSaida)} />
                        <Kpi label="Qtd NF-e entrada" value={String(data.resumoSped.qtdEntrada)} />
                    </div>

                    {origemDeclarado && (
                        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
                            Faturamento declarado lido de: <b>{origemDeclarado}</b>
                            {declaradoBackend === 0 && ' — campo vazio no cadastro'}
                        </p>
                    )}
                    {data.resumoSped.ignorados > 0 && (
                        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
                            {data.resumoSped.ignorados} nota(s) ignorada(s) (canceladas/denegadas/inutilizadas)
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

function Kpi({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-lg font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{value}</p>
        </div>
    );
}

export default ConciliarFaturamento;
