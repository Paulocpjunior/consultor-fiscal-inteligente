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
import React, { useState } from 'react';
// ⚠️ AQUI SÓ ENTRAM OS **ATOS** (fechar/reabrir). A LEITURA saiu de propósito:
// este bloco é renderizado uma vez por EMPRESA, e um `fetch` no mount virava
// ~400 requisições simultâneas ao abrir a Rotina do Mês — foi o **HTTP 429** do
// print de 27/08. O estado chega por PROPS, do painel, que já lê tudo numa
// leitura só. Ver `lerFechamentosDaCompetencia`.
import {
    darFimDeMes, reabrirCompetencia,
    type FechamentoCompetencia, type BloqueioFimDeMes,
} from '../services/fimDeMesService';
// 📋 A porta do envio DECLARADO. Ela é um ATO (um clique por vez), como
// fechar e reabrir — a leitura continua vindo por props.
import { registrarEnvioForaDoApp, meiosForaDoApp, type MeioForaDoApp } from '../services/envioImpostoService';
// 📋 A porta da COBERTURA declarada — a obrigação que o catálogo não cobre.
import { declararCoberturaForaDoCatalogo } from '../services/rotinaFiscalService';

interface Props {
    empresaId: string;
    competencia: string;
    /** Para a declaração de envio fora do app (auditoria por CNPJ). */
    empresaCnpj?: string;
    empresaNome?: string;
    /** O carimbo, vindo do painel — NUNCA buscado aqui (ver o 429 acima). */
    fechamento?: FechamentoCompetencia | null;
    /** Os bloqueios, derivados das etapas que o painel já calculou. */
    bloqueios: BloqueioFimDeMes[];
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

const FimDeMesBloco: React.FC<Props> = ({
    empresaId, competencia, empresaCnpj, empresaNome,
    fechamento: f, bloqueios: bloqueiosDoPainel,
    ehAdmin, onIrPara, onMudou,
}) => {
    const [ocupado, setOcupado] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [bloqueiosDaRecusa, setBloqueiosDaRecusa] = useState<BloqueioFimDeMes[]>([]);
    const [motivo, setMotivo] = useState('');
    const [pedindoMotivo, setPedindoMotivo] = useState(false);

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
        // Quem recarrega é o PAINEL — uma leitura para a tela toda. Recarregar
        // aqui seria a leitura por empresa voltando pela porta de trás.
        onMudou?.();
    };

    const reabrir = async () => {
        setOcupado(true); setErro(null);
        const r = await reabrirCompetencia(empresaId, competencia, motivo);
        setOcupado(false);
        if (!r.ok) { setErro(r.erro || 'Não foi possível reabrir.'); return; }
        setPedindoMotivo(false); setMotivo('');
        onMudou?.();
    };

    // 📋 A porta do envio declarado, montada UMA vez e passada aos três ramos.
    const declarar = (
        <DeclararEnvio
            empresaId={empresaId} empresaCnpj={empresaCnpj} empresaNome={empresaNome}
            competencia={competencia} onMudou={onMudou}
        />
    );

    // Os bloqueios da RECUSA vencem os do painel: eles são do instante do
    // clique, e a tela não pode mostrar dois retratos do mesmo fato.
    const bloqueios = bloqueiosDaRecusa.length ? bloqueiosDaRecusa : bloqueiosDoPainel;

