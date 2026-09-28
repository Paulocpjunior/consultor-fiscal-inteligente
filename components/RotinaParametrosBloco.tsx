/**
 * RotinaParametrosBloco — ⚙️ Parâmetros da Rotina do escritório (28/09).
 *
 * Paulo: "isso deve ser parametrizado — um ajuste não pode influenciar ou
 * parar outra produção". A régua mora no backend (`rotina-fiscal.js`);
 * aqui só se lê e se escolhe. Todo mundo vê qual régua está valendo;
 * só admin muda (o backend trava também).
 */
import React, { useEffect, useState } from 'react';
import {
    lerParametrosRotina, salvarParametrosRotina,
    type ParametrosRotina, type CienciaAposCompletaManual,
} from '../services/rotinaFiscalService';

interface Props { ehAdmin?: boolean; onMudou?: () => void }

const OPCOES: Array<{ valor: CienciaAposCompletaManual; rotulo: string; explica: string }> = [
    { valor: 'exigir', rotulo: 'Exigir a ciência', explica: 'A nota completada à mão sem manifestação segue como pendência da etapa 2, nomeada, com o botão 📨 Manifestar ciência.' },
    { valor: 'dispensar', rotulo: 'Dispensar a ciência', explica: 'Não é pendência. A contagem continua dita no resumo da etapa 2 ("N sem ciência manifestada — dispensada por parâmetro").' },
];

const RotinaParametrosBloco: React.FC<Props> = ({ ehAdmin, onMudou }) => {
    const [aberto, setAberto] = useState(false);
    const [param, setParam] = useState<ParametrosRotina | null>(null);
    const [gravado, setGravado] = useState<{ atualizadoEm?: string; atualizadoPor?: string | null } | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        let ativo = true;
        lerParametrosRotina().then((r) => {
            if (!ativo) return;
            if (r.ok && r.parametros) { setParam(r.parametros); setGravado(r.gravado || null); }
            else setErro(r.error || 'Não foi possível ler os parâmetros.');
        });
        return () => { ativo = false; };
    }, []);

    const escolher = async (valor: CienciaAposCompletaManual) => {
        if (!ehAdmin || !param || param.cienciaAposCompletaManual === valor) return;
        setSalvando(true); setErro(null);
        const r = await salvarParametrosRotina({ cienciaAposCompletaManual: valor });
        setSalvando(false);
        if (r.ok && r.parametros) { setParam(r.parametros); setGravado(r.gravado || null); onMudou?.(); }
        else setErro(r.error || 'Não foi possível gravar.');
    };

    const atual = OPCOES.find((o) => o.valor === param?.cienciaAposCompletaManual);
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs">
            <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                    ⚙️ Parâmetros da Rotina
                    {atual && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">· ciência após completa importada à mão: <strong>{atual.rotulo.toLowerCase()}</strong></span>}
                    {!param && !erro && <span className="ml-2 font-normal text-slate-400">· lendo…</span>}
                </span>
                <span className="text-slate-400">{aberto ? '▲' : '▼'}</span>
            </button>
            {erro && <p className="mt-1 text-red-600">{erro}</p>}
            {aberto && param && (
                <div className="mt-2 space-y-2">
                    <p className="text-slate-600 dark:text-slate-300">
                        <strong>Nota de entrada (mod 55) que era resumo da SEFAZ e foi completada à mão, ainda sem manifestação do destinatário.</strong>{' '}
                        A nota está inteira (a apuração não sai a menor); o que pode faltar é o registro fiscal da ciência.
                        Vale para todo o escritório{ehAdmin ? '' : ' — só administrador altera'}.
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                        {OPCOES.map((o) => {
                            const ativo = param.cienciaAposCompletaManual === o.valor;
                            return (
                                <button key={o.valor} type="button" disabled={!ehAdmin || salvando} onClick={() => escolher(o.valor)}
                                    className={`text-left rounded-lg border p-2 ${ativo
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                                        : 'border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50'} disabled:cursor-default`}>
                                    <div className="font-semibold text-slate-800 dark:text-slate-100">{ativo ? '● ' : '○ '}{o.rotulo}</div>
                                    <div className="text-[11px] text-slate-600 dark:text-slate-300">{o.explica}</div>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {gravado?.atualizadoEm
                            ? `Última alteração: ${new Date(gravado.atualizadoEm).toLocaleString('pt-BR')}${gravado.atualizadoPor ? ` por ${gravado.atualizadoPor}` : ''}.`
                            : 'Nunca alterado — vale o padrão (exigir).'}
                        {' '}Uma empresa pode sobrepor pelo campo <code>rotinaParametros</code> no cadastro.
                    </p>
                </div>
            )}
        </div>
    );
};

export default RotinaParametrosBloco;
