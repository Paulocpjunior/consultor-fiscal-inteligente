/**
 * FechamentoReinfPanel — o RITO DE FECHAMENTO da EFD-Reinf.
 *
 * Paulo, 13/08, com o recibo do R-2099 da VINCENZO na mão: *"vc pode mandar por
 * email somente o que foi enviado e seu status, salvar pode salvar no
 * sharepoint"* — no fechamento do R-2099, saindo da caixa de quem transmitiu,
 * com o gestor em cópia. O rito das guias (#293) aplicado à obrigação acessória.
 *
 * ═══ POR QUE ESTA TELA EXISTE ═══════════════════════════════════════════════
 *
 * A rota do rito subiu no mesmo dia e ficou SEM BOTÃO: funcionalidade que
 * nenhuma tela chama não é funcionalidade, é código morto que dá a impressão de
 * entregue. Este painel é o caminho.
 *
 * ═══ O QUE A TELA NÃO FAZ ═══════════════════════════════════════════════════
 *
 * Nenhuma conta. O apurado vem da MESMA `montarDipamCompetencia` da aba 🌾, a
 * conferência do totalizador é do backend e os códigos de receita chegam
 * prontos — tela de conferência que reimplementa a régua promete um número
 * diferente do que é arquivado e enviado ao gestor.
 *
 * ═══ E NÃO INVENTA RECIBO ═══════════════════════════════════════════════════
 *
 * Toda linha nasce SEM recibo, porque a auditoria do gateway guarda protocolo
 * (lote recebido), não recibo (evento processado). É a pessoa que cola o recibo
 * do e-CAC. Transmitido ≠ entregue: entre um e outro cabe uma recusa.
 */
import React, { useMemo, useState } from 'react';
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../EmpresaAtivaFixa';
import {
    prepararFechamentoReinf, fecharCompetenciaReinf,
    type PrepararFechamento, type EntregaReinf, type RespostaFechamento,
} from '../../services/reinfFechamentoService';

interface Props { onShowToast?: (msg: string) => void }

const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CORES: Record<string, { fundo: string; borda: string; texto: string }> = {
    ok: { fundo: 'bg-emerald-50 dark:bg-emerald-900/20', borda: 'border-emerald-300 dark:border-emerald-700', texto: 'text-emerald-800 dark:text-emerald-200' },
    atencao: { fundo: 'bg-amber-50 dark:bg-amber-900/20', borda: 'border-amber-300 dark:border-amber-700', texto: 'text-amber-800 dark:text-amber-200' },
    falha: { fundo: 'bg-red-50 dark:bg-red-900/20', borda: 'border-red-300 dark:border-red-700', texto: 'text-red-800 dark:text-red-200' },
};
const EMOJI: Record<string, string> = { ok: '✅', atencao: '🟡', falha: '🔴' };
const MARCA: Record<string, string> = { entregue: '✓', recusado: '✗', 'sem-recibo': '!' };

const competenciaPadrao = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const lerBase64 = (f: File) => new Promise<string>((ok, falhou) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result || '').split(',').pop() || '');
    r.onerror = () => falhou(new Error(`Não foi possível ler ${f.name}`));
    r.readAsDataURL(f);
});

