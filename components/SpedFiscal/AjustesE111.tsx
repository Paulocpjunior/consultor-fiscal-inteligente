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
// 🧭 O DIFAL de aquisição DENTRO da apuração (art. 117) mora aqui, ao lado dos
// códigos estaduais que ele precisa — é onde a pessoa já vem lançar o E111.
import DifalArt117 from './DifalArt117';
// A tabela de receitas da GNRE para a EC 87/15 — sugestão no cadastro, nunca default.
import { CODIGOS_RECEITA_GNRE_EC87 } from '../../sefaz-backend/difal-ec87-saida.js';
import { auth } from '../../services/firebaseConfig';

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
    // 🚨 18/09 (VINATEX): o E316 do DIFAL da EC 87/15 nasceu com o cadastro no
    // MESMO PR — sem ele o registro não sairia e o aviso mandaria preencher um
    // lugar inexistente, que é o achado 18 (21/08) na forma que já custou dois
    // dias nesta casa.
    const [obrigacoesDifal, setObrigacoesDifal] = useState<Array<{ uf: string } & ObrigacaoStUf>>([]);
    // 🧭 21/09, Paulo (WALDESA, "13 páginas de DIFAL para lançar"): as UFs vêm
    // das NOTAS da competência (rota /difal-ec87), não da digitação; o que
    // continua sendo cadastro é só o que a nota não traz — vencimento e
    // código de receita —, e esses se aplicam a todas de uma vez.
    const [ufsDaCompetencia, setUfsDaCompetencia] = useState<Array<{ uf: string; difal: number; fcp: number; documentos: number }> | null>(null);
    const [puxando, setPuxando] = useState(false);
    const [aplicar, setAplicar] = useState({ dtVcto: '', codRec: '', codRecFcp: '' });

    const puxarUfsDaCompetencia = async () => {
        if (!empresaId || !competencia) return;
        setPuxando(true);
        try {
            const t = await auth?.currentUser?.getIdToken();
            const r = await fetch(
                `/api/admin/sped-fiscal/difal-ec87?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
                { headers: { Authorization: `Bearer ${t}` } },
            );
            const j = await r.json();
            if (!j.ok) { onShowToast?.(j.error || 'Falha ao ler o DIFAL da competência.'); return; }
            const ufs: Array<{ uf: string; difal: number; fcp: number; documentos: number }> = j.ufs || [];
            setUfsDaCompetencia(ufs);
            if (!ufs.length) {
                onShowToast?.('Nenhuma saída com DIFAL da EC 87/15 nesta competência. Se há venda a não contribuinte de outra UF, rode ♻️ Reler itens dos XMLs (o grupo ICMSUFDest pode não ter sido capturado).');
                return;
            }
            setObrigacoesDifal(prev => {
                const existentes = new Set(prev.map(o => o.uf.trim().toUpperCase()));
                const novas = ufs.filter(u => !existentes.has(u.uf)).map(u => ({ uf: u.uf, dtVcto: '', codRec: '', codRecFcp: '' }));
                return [...prev, ...novas];
            });
            const comFcp = ufs.filter(u => u.fcp > 0).map(u => u.uf);
            onShowToast?.(`${ufs.length} UF(s) com DIFAL nesta competência (${j.documentosLidos} documento(s) lidos)`
                + (comFcp.length ? ` · FCP em ${comFcp.join(', ')} — essas precisam do código do FCP também.` : '.')
                + (j.semUf?.length ? ` ⚠️ ${j.semUf.length} nota(s) sem UF do destinatário ficaram fora.` : ''));
        } catch (e: any) {
            onShowToast?.(`Falha ao puxar as UFs: ${e?.message || e}`);
        } finally {
            setPuxando(false);
        }
    };
    const infoUf = (u: string) => ufsDaCompetencia?.find(x => x.uf === u.trim().toUpperCase()) || null;
    const aplicarATodas = () => {
        const dt = aplicar.dtVcto.replace(/\D/g, '').slice(0, 8);
        const cod = aplicar.codRec.trim();
        const codFcp = aplicar.codRecFcp.trim();
        if (!dt && !cod && !codFcp) { onShowToast?.('Preencha ao menos um campo para aplicar.'); return; }
        setObrigacoesDifal(prev => prev.map(o => {
            const info = infoUf(o.uf);
            // O código do FCP só vai para a UF que TEM FCP (quando se sabe); sem
            // a leitura das notas, vai para todas e o gerador ignora onde não há.
            const levaFcp = info ? info.fcp > 0 : true;
            return {
                ...o,
                ...(dt ? { dtVcto: dt } : {}),
                ...(cod ? { codRec: cod } : {}),
                ...(codFcp && levaFcp ? { codRecFcp: codFcp } : {}),
            };
        }));
    };

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
                setObrigacoesDifal(Object.entries(cfg.obrigacoesDifalEc87PorUf || {})
                    .map(([uf, o]) => ({ uf, dtVcto: o.dtVcto || '', codRec: o.codRec || '', codRecFcp: o.codRecFcp || '' })));
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
            // Mesma régua no E316 do DIFAL EC 87/15: sem vencimento E código de
            // receita o registro não sai. Meia obrigação não se declara.
            const difalMap: Record<string, ObrigacaoStUf> = {};
            for (const o of obrigacoesDifal) {
                const u = o.uf.trim().toUpperCase();
                const dt = o.dtVcto.replace(/\D/g, '');
                const cod = o.codRec.trim();
                // O FCP tem receita própria (21/09): vai só quando informado —
                // o Firestore rejeita `undefined`, por isso o spread condicional.
                const codFcp = String(o.codRecFcp || '').trim();
                if (u.length === 2 && dt.length === 8 && cod) {
                    difalMap[u] = { dtVcto: dt, codRec: cod, ...(codFcp ? { codRecFcp: codFcp } : {}) };
                }
            }
            await salvarAjustes({
                empresaId, empresaCnpj: empresa.cnpj, competencia, ajustes: limpos,
                difalCodigoAjusteC197: difalCodigo,
                obrigacoesStPorUf: stMap,
                obrigacoesDifalEc87PorUf: difalMap,
            });
            setAjustes(limpos);
            const nSt = Object.keys(stMap).length;
            const nDifal = Object.keys(difalMap).length;
            onShowToast?.(`Ajustes salvos (${limpos.length})`
                + `${difalCodigo ? ' · código do C197' : ''}`
                + `${nSt ? ` · ${nSt} obrigação(ões) de ST` : ''}`
                + `${nDifal ? ` · ${nDifal} obrigação(ões) de DIFAL EC 87/15` : ''}`
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
                            Use o <strong>💾 Salvar ajustes</strong> acima: os blocos gravam no mesmo lugar.
                        </p>

                        {/* 🚨 E316 — a obrigação do DIFAL da EC 87/15, por UF de DESTINO.
                            Nasceu em 18/09 (VINATEX) junto do E300/E310, porque registro
                            que depende de código estadual e não tem onde ser cadastrado é
                            aviso apontando lugar que não existe. */}
                        <label className="text-[10px] uppercase font-bold block mb-1 mt-5" style={{ color: 'var(--text-muted)' }}>
                            DIFAL EC 87/15 a recolher por UF de destino (E316) — uma guia por estado
                        </label>
                        <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                            Venda interestadual a <strong>consumidor final não contribuinte</strong>: o valor do
                            diferencial e do FCP vem da <strong>própria nota</strong> (o app não recalcula), mas o
                            <strong> código de receita</strong> e o <strong>vencimento</strong> são do estado de
                            destino e não estão no documento. Sem os dois, o E316 fica de fora e a geração avisa.
                            {' '}O <strong>FCP tem código próprio</strong> e sai em E316 separado — quando a UF tem FCP
                            (BA, por exemplo), informe os dois códigos. Na GNRE a tabela é nacional:
                            {' '}<strong>100102</strong> DIFAL por operação · <strong>100110</strong> DIFAL por apuração ·
                            {' '}<strong>100129</strong> FCP por operação · <strong>100137</strong> FCP por apuração
                            {' '}(por operação = sem inscrição no estado de destino, uma guia por nota; por apuração =
                            com inscrição lá). Estado fora do Portal GNRE usa o código da guia própria.
                        </p>
                        <datalist id="cod-rec-gnre-difal">
                            {CODIGOS_RECEITA_GNRE_EC87.filter(c => c.tributo === 'difal').map(c => (
                                <option key={c.codigo} value={c.codigo}>{c.descricao} (GNRE)</option>
                            ))}
                        </datalist>
                        <datalist id="cod-rec-gnre-fcp">
                            {CODIGOS_RECEITA_GNRE_EC87.filter(c => c.tributo === 'fcp').map(c => (
                                <option key={c.codigo} value={c.codigo}>{c.descricao} (GNRE)</option>
                            ))}
                        </datalist>
                        {/* 🧭 As UFs vêm das notas; o cadastro é só o que a nota não traz. */}
                        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-default)' }}>
                            <button
                                onClick={() => void puxarUfsDaCompetencia()}
                                disabled={puxando || !empresaId}
                                className="px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-50"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                                title="Lê as saídas com DIFAL da EC 87/15 desta competência e lista as UFs de destino — sem digitar UF por UF."
                            >{puxando ? '⏳ Lendo as notas…' : '📥 Puxar UFs desta competência'}</button>
                            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>depois, aplique a todas:</span>
                            <input
                                value={aplicar.dtVcto}
                                onChange={e => setAplicar(a => ({ ...a, dtVcto: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                                placeholder="Vencimento DDMMAAAA"
                                className="w-[170px] px-3 py-2 text-sm rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            />
                            <input
                                value={aplicar.codRec}
                                list="cod-rec-gnre-difal"
                                onChange={e => setAplicar(a => ({ ...a, codRec: e.target.value }))}
                                placeholder="Código do DIFAL"
                                className="w-[160px] px-3 py-2 text-sm rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            />
                            <input
                                value={aplicar.codRecFcp}
                                list="cod-rec-gnre-fcp"
                                onChange={e => setAplicar(a => ({ ...a, codRecFcp: e.target.value }))}
                                placeholder="Código do FCP"
                                className="w-[160px] px-3 py-2 text-sm rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            />
                            <button
                                onClick={aplicarATodas}
                                disabled={!obrigacoesDifal.length}
                                className="px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-50"
                                style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                                title="Preenche o vencimento e os códigos em todas as UFs listadas (o código do FCP só nas UFs que têm FCP). Campo vazio não sobrescreve."
                            >↧ Aplicar a todas as UFs</button>
                        </div>
                        {ufsDaCompetencia && ufsDaCompetencia.length > 0 && (
                            <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                                Nas notas de {competencia.split('-').reverse().join('/')}: {ufsDaCompetencia.map(u => `${u.uf} ${fmtBRL(u.difal)}${u.fcp > 0 ? ` + FCP ${fmtBRL(u.fcp)}` : ''}`).join(' · ')}.
                                {' '}O detalhamento nota a nota está em Relatórios → 🧭 DIFAL/FCP EC 87/15.
                            </p>
                        )}
                        {obrigacoesDifal.map((o, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
                                <input
                                    value={o.uf}
                                    onChange={e => setObrigacoesDifal(prev => prev.map((x, k) => k === i
                                        ? { ...x, uf: e.target.value.toUpperCase().slice(0, 2) } : x))}
                                    placeholder="UF"
                                    className="w-[70px] px-3 py-2 text-sm rounded-lg text-center"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                {infoUf(o.uf) && (
                                    <span className="text-[10px] w-[150px]" style={{ color: infoUf(o.uf)!.fcp > 0 && !String(o.codRecFcp || '').trim() ? 'var(--accent)' : 'var(--text-muted)' }}>
                                        {fmtBRL(infoUf(o.uf)!.difal)}{infoUf(o.uf)!.fcp > 0 ? ` + FCP ${fmtBRL(infoUf(o.uf)!.fcp)}` : ''}
                                    </span>
                                )}
                                <input
                                    value={o.dtVcto}
                                    onChange={e => setObrigacoesDifal(prev => prev.map((x, k) => k === i
                                        ? { ...x, dtVcto: e.target.value.replace(/\D/g, '').slice(0, 8) } : x))}
                                    placeholder="Vencimento DDMMAAAA"
                                    className="w-[190px] px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <input
                                    value={o.codRec}
                                    list="cod-rec-gnre-difal"
                                    onChange={e => setObrigacoesDifal(prev => prev.map((x, k) => k === i
                                        ? { ...x, codRec: e.target.value } : x))}
                                    placeholder="Código de receita do DIFAL (GNRE: 100102 / 100110)"
                                    className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <input
                                    value={o.codRecFcp || ''}
                                    list="cod-rec-gnre-fcp"
                                    onChange={e => setObrigacoesDifal(prev => prev.map((x, k) => k === i
                                        ? { ...x, codRecFcp: e.target.value } : x))}
                                    placeholder="Código do FCP, se houver (GNRE: 100129 / 100137)"
                                    className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                />
                                <button
                                    onClick={() => setObrigacoesDifal(prev => prev.filter((_, k) => k !== i))}
                                    className="px-3 py-2 text-xs font-bold rounded-lg"
                                    style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                                    title="Remover"
                                >✕</button>
                            </div>
                        ))}
                        <button
                            onClick={() => setObrigacoesDifal(prev => [...prev, { uf: '', dtVcto: '', codRec: '', codRecFcp: '' }])}
                            className="px-4 py-2 text-xs font-bold rounded-lg"
                            style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                        >＋ Adicionar UF de destino</button>
                    </div>

                    {/* 🧭 O campo "dentro da nota" do e-Fiscal — pedido do Paulo em 14/09 (HYPE CAFÉ). */}
                    <DifalArt117
                        empresaId={empresaId}
                        empresaCnpj={empresa?.cnpj || ''}
                        competencia={competencia}
                        uf={uf}
                        onShowToast={onShowToast}
                    />
                </div>
            )}
            {loading && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Carregando ajustes…</p>}
            {!empresaId && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Escolha a empresa (do Lucro) e a competência.</p>}
        </div>
    );
};

export default AjustesE111;
