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
import {
    carregarConfigAjustes, salvarAjustes, type ObrigacaoStUf,
} from '../../services/spedAjustesService';
import {
    validarCodigoAjuste, TIPOS_AJUSTE, type AjusteApuracao,
} from '../../sefaz-backend/sped-ajustes-apuracao.js';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';

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
    // A EMPRESA É A ATIVA DA SESSÃO — este painel não pergunta de novo.
    //
    // Paulo, 15/08: *"tira os seletores internos"*. Dava para ativar a empresa
    // A no cabeçalho e escolher a B aqui dentro, sem a tela denunciar nada:
    // dois lugares decidindo em qual CLIENTE o trabalho ia cair.
    const empresaId = useEmpresaAtivaId();
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [ajustes, setAjustes] = useState<AjusteApuracao[]>([]);
    const [carregado, setCarregado] = useState('');
    const [loading, setLoading] = useState(false);
    const [salvando, setSalvando] = useState(false);
    // 🚨 OS DOIS CAMPOS QUE O GERADOR LIA E NINGUÉM PODIA PREENCHER (21/08).
    // Eles moram no MESMO documento dos ajustes — são configuração de
    // apuração da competência, não merecem coleção própria (o mesmo desenho
    // que o código do C197 já tinha). Sem eles o C197 e o E250 NUNCA saíam, e
    // o aviso da geração mandava "informe no cadastro" — um cadastro que não
    // existia em tela nenhuma.
    const [difalCodigo, setDifalCodigo] = useState('');
    const [obrigacoesSt, setObrigacoesSt] = useState<Array<{ uf: string } & ObrigacaoStUf>>([]);

    const empresa = empresas.find(e => e.id === empresaId) || null;
    const uf = (empresa?.uf || '').toUpperCase();
    const chave = `${empresaId}|${competencia}`;

    useEffect(() => {
        if (!empresaId || !competencia) return;
        let alive = true;
        setLoading(true);
        carregarConfigAjustes(empresaId, competencia)
            .then(cfg => {
                if (!alive) return;
                setAjustes(cfg.ajustes);
                setDifalCodigo(cfg.difalCodigoAjusteC197 || '');
                setObrigacoesSt(Object.entries(cfg.obrigacoesStPorUf || {})
                    .map(([uf, o]) => ({ uf, dtVcto: o.dtVcto || '', codRec: o.codRec || '' })));
                setCarregado(chave);
            })
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
            // Só a UF com os DOIS campos vira obrigação: o E250 exige vencimento
            // E código de receita, e meia obrigação não se declara.
            const stMap: Record<string, ObrigacaoStUf> = {};
            for (const o of obrigacoesSt) {
                const uf = o.uf.trim().toUpperCase();
                const dt = o.dtVcto.replace(/\D/g, '');
                const cod = o.codRec.trim();
                if (uf.length === 2 && dt.length === 8 && cod) stMap[uf] = { dtVcto: dt, codRec: cod };
            }
            await salvarAjustes({
                empresaId, empresaCnpj: empresa.cnpj, competencia, ajustes: limpos,
                difalCodigoAjusteC197: difalCodigo,
                obrigacoesStPorUf: stMap,
            });
            setAjustes(limpos);
            const nSt = Object.keys(stMap).length;
            onShowToast?.(`Ajustes salvos (${limpos.length})`
                + `${difalCodigo ? ' · código do C197' : ''}`
                + `${nSt ? ` · ${nSt} obrigação(ões) de ST` : ''}`
                + '. Entram no PRÓXIMO arquivo gerado desta competência.');
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
                        <EmpresaAtivaFixa />
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
                        Código de OUTRA UF é recusado aqui — a tabela 5.1.1 é estadual.
                    </p>

                    {/* ═══ OS DOIS CAMPOS QUE O GERADOR LIA E NINGUÉM PODIA PREENCHER ═══
                        O C197 do DIFAL e o E250 do ST dependem de códigos de tabela
                        ESTADUAL. O app não os deduz — mas até 21/08 o aviso mandava
                        "informe no cadastro" e o cadastro não existia. */}
                    <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                            Obrigações e códigos estaduais
                        </h4>
                        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                            O app <strong>não deduz</strong> código de tabela estadual. Sem eles, o C197 do DIFAL e o
                            E250 do ST ficam de fora do arquivo e a geração avisa.
                        </p>

                        <div className="flex flex-wrap items-end gap-3 mb-4">
                            <div className="min-w-[280px]">
                                <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
                                    Código de ajuste do C197 (DIFAL de aquisição) — tabela 5.3
                                </label>
                                <input
                                    value={difalCodigo}
                                    onChange={e => setDifalCodigo(e.target.value.toUpperCase())}
                                    placeholder="Ex.: SP70000001"
                                    className="w-full px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                            </div>
                        </div>

                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
                            ICMS-ST a recolher por UF de destino (E250) — uma GNRE por estado
                        </label>
                        {obrigacoesSt.map((o, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
                                <input
                                    value={o.uf}
                                    onChange={e => setObrigacoesSt(prev => prev.map((x, k) => k === i
                                        ? { ...x, uf: e.target.value.toUpperCase().slice(0, 2) } : x))}
                                    placeholder="UF"
                                    className="w-[70px] px-3 py-2 text-sm rounded-lg text-center"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <input
                                    value={o.dtVcto}
                                    onChange={e => setObrigacoesSt(prev => prev.map((x, k) => k === i
                                        ? { ...x, dtVcto: e.target.value.replace(/\D/g, '').slice(0, 8) } : x))}
                                    placeholder="Vencimento DDMMAAAA"
                                    className="w-[190px] px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <input
                                    value={o.codRec}
                                    onChange={e => setObrigacoesSt(prev => prev.map((x, k) => k === i
                                        ? { ...x, codRec: e.target.value } : x))}
                                    placeholder="Código de receita da GNRE"
                                    className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <button
                                    onClick={() => setObrigacoesSt(prev => prev.filter((_, k) => k !== i))}
                                    className="px-3 py-2 text-xs font-bold rounded-lg"
                                    style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                                    title="Remover"
                                >✕</button>
                            </div>
                        ))}
                        <button
                            onClick={() => setObrigacoesSt(prev => [...prev, { uf: '', dtVcto: '', codRec: '' }])}
                            className="px-4 py-2 text-xs font-bold rounded-lg"
                            style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                        >＋ Adicionar UF</button>
                        <p className="text-[11px] pt-2" style={{ color: 'var(--text-muted)' }}>
                            A linha só vira E250 com os TRÊS campos preenchidos — meia obrigação não se declara.
                            Use o <strong>💾 Salvar ajustes</strong> acima: os três blocos gravam no mesmo lugar.
                        </p>
                    </div>
                </div>
            )}
            {loading && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Carregando ajustes…</p>}
            {!empresaId && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Escolha a empresa (do Lucro) e a competência.</p>}
        </div>
    );
};

export default AjustesE111;
