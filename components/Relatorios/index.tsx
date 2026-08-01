/**
 * Menu RELATÓRIOS — card próprio no menu principal (Paulo, 01/08).
 *
 * v1 com os 4 relatórios que a equipe tira do SAGE hoje, todos com saída em
 * PDF com a identidade da SP (casca única em services/relatorioPdf.ts):
 *   1. Livro de Entradas/Saídas (por empresa × competência)
 *   2. Faturamento por cliente/carteira
 *   3. Impostos apurados × enviados (rito #293)
 *   4. DIPAM/FUNRURAL consolidado
 *
 * Regra de dado: NENHUM relatório tem conta própria — cada aba lê o MESMO
 * endpoint/serviço da tela correspondente (lição do card 4: contador paralelo
 * mente). Livro usa a régua de direção efetiva + alocação Base/Isentos/Outras
 * do Exportar SAGE; DIPAM usa a varredura da aba 🌾; impostos usa o painel da
 * Rotina. A lista na tela é prévia — o produto final é o PDF.
 */
import React, { useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { alocarTributacaoIcms } from '../../services/iobSageExportService';
import { direcaoEfetivaDoc } from '../../sefaz-backend/xml-metadata-helper.js';
import { carregarRotinaFiscal, type PainelRotina } from '../../services/rotinaFiscalService';
import { varrerDipam, type DipamVarreduraLinha } from '../../services/dipamService';
import { carregarFaturamento, type FaturamentoResp } from '../../services/relatoriosService';
import { gerarRelatorioPdf } from '../../services/relatorioPdf';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type AbaId = 'livro' | 'faturamento' | 'impostos' | 'dipam';

const ABAS: Array<{ id: AbaId; label: string }> = [
    { id: 'livro', label: '📒 Livro Entradas/Saídas' },
    { id: 'faturamento', label: '📈 Faturamento por carteira' },
    { id: 'impostos', label: '💸 Impostos apurados × enviados' },
    { id: 'dipam', label: '🌾 DIPAM/FUNRURAL' },
];

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtComp = (c: string) => c.split('-').reverse().join('/');
const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const RelatoriosHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [aba, setAba] = useState<AbaId>('livro');
    const [competencia, setCompetencia] = useState(competenciaAtual());

    if (!currentUser) {
        return <p className="text-center text-xs text-slate-400 py-6">Faça login para acessar os Relatórios.</p>;
    }

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-5 rounded-xl text-white">
                <h2 className="text-lg font-bold">📊 Relatórios</h2>
                <p className="text-blue-100 text-sm">
                    Os relatórios do departamento em PDF com a identidade da SP — mesmos números das telas de origem.
                </p>
            </div>

            <div className="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                {ABAS.map(a => (
                    <button
                        key={a.id}
                        onClick={() => setAba(a.id)}
                        className={`px-3 py-1.5 text-xs font-bold whitespace-nowrap rounded-md transition-colors ${
                            aba === a.id
                                ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        {a.label}
                    </button>
                ))}
                <div className="ml-auto flex items-center gap-2 pr-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Competência</label>
                    <input
                        type="month"
                        value={competencia}
                        onChange={e => setCompetencia(e.target.value)}
                        className="p-1.5 text-xs rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                    />
                </div>
            </div>

            {aba === 'livro' && <AbaLivro currentUser={currentUser} competencia={competencia} onShowToast={onShowToast} />}
            {aba === 'faturamento' && <AbaFaturamento competencia={competencia} onShowToast={onShowToast} />}
            {aba === 'impostos' && <AbaImpostos competencia={competencia} onShowToast={onShowToast} />}
            {aba === 'dipam' && <AbaDipam competencia={competencia} onShowToast={onShowToast} />}
        </div>
    );
};

// ─── Helpers de UI ──────────────────────────────────────────────────────────

const BotaoPdf: React.FC<{ onClick: () => void; disabled?: boolean; gerando?: boolean }> = ({ onClick, disabled, gerando }) => (
    <button
        onClick={onClick}
        disabled={disabled || gerando}
        className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40"
    >
        {gerando ? 'Gerando…' : '📄 Baixar PDF'}
    </button>
);

const Aviso: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
        {children}
    </p>
);

// ─── 1. Livro de Entradas/Saídas ────────────────────────────────────────────

const AbaLivro: React.FC<{ currentUser: User; competencia: string; onShowToast?: (m: string) => void }> = ({ currentUser, competencia, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [empresaId, setEmpresaId] = useState('');
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    const [docs, setDocs] = useState<DocumentoFiscal[] | null>(null);
    const [truncado, setTruncado] = useState(false);
    const [loading, setLoading] = useState(false);
    const [gerando, setGerando] = useState(false);

    React.useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(l => { if (alive) setEmpresas(l); });
        return () => { alive = false; };
    }, [currentUser]);

    const empresa = empresas.find(e => e.id === empresaId) || null;

    const buscar = async () => {
        if (!empresa) { onShowToast?.('Escolha a empresa.'); return; }
        setLoading(true);
        try {
            const meta: { truncado?: boolean } = {};
            const todos = await listDocumentos(currentUser, { competencia }, meta);
            setTruncado(!!meta.truncado);
            const cnpj = empresa.cnpj.replace(/\D/g, '');
            setDocs(todos
                .filter(d => d.empresaId === empresa.id || String(d.empresaCnpj || '').replace(/\D/g, '') === cnpj)
                .filter(d => ['NFe', 'NFCe'].includes((d as any).tipoDoc || d.tipo))
                .map(d => ({ ...d, direcao: (direcaoEfetivaDoc(d) as any) || d.direcao })));
        } finally {
            setLoading(false);
        }
    };

    const linhas = useMemo(() => {
        if (!docs) return [];
        return docs
            .filter(d => d.direcao === direcao && !['cancelado', 'cancelada', 'denegado', 'inutilizado'].includes(d.status))
            .map(d => {
                const contabil = d.totais?.vNF || d.valorTotal || 0;
                const a = alocarTributacaoIcms(d.itens || [], contabil);
                const parte: any = direcao === 'saida' || String((d as any).tpNF ?? '') === '0' ? d.destinatario : d.emitente;
                const cfops = Array.from(new Set((d.itens || []).map(i => i.cfop).filter(Boolean))).join(' ');
                return {
                    data: (d.dhEmi || '').slice(0, 10).split('-').reverse().join('/'),
                    numero: d.numero || '—',
                    participante: parte?.nome || '—',
                    cfops: cfops || '—',
                    contabil, base: a.base, icms: a.icms, isentos: a.isentos, outras: a.outras, ipi: a.ipi,
                };
            })
            .sort((x, y) => x.data.localeCompare(y.data) || String(x.numero).localeCompare(String(y.numero)));
    }, [docs, direcao]);

    const totais = useMemo(() => linhas.reduce((t, l) => ({
        contabil: t.contabil + l.contabil, base: t.base + l.base, icms: t.icms + l.icms,
        isentos: t.isentos + l.isentos, outras: t.outras + l.outras, ipi: t.ipi + l.ipi,
    }), { contabil: 0, base: 0, icms: 0, isentos: 0, outras: 0, ipi: 0 }), [linhas]);

    const pdf = async () => {
        if (!empresa || linhas.length === 0) return;
        setGerando(true);
        try {
            await gerarRelatorioPdf({
                titulo: `Livro de ${direcao === 'entrada' ? 'Entradas' : 'Saídas'} — ${fmtComp(competencia)}`,
                subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} nota(s)`,
                colunas: [
                    { titulo: 'Data', largura: 8 },
                    { titulo: 'Nº NF', largura: 8 },
                    { titulo: direcao === 'entrada' ? 'Fornecedor/Remetente' : 'Cliente/Destinatário', largura: 26 },
                    { titulo: 'CFOP', largura: 8 },
                    { titulo: 'Vlr. Contábil', largura: 10, alinhamento: 'direita' },
                    { titulo: 'Base ICMS', largura: 10, alinhamento: 'direita' },
                    { titulo: 'ICMS', largura: 8, alinhamento: 'direita' },
                    { titulo: 'Isentas', largura: 10, alinhamento: 'direita' },
                    { titulo: 'Outras', largura: 10, alinhamento: 'direita' },
                    { titulo: 'IPI', largura: 7, alinhamento: 'direita' },
                ],
                linhas: linhas.map(l => [l.data, l.numero, l.participante, l.cfops, l.contabil, l.base, l.icms, l.isentos, l.outras, l.ipi]),
                totais: ['', '', `TOTAIS (${linhas.length} notas)`, '', totais.contabil, totais.base, totais.icms, totais.isentos, totais.outras, totais.ipi],
                observacoes: [
                    'Colunas Base/Isentas/Outras alocadas pela tributação de cada item (CST do XML), fechando no valor contábil — mesma régua do Exportar SAGE.',
                    ...(truncado ? ['ATENÇÃO: a leitura da competência atingiu o limite — o livro pode estar INCOMPLETO. Confira o total de notas na Central de XMLs.'] : []),
                ],
                fileName: `livro-${direcao}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
            });
        } finally {
            setGerando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[260px] flex-1">
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa</label>
                    <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId} />
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Direção</label>
                    <select
                        value={direcao}
                        onChange={e => setDirecao(e.target.value as any)}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                    >
                        <option value="entrada">Entradas</option>
                        <option value="saida">Saídas</option>
                    </select>
                </div>
                <button onClick={buscar} disabled={loading || !empresaId}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Buscando…' : '🔎 Buscar'}
                </button>
                <BotaoPdf onClick={pdf} disabled={linhas.length === 0} gerando={gerando} />
            </div>

            {truncado && <Aviso>⚠ Leitura truncada — o recorte pode estar incompleto (mostrando o que foi lido).</Aviso>}
            {docs && linhas.length === 0 && (
                <p className="text-sm text-slate-500">Nenhuma nota de {direcao} nesta competência para esta empresa.</p>
            )}
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="text-left py-1">Data</th><th className="text-left">Nº</th>
                                <th className="text-left">Participante</th><th className="text-left">CFOP</th>
                                <th className="text-right">Contábil</th><th className="text-right">Base</th>
                                <th className="text-right">ICMS</th><th className="text-right">Isentas</th>
                                <th className="text-right">Outras</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.slice(0, 100).map((l, i) => (
                                <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1">{l.data}</td><td>{l.numero}</td>
                                    <td className="max-w-[220px] truncate">{l.participante}</td><td>{l.cfops}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.contabil)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.base)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.icms)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.isentos)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.outras)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="font-bold border-t-2 border-slate-300 dark:border-slate-600">
                                <td colSpan={4} className="py-1">TOTAIS · {linhas.length} nota(s){linhas.length > 100 ? ' (prévia de 100 — o PDF sai completo)' : ''}</td>
                                <td className="text-right font-mono">{fmtBRL(totais.contabil)}</td>
                                <td className="text-right font-mono">{fmtBRL(totais.base)}</td>
                                <td className="text-right font-mono">{fmtBRL(totais.icms)}</td>
                                <td className="text-right font-mono">{fmtBRL(totais.isentos)}</td>
                                <td className="text-right font-mono">{fmtBRL(totais.outras)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
};

// ─── 2. Faturamento por cliente/carteira ────────────────────────────────────

const AbaFaturamento: React.FC<{ competencia: string; onShowToast?: (m: string) => void }> = ({ competencia }) => {
    const [dados, setDados] = useState<FaturamentoResp | null>(null);
    const [loading, setLoading] = useState(false);
    const [gerando, setGerando] = useState(false);

    const buscar = async () => {
        setLoading(true);
        try { setDados(await carregarFaturamento(competencia)); } finally { setLoading(false); }
    };

    const pdf = async () => {
        if (!dados?.ok || !dados.linhas?.length || !dados.totais) return;
        const totais = dados.totais;
        setGerando(true);
        try {
            await gerarRelatorioPdf({
                titulo: `Faturamento por cliente — ${fmtComp(competencia)}`,
                subtitulo: `${dados.linhas.length} empresa(s) com movimento · escopo: ${dados.escopo === 'carteira' ? 'sua carteira' : 'todas'}`,
                colunas: [
                    { titulo: 'Cliente', largura: 26 },
                    { titulo: 'CNPJ', largura: 12 },
                    { titulo: 'Regime', largura: 6 },
                    { titulo: 'Responsável', largura: 12 },
                    { titulo: 'Entradas (qtd)', largura: 7, alinhamento: 'direita' },
                    { titulo: 'Entradas (R$)', largura: 11, alinhamento: 'direita' },
                    { titulo: 'Saídas (qtd)', largura: 7, alinhamento: 'direita' },
                    { titulo: 'Saídas (R$)', largura: 11, alinhamento: 'direita' },
                ],
                linhas: dados.linhas.map(l => [
                    l.nome, fmtCnpj(l.cnpj), l.regime === 'simples' ? 'SN' : 'LP/LR', l.colaborador || '—',
                    l.entradasQtd, l.entradasValor, l.saidasQtd, l.saidasValor,
                ]),
                totais: [`TOTAIS · ${totais.empresas} empresa(s)`, '', '', '',
                    totais.entradasQtd, totais.entradasValor, totais.saidasQtd, totais.saidasValor],
                observacoes: [
                    'Valores das notas capturadas (canceladas fora; nota própria de entrada contada como entrada).',
                    `${dados.semMovimento} empresa(s) sem movimento na competência não listadas.`,
                    ...(dados.ignoradosSemEmpresa ? [`${dados.ignoradosSemEmpresa} documento(s) sem vínculo de empresa ficaram fora — ver "docs sem dono" na Central.`] : []),
                ],
                fileName: `faturamento-carteira-${competencia}.pdf`,
            });
        } finally {
            setGerando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <button onClick={buscar} disabled={loading}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Consolidando…' : '🔎 Consolidar competência'}
                </button>
                <BotaoPdf onClick={pdf} disabled={!dados?.ok || !dados.linhas?.length} gerando={gerando} />
            </div>
            {dados && !dados.ok && <p className="text-sm text-red-600">{dados.error}</p>}
            {dados?.ok && (
                <>
                    <p className="text-xs text-slate-500">
                        {dados.linhas!.length} empresa(s) com movimento · entradas {fmtBRL(dados.totais!.entradasValor)} · saídas {fmtBRL(dados.totais!.saidasValor)}
                        · {dados.semMovimento} sem movimento
                    </p>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800">
                                <tr>
                                    <th className="text-left py-1">Cliente</th><th className="text-left">Responsável</th>
                                    <th className="text-right">Entradas</th><th className="text-right">Saídas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dados.linhas!.map(l => (
                                    <tr key={l.empresaId} className="border-b border-slate-100 dark:border-slate-700/50">
                                        <td className="py-1 max-w-[280px] truncate">{l.nome}</td>
                                        <td>{l.colaborador || <span className="text-amber-500">sem responsável</span>}</td>
                                        <td className="text-right font-mono">{fmtBRL(l.entradasValor)} <span className="text-slate-400">({l.entradasQtd})</span></td>
                                        <td className="text-right font-mono">{fmtBRL(l.saidasValor)} <span className="text-slate-400">({l.saidasQtd})</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

// ─── 3. Impostos apurados × enviados (rito #293) ────────────────────────────

const AbaImpostos: React.FC<{ competencia: string; onShowToast?: (m: string) => void }> = ({ competencia }) => {
    const [dados, setDados] = useState<PainelRotina | null>(null);
    const [loading, setLoading] = useState(false);
    const [gerando, setGerando] = useState(false);

    const buscar = async () => {
        setLoading(true);
        try { setDados(await carregarRotinaFiscal(competencia)); } finally { setLoading(false); }
    };

    const linhas = useMemo(() => (dados?.rotinas || []).map(r => {
        const ap = r.etapas.find(e => e.id === 'apuracao');
        const gu = r.etapas.find(e => e.id === 'guias');
        return {
            nome: r.empresa?.nome || '—',
            cnpj: r.empresa?.cnpj || '',
            regime: r.empresa?.regime === 'simples' ? 'SN' : 'LP/LR',
            apurado: ap?.status === 'concluida' ? (ap?.totalImpostos ?? null) : null,
            statusApuracao: ap?.status || '—',
            envios: gu?.envios ?? 0,
            completos: gu?.completos ?? 0,
            statusGuias: gu?.status || '—',
        };
    }), [dados]);

    const pdf = async () => {
        if (!linhas.length) return;
        setGerando(true);
        try {
            const rotulo: Record<string, string> = { concluida: 'OK', atencao: 'ATENÇÃO', pendente: 'PENDENTE', na: 'N/A' };
            await gerarRelatorioPdf({
                titulo: `Impostos apurados × enviados — ${fmtComp(competencia)}`,
                subtitulo: `${linhas.length} empresa(s) · escopo: ${dados?.escopo === 'carteira' ? 'sua carteira' : 'todas'} · rito: SharePoint + gestor + baixa`,
                colunas: [
                    { titulo: 'Cliente', largura: 28 },
                    { titulo: 'CNPJ', largura: 12 },
                    { titulo: 'Regime', largura: 6 },
                    { titulo: 'Apuração', largura: 9 },
                    { titulo: 'Impostos (R$)', largura: 10, alinhamento: 'direita' },
                    { titulo: 'Envios', largura: 6, alinhamento: 'direita' },
                    { titulo: 'Rito completo', largura: 7, alinhamento: 'direita' },
                    { titulo: 'Situação guias', largura: 9 },
                ],
                linhas: linhas.map(l => [
                    l.nome, fmtCnpj(l.cnpj), l.regime,
                    rotulo[l.statusApuracao] || l.statusApuracao,
                    l.apurado ?? '—',
                    l.envios, l.completos,
                    rotulo[l.statusGuias] || l.statusGuias,
                ]),
                observacoes: [
                    'Apuração e envios saem do painel Rotina do Mês — nenhuma etapa se marca à mão; "rito completo" = cópia no SharePoint + baixa da obrigação.',
                ],
                fileName: `impostos-apurados-enviados-${competencia}.pdf`,
            });
        } finally {
            setGerando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <button onClick={buscar} disabled={loading}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Lendo o painel…' : '🔎 Consolidar competência'}
                </button>
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
            </div>
            {dados && !dados.ok && <p className="text-sm text-red-600">{dados.error}</p>}
            {linhas.length > 0 && (
                <p className="text-xs text-slate-500">
                    {linhas.length} empresa(s) · {linhas.filter(l => l.statusGuias === 'concluida').length} com guias enviadas pelo rito completo ·
                    {' '}{linhas.filter(l => l.statusApuracao !== 'concluida').length} sem apuração fechada
                </p>
            )}
        </div>
    );
};

// ─── 4. DIPAM/FUNRURAL consolidado ──────────────────────────────────────────

const AbaDipam: React.FC<{ competencia: string; onShowToast?: (m: string) => void }> = ({ competencia }) => {
    const [dados, setDados] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [gerando, setGerando] = useState(false);

    const buscar = async () => {
        setLoading(true);
        try { setDados(await varrerDipam(competencia)); } finally { setLoading(false); }
    };

    const pdf = async () => {
        const linhas: DipamVarreduraLinha[] = dados?.linhas || [];
        if (!linhas.length) return;
        setGerando(true);
        try {
            await gerarRelatorioPdf({
                titulo: `DIPAM 1.1 e FUNRURAL — ${fmtComp(competencia)}`,
                subtitulo: `${linhas.length} cliente(s) com compra de produtor rural · Manual da DIPAM 2026 (SPDIPAM11) · LC 224/2025`,
                colunas: [
                    { titulo: 'Cliente', largura: 28 },
                    { titulo: 'CNPJ', largura: 12 },
                    { titulo: 'DIPAM 1.1 (R$)', largura: 11, alinhamento: 'direita' },
                    { titulo: 'Municípios', largura: 7, alinhamento: 'direita' },
                    { titulo: 'Notas', largura: 6, alinhamento: 'direita' },
                    { titulo: 'FUNRURAL (R$)', largura: 11, alinhamento: 'direita' },
                    { titulo: 'Pendências', largura: 7, alinhamento: 'direita' },
                    { titulo: 'Situação', largura: 14 },
                ],
                linhas: linhas.map(l => [
                    l.nome, fmtCnpj(l.cnpj), l.dipamTotal, l.municipios, l.notasDipam,
                    l.funruralTotal, l.pendencias, l.farol?.resumo || '',
                ]),
                totais: [`TOTAIS · ${linhas.length} cliente(s)`, '',
                    linhas.reduce((s, l) => s + l.dipamTotal, 0), '', linhas.reduce((s, l) => s + l.notasDipam, 0),
                    linhas.reduce((s, l) => s + l.funruralTotal, 0), linhas.reduce((s, l) => s + l.pendencias, 0), ''],
                observacoes: [
                    'DIPAM 1.1: valor mensal por município paulista de origem (GIA ficha DIPAM B + Registro 1400 da EFD). FUNRURAL: sub-rogação Lei 8.212/91 art. 25 (LC 224/2025 desde 04/2026).',
                    'Cliente com pendência tem valor INCOMPLETO — resolva na aba 🌾 DIPAM / Produtor rural antes de declarar.',
                    ...(dados?.truncado ? [`${dados.truncado} cliente(s) não analisados neste lote — rode de novo na aba 🌾.`] : []),
                ],
                fileName: `dipam-funrural-${competencia}.pdf`,
            });
        } finally {
            setGerando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <button onClick={buscar} disabled={loading}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Varrendo…' : '🔎 Consolidar competência'}
                </button>
                <BotaoPdf onClick={pdf} disabled={!dados?.ok || !dados?.linhas?.length} gerando={gerando} />
            </div>
            {dados && !dados.ok && <p className="text-sm text-red-600">{dados.error}</p>}
            {dados?.ok && (
                <p className="text-xs text-slate-500">
                    {dados.linhas.length} cliente(s) com compra de produtor · DIPAM {fmtBRL(dados.linhas.reduce((s: number, l: any) => s + l.dipamTotal, 0))}
                    · FUNRURAL {fmtBRL(dados.linhas.reduce((s: number, l: any) => s + l.funruralTotal, 0))}
                    {dados.linhas.some((l: any) => l.pendencias > 0) && ' · ⚠ há pendências — resolva na aba 🌾 antes de declarar'}
                </p>
            )}
        </div>
    );
};

export default RelatoriosHub;
