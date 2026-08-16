/**
 * PrazoIssModal — a data do ISS pedida NA HORA, não numa fila de admin.
 *
 * Paulo, 16/08: *"eu não vou fazer nada manual. Você deve, como nos demais
 * impostos, se atualizar automaticamente; no caso de ISS de outra cidade, deve
 * abrir o modal de data de vencimento para que o colaborador insira a data na
 * hora do cálculo e geração da guia — assim eliminamos esta pendência e
 * seguimos para o próximo."*
 *
 * ═══ A INVERSÃO ════════════════════════════════════════════════════════════
 *
 * O calendário deixa de ser 57 cidades para alguém preencher ANTES que o mês
 * funcione, e passa a se preencher pelo trabalho que já acontece. Quem informa
 * a data de Jundiaí é quem gera a guia de Jundiaí — uma vez. No mês seguinte
 * ninguém pergunta de novo, porque virou o calendário da cidade.
 *
 * ═══ O QUE ESTE MODAL NÃO FAZ ══════════════════════════════════════════════
 *
 * Não sugere um dia. Nem o do mês passado, nem o da cidade vizinha, nem o de
 * São Paulo. Campo de prazo não recebe default — a única coisa pré-preenchida
 * aqui é o que a CONSULTA COM FONTE trouxer, e mesmo essa vem com o link para
 * conferir e marcada quando a fonte não é oficial.
 */