const FechamentoReinfPanel: React.FC<Props> = ({ onShowToast }) => {
    // ─── O CNPJ NÃO SE DIGITA MAIS ──────────────────────────────────────────
    //
    // Este painel nasceu em 13/08 com um campo de CNPJ EM BRANCO — pior que um
    // seletor: dar a competência por FECHADA arquiva recibo no SharePoint do
    // cliente e manda extrato ao gestor, e um dígito errado fecha a competência
    // de OUTRA empresa no registro. Agora ele responde pela empresa ativa, que
    // é o mesmo gesto do resto do app (Paulo, 15/08).
    const { empresa: empresaAtiva } = useEmpresaAtiva();
    const cnpj = empresaAtiva?.cnpj || '';
    const [competencia, setCompetencia] = useState(competenciaPadrao());
    const [carregando, setCarregando] = useState(false);
    const [fechando, setFechando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [base, setBase] = useState<PrepararFechamento | null>(null);
    const [entregas, setEntregas] = useState<EntregaReinf[]>([]);
    const [totalizador, setTotalizador] = useState<Array<{ codigoReceita: string; valor: string }>>([]);
    const [reciboFech, setReciboFech] = useState('');
    const [processadoEm, setProcessadoEm] = useState('');
    const [arquivos, setArquivos] = useState<File[]>([]);
    const [resposta, setResposta] = useState<RespostaFechamento | null>(null);

    const cnpj14 = cnpj.replace(/\D/g, '');

    const preparar = async () => {
        setErro(null); setResposta(null);
        if (cnpj14.length !== 14) {
            setErro('Ative a empresa declarante no topo (⇄) — o fechamento é dela, e o CNPJ vem da ativação.');
            return;
        }
        setCarregando(true);
        try {
            const r = await prepararFechamentoReinf(cnpj14, competencia);
            setBase(r);
            setEntregas(r.entregas.map((e) => ({ ...e, recibo: '' })));
            // Os códigos vêm do backend — a tela não escreve a tabela.
            setTotalizador(Object.values(r.codigosFunrural || {}).map((codigoReceita) => ({ codigoReceita, valor: '' })));
        } catch (e: any) {
            setBase(null); setEntregas([]); setTotalizador([]);
            setErro(e.message || 'Falha ao preparar o fechamento.');
        }
        setCarregando(false);
    };

    const fechar = async () => {
        if (!base) return;
        setErro(null); setFechando(true);
        try {
            const anexos = await Promise.all(arquivos.map(async (f) => ({
                nome: f.name, base64: await lerBase64(f), mime: f.type || 'application/octet-stream',
            })));
            const r = await fecharCompetenciaReinf({
                cnpj: cnpj14,
                competencia,
                entregas: entregas.map((e) => ({
                    evento: e.evento, tipo: e.tipo, protocolo: e.protocolo,
                    recibo: (e.recibo || '').trim() || null,
                    transmitidoEm: e.transmitidoEm,
                    ocorrencias: e.ocorrencias?.length ? e.ocorrencias : undefined,
                })),
                // Valor em branco NÃO vira zero: linha sem número fica fora, e a
                // conferência acusa "a Receita não totalizou este código".
                // Zero digitado é resposta; vazio é ausência de resposta.
                totalizador: totalizador
                    .filter((t) => t.codigoReceita && String(t.valor).trim() !== '')
                    .map((t) => ({ codigoReceita: t.codigoReceita, valor: Number(String(t.valor).replace(',', '.')) || 0 })),
                fechamento: reciboFech.trim() ? { recibo: reciboFech.trim(), processadoEm: processadoEm || undefined } : null,
                arquivos: anexos,
            });
            setResposta(r);
            onShowToast?.(`${EMOJI[r.extrato.farol.cor] || ''} Fechamento registrado — ${r.extrato.farol.resumo.slice(0, 80)}`);
        } catch (e: any) {
            setErro(e.message || 'Falha ao fechar a competência.');
        }
        setFechando(false);
    };

    const alterarEntrega = (i: number, campo: 'recibo' | 'ocorrencia', valor: string) => {
        setEntregas((prev) => prev.map((e, idx) => {
            if (idx !== i) return e;
            if (campo === 'recibo') return { ...e, recibo: valor };
            return { ...e, ocorrencias: valor.trim() ? [{ descricao: valor }] : [] };
        }));
    };

    const acrescentarEvento = () => setEntregas((prev) => [...prev, { evento: '', tipo: null, protocolo: null, recibo: '' }]);

    const semRecibo = useMemo(() => entregas.filter((e) => !(e.recibo || '').trim() && !e.ocorrencias?.length).length, [entregas]);

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                <h3 className="text-sm font-bold mb-1">🧾 Fechamento da competência — EFD-Reinf</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                    Depois do R-2099: confere o totalizador contra a apuração da aba 🌾, arquiva os recibos na pasta
                    <strong> RECIBOS</strong> do cliente no SharePoint e manda o extrato ao gestor — da caixa de quem
                    transmitiu. <strong>Transmitido não é entregue</strong>: evento sem recibo nunca aparece como entregue.
                </p>
                <EmpresaAtivaFixa rotulo="Declarante" className="mb-3" />
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[11px] font-semibold">
                        Competência
                        <input
                            type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                        />
                    </label>
                    <button
                        onClick={preparar} disabled={carregando}
                        className="btn-press px-3 py-1.5 text-xs font-bold rounded bg-blue-600 text-white disabled:opacity-50 whitespace-nowrap"
                    >
                        {carregando ? 'Lendo…' : '🔎 Preparar fechamento'}
                    </button>
                </div>
            </div>

            {erro && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-800 dark:text-red-200">
                    {erro}
                </div>
            )}

            {base && (
                <>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                        <p className="text-xs font-bold">{base.empresa.nome || base.empresa.cnpj}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Apurado na aba 🌾 · base {brl(base.apurado?.base)} · INSS {brl(base.apurado?.inss)} ·
                            GILRAT {brl(base.apurado?.gilrat)} · SENAR {brl(base.apurado?.senar)} ·
                            <strong> total {brl(base.apurado?.total)}</strong>
                        </p>
                        {!base.temPastaSharePoint && (
                            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                                ⚠️ Esta empresa não tem pasta configurada (grupo + pasta) na Central de XMLs →
                                Integrações → SharePoint. O extrato é montado e enviado, mas <strong>não há onde
                                arquivar</strong> o recibo.
                            </p>
                        )}
                        {base.lotesSemCompetencia > 0 && (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                {base.lotesSemCompetencia} lote(s) deste CNPJ não declaram competência (R-1000 e tabelas
                                não têm período) — ficam fora desta lista de propósito.
                            </p>
                        )}
                    </div>

                    {/* ── EVENTOS ────────────────────────────────────────── */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <h4 className="text-xs font-bold">Eventos da competência</h4>
                            <button onClick={acrescentarEvento} className="btn-press text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 whitespace-nowrap">
                                + acrescentar evento
                            </button>
                        </div>
                        {!entregas.length ? (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                Nenhum evento transmitido por este app nesta competência. Se o cliente tem retenção ou
                                compra de produtor rural, isso é falha de apuração ou de captura — não é ausência de
                                obrigação. Acrescente à mão o que foi entregue por fora.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                    <thead className="text-slate-500 dark:text-slate-400">
                                        <tr className="text-left">
                                            <th className="py-1 pr-2">Evento</th>
                                            <th className="py-1 pr-2">Protocolo do lote</th>
                                            <th className="py-1 pr-2">Recibo (do e-CAC)</th>
                                            <th className="py-1">Ocorrência, se recusado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {entregas.map((e, i) => (
                                            <tr key={`${e.tipo || 'novo'}-${i}`} className="border-t border-slate-100 dark:border-slate-700">
                                                <td className="py-1 pr-2 align-top">
                                                    <input
                                                        value={e.evento}
                                                        onChange={(ev) => setEntregas((p) => p.map((x, idx) => idx === i ? { ...x, evento: ev.target.value } : x))}
                                                        placeholder="R-2055"
                                                        className="w-24 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                                    />
                                                    {e.tipo && <div className="text-[10px] text-slate-400 mt-0.5 break-all">{e.tipo}</div>}
                                                    {e.elementoIncerto && (
                                                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                                            lote com mais de um tipo de evento — confirme qual é este
                                                        </div>
                                                    )}
                                                    {e.tpAmb === 2 && (
                                                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                                            produção restrita — não vale como entrega
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-1 pr-2 align-top text-slate-500 break-all">{e.protocolo || '—'}</td>
                                                <td className="py-1 pr-2 align-top">
                                                    <input
                                                        value={e.recibo || ''} onChange={(ev) => alterarEntrega(i, 'recibo', ev.target.value)}
                                                        placeholder="11774083-10-2099-…"
                                                        className="w-48 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                                    />
                                                </td>
                                                <td className="py-1 align-top">
                                                    <input
                                                        value={e.ocorrencias?.[0]?.descricao || ''} onChange={(ev) => alterarEntrega(i, 'ocorrencia', ev.target.value)}
                                                        placeholder="MS0030 — …"
                                                        className="w-48 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {semRecibo > 0 && (
                            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                                {semRecibo} evento(s) ainda sem recibo. O protocolo prova que a Receita <em>recebeu</em> o
                                lote; o recibo prova que ela <em>processou</em> o evento.
                            </p>
                        )}
                    </div>

                    {/* ── R-2099 + TOTALIZADOR ───────────────────────────── */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                        <h4 className="text-xs font-bold mb-2">Fechamento (R-2099) e totalizador</h4>
                        <div className="flex flex-wrap gap-2 mb-3">
                            <label className="text-[11px] font-semibold">
                                Recibo do R-2099
                                <input
                                    value={reciboFech} onChange={(e) => setReciboFech(e.target.value)} placeholder="11774083-10-2099-2607-…"
                                    className="block mt-1 w-64 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                />
                            </label>
                            <label className="text-[11px] font-semibold">
                                Processado em
                                <input
                                    type="date" value={processadoEm} onChange={(e) => setProcessadoEm(e.target.value)}
                                    className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                />
                            </label>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                            Copie do <strong>Totalizador das contribuições sociais sobre aquisição de produção rural</strong>.
                            Código que a Receita totalizou e o app não conhece pode ser acrescentado — ele fica FORA da
                            conta e é nomeado, nunca somado por engano. <strong>Campo vazio não é zero</strong>: linha sem
                            número acusa "a Receita não totalizou este código".
                        </p>
                        <div className="space-y-1">
                            {totalizador.map((t, i) => (
                                <div key={i} className="flex flex-wrap gap-2 items-center">
                                    <input
                                        value={t.codigoReceita}
                                        onChange={(e) => setTotalizador((p) => p.map((x, idx) => idx === i ? { ...x, codigoReceita: e.target.value } : x))}
                                        className="w-28 px-1.5 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                    <input
                                        value={t.valor} inputMode="decimal" placeholder="0,00"
                                        onChange={(e) => setTotalizador((p) => p.map((x, idx) => idx === i ? { ...x, valor: e.target.value } : x))}
                                        className="w-28 px-1.5 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                </div>
                            ))}
                            <button
                                onClick={() => setTotalizador((p) => [...p, { codigoReceita: '', valor: '' }])}
                                className="btn-press text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 whitespace-nowrap"
                            >
                                + outro código
                            </button>
                        </div>
                    </div>

                    {/* ── ARQUIVO + AÇÃO ─────────────────────────────────── */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                        <h4 className="text-xs font-bold mb-2">Recibos para arquivar</h4>
                        <input
                            type="file" multiple onChange={(e) => setArquivos(Array.from(e.target.files || []))}
                            className="text-[11px]"
                        />
                        {arquivos.length > 0 && (
                            <p className="text-[11px] text-slate-500 mt-1">{arquivos.map((f) => f.name).join(' · ')}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-3">
                            <button
                                onClick={fechar} disabled={fechando}
                                className="btn-press px-3 py-1.5 text-xs font-bold rounded bg-emerald-600 text-white disabled:opacity-50 whitespace-nowrap"
                            >
                                {fechando ? 'Fechando…' : '🧾 Conferir, arquivar e avisar'}
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                            Nesta ordem: arquiva no SharePoint, depois avisa. Avisar antes produziria "extrato enviado"
                            com o arquivo em lugar nenhum — e é o e-mail que faz a pessoa parar de procurar.
                        </p>
                    </div>
                </>
            )}

            {/* ── RESULTADO ──────────────────────────────────────────────── */}
            {resposta && (
                <div className={`rounded-lg border p-3 ${CORES[resposta.extrato.farol.cor].borda} ${CORES[resposta.extrato.farol.cor].fundo}`}>
                    <p className={`text-xs font-bold ${CORES[resposta.extrato.farol.cor].texto}`}>
                        {EMOJI[resposta.extrato.farol.cor]} {resposta.extrato.farol.resumo}
                    </p>

                    <ul className="mt-2 space-y-0.5">
                        {resposta.extrato.linhas.map((l, i) => (
                            <li key={i} className="text-[11px] text-slate-700 dark:text-slate-200">
                                <strong>{MARCA[l.situacao] || '·'} {l.evento}</strong> — {l.detalhe}
                            </li>
                        ))}
                    </ul>

                    {resposta.extrato.conferencia && (
                        <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                            {resposta.extrato.conferencia.resumo}
                        </p>
                    )}

                    <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                        SharePoint: <strong>{resposta.sharePoint.status}</strong>
                        {resposta.sharePoint.pasta ? ` · ${resposta.sharePoint.pasta}` : ''}
                        {resposta.sharePoint.motivo ? ` · ${resposta.sharePoint.motivo}` : ''}
                        {' · '}E-mail: <strong>{resposta.email.status}</strong>
                        {resposta.email.remetente ? ` (de ${resposta.email.remetente}, ${resposta.email.gestorEmCopia} em cópia)` : ''}
                        {resposta.email.motivo ? ` · ${resposta.email.motivo}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
};

export default FechamentoReinfPanel;
