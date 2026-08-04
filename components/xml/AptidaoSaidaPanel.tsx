/**
 * AptidaoSaidaPanel — "o cliente fez certo?".
 *
 * Paulo, 04/08: "como assegurar que o cliente fez correto, como podemos
 * confirmar se o cadastro já está apto conforme ele informa".
 *
 * A Cobertura de Saída olha os últimos N dias e, por isso, confunde
 * "não configurou" com "configurou e não vendeu no mês" — cobrar quem já fez
 * queima a relação. Aqui a régua é a PROVA: uma nota, de qualquer data, que
 * tenha chegado por trilho automático. Aptidão ≠ atividade.
 */
import React, { useState } from 'react';
import { getAuth } from 'firebase/auth';

interface Linha {
    empresaId: string | null;
    cnpj: string;
    nome: string;
    status: 'apto-ativo' | 'apto-sem-fluxo' | 'apto-parou' | 'sem-prova' | 'sem-saida-55';
    rotulo: string;
    apto: boolean;
    trilhos: string[];
    provaChave: string | null;
    provaData: string | null;
    provaTipo: string | null;
    diasSemReceber: number | null;
    acao: string;
}

interface Resposta {
    ok: boolean;
    error?: string;
    linhas: Linha[];
    resumo: {
        total: number; comSaida55: number; aptos: number; ativos: number;
        aptosSemFluxo: number; aptosPararam: number; semProva: number; semSaida55: number;
    };
    ressalvas: string[];
}

const CORES: Record<Linha['status'], string> = {
    'apto-ativo': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'apto-sem-fluxo': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    'apto-parou': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'sem-prova': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'sem-saida-55': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const fmtCnpj = (c: string) => {
    const d = String(c || '').replace(/\D/g, '');
    return d.length === 14
        ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
        : d;
};
const fmtData = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

const AptidaoSaidaPanel: React.FC = () => {
    const [dados, setDados] = useState<Resposta | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<'todos' | 'acao'>('acao');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada — entre de novo.');
            const r = await fetch('/api/admin/sefaz/aptidao-saida', {
                headers: { Authorization: `Bearer ${await u.getIdToken()}` },
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDados(j);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao apurar a aptidão.');
        } finally {
            setLoading(false);
        }
    };

    const visiveis = !dados ? [] : (filtro === 'acao'
        ? dados.linhas.filter(l => l.status === 'sem-prova' || l.status === 'apto-parou')
        : dados.linhas);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        ✅ O cliente fez certo? — prova de configuração da saída
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
                        <b>Aptidão não é o mesmo que atividade.</b> Uma única nota, de qualquer data, que tenha
                        chegado por trilho automático já prova que o cliente configurou — ele pode ficar meses
                        sem vender e continuar apto. A prova mais forte é o <b>CNPJ do escritório no
                        &lt;autXML&gt;</b> da nota: sem ele a SEFAZ não entrega saída ao emissor (Rejeição 641).
                    </p>
                </div>
                <button onClick={carregar} disabled={loading}
                    className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Apurando…' : '🔎 Apurar aptidão'}
                </button>
            </div>

            {erro && <p className="text-xs text-red-600">{erro}</p>}

            {dados && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {[
                            { k: 'semProva', rot: 'Sem prova — cobrar', cor: 'text-red-700 dark:text-red-400' },
                            { k: 'aptosPararam', rot: 'Apto, mas parou', cor: 'text-amber-700 dark:text-amber-400' },
                            { k: 'aptosSemFluxo', rot: 'Apto · sem venda', cor: 'text-sky-700 dark:text-sky-400' },
                            { k: 'ativos', rot: 'Apto e recebendo', cor: 'text-emerald-700 dark:text-emerald-400' },
                            { k: 'semSaida55', rot: 'Não emite mod 55', cor: 'text-slate-500' },
                        ].map(c => (
                            <div key={c.k} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
                                <p className={`text-xl font-bold font-mono ${c.cor}`}>
                                    {(dados.resumo as any)[c.k]}
                                </p>
                                <p className="text-[10px] text-slate-500">{c.rot}</p>
                            </div>
                        ))}
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        <b>{dados.resumo.aptos}</b> de <b>{dados.resumo.comSaida55}</b> clientes que emitem mod 55
                        têm configuração <b>comprovada</b>. Só os{' '}
                        <b className="text-red-700 dark:text-red-400">{dados.resumo.semProva} sem prova</b> precisam
                        receber as instruções.
                    </p>

                    <div className="flex gap-2">
                        <button onClick={() => setFiltro('acao')}
                            className={`px-3 py-1 text-[11px] rounded-lg font-semibold ${filtro === 'acao' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700'}`}>
                            Só quem precisa de ação
                        </button>
                        <button onClick={() => setFiltro('todos')}
                            className={`px-3 py-1 text-[11px] rounded-lg font-semibold ${filtro === 'todos' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700'}`}>
                            Todos
                        </button>
                        <span className="text-[11px] text-slate-500 self-center">
                            mostrando {visiveis.length} de {dados.linhas.length}
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="text-left py-1">Cliente</th>
                                    <th className="text-left">Situação</th>
                                    <th className="text-left">Prova</th>
                                    <th className="text-left">O que fazer</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visiveis.map(l => (
                                    <tr key={l.cnpj} className="border-b border-slate-100 dark:border-slate-700/50 align-top">
                                        <td className="py-1.5 pr-2">
                                            <span className="font-semibold">{l.nome}</span>
                                            <span className="block text-[10px] font-mono text-slate-400">{fmtCnpj(l.cnpj)}</span>
                                        </td>
                                        <td className="pr-2">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CORES[l.status]}`}>
                                                {l.rotulo}
                                            </span>
                                            {l.trilhos.length > 0 && (
                                                <span className="block text-[9px] text-slate-400 mt-0.5">
                                                    trilho: {l.trilhos.join(' + ')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="pr-2 text-slate-500">
                                            {l.provaChave ? (
                                                <>
                                                    <span className="block">{fmtData(l.provaData)} · {l.provaTipo}</span>
                                                    <span className="block text-[9px] font-mono text-slate-400 break-all">
                                                        {l.provaChave.slice(0, 20)}…
                                                    </span>
                                                </>
                                            ) : '—'}
                                        </td>
                                        <td className="text-slate-600 dark:text-slate-300">{l.acao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <ul className="text-[10px] text-slate-500 list-disc pl-4 space-y-0.5">
                        {dados.ressalvas.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                </>
            )}
        </div>
    );
};

export default AptidaoSaidaPanel;
