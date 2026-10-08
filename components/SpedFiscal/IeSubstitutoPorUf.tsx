/**
 * 🏛️ IE DE SUBSTITUTO TRIBUTÁRIO POR UF — recolhimento MENSAL do ICMS-ST (08/10).
 *
 * Paulo, FLANACAR (IE de ST em todos os estados): o E210 já saía por UF, mas o
 * E250 (a guia) dependia de digitar vencimento e código EM CADA competência.
 * Este cadastro é FIXO por empresa: código da obrigação (tabela 5.4), código
 * de receita da GNRE e o dia do vencimento no mês seguinte. Com ele, toda
 * competência com ICMS-ST a recolher na UF ganha o E250 sozinha. O lançado
 * na competência (bloco "ICMS-ST a recolher por UF") continua vencendo.
 *
 * Os valores sugeridos numa linha nova são os do exemplo real do Paulo (PR,
 * 09/2026: 002 · 100048 · dia 9) — a pessoa confere e grava; nada é gravado
 * sem ela.
 */
import React, { useEffect, useState } from 'react';
import {
    CODIGOS_OBRIGACAO_ST, UFS_BRASIL, validarCadastroStUf, vencimentoNoMesSeguinte,
} from '../../sefaz-backend/st-cadastro-uf.js';
import { lerCadastroStUf, gravarCadastroStUf, type LinhaStUf } from '../../services/stCadastroUfService';

interface Props {
    empresaId: string;
    /** UF da própria empresa — só para dizer qual linha é a do estado. */
    uf?: string;
    competencia: string;
    onShowToast?: (msg: string) => void;
}

type Rascunho = { uf: string; ie: string; codOr: string; codRec: string; diaVencimento: string };

