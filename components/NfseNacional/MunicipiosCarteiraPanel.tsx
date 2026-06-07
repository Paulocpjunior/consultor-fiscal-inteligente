/**
 * MunicipiosCarteiraPanel — agregacao por municipio (UF + cidade) com
 * priorizacao para o Caminho A da Reforma (acelerar uso do Padrao Nacional).
 *
 * Cada linha mostra:
 *   - UF + Municipio (+ codigo IBGE)
 *   - Qtd empresas da carteira nesse municipio
 *   - % com ADN ativo (potencial de captura nacional)
 *   - Empresas com NFSe ja capturadas (saude da captura)
 *
 * Botao bulk: "Habilitar ADN em todas empresas dessa cidade".
 *
 * Como priorizar:
 *   1. Cidades grandes (>10 empresas) e baixo % ADN -> alto impacto.
 *   2. Cidades sem nenhuma NFSe capturada apesar de ADN ativo -> investigar
 *      adesao da prefeitura ao Padrao Nacional.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../dialog/DialogProvider';
import {
    getMunicipiosCarteira,
    toggleAdnPorMunicipio,
    type MunicipiosResposta,
    type MunicipioCobertura,
} from '../../services/nfseNacionalCoberturaService';

interface Props {
    onShowToast?: (msg: string) => void;
}

type FiltroPriorizacao = 'todos' | 'alta-prioridade' | 'sem-captura' | 'sem-adn';

const MunicipiosCarteiraPanel: React.FC<Props> = ({ onShowToast }) => {
    const confirm = useConfirm();
    const [data, setData] = useState<MunicipiosResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    const [filtro, setFiltro] = useState<FiltroPriorizacao>('todos');
    const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const r = await getMunicipiosCarteira();
            setData(r);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const linhas = useMemo<MunicipioCobertura[]>(() => {
        if (!data) return [];
        const buscaLow = busca.toLowerCase().trim();
        return data.municipios.filter(m => {
            // Filtros de priorizacao
            const pctAdn = m.qtdEmpresas ? m.qtdAdnAtivo / m.qtdEmpresas : 0;
            if (filtro === 'alta-prioridade' && (m.qtdEmpresas < 10 || pctAdn > 0.5)) return false;
            if (filtro === 'sem-captura' && m.qtdComNfse > 0) return false;
            if (filtro === 'sem-adn' && m.qtdAdnAtivo > 0) return false;
            // Busca textual
            if (!buscaLow) return true;
            return (
                m.municipio.toLowerCase().includes(buscaLow) ||
                m.uf.toLowerCase().includes(buscaLow) ||
                m.codMunIBGE.includes(buscaLow)
            );
        });
    }, [data, busca, filtro]);

    const handleHabilitarMunicipio = async (m: MunicipioCobertura) => {
        const inativas = m.qtdEmpresas - m.qtdAdnAtivo;
        if (inativas <= 0) { onShowToast?.('Todas as empresas desse municipio ja estao com ADN ativo.'); return; }
        const ok = await confirm({
            title: `Habilitar ADN em ${m.municipio}/${m.uf}?`,
            message: (
                <>
                    Vai ativar o Padrão Nacional em <b>{inativas}</b> empresa(s) inativas
                    nesse município. A ADN exige procuração eletrônica registrada na
                    Receita pra cada CNPJ. Empresas sem procuração ficarão habilitadas
                    mas vão falhar no cron — sem perda de dados.
                </>
            ),
            variant: 'warning',
            confirmLabel: 'Habilitar',
        });
        if (!ok) return;
        setAcaoEmCurso(`${m.uf}|${m.municipio}`);
        try {
            const r = await toggleAdnPorMunicipio(m.uf, m.municipio, true);
            onShowToast?.(
                `${m.municipio}/${m.uf}: ${r.atualizados}/${r.total} habilitadas`
                + (r.falhas ? ` · ${r.falhas} falha(s)` : '')
            );
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Erro: ${e?.message || 'falha'}`);
        } finally {
            setAcaoEmCurso(null);
        }
    };

    if (loading) {
        return <div className="p-6 text-center text-slate-500">Carregando municípios…</div>;
    }
    if (erro) {
        return <div className="p-6 text-center text-red-600">Erro: {erro}</div>;
    }
    if (!data) return null;

    return (
        <div className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Empresas na carteira" valor={data.total.toString()} />
                <Card label="Municípios distintos" valor={data.municipiosDistintos.toString()} />
                <Card label="ADN ativo" valor={`${data.totalAdn} (${data.percentualAdn}%)`} cor={data.percentualAdn < 50 ? 'amber' : 'emerald'} />
                <Card label="Inativas" valor={(data.total - data.totalAdn).toString()} cor="amber" />
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar UF, município ou IBGE…"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <FiltroBtn ativo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</FiltroBtn>
                <FiltroBtn ativo={filtro === 'alta-prioridade'} onClick={() => setFiltro('alta-prioridade')}>
                    🔥 Alta prioridade
                </FiltroBtn>
                <FiltroBtn ativo={filtro === 'sem-captura'} onClick={() => setFiltro('sem-captura')}>
                    Sem captura
                </FiltroBtn>
                <FiltroBtn ativo={filtro === 'sem-adn'} onClick={() => setFiltro('sem-adn')}>
                    Sem ADN
                </FiltroBtn>
                <button
                    onClick={carregar}
                    className="px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600"
                >
                    🔄 Atualizar
                </button>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase text-slate-600 dark:text-slate-400">
                        <tr>
                            <th className="px-3 py-2 text-left">UF</th>
                            <th className="px-3 py-2 text-left">Município</th>
                            <th className="px-3 py-2 text-left">IBGE</th>
                            <th className="px-3 py-2 text-right">Empresas</th>
                            <th className="px-3 py-2 text-right">ADN ativo</th>
                            <th className="px-3 py-2 text-right">% ADN</th>
                            <th className="px-3 py-2 text-right">c/ NFSe</th>
                            <th className="px-3 py-2 text-right">Σ NFSe</th>
                            <th className="px-3 py-2 text-right">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {linhas.length === 0 && (
                            <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Nenhum município encontrado.</td></tr>
                        )}
                        {linhas.map(m => {
                            const key = `${m.uf}|${m.municipio}`;
                            const pct = m.qtdEmpresas ? Math.round(100 * m.qtdAdnAtivo / m.qtdEmpresas) : 0;
                            const corPct = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
                            const inativas = m.qtdEmpresas - m.qtdAdnAtivo;
                            return (
                                <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <td className="px-3 py-2 font-bold">{m.uf}</td>
                                    <td className="px-3 py-2">{m.municipio}</td>
                                    <td className="px-3 py-2 text-xs text-slate-500">{m.codMunIBGE || '—'}</td>
                                    <td className="px-3 py-2 text-right font-bold">{m.qtdEmpresas}</td>
                                    <td className="px-3 py-2 text-right">{m.qtdAdnAtivo}</td>
                                    <td className={`px-3 py-2 text-right font-bold ${corPct}`}>{pct}%</td>
                                    <td className="px-3 py-2 text-right">{m.qtdComNfse}</td>
                                    <td className="px-3 py-2 text-right text-slate-500">{m.totalNfse}</td>
                                    <td className="px-3 py-2 text-right">
                                        {inativas > 0 && (
                                            <button
                                                onClick={() => handleHabilitarMunicipio(m)}
                                                disabled={acaoEmCurso === key}
                                                className="text-xs px-2 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                                            >
                                                {acaoEmCurso === key ? '…' : `+${inativas} ADN`}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-slate-500">
                💡 <b>Caminho A</b> da Reforma: à medida que cada município adere ao Padrão Nacional
                (cronograma LC 214/2025), basta habilitar ADN nas empresas dele e a captura passa a funcionar
                sem código novo. Cidades sem captura podem ainda não ter aderido — confira o cronograma da
                prefeitura ou da RFB.
            </p>
        </div>
    );
};

const Card: React.FC<{ label: string; valor: string; cor?: 'emerald' | 'amber' | 'red' }> = ({ label, valor, cor }) => {
    const corCls = cor === 'emerald' ? 'text-emerald-600' : cor === 'amber' ? 'text-amber-600' : cor === 'red' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100';
    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-xl font-bold ${corCls}`}>{valor}</div>
        </div>
    );
};

const FiltroBtn: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({ ativo, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-3 py-2 text-sm font-medium rounded-lg ${ativo ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
    >
        {children}
    </button>
);

export default MunicipiosCarteiraPanel;