import React, { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

export interface AlvoPrazoIss {
    empresaNome: string;
    codMunIBGE: string;
    municipioNome?: string | null;
    uf?: string | null;
    /** 'AAAA-MM' — a vigência começa AQUI e nunca retroage. */
    competencia: string;
}

interface Props {
    alvo: AlvoPrazoIss;
    onClose: () => void;
    /** Chamado depois de gravar — quem abriu recarrega o que precisa. */
    onInformado?: (diaVencimento: number) => void;
}

const PrazoIssModal: React.FC<Props> = ({ alvo, onClose, onInformado }) => {
    const [dia, setDia] = useState('');
    const [mesesApos, setMesesApos] = useState('1');
    const [erro, setErro] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [proposta, setProposta] = useState<any>(null);
    const [consultando, setConsultando] = useState(false);

    const token = async () => {
        const u = getAuth().currentUser;
        if (!u) throw new Error('Sessão expirada — entre novamente.');
        return u.getIdToken();
    };

    // A CONSULTA RODA SOZINHA ao abrir: é o "se atualizar automaticamente" que
    // o Paulo pediu. Ela PROPÕE — quem confirma é quem está com a guia na mão.
    useEffect(() => {
        let vivo = true;
        (async () => {
            setConsultando(true);
            try {
                const r = await fetch('/api/admin/prazos-municipais/consultar', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        codMunIBGE: alvo.codMunIBGE, municipioNome: alvo.municipioNome,
                        uf: alvo.uf, obrigacao: 'ISS',
                    }),
                });
                const j = await r.json().catch(() => ({}));
                if (!vivo) return;
                setProposta(j);
                // Pré-preenche SÓ o que veio com fonte. Sem proposta, o campo
                // fica vazio — nunca com um dia "provável".
                if (j?.ok && j.proposta?.diaVencimento) {
                    setDia(String(j.proposta.diaVencimento));
                    setMesesApos(String(j.proposta.mesesApos ?? 1));
                }
            } catch {
                if (vivo) setProposta(null);
            } finally {
                if (vivo) setConsultando(false);
            }
        })();
        return () => { vivo = false; };
    }, [alvo.codMunIBGE]);

    const salvar = async () => {
        setErro(null);
        const d = Number(dia);
        if (!Number.isInteger(d) || d < 1 || d > 31) {
            setErro('Informe o dia do vencimento (1 a 31).');
            return;
        }
        setSalvando(true);
        try {
            const r = await fetch('/api/admin/prazos-municipais/informar', {
                method: 'POST',
                headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codMunIBGE: alvo.codMunIBGE,
                    municipioNome: alvo.municipioNome,
                    uf: alvo.uf,
                    obrigacao: 'ISS',
                    diaVencimento: d,
                    mesesApos: Number(mesesApos) || 1,
                    competencia: alvo.competencia,
                }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) { setErro(j.error || `HTTP ${r.status}`); return; }
            onInformado?.(d);
            onClose();
        } catch (e: any) {
            setErro(e?.message || 'falha ao gravar');
        } finally { setSalvando(false); }
    };

    const campo = 'w-full p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600';
    const rotulo = 'text-[10px] uppercase font-bold block mb-1 text-slate-500 dark:text-slate-400';
    const cidade = alvo.municipioNome || `IBGE ${alvo.codMunIBGE}`;

    return (
        // `overflow-y-auto` + `items-start`: com a consulta trazendo várias
        // fontes o modal cresce, e com `items-center` puro o excesso transborda
        // para cima e para baixo — os botões "Informar" somem sem scroll. A
        // trava de layout do projeto pegou isto antes de subir.
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
            onClick={onClose}>
            <div className="w-full max-w-lg my-auto rounded-xl bg-white dark:bg-slate-800 p-5 space-y-3"
                onClick={(e) => e.stopPropagation()}>
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        🏛️ Quando vence o ISS de {cidade}?
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Não existe “dia do ISS” nacional — cada prefeitura tem o seu, e o do <strong>{cidade}</strong> ainda
                        não está no CFI. Informe uma vez: a partir da competência <strong>{alvo.competencia}</strong> isso
                        vira o calendário da cidade e <strong>ninguém pergunta de novo</strong>, nem para {alvo.empresaNome}
                        {' '}nem para os outros clientes de lá.
                    </p>
                </div>

                {/* A CONSULTA COM FONTE roda sozinha — é ela que faz o app "se
                    atualizar automaticamente". Proposta sem fonte é recusada no
                    backend, então aqui ou vem com link, ou não vem. */}
                {consultando && (
                    <p className="text-[11px] text-violet-700 dark:text-violet-400">🔎 procurando o calendário oficial…</p>
                )}
                {!consultando && proposta?.ok && (
                    <div className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-2.5 space-y-1">
                        <p className="text-[11px] text-violet-900 dark:text-violet-200">
                            Encontrado: dia <strong>{proposta.proposta.diaVencimento}</strong>
                            {proposta.proposta.baseLegal && <> · {proposta.proposta.baseLegal}</>} — já preenchido abaixo.
                            <strong> Confira antes de salvar.</strong>
                        </p>
                        {(proposta.avisos || []).map((a: string, i: number) => (
                            <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {a}</p>
                        ))}
                        {(proposta.fontes || []).map((f: any, i: number) => (
                            <p key={i} className="text-[11px]">
                                <a href={f.uri} target="_blank" rel="noreferrer"
                                    className="text-blue-600 dark:text-blue-400 underline break-all">{f.title}</a>
                                {f.oficial
                                    ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">oficial</span>
                                    : <span className="ml-1 text-amber-600 dark:text-amber-400">não oficial</span>}
                            </p>
                        ))}
                    </div>
                )}
                {!consultando && proposta && !proposta.ok && (
                    // Recusa NÃO vira campo pré-preenchido com chute: o campo
                    // fica vazio e a pessoa informa o que ELA sabe.
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        A busca não trouxe um calendário confiável ({proposta.motivo || proposta.error}). Informe o dia que
                        você usa para pagar — é você quem gera essa guia todo mês.
                    </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={rotulo}>Dia do vencimento</label>
                        <input value={dia} onChange={(e) => setDia(e.target.value)} className={campo}
                            placeholder="ex.: 10" inputMode="numeric" autoFocus />
                    </div>
                    <div>
                        <label className={rotulo}>Vence em</label>
                        <select value={mesesApos} onChange={(e) => setMesesApos(e.target.value)} className={campo}>
                            <option value="1">no mês SEGUINTE à competência</option>
                            <option value="0">no PRÓPRIO mês da competência</option>
                            <option value="2">dois meses depois</option>
                        </select>
                    </div>
                </div>

                {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}

                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Fica gravado com o seu nome e a data. Vale a partir de {alvo.competencia} —
                    competências anteriores continuam com a regra que valia nelas.
                </p>

                <div className="flex gap-2 justify-end">
                    <button onClick={onClose}
                        className="btn-press px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                        Agora não
                    </button>
                    <button onClick={salvar} disabled={salvando}
                        className="btn-press px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                        {salvando ? '⏳ gravando…' : 'Informar e continuar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PrazoIssModal;