    // 📋 A porta da cobertura, montada com as obrigações que o BACKEND nomeou.
    // A lista vem do bloqueio — escrevê-la aqui faria a tela declarar quitação
    // sobre um nome que a leitura não reconhece, e a trava voltaria calada.
    const bloqueioCobertura = bloqueios.find(
        (b) => b.id === 'obrigacoes' && b.podeDeclararCobertura === true,
    );
    const declararCobertura = bloqueioCobertura ? (
        <DeclararCobertura
            empresaId={empresaId} empresaCnpj={empresaCnpj} competencia={competencia}
            obrigacoes={bloqueioCobertura.propostas || []} onMudou={onMudou}
        />
    ) : null;
    const pre = { pode: bloqueiosDoPainel.length === 0 };

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
                    <Bloqueios bloqueios={bloqueios} onIrPara={onIrPara} declarar={declarar} declararCobertura={declararCobertura} />
                )}
                {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
            </div>
        );
    }

    // ── ABERTA: pronta ou bloqueada ─────────────────────────────────────────
    if (pre?.pode) {
        // ═══════════════════════════════════════════════════════════════════
        // 🚨 UMA AFIRMAÇÃO QUE O APP ACABOU DE DESMENTIR NÃO FICA NA TELA.
        //
        // Print do Paulo (27/08, REGINA CELIA): "✓ Pronto para dar fim de mês"
        // em VERDE com a recusa em VERMELHO logo abaixo. O `pre.pode` sai das
        // ETAPAS que o painel leu; o ato recusa por OUTRAS razões também
        // (competência ilegível, mês já fechado, sem apuração) — e nenhuma
        // delas é bloqueio de etapa, então a caixa continuava se dizendo
        // pronta enquanto a linha de baixo dizia o contrário.
        //
        // Isto é INDEPENDENTE da causa daquele print (que era o Simples sem
        // ficha, corrigido no backend): é a classe. Qualquer recusa futura que
        // não seja bloqueio de etapa cairia na mesma contradição.
        // ═══════════════════════════════════════════════════════════════════
        const recusouSemBloqueio = !!erro && bloqueiosDaRecusa.length === 0;
        return (
            <div className={`rounded-lg border p-2 space-y-1 ${
                recusouSemBloqueio
                    ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
            }`}>
                {/* Era aqui que ficava o "✓ Mês fechado" por DEDUÇÃO. Agora ele
                    diz o que de fato é: pronto para o ato — e para de dizê-lo
                    no instante em que o ato prova que não estava. */}
                {recusouSemBloqueio ? (
                    <>
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                            ⚠ O fim de mês foi RECUSADO
                        </p>
                        <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
                            As cinco etapas estão fechadas, mas o ato não passou — o motivo está abaixo.
                            Nenhuma etapa está bloqueando: é outra coisa.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                            ✓ Pronto para dar fim de mês
                        </p>
                        <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                            Notas capturadas e validadas, apuração feita, obrigações entregues e guia enviada com o rito.
                        </p>
                    </>
                )}
                <button
                    onClick={fechar}
                    disabled={ocupado}
                    className="text-[11px] px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                    {ocupado ? 'Fechando…' : '🔒 Dar fim de mês'}
                </button>
                {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
                {bloqueiosDaRecusa.length > 0 && <Bloqueios bloqueios={bloqueiosDaRecusa} onIrPara={onIrPara} declarar={declarar} declararCobertura={declararCobertura} />}
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <Bloqueios bloqueios={bloqueios} onIrPara={onIrPara} declarar={declarar} declararCobertura={declararCobertura} />
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
/**
 * 📋 DECLARAR UM ENVIO QUE ACONTECEU FORA DO APP.
 *
 * Paulo, 27/08 (AC MASON): *"a obrigação já foi entregue e as guias enviadas
 * para o cliente"* — e a etapa 5 travava o fim de mês, porque reenviar pelo app
 * DUPLICARIA a guia no cliente.
 *
 * ⚠️ **NENHUMA RÉGUA MORA AQUI.** O piso do texto, a lista de meios e a recusa
 * de data no futuro vivem no backend (`envio-fora-do-app.js`). Esta tela DIZ o
 * que o backend respondeu — validar aqui criaria a segunda cópia, e ela
 * divergiria no primeiro meio novo.
 */
const DeclararEnvio: React.FC<{
    empresaId: string; empresaCnpj?: string; empresaNome?: string; competencia: string;
    onMudou?: () => void;
}> = ({ empresaId, empresaCnpj, empresaNome, competencia, onMudou }) => {
    const [aberto, setAberto] = useState(false);
    const [meios, setMeios] = useState<MeioForaDoApp[]>([]);
    const [tipo, setTipo] = useState('');
    const [meio, setMeio] = useState('');
    const [comoFoi, setComoFoi] = useState('');
    const [quando, setQuando] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [feito, setFeito] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);

    // A lista vem do BACKEND — copiá-la aqui faria a tela oferecer um id que
    // o backend recusa no dia em que um meio entrar.
    const abrir = async () => {
        setAberto(true);
        if (meios.length) return;
        try { setMeios(await meiosForaDoApp()); } catch (e: any) { setErro(e?.message || 'Não consegui carregar os meios.'); }
    };

    const salvar = async () => {
        if (!empresaCnpj) { setErro('Empresa sem CNPJ legível — não dá para registrar o envio.'); return; }
        setSalvando(true); setErro(null);
        try {
            const r = await registrarEnvioForaDoApp({
                empresaId, empresaCnpj, empresaNome: empresaNome || '',
                tipo: tipo.trim().toUpperCase(), competencia,
                meio, comoFoi, quando,
            });
            if (!r.ok) { setErro(r.error || 'Não consegui registrar.'); return; }
            // A frase do backend DIZ que o app não enviou — mostrá-la é o que
            // impede alguém de ler isto como "o app mandou a guia".
            setFeito(r.declaracao?.texto || 'Envio registrado.');
            setComoFoi(''); setTipo('');
            onMudou?.();
        } catch (e: any) {
            setErro(e?.message || 'Falha ao registrar.');
        } finally { setSalvando(false); }
    };

    if (!aberto) {
        return (
            <button
                onClick={abrir}
                className="text-[11px] px-2 py-1 rounded border border-slate-400 text-slate-700 dark:text-slate-200"
            >
                📋 Já enviei esta guia por fora — registrar
            </button>
        );
    }

    return (
        <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-2 space-y-2">
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-semibold">Registrar um envio que já aconteceu.</span>{' '}
                O app <span className="font-semibold">não vai enviar nada</span> — ele grava a sua
                declaração, com o seu nome e a data, e o envio fica marcado como{' '}
                <span className="font-semibold">sem prova de entrega</span>.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                    value={tipo} onChange={(e) => setTipo(e.target.value)}
                    placeholder="Guia (DAS, DARF, DARE…)"
                    className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
                <select
                    value={meio} onChange={(e) => setMeio(e.target.value)}
                    className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                >
                    <option value="">Por qual meio?</option>
                    {meios.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <input
                    type="date" value={quando} onChange={(e) => setQuando(e.target.value)}
                    className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
            </div>
            <textarea
                value={comoFoi} onChange={(e) => setComoFoi(e.target.value)}
                rows={2}
                placeholder="Como a guia chegou ao cliente? (esta frase é o que responde a pergunta daqui a três meses)"
                className="w-full text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            />
            {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
            {feito && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">✓ {feito}</p>}
            <div className="flex gap-2">
                <button
                    onClick={salvar} disabled={salvando}
                    className="text-[11px] px-3 py-1.5 rounded bg-slate-700 text-white disabled:opacity-50"
                >
                    {salvando ? 'Registrando…' : 'Registrar o envio'}
                </button>
                <button onClick={() => setAberto(false)} className="text-[11px] px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600">
                    Cancelar
                </button>
            </div>
        </div>
    );
};

/**
 * 📋 DECLARAR A ENTREGA DE UMA OBRIGAÇÃO QUE O CATÁLOGO NÃO COBRE.
 *
 * Paulo, 28/08 (CLINICA MEDICA MANTOAN): *"pra encerrar o mês essas duas etapas
 * está como se não tivesse feita"*. A etapa 4 acusava *"o catálogo NÃO cobre 1
 * obrigação: INSS Patronal (depende de folha)"* — e ela NUNCA ia fechar, porque
 * a folha vive no módulo de DP.
 *
 * ⚠️ **A LISTA VEM DO BACKEND**, não de um campo livre: é ela que a leitura
 * compara depois (`coberturaDeclarada`). Deixar a pessoa escrever o nome faria
 * a declaração passar aqui e a trava continuar de pé, calada.
 *
 * ⚠️ E NENHUMA RÉGUA MORA AQUI — piso do texto, data no futuro e autor são do
 * módulo puro.
 */
const DeclararCobertura: React.FC<{
    empresaId: string; empresaCnpj?: string; competencia: string;
    obrigacoes: string[]; onMudou?: () => void;
}> = ({ empresaId, empresaCnpj, competencia, obrigacoes, onMudou }) => {
    const [aberto, setAberto] = useState(false);
    const [comoFoi, setComoFoi] = useState('');
    const [quando, setQuando] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [feito, setFeito] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);

    const salvar = async () => {
        setSalvando(true); setErro(null);
        try {
            const r = await declararCoberturaForaDoCatalogo({
                empresaId, empresaCnpj, competencia, obrigacoes, comoFoi, quando,
            });
            if (!r.ok) { setErro(r.error || 'Não consegui registrar.'); return; }
            // A frase do backend DIZ que o app não tem prova da entrega — é ela
            // que impede alguém de ler isto como "o app entregou".
            setFeito(r.declaracao?.texto || 'Entrega declarada.');
            setComoFoi('');
            onMudou?.();
        } catch (e: any) {
            setErro(e?.message || 'Falha ao registrar.');
        } finally { setSalvando(false); }
    };

    if (!aberto) {
        return (
            <button
                onClick={() => setAberto(true)}
                className="text-[11px] px-2 py-1 rounded border border-slate-400 text-slate-700 dark:text-slate-200"
            >
                📋 Já entreguei estas obrigações por fora — registrar
            </button>
        );
    }

    return (
        <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-2 space-y-2">
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-semibold">Registrar a entrega destas obrigações:</span>{' '}
                {obrigacoes.join(', ')}. O app <span className="font-semibold">não as acompanha</span> —
                elas não viram tarefa automática e ele <span className="font-semibold">não tem prova
                da entrega</span>. Fica gravado o seu nome e a data.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                    type="date" value={quando} onChange={(e) => setQuando(e.target.value)}
                    className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
            </div>
            <textarea
                value={comoFoi} onChange={(e) => setComoFoi(e.target.value)}
                rows={2}
                placeholder="Como foram entregues? (esta frase é o que responde a pergunta daqui a três meses)"
                className="w-full text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            />
            {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
            {feito && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">✓ {feito}</p>}
            <div className="flex gap-2">
                <button
                    onClick={salvar} disabled={salvando}
                    className="text-[11px] px-3 py-1.5 rounded bg-slate-700 text-white disabled:opacity-50"
                >
                    {salvando ? 'Registrando…' : 'Registrar a entrega'}
                </button>
                <button onClick={() => setAberto(false)} className="text-[11px] px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600">
                    Cancelar
                </button>
            </div>
        </div>
    );
};

const Bloqueios: React.FC<{
    bloqueios: BloqueioFimDeMes[];
    onIrPara?: (id: string) => void;
    /** 📋 A porta do envio declarado — só aparece quando a GUIA é o bloqueio. */
    declarar?: React.ReactNode;
    /** 📋 A porta da cobertura — só quando a OBRIGAÇÃO fora do catálogo trava. */
    declararCobertura?: React.ReactNode;
}> = ({ bloqueios, onIrPara, declarar, declararCobertura }) => {
    if (!bloqueios.length) return null;
    // ⚠️ E só quando declarar RESOLVE: se o app já enviou a guia e o que falta
    // é o rito, oferecer "já enviei por fora" convida a declarar o que o app
    // fez (Paulo, 27/08, VINCENZO: *"ESSE FOI ENVIADO PELO SISTEMA"*). Quem
    // decide é a etapa — a tela não reimplementa a pergunta.
    const travaGuia = bloqueios.some((b) => b.id === 'guias' && b.podeDeclararEnvio !== false);
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
            {/* 📋 A SAÍDA NASCE ONDE A TRAVA APARECE (Paulo autorizou em 27/08).
                Trava sem caminho é trava que a equipe contorna — e aqui o
                contorno seria mandar a guia DE NOVO ao cliente. Só aparece
                quando é a GUIA que bloqueia: oferecê-la ao lado de "falta
                capturar" convidaria a declarar o que não foi feito. */}
            {travaGuia && declarar}
            {/* 📋 A MESMA régua, na etapa 4: a porta só aparece onde ela
                RESOLVE. Quem decide é o backend (`podeDeclararCobertura`) —
                oferecê-la sobre regime indefinido ou prazo de outra UF faria
                alguém declarar por cima de um cadastro que dá para arrumar. */}
            {declararCobertura}
        </div>
    );
};

export default FimDeMesBloco;
