/**
 * AjustesE111 — lançamento dos ajustes da apuração do ICMS (Registro E111):
 * crédito outorgado, estornos, deduções, débitos especiais. Era a maior
 * lacuna da migração E-Fiscal → CFI (02/08): cliente com ajuste recorrente
 * não fechava a apuração pelo app.
 *
 * O TIPO do ajuste sai do próprio código (4º caractere, tabela 5.1.1 da UF)
 * — a validação aqui é a MESMA do gerador (sped-ajustes-apuracao.js).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import { carregarAjustes, salvarAjustes } from '../../services/spedAjustesService';
import {
    validarCodigoAjuste, TIPOS_AJUSTE, type AjusteApuracao,
} from '../../sefaz-backend/sped-ajustes-apuracao.js';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';

interface Props {
    currentUser: User | null;
    empresas: EmpresaXmlOption[];
    onShowToast?: (msg: string) => void;
}

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const AjustesE111: React.FC<Props> = ({ empresas, onShowToast }) => {
    const [empresaId, setEmpresaId] = useState('');
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [ajustes, setAjustes] = useState<AjusteApuracao[]>([]);
    const [carregado, setCarregado] = useState('');
    const [loading, setLoading] = useState(false);
    const [salvando, setSalvando] = useState(false);

    const empresa = empresas.find(e => e.id === empresaId) || null;
    const uf = (empresa?.uf || '').toUpperCase();
    const chave = `${empresaId}|${competencia}`;

    useEffect(() => {
        if (!empresaId || !competencia) return;
        let alive = true;
        setLoading(true);
        carregarAjustes(empresaId, competencia)
            .then(l => { if (alive) { setAjustes(l); setCarregado(chave); } })
            .catch(e => onShowToast?.(`Falha ao carregar ajustes: ${e.message}`))
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, competencia]);

    const linhas = useMemo(() => ajustes.map(a => {
        const v = validarCodigoAjuste(a.codigo, uf);
        return {
            ...a,
            erro: a.codigo ? (v.ok ? null : v.erro) : null,
            rotulo: v.ok && v.tipo !== undefined ? TIPOS_AJUSTE[v.tipo]?.rotulo : null,
        };
    }), [ajustes, uf]);

    const totalValido = useMemo(
        () => linhas.filter(l => !l.erro && l.codigo).reduce((s, l) => s + (Number(l.valor) || 0), 0),
        [linhas],
    );
    const temErro = linhas.some(l => l.erro);

    const setCampo = (idx: number, campo: keyof AjusteApuracao, valor: string) => {
        setAjustes(prev => prev.map((a, i) => i === idx
            ? { ...a, [campo]: campo === 'valor' ? (valor === '' ? 0 : parseFloat(valor)) : valor }
            : a));
    };

    const salvar = async () => {
        if (!empresa) { onShowToast?.('Escolha a empresa.'); return; }
        setSalvando(true);
        try {
            const limpos = ajustes.filter(a => a.codigo || a.descricao || a.valor);
            await salvarAjustes({ empresaId, empresaCnpj: empresa.cnpj, competencia, ajustes: limpos });
            setAjustes(limpos);
            onShowToast?.(`Ajustes salvos (${limpos.length}). Eles entram no PRÓXIMO arquivo gerado desta competência.`);
        } catch (e: any) {
            onShowToast?.(`Falha ao salvar: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Ajustes da apuração do ICMS — Registro E111
                </h3>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                    Crédito outorgado, estornos, deduções e débitos especiais. O <strong>tipo</strong> (soma ou abate)
                    vem do próprio código da tabela 5.1.1 da SEFAZ — lance o valor sempre POSITIVO.
                    Só empresas do <strong>Lucro</strong> (Simples não apura ICMS no E110).
                </p>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[280px] flex-1">
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Empresa</label>
                        <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId} />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Competência</label>
                        <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                </div>
            </div>

            {empresaId && carregado === chave && !loading && (
                <div className="p-5 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    {linhas.map((l, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-start">
                            <div>
                                <input
                                    value={l.codigo}
                                    onChange={e => setCampo(i, 'codigo', e.target.value.toUpperCase())}
                                    placeholder={`${uf || 'SP'}020799`}
                                    maxLength={8}
                                    className="p-2 text-sm rounded-lg font-mono w-32"
                                    style={{ background: 'var(--bg-card)', border: `1px solid ${l.erro ? 'var(--danger, #dc2626)' : 'var(--border-default)'}`, color: 'var(--text-primary)' }}
                                />
                                {l.rotulo && <p className="text-[10px] mt-0.5 font-bold" style={{ color: 'var(--accent)' }}>{l.rotulo}</p>}
                            </div>
                            <input
                                value={l.descricao || ''}
                                onChange={e => setCampo(i, 'descricao', e.target.value)}
                                placeholder="Descrição complementar (ex.: crédito outorgado art. …)"
                                className="p-2 text-sm rounded-lg flex-1 min-w-[220px]"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            />
                            <input
                                type="number" min="0" step="0.01"
                                value={l.valor || ''}
                                onChange={e => setCampo(i, 'valor', e.target.value)}
                                placeholder="0,00"
                                className="p-2 text-sm rounded-lg w-32 text-right font-mono"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            />
                            <button
                                onClick={() => setAjustes(prev => prev.filter((_, x) => x !== i))}
                                className="px-3 py-2 text-xs font-bold rounded-lg"
                                style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                                title="Remover linha"
                            >✕</button>
                            {l.erro && <p className="basis-full text-[11px] font-semibold" style={{ color: 'var(--danger, #dc2626)' }}>⚠ {l.erro}</p>}
                        </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                            onClick={() => setAjustes(prev => [...prev, { codigo: '', descricao: '', valor: 0 }])}
                            className="px-4 py-2 text-xs font-bold rounded-lg"
                            style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                        >＋ Adicionar ajuste</button>
                        <button
                            onClick={salvar}
                            disabled={salvando || temErro}
                            className="px-5 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40"
                            style={{ background: 'var(--accent)' }}
                            title={temErro ? 'Corrija os códigos em vermelho antes de salvar' : ''}
                        >{salvando ? 'Salvando…' : '💾 Salvar ajustes'}</button>
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {linhas.filter(l => l.codigo && !l.erro).length} ajuste(s) válido(s) · {fmtBRL(totalValido)}
                        </span>
                    </div>

                    <p className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
                        Os ajustes entram no E110/E111 do próximo arquivo gerado desta competência (mensal ou dentro do trimestre).
                        Código de OUTRA UF ou de ST é recusado aqui — ST/DIFAL (E220/E310) ainda não são gerados pelo CFI e devem ser lançados no PVA.
                    </p>
                </div>
            )}
            {loading && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Carregando ajustes…</p>}
            {!empresaId && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Escolha a empresa (do Lucro) e a competência.</p>}
        </div>
    );
};

export default AjustesE111;
