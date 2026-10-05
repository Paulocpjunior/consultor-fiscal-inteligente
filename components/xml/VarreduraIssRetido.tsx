/**
 * 🔁 VARREDURA DA CARTEIRA — retenção do ISS das NFS-e do padrão nacional (05/10).
 *
 * Paulo: "faz a varredura da carteira inteira". O leitor gravava o tpRetISSQN
 * invertido; a aba ISS corrige a empresa que abre, e esta varredura corrige
 * TODAS de uma vez e diz onde a correção mudou imposto — com as guias de ISS
 * que já saíram para o cliente, que são as que precisam ser reconferidas.
 */
import React, { useState } from 'react';
import { agruparCorrecoes } from '../../sefaz-backend/nfse-iss-retido-releitura.js';
import {
    varrerCarteiraIssRetido, enviosIssDosPares, type ProgressoVarredura, type EnviosIssDoPar,
} from '../../services/nfseIssRetidoService';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const VarreduraIssRetido: React.FC = () => {
    const [rodando, setRodando] = useState(false);
    const [prog, setProg] = useState<ProgressoVarredura | null>(null);
    const [envios, setEnvios] = useState<Record<string, EnviosIssDoPar['envios']>>({});
    const [falhaEnvios, setFalhaEnvios] = useState<string | null>(null);

    const varrer = async () => {
        setRodando(true); setEnvios({}); setFalhaEnvios(null);
        const fim = await varrerCarteiraIssRetido(setProg);
        const grupos = agruparCorrecoes(fim.corrigidas);
        const pares = grupos.filter((g) => g.empresaCnpj && g.competencia)
            .map((g) => ({ empresaCnpj: String(g.empresaCnpj), competencia: String(g.competencia) }));
        if (pares.length) {
            try {
                const r = await enviosIssDosPares(pares);
                const mapa: Record<string, EnviosIssDoPar['envios']> = {};
                for (const x of r.resultado) mapa[`${x.empresaCnpj}|${x.competencia}`] = x.envios;
                setEnvios(mapa);
                if (r.falhas.length) setFalhaEnvios(`${r.falhas.length} empresa(s)/competência(s) sem a consulta de envios — confira à mão.`);
            } catch (e: any) {
                setFalhaEnvios(`Não consegui consultar as guias já enviadas (${e?.message || e}) — confira à mão.`);
            }
        }
        setRodando(false);
    };

    const grupos = prog ? agruparCorrecoes(prog.corrigidas) : [];
    const comEnvio = grupos.filter((g) => (envios[`${String(g.empresaCnpj || '').replace(/\D/g, '')}|${g.competencia}`] || []).length > 0);

    return (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10 p-4 space-y-2">
            <h4 className="text-sm font-bold text-amber-800 dark:text-amber-300">🔁 Varredura da carteira — ISS retido das NFS-e do padrão nacional</h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Até 05/10 a retenção do ISS das NFS-e nacionais foi gravada invertida. A varredura relê o XML guardado de todas as
                notas de serviço ainda não conferidas, corrige e lista onde o imposto mudou, com as guias de ISS que já saíram.
                Pode parar e rodar de novo: o que já foi relido não é lido outra vez.
            </p>
            <button onClick={() => void varrer()} disabled={rodando}
                className="btn-press px-3 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
                {rodando ? '⏳ Varrendo…' : '🔁 Varrer a carteira inteira'}
            </button>

            {prog && (
                <p className="text-[11px] text-slate-700 dark:text-slate-200">
                    {prog.examinadas} nota(s) de serviço examinada(s) · {prog.relidas} relida(s) no XML ·{' '}
                    <strong>{prog.corrigidas.length} corrigida(s)</strong> em {grupos.length} empresa(s)/competência(s)
                    {prog.falhas.length > 0 && <span className="text-red-600 dark:text-red-400"> · {prog.falhas.length} não puderam ser lidas (rode de novo)</span>}
                    {prog.concluida && ' · varredura concluída.'}
                    {prog.erro && <span className="text-red-600 dark:text-red-400"> · parou: {prog.erro} — rode de novo para continuar.</span>}
                </p>
            )}
            {falhaEnvios && <p className="text-[11px] text-red-600 dark:text-red-400">⚠ {falhaEnvios}</p>}

            {!rodando && prog?.concluida && grupos.length > 0 && (
                <>
                    {comEnvio.length > 0 && (
                        <p className="text-[11px] font-bold text-red-700 dark:text-red-400">
                            ⚠ {comEnvio.length} empresa(s)/competência(s) já tinham guia de ISS ENVIADA ao cliente — reconfira na aba ISS e reenvie se o valor mudou.
                        </p>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead>
                                <tr className="text-left text-slate-500"><th>Empresa</th><th>Competência</th><th>Notas</th><th>O que mudou</th><th>Guia de ISS já enviada</th></tr>
                            </thead>
                            <tbody>
                                {grupos.map((g) => {
                                    const env = envios[`${String(g.empresaCnpj || '').replace(/\D/g, '')}|${g.competencia}`] || [];
                                    return (
                                        <tr key={`${g.empresaId}|${g.competencia}`} className="border-t border-amber-200 dark:border-amber-800 align-top">
                                            <td className="py-1 pr-2">{g.empresaNome || g.empresaCnpj || g.empresaId}</td>
                                            <td className="pr-2">{g.competencia}</td>
                                            <td className="pr-2 whitespace-nowrap">{g.saidas > 0 && <>{g.saidas} emitida(s) </>}{g.entradas > 0 && <>{g.entradas} tomada(s)</>}</td>
                                            <td className="pr-2">{g.impactos.map((i) => <div key={i}>{i}</div>)}</td>
                                            <td className={env.length ? 'font-bold text-red-700 dark:text-red-400' : 'text-slate-500'}>
                                                {env.length
                                                    ? env.map((e, k) => <div key={k}>{e.tipo} · {e.valor != null ? brl(e.valor) : 'valor não gravado'} · {dataBr(e.enviadoEm)}</div>)
                                                    : 'nenhuma'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            {!rodando && prog?.concluida && grupos.length === 0 && (
                <p className="text-[11px] text-slate-700 dark:text-slate-200">Nenhuma nota teve a retenção alterada nesta varredura{prog.relidas === 0 ? ' — todas já estavam conferidas' : ''}.</p>
            )}
        </div>
    );
};

export default VarreduraIssRetido;