const SUGESTAO = { codOr: '002', codRec: '100048', diaVencimento: '9' };
const estilo = { background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' };

const IeSubstitutoPorUf: React.FC<Props> = ({ empresaId, uf, competencia, onShowToast }) => {
    const [linhas, setLinhas] = useState<Rascunho[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [gravando, setGravando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [carimbo, setCarimbo] = useState<string>('');

    useEffect(() => {
        let vivo = true;
        if (!empresaId) return undefined;
        setCarregando(true); setErro(null);
        lerCadastroStUf(empresaId).then((r) => {
            if (!vivo) return;
            if (!r.ok) { setErro(r.erro); setLinhas([]); return; }
            setLinhas(Object.entries(r.ufs || {}).sort(([a], [b]) => a.localeCompare(b)).map(([u, l]) => ({
                uf: u, ie: l.ie || '', codOr: l.codOr || '', codRec: l.codRec || '', diaVencimento: String(l.diaVencimento ?? ''),
            })));
            setCarimbo(r.atualizadoEm ? `gravado por ${r.atualizadoPor || '—'} em ${new Date(r.atualizadoEm).toLocaleString('pt-BR')}` : '');
        }).finally(() => { if (vivo) setCarregando(false); });
        return () => { vivo = false; };
    }, [empresaId]);

    const paraGravar: LinhaStUf[] = linhas.map((l) => ({ ...l, diaVencimento: Number(l.diaVencimento) }));
    const conf = validarCadastroStUf(paraGravar);
    const mudar = (i: number, campo: keyof Rascunho, valor: string) =>
        setLinhas((prev) => prev.map((x, k) => (k === i ? { ...x, [campo]: valor } : x)));
    const jaTem = new Set(linhas.map((l) => l.uf));

    const adicionarTodas = () => setLinhas((prev) => [
        ...prev,
        ...UFS_BRASIL.filter((u) => !jaTem.has(u) && u !== String(uf || '').toUpperCase())
            .map((u) => ({ uf: u, ie: '', ...SUGESTAO })),
    ]);

    const gravar = async () => {
        if (!conf.ok) return;
        setGravando(true); setErro(null);
        try {
            const r = await gravarCadastroStUf(empresaId, paraGravar);
            if (!r.ok) { setErro(r.erro); return; }
            setCarimbo(r.atualizadoEm ? `gravado por ${r.atualizadoPor || '—'} em ${new Date(r.atualizadoEm).toLocaleString('pt-BR')}` : '');
            onShowToast?.(`🏛️ IE de substituto: ${linhas.length} UF(s) gravada(s) — o E250 sai sozinho em toda competência.`);
        } finally {
            setGravando(false);
        }
    };

    return (
        <div className="p-5 rounded-xl space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                🏛️ IE de substituto por UF — recolhimento mensal do ICMS-ST (E250)
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Cadastro <strong>fixo da empresa</strong> (vale para todas as competências). Em cada UF com ICMS-ST a recolher no E210, o
                SPED gera o E250 com o código da obrigação, o código de receita da GNRE e o vencimento no dia informado do
                <strong> mês seguinte</strong> à competência (sem ajuste de fim de semana ou feriado). O lançado só na competência, no bloco
                "ICMS-ST a recolher por UF" abaixo, vence o cadastro naquele mês.
            </p>
            {carregando && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Carregando cadastro…</p>}
            {!carregando && linhas.map((l, i) => {
                const venc = vencimentoNoMesSeguinte(competencia, Number(l.diaVencimento));
                return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                        <select value={l.uf} onChange={(e) => mudar(i, 'uf', e.target.value)}
                            className="w-[80px] px-2 py-2 text-sm rounded-lg" style={estilo}>
                            <option value="">UF</option>
                            {UFS_BRASIL.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <input value={l.ie} onChange={(e) => mudar(i, 'ie', e.target.value)} placeholder="IE de substituto (opcional)"
                            className="w-[180px] px-3 py-2 text-sm rounded-lg" style={estilo} />
                        <select value={l.codOr} onChange={(e) => mudar(i, 'codOr', e.target.value)}
                            className="w-[260px] px-2 py-2 text-sm rounded-lg" style={estilo} title="COD_OR — tabela 5.4">
                            <option value="">Código da obrigação…</option>
                            {Object.entries(CODIGOS_OBRIGACAO_ST).map(([c, t]) => <option key={c} value={c}>{c} — {t}</option>)}
                        </select>
                        <input value={l.codRec} onChange={(e) => mudar(i, 'codRec', e.target.value)} placeholder="Cód. receita GNRE"
                            className="w-[140px] px-3 py-2 text-sm rounded-lg" style={estilo} />
                        <input value={l.diaVencimento} onChange={(e) => mudar(i, 'diaVencimento', e.target.value.replace(/\D/g, '').slice(0, 2))}
                            placeholder="Dia" className="w-[60px] px-2 py-2 text-sm rounded-lg text-center" style={estilo}
                            title="Dia do vencimento no mês seguinte à competência" />
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {venc ? `${competencia.slice(5)}/${competencia.slice(0, 4)} → vence ${venc.slice(0, 2)}/${venc.slice(2, 4)}/${venc.slice(4)}` : ''}
                            {l.uf && l.uf === String(uf || '').toUpperCase() ? ' · UF da empresa' : ''}
                        </span>
                        <button onClick={() => setLinhas((prev) => prev.filter((_, k) => k !== i))}
                            className="px-3 py-2 text-xs font-bold rounded-lg" style={{ ...estilo, color: 'var(--text-muted)' }} title="Remover">✕</button>
                    </div>
                );
            })}
            {!carregando && (
                <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => setLinhas((prev) => [...prev, { uf: '', ie: '', ...SUGESTAO }])}
                        className="px-4 py-2 text-xs font-bold rounded-lg" style={{ ...estilo, color: 'var(--accent)', border: '1px solid var(--accent)' }}
                    >＋ Adicionar UF</button>
                    <button onClick={adicionarTodas}
                        className="px-4 py-2 text-xs font-bold rounded-lg" style={{ ...estilo, color: 'var(--accent)', border: '1px solid var(--accent)' }}
                        title="Acrescenta as UFs que faltam (menos a da empresa) com a sugestão 002 · 100048 · dia 9 — confira antes de gravar"
                    >＋ Todas as UFs</button>
                    <button onClick={gravar} disabled={gravando || !conf.ok || !empresaId}
                        className="px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50"
                        style={{ background: 'var(--accent)' }}
                    >{gravando ? 'gravando…' : '💾 Gravar cadastro'}</button>
                </div>
            )}
            {!conf.ok && linhas.length > 0 && (
                <ul className="text-[11px] list-disc pl-4" style={{ color: 'var(--accent)' }}>
                    {conf.erros.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
                    {conf.erros.length > 8 && <li>mostrando 8 de {conf.erros.length} pendências</li>}
                </ul>
            )}
            {erro && <p className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{erro}</p>}
            {carimbo && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{carimbo}</p>}
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Linha nova vem com a sugestão do exemplo real (002 · 100048 · dia 9). Confira o código e o prazo de cada UF antes de gravar.
            </p>
        </div>
    );
};

export default IeSubstitutoPorUf;
