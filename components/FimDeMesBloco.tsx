/**
 * 🔒 DAR FIM DE MÊS — o bloco que fecha a competência de UM cliente.
 *
 * Paulo, 26/08: *"o fechamento do fim do mês no CFI exige (DAR FIM DE MÊS);
 * essa função é que deve ser usada como régua para nos nortear, usar como base
 * p impostos, livros, ficha financeira, exatamente o que o CCI deve usar como
 * base para importação do contábil"*.
 *
 * ═══ ELE MORA NA ROTINA DO MÊS, E ISSO É O DESENHO ══════════════════════════
 *
 * As 5 etapas da Rotina são a PRÉ-CONDIÇÃO do ato: enquanto uma delas estiver
 * aberta, o mês não fecha (decisão do Paulo — BLOQUEIA, sem justificativa que
 * fure). Pôr o botão em outra tela faria a pessoa procurar o bloqueio longe de
 * onde ele é mostrado.
 *
 * ⚠️ **E ISSO MUDA O SIGNIFICADO DO "✓ Mês fechado" QUE ESTAVA AQUI.** Aquela
 * frase era DEDUÇÃO — as 5 etapas fecharam, logo o mês fechou. Agora ela vira
 * *"pronto para dar fim de mês"*, e "fechado" passa a ser FATO, com quem,
 * quando e qual versão. Pela régua de 23/08 (o `capturaNfeOk`), o leitor do
 * booleano entra no MESMO PR — senão uma tela diz fechado e a outra diz aberto.
 *
 * ⚠️ **NENHUMA RÉGUA MORA AQUI.** A pré-condição, a versão e o direito de
 * reabrir vivem no backend. A tela exibe o que ele respondeu — cópia da régua
 * na tela é contornável, e divergiria.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    situacaoFimDeMes, darFimDeMes, reabrirCompetencia,
    type SituacaoFimDeMes, type BloqueioFimDeMes,
} from '../services/fimDeMesService';

interface Props {
    empresaId: string;
    competencia: string;
    /** Só admin reabre (decisão do Paulo) — sem isso o botão nem aparece. */
    ehAdmin?: boolean;
    /** Leva à tela da etapa que está bloqueando. */
    onIrPara?: (etapaId: string) => void;
    /** A Rotina recarrega depois de fechar/reabrir. */
    onMudou?: () => void;
}

const fmtDataHora = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
};

