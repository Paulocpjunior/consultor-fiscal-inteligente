/**
 * components/Das/DeclararEnvioModal.tsx
 *
 * 📤 "JÁ ENVIEI ESTA GUIA POR FORA" — uma guia ou várias (Paulo, 25/09).
 *
 * A Central de DAS tem dois eixos: Pagamento (pendente → vencido → pago, e
 * "pago" só entra à mão) e Envio (o rito). Guia mandada pelo WhatsApp do
 * escritório ou por outra caixa ficava "não enviada" para sempre, e a etapa 5
 * da Rotina daquela competência ficava âmbar sobre trabalho já feito.
 *
 * Aqui a pessoa DECLARA: meio (lista do backend), data em que a guia saiu e
 * como chegou ao cliente — com o nome dela. O app NÃO envia nada, NÃO inventa
 * pagamento e NÃO sobrepõe um envio já registrado (essas guias voltam como
 * "puladas", ditas). A régua (piso do texto, data no futuro, autor) mora no
 * backend; validar aqui criaria a segunda cópia, e ela divergiria no primeiro
 * meio novo.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User, DasEmitido } from '../../types';
import { declararEnvioDasForaDoApp, formatBRL, type DeclararEnvioDasResultado } from '../../services/dasService';
import { meiosForaDoApp, type MeioForaDoApp } from '../../services/envioImpostoService';

interface Props {
    guias: DasEmitido[];
    currentUser: User | null;
    onClose: () => void;
    /** Chamado quando ao menos uma guia foi declarada — quem chama recarrega. */
    onDeclarado?: (r: DeclararEnvioDasResultado) => void;
}

const hojeIso = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DeclararEnvioModal: React.FC<Props> = ({ guias, currentUser, onClose, onDeclarado }) => {
    const [meios, setMeios] = useState<MeioForaDoApp[]>([]);
    const [meio, setMeio] = useState('');
    const [quando, setQuando] = useState(hojeIso);
    const [comoFoi, setComoFoi] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [resultado, setResultado] = useState<DeclararEnvioDasResultado | null>(null);

    // A lista vem do BACKEND — copiá-la aqui faria a tela oferecer um id que
    // o backend recusa no dia em que um meio entrar.
    useEffect(() => {
        let vivo = true;
        meiosForaDoApp()
            .then((m) => { if (vivo) setMeios(m); })
            .catch((e: any) => { if (vivo) setErro(e?.message || 'Não consegui carregar os meios.'); });
        return () => { vivo = false; };
    }, []);

    const jaComEnvio = guias.filter((g) => g.ultimoEnvioCliente).length;

    const salvar = async () => {
        setSalvando(true); setErro(null);
        try {
            const r = await declararEnvioDasForaDoApp(currentUser, {
                dasIds: guias.map((g) => g.id), meio, comoFoi, quando,
            });
            setResultado(r);
            if (r.declaradas.length > 0) onDeclarado?.(r);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao registrar.');
        } finally { setSalvando(false); }
    };

    return createPortal((
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
                data-testid="declarar-envio-modal"
            >
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">
                        📤 Já enviei {guias.length === 1 ? 'esta guia' : `estas ${guias.length} guias`} por fora
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        <span className="font-semibold">Registrar um envio que já aconteceu.</span>{' '}
                        O app <span className="font-semibold">não vai enviar nada</span> — ele grava a sua declaração,
                        com o seu nome e a data. Isso preenche a coluna Envio e fecha a etapa 5 da Rotina da competência.{' '}
                        <span className="font-semibold">O pagamento continua como está</span> até alguém marcar.
                    </p>
                </div>

                <div className="p-4 space-y-3">
                    <ul className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 max-h-40 overflow-y-auto">
                        {guias.map((g) => (
                            <li key={g.id} className="px-3 py-1.5 flex justify-between gap-2">
                                <span className="truncate">{g.empresaNome} · <span className="font-mono">{g.competencia}</span></span>
                                <span className="shrink-0 font-mono">
                                    {formatBRL(g.valor)}
                                    {g.ultimoEnvioCliente && <span className="ml-2 text-amber-600 dark:text-amber-400" title="Já tem envio registrado — a declaração não sobrepõe.">já enviada</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {jaComEnvio > 0 && !resultado && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                            {jaComEnvio} guia(s) já {jaComEnvio === 1 ? 'tem' : 'têm'} envio registrado e {jaComEnvio === 1 ? 'será pulada' : 'serão puladas'} — a declaração nunca sobrepõe um envio.
                        </p>
                    )}

                    {!resultado && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <select
                                    value={meio} onChange={(e) => setMeio(e.target.value)}
                                    aria-label="Por qual meio?"
                                    className="text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                                >
                                    <option value="">Por qual meio?</option>
                                    {meios.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                                <input
                                    type="date" value={quando} onChange={(e) => setQuando(e.target.value)}
                                    aria-label="Quando a guia saiu?"
                                    className="text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                                />
                            </div>
                            <textarea
                                value={comoFoi} onChange={(e) => setComoFoi(e.target.value)}
                                rows={2}
                                aria-label="Como a guia chegou ao cliente?"
                                placeholder="Como a guia chegou ao cliente? (esta frase é o que responde a pergunta daqui a três meses)"
                                className="w-full text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                            />
                        </>
                    )}

                    {erro && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{erro}</p>}

                    {resultado && (
                        <div className="text-xs space-y-2 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-emerald-900 dark:text-emerald-100">
                            <p className="font-semibold">✓ {resultado.resumo}</p>
                            {resultado.declaracao?.texto && <p>{resultado.declaracao.texto}</p>}
                            {resultado.puladas.length > 0 && (
                                <ul className="list-disc ml-4 text-amber-800 dark:text-amber-200">
                                    {resultado.puladas.map((p) => (
                                        <li key={p.id}>{p.empresaNome || p.id}{p.competencia ? ` · ${p.competencia}` : ''}: {p.motivo}</li>
                                    ))}
                                </ul>
                            )}
                            {resultado.erros.length > 0 && (
                                <ul className="list-disc ml-4 text-red-700 dark:text-red-300">
                                    {resultado.erros.map((p) => (
                                        <li key={p.id}>{p.empresaNome || p.id}{p.competencia ? ` · ${p.competencia}` : ''}: {p.motivo}</li>
                                    ))}
                                </ul>
                            )}
                            {resultado.declaradas.some((d) => d.rito?.baixa?.status === 'sem-tarefa') && (
                                <p className="text-amber-800 dark:text-amber-200">
                                    ⚠️ Guia(s) sem tarefa DAS em Vencimentos: o envio ficou registrado, mas a etapa 5 só fecha quando a tarefa da competência existir.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                        {resultado ? 'Fechar' : 'Cancelar'}
                    </button>
                    {!resultado && (
                        <button
                            onClick={salvar} disabled={salvando || !meio || !quando || !comoFoi.trim()}
                            className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50"
                        >
                            {salvando ? 'Registrando…' : `Registrar o envio${guias.length > 1 ? ` (${guias.length})` : ''}`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    ), document.body);
};

export default DeclararEnvioModal;