const FimDeMesBloco: React.FC<Props> = ({ empresaId, competencia, ehAdmin, onIrPara, onMudou }) => {
    const [sit, setSit] = useState<SituacaoFimDeMes | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [bloqueiosDaRecusa, setBloqueiosDaRecusa] = useState<BloqueioFimDeMes[]>([]);
    const [motivo, setMotivo] = useState('');
    const [pedindoMotivo, setPedindoMotivo] = useState(false);

    const carregar = useCallback(async () => {
        setErro(null);
        const r = await situacaoFimDeMes(empresaId, competencia);
        setSit(r);
        if (!r.ok) setErro(r.erro || 'Não foi possível ler a situação da competência.');
    }, [empresaId, competencia]);

    useEffect(() => { void carregar(); }, [carregar]);

    const fechar = async () => {
        // ⚠️ PERGUNTA ANTES: fechar muda o que o Contábil vai importar, e só um
        // admin desfaz. Clique fácil em ato que outra pessoa precisa reverter é
        // o desenho que a manifestação já obrigou a ter.
        if (!window.confirm(
            `Dar fim de mês em ${competencia}?\n\n`
            + 'A partir daqui os valores apurados ficam CONGELADOS e é essa a base que a '
            + 'contabilidade importa. Só um administrador reabre.',
        )) return;
        setOcupado(true); setErro(null); setBloqueiosDaRecusa([]);
        const r = await darFimDeMes(empresaId, competencia);
        setOcupado(false);
        if (!r.ok) {
            setErro(r.erro || 'Não foi possível fechar.');
            setBloqueiosDaRecusa(r.bloqueios || []);
            return;
        }
        await carregar();
        onMudou?.();
    };

    const reabrir = async () => {
        setOcupado(true); setErro(null);
        const r = await reabrirCompetencia(empresaId, competencia, motivo);
        setOcupado(false);
        if (!r.ok) { setErro(r.erro || 'Não foi possível reabrir.'); return; }
        setPedindoMotivo(false); setMotivo('');
        await carregar();
        onMudou?.();
    };

    if (!sit) {
        return <p className="text-[11px] text-slate-400">Lendo a situação da competência…</p>;
    }

    const f = sit.fechamento;
    const pre = sit.precondicao;
    // Os bloqueios da RECUSA vencem os da leitura: eles são do instante do
    // clique, e a tela não pode mostrar dois retratos do mesmo fato.
    const bloqueios = bloqueiosDaRecusa.length ? bloqueiosDaRecusa : (pre?.bloqueios || []);

    // ── FECHADA ─────────────────────────────────────────────────────────────
    if (f && f.estado === 'fechada') {
        return (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-2 space-y-1">
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    🔒 Mês fechado{f.versao > 1 ? ` · versão ${f.versao}` : ''}
                </p>
                <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                    Por {f.fechadoPor?.email || '—'} em {fmtDataHora(f.fechadoEm)}
                    {f.corte && (
                        <>
                            {' '}· acervo do corte: {f.corte.documentos.total} documento(s)
                            {f.corte.ultNSU != null && ` · NSU ${f.corte.ultNSU}`}
                        </>
                    )}
                </p>
                {/* ⚠️ O LASTRO viaja no carimbo: número fechado com zero documento
                    por trás é o caso EXPERTE, e o Contábil precisa ver isso. */}
                {f.lastro && f.lastro.cor !== 'ok' && f.lastro.situacao !== 'sem-valor' && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {f.lastro.mensagem}</p>
                )}
                <p className="text-[11px] text-emerald-900/70 dark:text-emerald-200/70">
                    É esta a base de impostos, livros, ficha financeira e da importação do Contábil.
                </p>
                {ehAdmin && !pedindoMotivo && (
                    <button
                        onClick={() => setPedindoMotivo(true)}
                        className="text-[11px] px-2 py-1 rounded border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                    >
                        🔓 Reabrir competência
                    </button>
                )}
                {ehAdmin && pedindoMotivo && (
                    <div className="space-y-1 pt-1">
                        {/* Reabrir NÃO é desfazer: é RETIFICAÇÃO. O número já pode
                            ter sido importado, e daqui a três meses ninguém lembra
                            por que o mês mudou de valor. */}
                        <p className="text-[11px] text-amber-800 dark:text-amber-300">
                            Reabrir é retificação — a contabilidade pode já ter importado a versão {f.versao}.
                            Escreva o motivo:
                        </p>
                        <textarea
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={2}
                            placeholder="Ex.: nota da GLOBAL chegou depois do corte e muda o ICMS."
                            className="w-full text-[11px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-1.5"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={reabrir}
                                disabled={ocupado}
                                className="text-[11px] px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                                {ocupado ? 'Reabrindo…' : 'Confirmar reabertura'}
                            </button>
                            <button
                                onClick={() => { setPedindoMotivo(false); setMotivo(''); setErro(null); }}
                                className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
                {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
            </div>
        );
    }

    // ── REABERTA ────────────────────────────────────────────────────────────
    if (f && f.estado === 'reaberta') {
        const ultima = f.reaberturas?.slice(-1)[0];
        return (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 space-y-1">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">🔓 Competência reaberta</p>
                <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
                    Por {ultima?.por || '—'} em {fmtDataHora(ultima?.em)} — {ultima?.motivo}
                </p>
                <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
                    A contabilidade pode estar com a versão {ultima?.versaoReaberta}. Feche de novo para
                    que ela receba o número corrigido.
                </p>
                {pre?.pode ? (
                    <button
                        onClick={fechar}
                        disabled={ocupado}
                        className="text-[11px] px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {ocupado ? 'Fechando…' : '🔒 Dar fim de mês novamente'}
                    </button>
                ) : (
                    <Bloqueios bloqueios={bloqueios} onIrPara={onIrPara} />
                )}
                {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
            </div>
        );
    }

    // ── ABERTA: pronta ou bloqueada ─────────────────────────────────────────
    if (pre?.pode) {
        return (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-2 space-y-1">
                {/* Era aqui que ficava o "✓ Mês fechado" por DEDUÇÃO. Agora ele
                    diz o que de fato é: pronto para o ato. */}
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    ✓ Pronto para dar fim de mês
                </p>
                <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                    Notas capturadas e validadas, apuração feita, obrigações entregues e guia enviada com o rito.
                </p>
                <button
                    onClick={fechar}
                    disabled={ocupado}
                    className="text-[11px] px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                    {ocupado ? 'Fechando…' : '🔒 Dar fim de mês'}
                </button>
                {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
                {bloqueiosDaRecusa.length > 0 && <Bloqueios bloqueios={bloqueiosDaRecusa} onIrPara={onIrPara} />}
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <Bloqueios bloqueios={bloqueios} onIrPara={onIrPara} />
            {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
        </div>
    );
};

/**
 * O bloqueio NOMEIA a etapa e diz ONDE se resolve.
 *
 * Trava sem caminho é trava que a equipe contorna (13/08) — e com a decisão de
 * BLOQUEAR, esta lista é a única saída que a pessoa tem.
 */
const Bloqueios: React.FC<{ bloqueios: BloqueioFimDeMes[]; onIrPara?: (id: string) => void }> = ({ bloqueios, onIrPara }) => {
    if (!bloqueios.length) return null;
    return (
        <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 p-2 space-y-1">
            <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                🔒 Fim de mês bloqueado — {bloqueios.length} etapa(s) ainda abertas:
            </p>
            {bloqueios.map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 min-w-[200px]">
                        <span className="font-semibold">{b.ordem}. {b.nome}</span>
                        {b.resumo ? ` — ${b.resumo}` : ''}
                        {b.acao && <span className="block text-blue-700 dark:text-blue-300">→ {b.acao}</span>}
                    </p>
                    {onIrPara && b.onde && (
                        <button
                            onClick={() => onIrPara(b.id)}
                            className="text-[11px] px-2 py-1 rounded border border-blue-400 text-blue-700 dark:text-blue-300 whitespace-nowrap"
                        >
                            Ir para {b.onde.split('→')[0].trim()}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};

export default FimDeMesBloco;
