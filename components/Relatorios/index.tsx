/**
 * Menu RELATÓRIOS — card próprio no menu principal (Paulo, 01/08).
 *
 * Lista de relatórios definida pelo Paulo (01/08, espelho do que a equipe tira
 * do E-Fiscal): Livro de Entradas/Saídas · Resumo por CFOP · ICMS/IPI/ISS ·
 * Serviços tomados · Serviços prestados · Retenções · Resumo por UF · Ficha
 * Financeira — mais os gerenciais (Faturamento por carteira, Impostos
 * apurados × enviados, DIPAM/FUNRURAL). Saída: PDF com a identidade da SP
 * (casca única em services/relatorioPdf.ts).
 *
 * Regras estruturais:
 *  - relatório NUNCA tem conta própria — as agregações vivem em
 *    services/relatoriosAgregacoes.ts (puras, testadas) sobre os MESMOS docs
 *    das telas, com a MESMA alocação Base/Isentos/Outras do Exportar SAGE;
 *  - o recorte (empresa × competência) é buscado UMA vez e serve todas as
 *    abas de movimento — trocar de aba não relê o banco;
 *  - farol honesto: leitura truncada e retenções não gravadas (docs antigos)
 *    aparecem na tela E no PDF.
 */
import React, { useMemo, useState } from 'react';
import type { User, DocumentoFiscal, LucroPresumidoEmpresa } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, getIdentificacaoEmpresa, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
// Régua ÚNICA de correlação — a mesma do Exportar SAGE e do modal de CFOP.
import {
    correlacionarCfop, resolverNaturezaAtividade, cfopDoLancamento,
    origemDoCfopLancamento, cfopsDistintosDaNota, validarCfopEscriturado,
} from '../../sefaz-backend/cfop-correlacao.js';
import { alocarTributacaoIcms } from '../../services/iobSageExportService';
import { direcaoEfetivaDoc } from '../../sefaz-backend/xml-metadata-helper.js';
import {
    resumoPorCfop, resumoImpostos, linhasServicos, linhasRetencoes, diagnosticoRetencoes, resumoPorUf, servicosPorCodigo,
    nfCanceladasFaltantes, formatarFaixas, resumoPorParticipante, resumoPorAliquota, resumoPorProduto,
    contraparteDoc, docValido, lerFaltantes,
} from '../../services/relatoriosAgregacoes';
import { reconferirCancelamento } from '../../services/reconferirCancelamentoService';
import { carregarRotinaFiscal, type PainelRotina } from '../../services/rotinaFiscalService';
import { varrerDipam, type DipamVarreduraLinha } from '../../services/dipamService';
import { carregarFaturamento, carregarFaturamentoMensal, type FaturamentoResp } from '../../services/relatoriosService';
import { mesesDoPeriodo, montarMeses, totalDeclaracao, avisosDaDeclaracao, type MesDeclaracao } from '../../services/declaracaoFaturamento';
import { montarApuracaoTrimestre, trimestresDisponiveis } from '../../services/apuracaoTrimestral';
import { calcularLucro } from '../../services/lucroService';
import { convertFichaToInput, getRetencoesAcumuladasTrimestre } from '../LucroPresumidoReal/fichaCalc';
import { gerarRelatorioPdf, gerarDeclaracaoFaturamentoPdf, montarIdentificacao, type IdentificacaoPdf } from '../../services/relatorioPdf';
import * as lucroPresumidoService from '../../services/lucroPresumidoService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type AbaId =
    | 'livro' | 'cfop' | 'impostos-resumo' | 'uf'
    | 'canceladas' | 'aliquota' | 'produto' | 'participante' | 'cfop-nota'
    | 'serv-tomados' | 'serv-prestados' | 'serv-codigo' | 'retencoes'
    | 'faturamento' | 'declaracao' | 'impostos-enviados' | 'dipam' | 'ficha' | 'trimestre';

import { livroSemNotaDeProdutorDuplicada } from '../../services/livroNotaProdutor';
import {
    gravarCfopEscriturado, lerParametrosCfop, gravarParametroCfop, desligarParametroCfop,
    type ParametroCfopDoc,
} from '../../services/cfopEscrituradoService';
// 🧠 O CÉREBRO: o que alguém corrigiu numa nota vira parâmetro do FORNECEDOR.
import { sugerirParametro } from '../../sefaz-backend/cfop-cerebro.js';
// MESMO painel do modal 🔗 — o cérebro tem UMA casa (Paulo, 18/08).
import CfopCerebroPainel, { type FornecedorOpcao } from '../CfopCerebroPainel';
// A descrição oficial vai JUNTO do número: foi por não vê-la que um 1101 numa
// nota de material de escritório passaria batido (Paulo, 17/08, caso Kalunga).
import { textoDoCfop, FONTE_CFOP, cfopsInexistentes } from '../../sefaz-backend/cfop-catalogo.js';

const GRUPOS: Array<{ titulo: string; abas: Array<{ id: AbaId; label: string }> }> = [
    {
        titulo: 'Movimento (por empresa)', abas: [
            { id: 'livro', label: '📒 Livro Entradas/Saídas' },
            { id: 'cfop', label: '🔢 Resumo por CFOP' },
            { id: 'cfop-nota', label: '✏️ CFOP por nota' },
            { id: 'impostos-resumo', label: '🧾 ICMS · IPI · ISS' },
            { id: 'uf', label: '🗺️ Resumo por UF' },
            { id: 'canceladas', label: '🚫 Canceladas/Faltantes' },
            { id: 'aliquota', label: '➗ Por alíquota' },
            { id: 'produto', label: '📦 Por produto' },
            { id: 'participante', label: '👥 Por participante' },
        ],
    },
    {
        titulo: 'Serviços (por empresa)', abas: [
            { id: 'serv-tomados', label: '🛠️ Serviços tomados' },
            { id: 'serv-prestados', label: '🧰 Serviços prestados' },
            { id: 'serv-codigo', label: '🔣 Por código de serviço' },
            { id: 'retencoes', label: '✂️ Retenções' },
        ],
    },
    {
        titulo: 'Gerencial', abas: [
            { id: 'faturamento', label: '📈 Faturamento por carteira' },
            { id: 'declaracao', label: '📄 Declaração de faturamento' },
            { id: 'impostos-enviados', label: '💸 Apurados × enviados' },
            { id: 'dipam', label: '🌾 DIPAM/FUNRURAL' },
            { id: 'ficha', label: '📑 Ficha Financeira (Lucro)' },
            { id: 'trimestre', label: '🧮 Apuração trimestral (Presumido)' },
        ],
    },
];

const ABAS_POR_EMPRESA: AbaId[] = [
    'livro', 'cfop', 'cfop-nota', 'impostos-resumo', 'uf',
    'canceladas', 'aliquota', 'produto', 'participante',
    'serv-tomados', 'serv-prestados', 'serv-codigo', 'retencoes',
];

/**
 * Empresas do módulo Lucro no formato do EmpresaSearchSelect — para a busca
 * por CÓDIGO valer aqui também (Paulo, 04/08: "todos os campos que contenham
 * consulta nome e cnpj agora devem aceitar código, nome, cnpj").
 */
const opcoesLucro = (lista: any[]): EmpresaXmlOption[] => (lista || []).map((e) => ({
    id: e.id,
    nome: e.nome,
    cnpj: e.cnpj,
    fonte: 'lucro',
    codCliente: e.codCliente ?? e.dadosFiscais?.codCliente,
} as EmpresaXmlOption));

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
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    // NASCE NA EMPRESA ATIVA (Paulo, 15/08 — a sequência é login → ativar).
    // O seletor continua existindo porque esta tela também serve à CARTEIRA
    // (varredura / "vá direto a um cliente", pedido de 13/08) — mas o padrão é
    // a empresa da sessão, não uma pergunta em branco.
    const empresaAtivaId = useEmpresaAtivaId();
    const [empresaId, setEmpresaId] = useState(empresaAtivaId || '');
    // Recorte compartilhado: buscado UMA vez, serve todas as abas de movimento.
    const [docs, setDocs] = useState<DocumentoFiscal[] | null>(null);
    const [recorteKey, setRecorteKey] = useState('');
    const [truncado, setTruncado] = useState(false);
    const [loading, setLoading] = useState(false);
    // Identificação obrigatória dos relatórios (responsável legal + contador,
    // Paulo 01/08) — buscada junto com o recorte, do cadastro da empresa.
    const [identificacao, setIdentificacao] = useState<IdentificacaoPdf>({});
    // O cadastro fiscal INTEIRO, não só o bloco do PDF: é dele que saem a
    // natureza da atividade e os overrides de CFOP, que a correlação de entrada
    // precisa (`correlacionarCfop`).
    const [cadastroFiscal, setCadastroFiscal] = useState<any>(null);

    React.useEffect(() => {
        let alive = true;
        if (currentUser) getEmpresasDisponiveis(currentUser).then(l => { if (alive) setEmpresas(l); });
        return () => { alive = false; };
    }, [currentUser]);

    if (!currentUser) {
        return <p className="text-center text-xs text-slate-400 py-6">Faça login para acessar os Relatórios.</p>;
    }

    const empresa = empresas.find(e => e.id === empresaId) || null;
    const precisaEmpresa = ABAS_POR_EMPRESA.includes(aba);
    const chaveAtual = `${empresaId}|${competencia}`;
    const recorteValido = docs !== null && recorteKey === chaveAtual;

    const buscar = async (empresaIdOverride?: unknown) => {
        // onClick passa o event como 1º argumento — só string interessa.
        const idAlvo = typeof empresaIdOverride === 'string' ? empresaIdOverride : empresaId;
        const alvo = empresas.find(e => e.id === idAlvo) || null;
        if (!alvo) { onShowToast?.('Escolha a empresa.'); return; }
        setLoading(true);
        try {
            const meta: { truncado?: boolean } = {};
            // Empresa vai ao SERVIDOR (id + CNPJ), como no Exportar SAGE (#437):
            // buscar a competência INTEIRA pra filtrar uma empresa no navegador
            // era pagar a leitura da carteira toda a cada relatório — e num mês
            // cheio ainda batia no teto e truncava o recorte.
            const [todos, dadosFiscais] = await Promise.all([
                listDocumentos(currentUser, {
                    competencia, empresaId: alvo.id, empresaCnpj: alvo.cnpj,
                }, meta),
                getIdentificacaoEmpresa(alvo),
            ]);
            setIdentificacao(montarIdentificacao(dadosFiscais));
            setCadastroFiscal(dadosFiscais || null);
            setTruncado(!!meta.truncado);
            const cnpj = alvo.cnpj.replace(/\D/g, '');
            setDocs(todos
                .filter(d => d.empresaId === alvo.id || String(d.empresaCnpj || '').replace(/\D/g, '') === cnpj)
                .map(d => ({ ...d, direcao: (direcaoEfetivaDoc(d) as any) || d.direcao })));
            setRecorteKey(`${alvo.id}|${competencia}`);
        } finally {
            setLoading(false);
        }
    };

    const docsRecorte = recorteValido ? (docs as DocumentoFiscal[]) : null;

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-5 rounded-xl text-white flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold">📊 Relatórios</h2>
                    <p className="text-blue-100 text-sm">
                        Os relatórios do departamento em PDF com a identidade da SP — mesmos números das telas de origem.
                    </p>
                </div>
                <a
                    href="/novidades-cfi.html" target="_blank" rel="noopener"
                    className="shrink-0 px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-bold"
                    title="O que mudou no CFI e o que fazer — comunicado interno"
                >
                    📣 Novidades
                </a>
            </div>

            <div className="bg-slate-100 dark:bg-slate-800/60 p-2 rounded-lg space-y-1.5">
                {GRUPOS.map(g => (
                    <div key={g.titulo} className="flex items-center gap-1 flex-wrap">
                        <span className="text-[9px] uppercase font-bold text-slate-400 w-40 shrink-0">{g.titulo}</span>
                        {g.abas.map(a => (
                            <button
                                key={a.id}
                                onClick={() => setAba(a.id)}
                                className={`px-2.5 py-1 text-[11px] font-bold whitespace-nowrap rounded-md transition-colors ${
                                    aba === a.id
                                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {a.label}
                            </button>
                        ))}
                    </div>
                ))}
            </div>

            {/* Recorte compartilhado */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap items-end gap-2">
                <div>
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Competência</label>
                    <input
                        type="month" value={competencia}
                        onChange={e => setCompetencia(e.target.value)}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                    />
                </div>
                {precisaEmpresa && (
                    <>
                        <div className="min-w-[280px] flex-1">
                            <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa</label>
                            <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId}
                                onAtivar={id => void buscar(id)} />
                        </div>
                        <button onClick={buscar} disabled={loading || !empresaId}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                            {loading ? 'Buscando…' : recorteValido ? '↻ Rebuscar' : '🔎 Buscar'}
                        </button>
                        {recorteValido && (
                            <span className="text-[11px] text-slate-500 pb-2">
                                {docsRecorte!.length} doc(s) no recorte{truncado ? ' · ⚠ leitura truncada' : ''}
                            </span>
                        )}
                        {recorteValido && (!identificacao.responsavel || !identificacao.contador) && (
                            <span className="text-[11px] text-amber-600 font-semibold pb-2 basis-full">
                                ⚠ Identificação incompleta no cadastro ({[
                                    !identificacao.responsavel && 'responsável legal',
                                    !identificacao.contador && 'contador/CRC',
                                ].filter(Boolean).join(' e ')}) — o PDF sai com "não cadastrado". Completar em Empresas → Dados Fiscais.
                            </span>
                        )}
                    </>
                )}
            </div>

            {precisaEmpresa && !recorteValido && (
                <p className="text-sm text-slate-500 text-center py-4">
                    Escolha a empresa e clique em <strong>⚡ Ativar</strong> — o mesmo recorte serve todas as abas de Movimento e Serviços.
                </p>
            )}

            {aba === 'livro' && docsRecorte && empresa && (
                <AbaLivro docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} cadastroFiscal={cadastroFiscal} />
            )}
            {aba === 'cfop' && docsRecorte && empresa && (
                <AbaCfop docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} cadastroFiscal={cadastroFiscal} />
            )}
            {aba === 'impostos-resumo' && docsRecorte && empresa && (
                <AbaImpostosResumo docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} />
            )}
            {aba === 'uf' && docsRecorte && empresa && (
                <AbaUf docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} />
            )}
            {aba === 'cfop-nota' && docsRecorte && empresa && (
                <AbaCfopPorNota docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} cadastroFiscal={cadastroFiscal} currentUser={currentUser} onShowToast={onShowToast} />
            )}
            {aba === 'canceladas' && docsRecorte && empresa && (
                <AbaCanceladas docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} />
            )}
            {aba === 'aliquota' && docsRecorte && empresa && (
                <AbaAliquota docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} />
            )}
            {aba === 'produto' && docsRecorte && empresa && (
                <AbaProduto docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} cadastroFiscal={cadastroFiscal} />
            )}
            {aba === 'participante' && docsRecorte && empresa && (
                <AbaParticipante docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} truncado={truncado} />
            )}
            {(aba === 'serv-tomados' || aba === 'serv-prestados' || aba === 'retencoes') && docsRecorte && empresa && (
                <AbaServicos docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} modo={aba} />
            )}
            {aba === 'serv-codigo' && docsRecorte && empresa && (
                <AbaServicosPorCodigo docs={docsRecorte} empresa={empresa} competencia={competencia} identificacao={identificacao} />
            )}
            {aba === 'faturamento' && <AbaFaturamento competencia={competencia} />}
            {aba === 'declaracao' && <AbaDeclaracao empresas={empresas} onShowToast={onShowToast} />}
            {aba === 'impostos-enviados' && <AbaImpostosEnviados competencia={competencia} />}
            {aba === 'dipam' && <AbaDipam competencia={competencia} />}
            {aba === 'ficha' && <AbaFicha currentUser={currentUser} />}
            {aba === 'trimestre' && <AbaTrimestre currentUser={currentUser} />}
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

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">{children}</div>
);

const usePdf = () => {
    const [gerando, setGerando] = useState(false);
    const rodar = async (fn: () => Promise<void>) => {
        setGerando(true);
        try { await fn(); } finally { setGerando(false); }
    };
    return { gerando, rodar };
};

interface AbaDocsProps {
    docs: DocumentoFiscal[];
    empresa: EmpresaXmlOption;
    competencia: string;
    truncado?: boolean;
    /** Bloco obrigatório do PDF (responsável legal + contador do cadastro). */
    identificacao?: IdentificacaoPdf;
    /** `dadosFiscais` da empresa — natureza da atividade + overrides de CFOP. */
    cadastroFiscal?: any;
}

/** De onde veio a natureza da atividade — o papel tem que dizer. */
const ORIGEM_NATUREZA: Record<string, string> = {
    cadastro: 'declarada no cadastro',
    indicador: 'derivada do indicador de atividade',
    padrao: 'PADRÃO (comércio) — não declarada no cadastro, confira',
};

const obsTruncado = (truncado?: boolean) => truncado
    ? ['ATENÇÃO: a leitura da competência atingiu o limite — os números podem estar INCOMPLETOS.']
    : [];

// ─── 1. Livro de Entradas/Saídas ────────────────────────────────────────────

const AbaLivro: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao, cadastroFiscal }) => {
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    const { gerando, rodar } = usePdf();

    // A COMPRA DE PRODUTOR RURAL TEM DUAS NOTAS E O LIVRO ESCRITURA UMA.
    // Sem esta dedup o livro DOBRA (VINCENZO 07/2026: 37.800,00 no lugar de
    // 18.900,00) — mesma duplicidade que dobrou o FUNRURAL em 11/08, e a mesma
    // régua do RICMS/SP art. 136, I, "a" (RC 33068/2025). Só nas ENTRADAS: na
    // saída não existe nota própria de entrada.
    // Natureza EFETIVA + de ONDE ela veio. O sufixo da compra depende dela
    // (comércio 102 · indústria 101 · serviços 556), então o papel tem que
    // dizer qual foi usada — número sem a régua do lado não se confere.
    const natureza = useMemo(
        () => resolverNaturezaAtividade(cadastroFiscal || {}) as { natureza: string; origem: string },
        [cadastroFiscal],
    );

    const { linhas, excluidas } = useMemo(() => {
        const filtrados = docs.filter(d => d.direcao === direcao && docValido(d)
            && ['NFe', 'NFCe'].includes((d as any).tipoDoc || d.tipo));
        const montar = (d: any) => {
            const contabil = d.totais?.vNF || d.valorTotal || 0;
            const a = alocarTributacaoIcms(d.itens || [], contabil);
            const parte: any = contraparteDoc(d);
            // O CFOP DO LIVRO DE ENTRADAS É O DA ENTRADA — não o do fornecedor.
            //
            // Paulo, 14/08: *"o relatório é com base nos CFOPs de saída dos
            // fornecedores dos nossos clientes; tudo que o cliente compra vira
            // CFOP de entrada de acordo com a correlação necessária"*. O XML de
            // uma compra traz o CFOP de quem VENDEU (5102, 6102…), porque a
            // nota é do fornecedor. Quem escritura a entrada lança 1102/2102.
            //
            // A régua é a MESMA do Exportar SAGE e do modal de correlação
            // (`correlacionarCfop`) — importada, nunca copiada: a réplica que o
            // modal tinha chegou a exibir `1405`, CFOP que não existe (PR #621).
            // Na saída ela devolve o CFOP original, e nota própria de entrada
            // (art. 136), que já nasce 1xxx, passa intacta.
            const cfopsEscriturados = Array.from(new Set(
                (d.itens || [])
                    .map((i: any) => String(i.cfop || '').replace(/\D/g, ''))
                    .filter(Boolean)
                    .map((c: string) => String(cfopDoLancamento(d, c, direcao, {
                        naturezaAtividade: natureza.natureza,
                        cfopOverrides: cadastroFiscal?.cfopOverrides,
                    }) || c)),
            ));
            return {
                data: (d.dhEmi || '').slice(0, 10).split('-').reverse().join('/'),
                numero: d.numero || '—',
                participante: parte?.nome || '—',
                cfops: cfopsEscriturados.join(' ') || '—',
                contabil, ...a,
            };
        };
        const r = direcao === 'entrada'
            ? livroSemNotaDeProdutorDuplicada(filtrados, montar, (d: any) => d.totais?.vNF || d.valorTotal || 0)
            : { linhas: filtrados.map(montar), excluidas: [] as any[] };
        return {
            linhas: r.linhas.sort((x: any, y: any) => x.data.localeCompare(y.data)
                || String(x.numero).localeCompare(String(y.numero))),
            excluidas: r.excluidas,
        };
    }, [docs, direcao, natureza, cadastroFiscal]);

    const tot = useMemo(() => linhas.reduce((t: any, l: any) => ({
        contabil: t.contabil + l.contabil, base: t.base + l.base, icms: t.icms + l.icms,
        isentos: t.isentos + l.isentos, outras: t.outras + l.outras, ipi: t.ipi + l.ipi,
    }), { contabil: 0, base: 0, icms: 0, isentos: 0, outras: 0, ipi: 0 }), [linhas]);

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Livro de ${direcao === 'entrada' ? 'Entradas' : 'Saídas'} — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} nota(s)`,
        colunas: [
            { titulo: 'Data', largura: 8 }, { titulo: 'Nº NF', largura: 8 },
            { titulo: direcao === 'entrada' ? 'Fornecedor/Remetente' : 'Cliente/Destinatário', largura: 26 },
            { titulo: 'CFOP', largura: 8 },
            { titulo: 'Vlr. Contábil', largura: 10, alinhamento: 'direita' },
            { titulo: 'Base ICMS', largura: 10, alinhamento: 'direita' },
            { titulo: 'ICMS', largura: 8, alinhamento: 'direita' },
            { titulo: 'Isentas', largura: 10, alinhamento: 'direita' },
            { titulo: 'Outras', largura: 10, alinhamento: 'direita' },
            { titulo: 'IPI', largura: 7, alinhamento: 'direita' },
        ],
        linhas: linhas.map((l: any) => [l.data, l.numero, l.participante, l.cfops, l.contabil, l.base, l.icms, l.isentos, l.outras, l.ipi]),
        totais: ['', '', `TOTAIS (${linhas.length} notas)`, '', tot.contabil, tot.base, tot.icms, tot.isentos, tot.outras, tot.ipi],
        identificacao,
        observacoes: [
            'Base/Isentas/Outras alocadas pela tributação de cada item (CST do XML), fechando no valor contábil — mesma régua do Exportar SAGE.',
            ...(direcao === 'entrada' ? [
                'CFOP: o XML da compra traz o CFOP do FORNECEDOR (saída). Aqui está o CFOP DE ENTRADA correlacionado — '
                + `natureza da atividade "${natureza.natureza}" (${ORIGEM_NATUREZA[natureza.origem] || natureza.origem}). `
                + 'Mesma régua do Exportar SAGE.',
            ] : []),
            // Total que muda sozinho faz desconfiar do número certo: o que saiu
            // do livro sai NOMEADO no papel, não só na tela.
            ...(excluidas.length ? [
                `${excluidas.length} NF-e de produtor rural FORA do livro (documento de origem; a escriturada é a `
                + 'nota própria de entrada — RICMS/SP art. 136, I, "a" e RC 33068/2025): '
                + excluidas.map((e: any) => `nº ${e.numero} ${e.participante} ${fmtBRL(e.valor)}`).join(' · '),
            ] : []),
            ...obsTruncado(truncado),
        ],
        fileName: `livro-${direcao}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2">
                <select value={direcao} onChange={e => setDirecao(e.target.value as any)}
                    className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                    <option value="entrada">Entradas</option>
                    <option value="saida">Saídas</option>
                </select>
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                <span className="text-xs text-slate-500">
                    {linhas.length} nota(s) · contábil {fmtBRL(tot.contabil)} · base {fmtBRL(tot.base)} · isentas {fmtBRL(tot.isentos)} · outras {fmtBRL(tot.outras)}
                </span>
            </div>
            {/* A régua VAI JUNTO DO NÚMERO: o sufixo da compra muda com a
                natureza (comércio 102 · indústria 101 · serviços 556), então
                quem confere precisa ver qual foi usada — e se ela foi
                DECLARADA ou apenas assumida. */}
            {direcao === 'entrada' && (
                <p className={`mt-2 text-[11px] ${natureza.origem === 'padrao' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                    CFOP correlacionado do fornecedor para a <strong>entrada</strong> — natureza da atividade{' '}
                    <strong>{natureza.natureza}</strong> ({ORIGEM_NATUREZA[natureza.origem] || natureza.origem}).
                    {natureza.origem === 'padrao' && ' Declare a atividade no cadastro para o sufixo sair certo.'}
                </p>
            )}
            {!!excluidas.length && (
                <div className="mt-3 rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <strong>{excluidas.length} NF-e de produtor rural fora do livro</strong> — documento de ORIGEM.
                    A escriturada é a nota própria de entrada (RICMS/SP art. 136, I, "a"; RC 33068/2025);
                    escriturar as duas dobra a entrada.
                    <ul className="mt-1 ml-4 list-disc">
                        {excluidas.map((e: any) => (
                            <li key={e.numero}>nº {e.numero} · {e.participante} · {fmtBRL(e.valor)}</li>
                        ))}
                    </ul>
                </div>
            )}
        </Card>
    );
};

// ─── 2b. CFOP por nota (o campo de lançamento pedido pelo Paulo) ─────────────

/**
 * ✏️ CFOP POR NOTA — o "campo para lançamento das notas escrituradas".
 *
 * Paulo, 17/08, com o Resumo por CFOP do CFI ao lado do livro do E-Fiscal:
 * *"é necessário incluir um campo para lançamento das notas escrituradas, a fim
 * de corrigir esses detalhes e facilitar a conferência"* — e, perguntado se era
 * por nota ou por item: **"é por NF"**.
 *
 * A tela NÃO decide CFOP: ela mostra o que a régua devolveu, aceita a correção e
 * grava carimbada. Quem decide é `cfopDoLancamento`, que TODOS os leitores usam
 * (livro, Resumo por CFOP, C170/C190 do SPED e Exportar SAGE) — por isso o que
 * for corrigido aqui aparece nos quatro, e não só nesta tela.
 */
const AbaCfopPorNota: React.FC<AbaDocsProps & { currentUser: User; onShowToast?: (m: string, t?: any) => void }> = ({
    docs, empresa, competencia, truncado, identificacao, cadastroFiscal, currentUser, onShowToast,
}) => {
    const { gerando, rodar } = usePdf();
    const [salvando, setSalvando] = useState<string | null>(null);
    const [rascunho, setRascunho] = useState<Record<string, string>>({});
    /** 🧠 Parâmetros do cérebro — o palpite melhor, entre a NF e o override. */
    const [parametros, setParametros] = useState<ParametroCfopDoc[]>([]);
    const [sugestao, setSugestao] = useState<any>(null);
    const [verParametros, setVerParametros] = useState(false);
    /** Gravado nesta sessão — o recorte não é relido a cada tecla. */
    const [gravado, setGravado] = useState<Record<string, string>>({});
    const [erro, setErro] = useState<string | null>(null);

    const natureza = useMemo(
        () => resolverNaturezaAtividade(cadastroFiscal || {}) as { natureza: string; origem: string },
        [cadastroFiscal],
    );
    const ctx = useMemo(
        () => ({
            naturezaAtividade: natureza.natureza,
            cfopOverrides: cadastroFiscal?.cfopOverrides,
            parametrosCfop: parametros.filter(p => p.ativo !== false),
        }),
        [natureza, cadastroFiscal, parametros],
    );

    React.useEffect(() => {
        let vivo = true;
        void lerParametrosCfop(empresa.id).then(ps => { if (vivo) setParametros(ps); });
        return () => { vivo = false; };
    }, [empresa.id]);

    const linhas = useMemo(() => {
        return docs
            .filter(d => ['NFe', 'NFCe'].includes((d as any).tipoDoc || d.tipo) && docValido(d))
            .map((d: any) => {
                const direcao = direcaoEfetivaDoc(d) as 'entrada' | 'saida';
                // O que ESTA sessão gravou vence o que veio do recorte — sem isso
                // a linha voltaria ao valor antigo até alguém recarregar a tela,
                // que é a "ação sem efeito visível" de 16/08.
                const informado = gravado[d.id] !== undefined ? gravado[d.id] : (d.cfopEscriturado || '');
                const docEfetivo = { ...d, cfopEscriturado: informado };
                const daRegua = cfopsDistintosDaNota(d, direcao, ctx);
                const cru = String(d.itens?.[0]?.cfop || '').replace(/\D/g, '');
                const origem = origemDoCfopLancamento(docEfetivo, cru, direcao, ctx);
                const parte: any = contraparteDoc(d);
                return {
                    id: d.id,
                    data: (d.dhEmi || '').slice(0, 10).split('-').reverse().join('/'),
                    numero: d.numero || '—',
                    participante: parte?.nome || '—',
                    // O cérebro é POR FORNECEDOR: sem CNPJ e sem competência ele
                    // não tem chave nem data de início, e a sugestão não nasce.
                    cnpjFornecedor: String(parte?.cnpjCpf || parte?.cnpj || d.cnpjEmit || '').replace(/\D/g, ''),
                    competencia: String(d.competencia || (d.dhEmi || '').slice(0, 7) || ''),
                    cfopCru: cru,
                    direcao,
                    daRegua,
                    /** Nota com mais de um CFOP: carimbar UM colapsa os outros. */
                    mista: daRegua.length > 1,
                    informado,
                    origem,
                    valor: d.totais?.vNF || d.valorTotal || 0,
                };
            })
            .sort((a, b) => a.data.localeCompare(b.data) || String(a.numero).localeCompare(String(b.numero)));
    }, [docs, ctx, gravado]);

    const comCarimbo = linhas.filter(l => l.informado).length;

    /** Fornecedores do recorte — a mesma leitura que já está na tela. */
    const fornecedoresDoRecorte: FornecedorOpcao[] = useMemo(() => {
        const mapa = new Map<string, FornecedorOpcao>();
        for (const l of linhas) {
            if (l.direcao !== 'entrada' || !l.cnpjFornecedor) continue;
            const f = mapa.get(l.cnpjFornecedor)
                || { cnpj: l.cnpjFornecedor, nome: l.participante, cfops: [] as string[], notas: 0 };
            f.notas += 1;
            if (l.cfopCru && !f.cfops.includes(l.cfopCru)) f.cfops.push(l.cfopCru);
            mapa.set(l.cnpjFornecedor, f);
        }
        return Array.from(mapa.values()).sort((a, b) => b.notas - a.notas);
    }, [linhas]);

    // 🚨 CFOP QUE NÃO CONSTA DA TABELA EM VIGOR — a conferência contra a NORMA.
    //
    // Foi assim que apareceram, no Resumo por CFOP da NOVA ERA 07/2026, o 1655
    // (109 notas), o 1929 (25), o 1103 (9) e o 2104 (1): a conversão mecânica
    // preserva o sufixo do vendedor e, em várias famílias, aquele sufixo não tem
    // par na entrada. É o defeito do 1405, repetido.
    const inexistentes = useMemo(() => {
        const usados = linhas.map(l => l.informado || l.daRegua[0] || '').filter(Boolean);
        const fora = cfopsInexistentes(usados);
        const notas = linhas.filter(l => fora.includes(l.informado || l.daRegua[0] || '')).length;
        return { fora, notas };
    }, [linhas]);

    const salvar = async (l: typeof linhas[number], valor: string) => {
        setErro(null);
        setSalvando(l.id);
        try {
            const r = await gravarCfopEscriturado({
                documentoId: l.id, direcao: l.direcao, cfop: valor,
                porEmail: currentUser?.email || '',
            });
            setGravado(g => ({ ...g, [l.id]: r.cfop }));
            setRascunho(x => { const n = { ...x }; delete n[l.id]; return n; });
            onShowToast?.(r.cfop
                ? `NF ${l.numero}: CFOP ${r.cfop} informado.`
                : `NF ${l.numero}: voltou para a correlação automática.`, 'success');
            // 🧠 A SUGESTÃO É OPT-IN. Nascer ligada faria o app aprender com um
            // clique de teste — e parâmetro errado é pior que a correção nota a
            // nota, porque se aplica calado a tudo que vier depois.
            if (r.cfop && l.direcao === 'entrada') {
                setSugestao(sugerirParametro({
                    cnpjFornecedor: l.cnpjFornecedor,
                    nomeFornecedor: l.participante,
                    cfopOrigem: l.cfopCru,
                    cfopDestino: r.cfop,
                    competencia: l.competencia,
                }));
            }
        } catch (e: any) {
            setErro(e?.message || 'Falha ao gravar.');
        } finally {
            setSalvando(null);
        }
    };

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `CFOP por nota — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} nota(s) · ${comCarimbo} com CFOP informado`,
        colunas: [
            { titulo: 'Data', largura: 8 }, { titulo: 'Nº NF', largura: 8 },
            { titulo: 'E/S', largura: 4 },
            { titulo: 'Participante', largura: 26 },
            { titulo: 'CFOP pela régua', largura: 14 },
            { titulo: 'CFOP informado', largura: 12 },
            { titulo: 'O que esse CFOP é', largura: 30 },
            { titulo: 'Origem', largura: 14 },
            { titulo: 'Vlr. Contábil', largura: 12, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [
            l.data, l.numero, l.direcao === 'entrada' ? 'E' : 'S', l.participante,
            l.daRegua.join(' ') || '—', l.informado || '—',
            textoDoCfop(l.informado || l.daRegua[0] || '').texto, l.origem.rotulo, l.valor,
        ]),
        identificacao,
        observacoes: [
            'O CFOP informado na NF vence a correlação automática e o override da empresa, e vale para TODOS os '
            + 'itens daquela nota (decisão de 17/08: o campo é por NF).',
            `Natureza da atividade "${natureza.natureza}" (${ORIGEM_NATUREZA[natureza.origem] || natureza.origem}).`,
            ...(inexistentes.fora.length ? [
                `${inexistentes.notas} nota(s) com CFOP que NÃO CONSTA da tabela em vigor (${FONTE_CFOP.redacao}): `
                + `${inexistentes.fora.join(', ')}. O app não escolhe o substituto — informe o CFOP nota a nota.`,
            ] : []),
            ...(linhas.some(l => l.mista) ? [
                `${linhas.filter(l => l.mista).length} nota(s) têm mais de um CFOP entre os itens — informar um CFOP `
                + 'na NF faz os itens saírem todos com ele.',
            ] : []),
            ...obsTruncado(truncado),
        ],
        fileName: `cfop-por-nota-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex flex-wrap items-center gap-2">
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                <button
                    onClick={() => setVerParametros(v => !v)}
                    className="btn-press px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 whitespace-nowrap"
                >🧠 Parâmetros ({parametros.filter(p => p.ativo !== false).length})</button>
                {/* Guia servido pelo PRÓPRIO app (public/ → dist/): link estável
                    para a equipe toda. Material de equipe nunca vai por link
                    externo — o colaborador receberia "link inválido". */}
                <a
                    href="/guia-cfop-por-nota.html"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 whitespace-nowrap"
                >📗 Guia do colaborador</a>
                <span className="text-xs text-slate-500">
                    {linhas.length} nota(s) · {comCarimbo} com CFOP informado
                </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
                O CFOP informado aqui vence a correlação automática e o override da empresa, e vale para{' '}
                <strong>todos os itens daquela nota</strong>. Ele aparece no Livro, no Resumo por CFOP, no SPED
                (C170/C190) e no Exportar SAGE — não só nesta tela. <strong>Campo em branco</strong> devolve a
                nota à régua automática.
            </p>
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                ⚠️ O catálogo de descrições de CFOP do CFI ainda está incompleto — código sem descrição aparece
                marcado. A tabela oficial é a do{' '}
                <a href={FONTE_CFOP.url} target="_blank" rel="noreferrer" className="underline">{FONTE_CFOP.titulo}</a>.
            </p>
            {/* 🧠 A SUGESTÃO DO CÉREBRO — opt-in, com a consequência escrita. */}
            {sugestao && (
                <div className={`mt-3 rounded-lg border-l-4 p-3 text-xs ${sugestao.pode
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                    : 'border-slate-400 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                    {sugestao.pode ? (
                        <>
                            <strong>🧠 {sugestao.pergunta}</strong>
                            <p className="mt-1">{sugestao.detalhe}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                    className="btn-press px-3 py-1 rounded bg-blue-700 text-white font-bold whitespace-nowrap"
                                    onClick={async () => {
                                        try {
                                            await gravarParametroCfop({
                                                empresaId: empresa.id,
                                                ...sugestao.parametro,
                                                porEmail: currentUser?.email || '',
                                            });
                                            setParametros(await lerParametrosCfop(empresa.id));
                                            onShowToast?.('Parâmetro criado — vale das próximas notas em diante.', 'success');
                                        } catch (e: any) { setErro(e?.message || 'Falha ao criar o parâmetro.'); }
                                        setSugestao(null);
                                    }}
                                >Sim, aprender</button>
                                <button
                                    className="btn-press px-3 py-1 rounded bg-slate-200 dark:bg-slate-700 whitespace-nowrap"
                                    onClick={() => setSugestao(null)}
                                >Só nesta nota</button>
                            </div>
                        </>
                    ) : (
                        <>🧠 {sugestao.motivo}{' '}
                            <button className="underline" onClick={() => setSugestao(null)}>ok</button>
                        </>
                    )}
                </div>
            )}
            {!!inexistentes.fora.length && (
                <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                    <strong>{inexistentes.notas} nota(s) com CFOP que NÃO CONSTA da tabela em vigor</strong>{' '}
                    ({FONTE_CFOP.redacao}): <span className="font-mono">{inexistentes.fora.join(' · ')}</span>.
                    <br />
                    Isso quase sempre é a conversão automática preservando um sufixo do vendedor que não tem par na
                    entrada — o app não sabe qual é o certo, e por isso NÃO escolhe. Informe o CFOP na coluna ao lado,
                    nota a nota.
                </div>
            )}
            {erro && (
                <div className="mt-2 rounded-lg border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                    {erro}
                </div>
            )}
            {verParametros && (
                <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <CfopCerebroPainel
                        empresaId={empresa.id}
                        user={currentUser}
                        fornecedores={fornecedoresDoRecorte}
                        parametros={parametros}
                        onMudou={setParametros}
                        competenciaPadrao={competencia}
                    />
                </div>
            )}
            {!linhas.length ? (
                <p className="mt-3 text-sm text-slate-500">
                    Nenhuma NF-e/NFC-e no recorte. Se a empresa emite ou recebe nota, isto é buraco de captura —
                    veja Prova de captura e Cobertura de Saída.
                </p>
            ) : (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500">
                            <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                                <th className="py-1 pr-2">Data</th>
                                <th className="py-1 pr-2">Nº NF</th>
                                <th className="py-1 pr-2">E/S</th>
                                <th className="py-1 pr-2">Participante</th>
                                <th className="py-1 pr-2">CFOP pela régua</th>
                                <th className="py-1 pr-2">CFOP informado</th>
                                <th className="py-1 pr-2">O que esse CFOP é</th>
                                <th className="py-1 pr-2">Origem</th>
                                <th className="py-1 pr-2 text-right">Vlr. Contábil</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map(l => (
                                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="py-1 pr-2 whitespace-nowrap">{l.data}</td>
                                    <td className="py-1 pr-2 font-mono">{l.numero}</td>
                                    <td className="py-1 pr-2">{l.direcao === 'entrada' ? 'E' : 'S'}</td>
                                    <td className="py-1 pr-2 max-w-[16rem] truncate" title={l.participante}>{l.participante}</td>
                                    <td className="py-1 pr-2 font-mono">
                                        {l.daRegua.join(' ') || '—'}
                                        {l.mista && (
                                            <span className="ml-1 text-amber-600 dark:text-amber-400"
                                                title="Esta nota tem mais de um CFOP entre os itens. Informar um CFOP na NF faz todos saírem com ele.">
                                                ⚠ mista
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-1 pr-2">
                                        <input
                                            value={rascunho[l.id] !== undefined ? rascunho[l.id] : l.informado}
                                            onChange={e => setRascunho(x => ({ ...x, [l.id]: e.target.value }))}
                                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                            onBlur={e => {
                                                const v = e.target.value.trim();
                                                if (v === (l.informado || '')) return;
                                                void salvar(l, v);
                                            }}
                                            disabled={salvando === l.id}
                                            placeholder="—"
                                            maxLength={4}
                                            className="w-20 p-1 font-mono text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 disabled:opacity-50"
                                        />
                                    </td>
                                    <td className="py-1 pr-2 max-w-[22rem]">
                                        {(() => {
                                            const valendo = l.informado || l.daRegua[0] || '';
                                            const t = textoDoCfop(valendo);
                                            return (
                                                <span className={t.temDescricao ? 'text-slate-600 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400'}
                                                    title={t.texto}>
                                                    {t.texto.length > 90 ? `${t.texto.slice(0, 90)}…` : t.texto}
                                                </span>
                                            );
                                        })()}
                                    </td>
                                    <td className="py-1 pr-2 text-slate-500">
                                        {l.origem.rotulo}
                                        {l.origem.por && <span className="block text-[10px]">{l.origem.por}</span>}
                                    </td>
                                    <td className="py-1 pr-2 text-right whitespace-nowrap">{fmtBRL(l.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── 3. ICMS · IPI · ISS ────────────────────────────────────────────────────

// ─── 2. Resumo por CFOP ─────────────────────────────────────────────────────

const AbaCfop: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao, cadastroFiscal }) => {
    const { gerando, rodar } = usePdf();
    const natureza = useMemo(
        () => resolverNaturezaAtividade(cadastroFiscal || {}) as { natureza: string; origem: string },
        [cadastroFiscal],
    );
    const linhas = useMemo(
        () => resumoPorCfop(
            docs.filter(d => ['NFe', 'NFCe'].includes((d as any).tipoDoc || d.tipo)),
            { naturezaAtividade: natureza.natureza, cfopOverrides: cadastroFiscal?.cfopOverrides },
        ),
        [docs, natureza, cadastroFiscal],
    );

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Resumo por CFOP — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} CFOP(s)`,
        colunas: [
            { titulo: 'E/S', largura: 5 }, { titulo: 'CFOP', largura: 7 },
            { titulo: 'Notas', largura: 6, alinhamento: 'direita' },
            { titulo: 'Itens', largura: 6, alinhamento: 'direita' },
            { titulo: 'Vlr. Contábil', largura: 12, alinhamento: 'direita' },
            { titulo: 'Base ICMS', largura: 12, alinhamento: 'direita' },
            { titulo: 'ICMS', largura: 10, alinhamento: 'direita' },
            { titulo: 'Isentas', largura: 12, alinhamento: 'direita' },
            { titulo: 'Outras', largura: 12, alinhamento: 'direita' },
            { titulo: 'IPI', largura: 8, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.direcao === 'entrada' ? 'E' : 'S', l.cfop, l.notas, l.itens, l.contabil, l.base, l.icms, l.isentos, l.outras, l.ipi]),
        identificacao,
        observacoes: [
            'Contábil da nota rateado entre os CFOPs dela na proporção do valor dos itens (mesma regra do E201 do Exportar SAGE).',
            'Nas ENTRADAS o CFOP é o CORRELACIONADO (o XML da compra traz o do fornecedor) — natureza da atividade '
            + `"${natureza.natureza}" (${ORIGEM_NATUREZA[natureza.origem] || natureza.origem}).`,
            ...obsTruncado(truncado),
        ],
        fileName: `resumo-cfop-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2 flex-wrap">
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                <span className="text-xs text-slate-500">{linhas.length} CFOP(s) no recorte</span>
            </div>
            {linhas.length > 0 && (
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800">
                            <tr><th className="text-left py-1">E/S</th><th className="text-left">CFOP</th><th className="text-right">Notas</th>
                                <th className="text-right">Contábil</th><th className="text-right">Base</th><th className="text-right">ICMS</th>
                                <th className="text-right">Isentas</th><th className="text-right">Outras</th></tr>
                        </thead>
                        <tbody>
                            {linhas.map((l, i) => (
                                <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1">{l.direcao === 'entrada' ? 'E' : 'S'}</td>
                                    <td className="font-mono">{l.cfop}</td>
                                    <td className="text-right">{l.notas}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.contabil)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.base)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.icms)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.isentos)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.outras)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── 3. ICMS / IPI / ISS ────────────────────────────────────────────────────

const AbaImpostosResumo: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const r = useMemo(() => resumoImpostos(docs), [docs]);

    const linhas = [
        ['ICMS', r.icms.creditoEntradas, r.icms.debitoSaidas, r.icms.saldo],
        ['IPI', r.ipi.creditoEntradas, r.ipi.debitoSaidas, r.ipi.saldo],
        ['ISS (prestados)', 0, r.iss.prestados, r.iss.prestados],
        ['ISS retido (tomados)', r.iss.retidoTomados, 0, -r.iss.retidoTomados],
    ] as (string | number)[][];

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `ICMS · IPI · ISS destacados — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)}`,
        orientacao: 'portrait',
        colunas: [
            { titulo: 'Imposto', largura: 16 },
            { titulo: 'Entradas (crédito destacado)', largura: 14, alinhamento: 'direita' },
            { titulo: 'Saídas (débito destacado)', largura: 14, alinhamento: 'direita' },
            { titulo: 'Saldo (débito − crédito)', largura: 14, alinhamento: 'direita' },
        ],
        linhas,
        identificacao,
        observacoes: [
            'Valores DESTACADOS nos documentos da competência — é resumo de escrituração, NÃO a apuração: direito a crédito depende da destinação (a apuração oficial vive nas fichas do regime).',
        ],
        fileName: `impostos-destacados-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2"><BotaoPdf onClick={pdf} gerando={gerando} /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                {[['ICMS crédito', r.icms.creditoEntradas], ['ICMS débito', r.icms.debitoSaidas],
                  ['IPI crédito', r.ipi.creditoEntradas], ['IPI débito', r.ipi.debitoSaidas],
                  ['ISS prestados', r.iss.prestados], ['ISS retido (tomados)', r.iss.retidoTomados],
                  ['Saldo ICMS', r.icms.saldo], ['Saldo IPI', r.ipi.saldo]].map(([rot, v]) => (
                    <div key={rot as string} className="rounded bg-slate-50 dark:bg-slate-900/40 p-2">
                        <p className="text-[10px] uppercase text-slate-500">{rot as string}</p>
                        <p className="text-sm font-mono font-bold text-slate-700 dark:text-slate-200">{fmtBRL(v as number)}</p>
                    </div>
                ))}
            </div>
            <p className="text-[11px] text-slate-400">
                Destacado nos documentos ≠ apuração — o crédito real depende da destinação de cada entrada.
            </p>
        </Card>
    );
};

// ─── 4. Resumo por UF ───────────────────────────────────────────────────────

const AbaUf: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const linhas = useMemo(() => resumoPorUf(docs), [docs]);

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Resumo por UF — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · UF da contraparte (fornecedor/cliente)`,
        orientacao: 'portrait',
        colunas: [
            { titulo: 'UF', largura: 6 },
            { titulo: 'Entradas (qtd)', largura: 10, alinhamento: 'direita' },
            { titulo: 'Entradas (R$)', largura: 14, alinhamento: 'direita' },
            { titulo: 'Saídas (qtd)', largura: 10, alinhamento: 'direita' },
            { titulo: 'Saídas (R$)', largura: 14, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.uf, l.entradasQtd, l.entradasValor, l.saidasQtd, l.saidasValor]),
        identificacao,
        observacoes: ['UF do outro participante da operação (na nota própria de entrada, o remetente). "??" = documento sem UF gravada.'],
        fileName: `resumo-uf-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2"><BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} /></div>
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs max-w-xl">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr><th className="text-left py-1">UF</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th></tr>
                        </thead>
                        <tbody>
                            {linhas.map(l => (
                                <tr key={l.uf} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1 font-bold">{l.uf}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.entradasValor)} <span className="text-slate-400">({l.entradasQtd})</span></td>
                                    <td className="text-right font-mono">{fmtBRL(l.saidasValor)} <span className="text-slate-400">({l.saidasQtd})</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── NF Canceladas/Faltantes (completude da numeração) ──────────────────────

const RESSALVAS_NUMERACAO = [
    'Buraco NÃO é sempre nota perdida: numeração INUTILIZADA na SEFAZ não gera XML e aparece aqui como faltante — confira a inutilização no portal antes de concluir.',
    'A sequência atravessa o mês: buraco entre o fim do mês anterior e a 1ª nota do mês não aparece neste recorte.',
    'A SEFAZ não entrega saída ao emitente (Rej. 641): se o cofre/autXML da empresa está incompleto, faltante pode ser nota emitida e não capturada — ver Cobertura de Saída.',
];

const AbaCanceladas: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const linhas = useMemo(() => nfCanceladasFaltantes(docs, empresa.cnpj), [docs, empresa.cnpj]);
    // "Nenhuma nota emitida" e "não capturamos as saídas desta empresa" são
    // coisas DIFERENTES e a tela dizia a primeira nos dois casos. Caso SILVIO
    // FREIRE (06/08): o E-Fiscal listava 12 NFC-e faltantes e o CFI dizia
    // "nenhuma nota emitida" com 436 documentos no recorte — porque a SEFAZ
    // NÃO entrega a saída ao emitente (Rej. 641), ela vem pelo cofre/autXML.
    const semSaidaCapturada = linhas.length === 0 && docs.length > 0;
    const totalFaltantes = linhas.reduce((s, l) => s + l.faltantesTotal, 0);
    const totalCanceladas = linhas.reduce((s, l) => s + l.canceladas.length, 0);
    // Lista de números sozinha é alarme sem ação — caso LAV (759 faltantes
    // contra 137 capturadas: era captura, não numeração).
    const leitura = useMemo(() => lerFaltantes(linhas), [linhas]);

    // "0 cancelada(s)" NÃO é a SEFAZ dizendo que não houve cancelamento — é o
    // app dizendo que nunca soube de nenhum. Para a saída o evento não chega
    // (Rej. 641 + cofre traz só o XML autorizado), então aqui se PERGUNTA.
    const [reconf, setReconf] = useState<any>(null);
    const [reconferindo, setReconferindo] = useState(false);
    const reconferir = async (simular: boolean) => {
        setReconferindo(true);
        try {
            setReconf(await reconferirCancelamento({ cnpj: empresa.cnpj, competencia, simular }));
        } catch (e: any) {
            setReconf({ error: e?.message || 'Falha ao consultar a SEFAZ.' });
        } finally {
            setReconferindo(false);
        }
    };

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `NF Saídas — Canceladas/Faltantes — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · notas EMITIDAS pela empresa (mod 55/65, inclui nota própria de entrada)`,
        orientacao: 'landscape',
        colunas: [
            { titulo: 'Mod', largura: 5 },
            { titulo: 'Série', largura: 5 },
            { titulo: 'De–Até', largura: 12 },
            { titulo: 'Autorizadas', largura: 9, alinhamento: 'direita' },
            { titulo: 'Canceladas', largura: 24 },
            { titulo: 'Faltantes', largura: 30 },
            { titulo: 'Qtd falt.', largura: 7, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [
            l.modelo, l.serie, `${l.primeiro}–${l.ultimo}`, l.autorizadas,
            formatarFaixas(l.canceladas) || '—',
            (formatarFaixas(l.faltantes) || '—') + (l.faltantesTotal > l.faltantes.length ? ` … (+${l.faltantesTotal - l.faltantes.length})` : ''),
            l.faltantesTotal,
        ]),
        identificacao,
        observacoes: [
            // A LISTA COMPLETA vai nas observações, que quebram linha. Na coluna
            // ela era CORTADA pela largura (o "…" do gerador de PDF não diz
            // quanto sobrou), e quem confere numeração precisa da sequência
            // inteira — foi o que o Paulo pediu no caso LAV (12/08).
            ...linhas.filter(l => l.faltantesTotal > 0).map(l =>
                `Faltantes mod ${l.modelo} série ${l.serie} (${l.faltantesTotal} número(s)): `
                + formatarFaixas(l.faltantes)
                + (l.faltantesTotal > l.faltantes.length
                    ? ` … e mais ${l.faltantesTotal - l.faltantes.length} não listado(s): a lista para em `
                      + `${l.faltantes.length} por série. Neste caso confira o intervalo ${l.primeiro}–${l.ultimo} inteiro.`
                    : ' — sequência COMPLETA.')),
            ...RESSALVAS_NUMERACAO, ...obsTruncado(truncado),
        ],
        fileName: `nf-canceladas-faltantes-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-3 flex-wrap">
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                {linhas.length > 0 && (
                    <span className={`text-xs font-bold ${totalFaltantes > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {totalFaltantes > 0
                            ? `⚠ ${totalFaltantes} número(s) faltante(s) · ${totalCanceladas} cancelada(s)`
                            : `✓ numeração contínua · ${totalCanceladas} cancelada(s)`}
                    </span>
                )}
            </div>
            {!linhas.length && !semSaidaCapturada && (
                <p className="text-xs text-slate-500">Sem documentos no recorte — escolha empresa e competência.</p>
            )}

            {/* A CAUSA junto do número. 759 faltantes contra 137 capturadas não
                é lista para conferir uma a uma — é captura da saída faltando, e
                a ação é outra (caso LAV, Eunice 12/08). */}
            {leitura.causa !== 'continua' && (
                <div className={`rounded-lg border p-2 text-xs ${leitura.causa === 'captura-incompleta'
                    ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                    : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'}`}>
                    <p className="font-bold">
                        {leitura.causa === 'captura-incompleta'
                            ? '🚩 Isto é buraco de CAPTURA, não de numeração'
                            : '⚠ Buraco pontual na numeração'}
                    </p>
                    <p className="mt-1">{leitura.acao}</p>
                </div>
            )}

            {/* "0 cancelada(s)" pode ser o app nunca ter sabido do cancelamento.
                Para a saída o evento não chega sozinho — então se PERGUNTA. */}
            {linhas.length > 0 && (
                <div className="rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 p-2 space-y-2">
                    <p className="text-xs text-sky-900 dark:text-sky-200">
                        <strong>"{totalCanceladas} cancelada(s)" é o que o app SABE, não o que a SEFAZ diz.</strong> O
                        cancelamento da saída chega por evento, e a SEFAZ não entrega ao emitente (Rej. 641) — o cofre
                        traz o XML autorizado, não o cancelamento do dia seguinte. Cancelada que não chegou continua
                        contando no faturamento.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => reconferir(true)}
                            disabled={reconferindo}
                            className="text-[11px] px-3 py-1 rounded-md bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 font-semibold disabled:opacity-50"
                        >
                            {reconferindo ? '⏳…' : '🔎 Quantas seriam consultadas?'}
                        </button>
                        <button
                            onClick={() => {
                                const n = reconf?.selecao?.aConsultar;
                                if (!window.confirm(
                                    `Perguntar à SEFAZ, nota a nota, se foram canceladas?\n\n`
                                    + `${n != null ? `${n} consulta(s)` : 'Cada nota é uma consulta'} com o certificado `
                                    + 'do próprio cliente. Nada é transmitido — só leitura.\n\n'
                                    + 'Nota que a SEFAZ confirmar cancelada SAI do faturamento.',
                                )) return;
                                reconferir(false);
                            }}
                            disabled={reconferindo}
                            className="text-[11px] px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-50"
                        >
                            {reconferindo ? '⏳ Perguntando à SEFAZ…' : '📡 Reconferir na SEFAZ'}
                        </button>
                    </div>

                    {reconf?.error && <p className="text-[11px] text-red-600 dark:text-red-400">{reconf.error}</p>}
                    {reconf?.ok && (
                        <div className="text-[11px] text-slate-700 dark:text-slate-300 space-y-1">
                            <p className="font-semibold">
                                {reconf.simulado
                                    ? `${reconf.selecao?.aConsultar} de ${reconf.selecao?.total} nota(s) de saída seriam consultadas`
                                    : `${reconf.resumo?.consultadas} consultada(s) · ${reconf.resumo?.canceladas} cancelada(s) · `
                                      + `${reconf.resumo?.indeterminadas} indeterminada(s)`}
                                {reconf.selecao?.jaCanceladas ? ` · ${reconf.selecao.jaCanceladas} já constavam canceladas` : ''}
                            </p>
                            {(reconf.resumo?.avisos || []).map((a: string, i: number) => (
                                <p key={i} className="text-amber-700 dark:text-amber-400">{a}</p>
                            ))}
                            {(reconf.resultados || []).filter((r: any) => r.situacao !== 'nao-cancelada').map((r: any) => (
                                <p key={r.id} className="font-mono">
                                    <span className={r.situacao === 'cancelada' ? 'text-red-600 font-bold' : 'text-slate-500'}>
                                        [{r.situacao}]
                                    </span>{' '}
                                    nº {r.numero ?? '—'} — {r.motivo}
                                </p>
                            ))}
                            {!reconf.simulado && (
                                <p className="text-slate-500">Recarregue o relatório para ver os totais já sem as canceladas.</p>
                            )}
                        </div>
                    )}
                </div>
            )}
            {semSaidaCapturada && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-300">
                    <p className="font-bold">
                        ⚠ Não há NENHUMA nota EMITIDA pela empresa neste recorte — e há {docs.length} documento(s).
                    </p>
                    <p>
                        Isso quase nunca significa que o cliente não emitiu. A SEFAZ <strong>não entrega a saída ao
                        próprio emitente</strong> (Rejeição 641): ela chega pelo cofre de e-mail ou por autXML. Se esse
                        trilho não estiver configurado, a numeração não pode ser conferida e este relatório fica
                        <strong> cego</strong>, não vazio.
                    </p>
                    <p className="mt-1">
                        Confira em <strong>Captura → Cobertura de Saída</strong> se esta empresa já envia os XMLs de
                        saída. Enquanto não enviar, o E-Fiscal (que recebe do ERP do cliente) vai listar faltantes que
                        o CFI não tem como ver.
                    </p>
                </div>
            )}
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="text-left py-1">Mod/Série</th><th className="text-right">De–Até</th>
                                <th className="text-right">Autorizadas</th><th className="text-left pl-3">Canceladas</th>
                                <th className="text-left pl-3">Faltantes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map(l => (
                                <tr key={`${l.modelo}|${l.serie}`} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1 font-bold">{l.modelo} · série {l.serie}</td>
                                    <td className="text-right font-mono">{l.primeiro}–{l.ultimo}</td>
                                    <td className="text-right font-mono">{l.autorizadas}</td>
                                    <td className="pl-3 font-mono text-slate-500">{formatarFaixas(l.canceladas) || '—'}</td>
                                    <td className={`pl-3 font-mono break-words ${l.faltantesTotal ? 'text-amber-600 font-bold' : 'text-emerald-600'}`}>
                                        {formatarFaixas(l.faltantes) || '✓ nenhum'}
                                        {l.faltantesTotal > l.faltantes.length
                                            ? ` … e mais ${l.faltantesTotal - l.faltantes.length} (a lista para em ${l.faltantes.length} por série)`
                                            : ''}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <ul className="text-[10px] text-slate-500 list-disc pl-4 space-y-0.5">
                {RESSALVAS_NUMERACAO.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
        </Card>
    );
};

// ─── Resumo por alíquota ────────────────────────────────────────────────────

const AbaAliquota: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const linhas = useMemo(() => resumoPorAliquota(docs), [docs]);

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Resumo por alíquota (ICMS) — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · NF-e/NFC-e, régua de CST do livro`,
        colunas: [
            { titulo: 'Direção', largura: 8 },
            { titulo: 'Alíquota', largura: 14 },
            { titulo: 'Itens', largura: 7, alinhamento: 'direita' },
            { titulo: 'Valor (R$)', largura: 13, alinhamento: 'direita' },
            { titulo: 'Base (R$)', largura: 13, alinhamento: 'direita' },
            { titulo: 'ICMS (R$)', largura: 13, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.direcao === 'entrada' ? 'Entrada' : 'Saída', l.rotulo, l.itens, l.valor, l.base, l.icms]),
        identificacao,
        observacoes: [
            'Isentas = CST 40/41/50; Outras = sem destaque (ST, diferimento, CSOSN do Simples) — mesma régua do Exportar SAGE.',
            'Alíquota derivada de ICMS/Base quando a nota não gravou pICMS.',
            ...obsTruncado(truncado),
        ],
        fileName: `resumo-aliquota-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2"><BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} /></div>
            {!linhas.length && <p className="text-xs text-slate-500">Nenhum item de NF-e/NFC-e no recorte.</p>}
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs max-w-3xl">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="text-left py-1">Direção</th><th className="text-left">Alíquota</th>
                                <th className="text-right">Itens</th><th className="text-right">Valor</th>
                                <th className="text-right">Base</th><th className="text-right">ICMS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map((l, i) => (
                                <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1">{l.direcao === 'entrada' ? '📥 Entrada' : '📤 Saída'}</td>
                                    <td className="font-bold">{l.rotulo}</td>
                                    <td className="text-right font-mono">{l.itens}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.valor)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.base)}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.icms)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── Por produto ────────────────────────────────────────────────────────────

const LIMITE_TELA = 50;

const AbaProduto: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao, cadastroFiscal }) => {
    const { gerando, rodar } = usePdf();
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    const natureza = useMemo(
        () => resolverNaturezaAtividade(cadastroFiscal || {}) as { natureza: string; origem: string },
        [cadastroFiscal],
    );
    const linhas = useMemo(
        () => resumoPorProduto(docs, direcao, {
            naturezaAtividade: natureza.natureza,
            cfopOverrides: cadastroFiscal?.cfopOverrides,
        }),
        [docs, direcao, natureza, cadastroFiscal],
    );

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Lançamento por produto — ${direcao === 'entrada' ? 'entradas' : 'saídas'} — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} produto(s)`,
        orientacao: 'landscape',
        colunas: [
            { titulo: 'Produto', largura: 30 },
            { titulo: 'NCM', largura: 8 },
            { titulo: 'CFOPs', largura: 10 },
            { titulo: 'Qtd', largura: 8, alinhamento: 'direita' },
            { titulo: 'Un', largura: 5 },
            { titulo: 'Notas', largura: 6, alinhamento: 'direita' },
            { titulo: 'Valor (R$)', largura: 12, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.produto, l.ncm, l.cfops, l.qtd, l.unidade, l.notas, l.valor]),
        identificacao,
        observacoes: ['Qtd somada só faz sentido quando a unidade é única — "várias" indica unidades misturadas.', ...obsTruncado(truncado)],
        fileName: `por-produto-${direcao}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2 flex-wrap">
                {(['entrada', 'saida'] as const).map(d => (
                    <button key={d} onClick={() => setDirecao(d)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg ${direcao === d ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                        {d === 'entrada' ? '📥 Entradas' : '📤 Saídas'}
                    </button>
                ))}
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                {linhas.length > LIMITE_TELA && (
                    <span className="text-[11px] text-slate-500">mostrando {LIMITE_TELA} de {linhas.length} — o PDF traz todos</span>
                )}
            </div>
            {!linhas.length && <p className="text-xs text-slate-500">Nenhum item de NF-e/NFC-e nessa direção.</p>}
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="text-left py-1">Produto</th><th className="text-left">NCM</th>
                                <th className="text-left">CFOPs</th><th className="text-right">Qtd</th>
                                <th className="text-right">Notas</th><th className="text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.slice(0, LIMITE_TELA).map((l, i) => (
                                <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1 font-semibold max-w-[280px] truncate" title={l.produto}>{l.produto}</td>
                                    <td className="font-mono">{l.ncm}</td>
                                    <td className="font-mono">{l.cfops}</td>
                                    <td className="text-right font-mono">{l.qtd.toLocaleString('pt-BR')} {l.unidade !== '—' ? l.unidade : ''}</td>
                                    <td className="text-right font-mono">{l.notas}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── Por participante (fornecedores/clientes) ───────────────────────────────

const AbaParticipante: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, truncado, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    const linhas = useMemo(() => resumoPorParticipante(docs, direcao), [docs, direcao]);
    const rotulo = direcao === 'entrada' ? 'fornecedor' : 'cliente';

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Resumo por ${rotulo} — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} participante(s), NF-e e NFS-e`,
        orientacao: 'landscape',
        colunas: [
            { titulo: rotulo === 'fornecedor' ? 'Fornecedor' : 'Cliente', largura: 30 },
            { titulo: 'CNPJ/CPF', largura: 13 },
            { titulo: 'Município', largura: 16 },
            { titulo: 'UF', largura: 4 },
            { titulo: 'Notas', largura: 6, alinhamento: 'direita' },
            { titulo: 'Valor (R$)', largura: 13, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.nome, l.doc ? fmtCnpj(l.doc) || l.doc : '—', l.municipio || '—', l.uf || '—', l.notas, l.valor]),
        identificacao,
        observacoes: [
            'Contraparte da operação: na nota própria de entrada (tpNF=0, ex.: compra de produtor rural) é o remetente do bloco destinatário.',
            ...obsTruncado(truncado),
        ],
        fileName: `por-${rotulo}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2 flex-wrap">
                {(['entrada', 'saida'] as const).map(d => (
                    <button key={d} onClick={() => setDirecao(d)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg ${direcao === d ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                        {d === 'entrada' ? '🚚 Fornecedores' : '🤝 Clientes'}
                    </button>
                ))}
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                {linhas.length > LIMITE_TELA && (
                    <span className="text-[11px] text-slate-500">mostrando {LIMITE_TELA} de {linhas.length} — o PDF traz todos</span>
                )}
            </div>
            {!linhas.length && <p className="text-xs text-slate-500">Nenhum documento nessa direção no recorte.</p>}
            {linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="text-left py-1">{rotulo === 'fornecedor' ? 'Fornecedor' : 'Cliente'}</th>
                                <th className="text-left">CNPJ/CPF</th><th className="text-left">Município/UF</th>
                                <th className="text-right">Notas</th><th className="text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.slice(0, LIMITE_TELA).map((l, i) => (
                                <tr key={i} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1 font-semibold max-w-[280px] truncate" title={l.nome}>{l.nome}</td>
                                    <td className="font-mono">{l.doc ? (fmtCnpj(l.doc) || l.doc) : '—'}</td>
                                    <td>{[l.municipio, l.uf].filter(Boolean).join('/') || '—'}</td>
                                    <td className="text-right font-mono">{l.notas}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── 5-7. Serviços tomados / prestados / retenções ──────────────────────────

const AbaServicos: React.FC<AbaDocsProps & { modo: 'serv-tomados' | 'serv-prestados' | 'retencoes' }> = ({ docs, empresa, competencia, modo, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const [dirRet, setDirRet] = useState<'entrada' | 'saida'>('entrada');
    const direcao = modo === 'serv-prestados' ? 'saida' : modo === 'serv-tomados' ? 'entrada' : dirRet;
    const linhas = useMemo(
        () => (modo === 'retencoes' ? linhasRetencoes(docs, direcao) : linhasServicos(docs, direcao)),
        [docs, direcao, modo],
    );
    // O diagnóstico olha TODAS as NFS-e do recorte, não a lista já filtrada:
    // na aba Retenções `linhas` só traz notas COM retenção, então contar o
    // aviso ali dava zero justamente quando ele era necessário.
    const diag = useMemo(() => diagnosticoRetencoes(docs, direcao), [docs, direcao]);
    const semRetGravada = modo === 'retencoes'
        ? diag.semCamposGravados
        : linhas.filter(l => !l.retencoesFederaisGravadas).length;

    const titulos: Record<string, string> = {
        'serv-tomados': 'Serviços tomados',
        'serv-prestados': 'Serviços prestados',
        'retencoes': `Retenções — serviços ${direcao === 'entrada' ? 'tomados' : 'prestados'}`,
    };

    const tot = useMemo(() => linhas.reduce((t, l) => ({
        base: t.base + l.base, iss: t.iss + l.iss, issRetido: t.issRetido + l.issRetido,
        pis: t.pis + l.pis, cofins: t.cofins + l.cofins, ir: t.ir + l.ir, inss: t.inss + l.inss, csll: t.csll + l.csll,
        liquido: t.liquido + l.liquido,
    }), { base: 0, iss: 0, issRetido: 0, pis: 0, cofins: 0, ir: 0, inss: 0, csll: 0, liquido: 0 }), [linhas]);

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `${titulos[modo]} — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${linhas.length} NFS-e`,
        colunas: [
            { titulo: 'Data', largura: 7 }, { titulo: 'Nº', largura: 7 },
            { titulo: direcao === 'entrada' ? 'Prestador' : 'Tomador', largura: 22 },
            { titulo: 'Base', largura: 9, alinhamento: 'direita' },
            { titulo: 'ISS', largura: 7, alinhamento: 'direita' },
            { titulo: 'ISS ret.', largura: 7, alinhamento: 'direita' },
            { titulo: 'PIS', largura: 7, alinhamento: 'direita' },
            { titulo: 'COFINS', largura: 7, alinhamento: 'direita' },
            { titulo: 'IR', largura: 7, alinhamento: 'direita' },
            { titulo: 'INSS', largura: 7, alinhamento: 'direita' },
            { titulo: 'CSLL', largura: 7, alinhamento: 'direita' },
            { titulo: 'Líquido', largura: 9, alinhamento: 'direita' },
        ],
        linhas: linhas.map(l => [l.data, l.numero, l.participante, l.base, l.iss, l.issRetido, l.pis, l.cofins, l.ir, l.inss, l.csll, l.liquido]),
        totais: ['', '', `TOTAIS (${linhas.length})`, tot.base, tot.iss, tot.issRetido, tot.pis, tot.cofins, tot.ir, tot.inss, tot.csll, tot.liquido],
        identificacao,
        observacoes: [
            ...(semRetGravada > 0 ? [`${semRetGravada} nota(s) importadas antes de 01/08/2026 não têm IR/INSS/CSLL gravados — ausência NÃO significa zero retido; reimporte o XML para completar.`] : []),
            ...(modo === 'retencoes' ? [diag.mensagem] : []),
        ],
        fileName: `${modo}-${direcao}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2 flex-wrap">
                {modo === 'retencoes' && (
                    <select value={dirRet} onChange={e => setDirRet(e.target.value as any)}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                        <option value="entrada">Serviços tomados</option>
                        <option value="saida">Serviços prestados</option>
                    </select>
                )}
                <BotaoPdf onClick={pdf} disabled={!linhas.length} gerando={gerando} />
                <span className="text-xs text-slate-500">
                    {linhas.length} NFS-e · base {fmtBRL(tot.base)} · ISS {fmtBRL(tot.iss)}
                    {modo === 'retencoes' && ` · retenções ${fmtBRL(tot.issRetido + tot.pis + tot.cofins + tot.ir + tot.inss + tot.csll)}`}
                </span>
            </div>
            {semRetGravada > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ {semRetGravada} nota(s) antigas sem IR/INSS/CSLL gravados — ausência não significa zero retido (reimporte o XML pra completar).
                </p>
            )}
            {linhas.length === 0 && (
                modo === 'retencoes'
                    ? (
                        <p className={`text-sm ${diag.podeAfirmarZero ? 'text-slate-500' : 'text-amber-700 dark:text-amber-400'}`}>
                            {diag.podeAfirmarZero ? '' : '⚠ '}{diag.mensagem}
                        </p>
                    )
                    : <p className="text-sm text-slate-500">Nenhuma NFS-e {direcao === 'entrada' ? 'tomada' : 'prestada'} neste recorte.</p>
            )}
        </Card>
    );
};

// ─── Serviços por CÓDIGO DE SERVIÇO ─────────────────────────────────────────
// Pedido do colaborador via Paulo (10/08): conferência da apuração dos
// impostos de serviço consolidada por código, com subtotais e retenções.
// NENHUMA conta nova: agrupa as MESMAS linhas de linhasServicos (o subtotal
// do grupo É a linha; total geral no rodapé). O período é a competência do
// recorte — o mesmo filtro das demais abas.

const AbaServicosPorCodigo: React.FC<AbaDocsProps> = ({ docs, empresa, competencia, identificacao }) => {
    const { gerando, rodar } = usePdf();
    const [direcao, setDirecao] = useState<'saida' | 'entrada'>('saida');
    const grupos = useMemo(() => servicosPorCodigo(docs, direcao), [docs, direcao]);
    const diag = useMemo(() => diagnosticoRetencoes(docs, direcao), [docs, direcao]);
    const semCodigo = grupos.find(g => !g.codigo);

    const tot = useMemo(() => grupos.reduce((t, g) => ({
        notas: t.notas + g.notas, bruto: t.bruto + g.bruto, issRetido: t.issRetido + g.issRetido,
        ir: t.ir + g.ir, pis: t.pis + g.pis, cofins: t.cofins + g.cofins,
        csll: t.csll + g.csll, inss: t.inss + g.inss,
        totalRetido: t.totalRetido + g.totalRetido, liquido: t.liquido + g.liquido,
    }), { notas: 0, bruto: 0, issRetido: 0, ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0, totalRetido: 0, liquido: 0 }), [grupos]);

    const pdf = () => rodar(() => gerarRelatorioPdf({
        titulo: `Serviços ${direcao === 'saida' ? 'prestados' : 'tomados'} por código de serviço — ${fmtComp(competencia)}`,
        subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${grupos.length} código(s) · ${tot.notas} NFS-e`,
        colunas: [
            { titulo: 'Código', largura: 8 },
            { titulo: 'Descrição (da nota)', largura: 24 },
            { titulo: 'NFS-e', largura: 5, alinhamento: 'direita' },
            { titulo: 'Bruto', largura: 10, alinhamento: 'direita' },
            { titulo: 'ISS ret.', largura: 8, alinhamento: 'direita' },
            { titulo: 'IRRF', largura: 8, alinhamento: 'direita' },
            { titulo: 'PIS', largura: 7, alinhamento: 'direita' },
            { titulo: 'COFINS', largura: 8, alinhamento: 'direita' },
            { titulo: 'CSLL', largura: 7, alinhamento: 'direita' },
            { titulo: 'INSS', largura: 7, alinhamento: 'direita' },
            { titulo: 'Retido', largura: 8, alinhamento: 'direita' },
            { titulo: 'Líquido', largura: 10, alinhamento: 'direita' },
        ],
        linhas: grupos.map(g => [
            g.codigo || '—', g.descricaoExemplo, g.notas, g.bruto, g.issRetido,
            g.ir, g.pis, g.cofins, g.csll, g.inss, g.totalRetido, g.liquido,
        ]),
        totais: ['', `TOTAL GERAL (${grupos.length} código(s))`, tot.notas, tot.bruto, tot.issRetido,
            tot.ir, tot.pis, tot.cofins, tot.csll, tot.inss, tot.totalRetido, tot.liquido],
        identificacao,
        observacoes: [
            `Total geral dos impostos retidos: ${fmtBRL(tot.totalRetido)} (ISS retido + IRRF + PIS + COFINS + CSLL + INSS).`,
            'A descrição é a discriminação mais frequente das notas do grupo — não existe tabela oficial código→descrição no app.',
            ...(semCodigo ? [`${semCodigo.notas} nota(s) sem código de serviço gravado (trilho ADN/nota antiga) agrupadas em "Sem código" — elas contam nos totais.`] : []),
            ...(diag.semCamposGravados > 0 ? [`${diag.semCamposGravados} nota(s) importadas antes de 01/08/2026 não têm IR/INSS/CSLL gravados — ausência NÃO significa zero retido; reimporte o XML para completar.`] : []),
        ],
        fileName: `servicos-por-codigo-${direcao}-${empresa.cnpj.replace(/\D/g, '')}-${competencia}.pdf`,
    }));

    return (
        <Card>
            <div className="flex items-center gap-2 flex-wrap">
                <select value={direcao} onChange={e => setDirecao(e.target.value as any)}
                    className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                    <option value="saida">Serviços prestados</option>
                    <option value="entrada">Serviços tomados</option>
                </select>
                <BotaoPdf onClick={pdf} disabled={!grupos.length} gerando={gerando} />
                <span className="text-xs text-slate-500">
                    {grupos.length} código(s) · {tot.notas} NFS-e · bruto {fmtBRL(tot.bruto)} · retido {fmtBRL(tot.totalRetido)} · líquido {fmtBRL(tot.liquido)}
                </span>
            </div>
            {diag.semCamposGravados > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ {diag.semCamposGravados} nota(s) antigas sem IR/INSS/CSLL gravados — ausência não significa zero retido (reimporte o XML pra completar).
                </p>
            )}
            {grupos.length === 0 && (
                <p className="text-sm text-slate-500">Nenhuma NFS-e {direcao === 'entrada' ? 'tomada' : 'prestada'} neste recorte.</p>
            )}
            {grupos.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-1 pr-2">Código</th>
                                <th className="py-1 pr-2">Descrição (da nota)</th>
                                <th className="py-1 pr-2 text-right">NFS-e</th>
                                <th className="py-1 pr-2 text-right">Bruto</th>
                                <th className="py-1 pr-2 text-right">ISS ret.</th>
                                <th className="py-1 pr-2 text-right">IRRF</th>
                                <th className="py-1 pr-2 text-right">PIS</th>
                                <th className="py-1 pr-2 text-right">COFINS</th>
                                <th className="py-1 pr-2 text-right">CSLL</th>
                                <th className="py-1 pr-2 text-right">INSS</th>
                                <th className="py-1 pr-2 text-right font-bold">Retido</th>
                                <th className="py-1 text-right">Líquido</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grupos.map(g => (
                                <tr key={g.codigo || 'sem'} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1 pr-2 font-mono font-bold">{g.codigo || '—'}</td>
                                    <td className="py-1 pr-2 max-w-[260px] truncate" title={g.descricaoExemplo}>{g.descricaoExemplo}</td>
                                    <td className="py-1 pr-2 text-right">{g.notas}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.bruto)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.issRetido)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.ir)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.pis)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.cofins)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.csll)}</td>
                                    <td className="py-1 pr-2 text-right">{fmtBRL(g.inss)}</td>
                                    <td className="py-1 pr-2 text-right font-bold">{fmtBRL(g.totalRetido)}</td>
                                    <td className="py-1 text-right">{fmtBRL(g.liquido)}</td>
                                </tr>
                            ))}
                            <tr className="font-bold bg-slate-50 dark:bg-slate-700/40">
                                <td className="py-1 pr-2" colSpan={2}>TOTAL GERAL</td>
                                <td className="py-1 pr-2 text-right">{tot.notas}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.bruto)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.issRetido)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.ir)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.pis)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.cofins)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.csll)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.inss)}</td>
                                <td className="py-1 pr-2 text-right">{fmtBRL(tot.totalRetido)}</td>
                                <td className="py-1 text-right">{fmtBRL(tot.liquido)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

// ─── 8. Faturamento por carteira ────────────────────────────────────────────

const AbaFaturamento: React.FC<{ competencia: string }> = ({ competencia }) => {
    const [dados, setDados] = useState<FaturamentoResp | null>(null);
    const [loading, setLoading] = useState(false);
    const { gerando, rodar } = usePdf();

    const buscar = async () => {
        setLoading(true);
        try { setDados(await carregarFaturamento(competencia)); } finally { setLoading(false); }
    };

    const pdf = () => {
        if (!dados?.ok || !dados.linhas?.length || !dados.totais) return;
        const totais = dados.totais;
        rodar(() => gerarRelatorioPdf({
            titulo: `Faturamento por cliente — ${fmtComp(competencia)}`,
            subtitulo: `${dados.linhas!.length} empresa(s) com movimento · escopo: ${dados.escopo === 'carteira' ? 'sua carteira' : 'todas'}`,
            colunas: [
                { titulo: 'Cliente', largura: 26 }, { titulo: 'CNPJ', largura: 12 },
                { titulo: 'Regime', largura: 6 }, { titulo: 'Responsável', largura: 12 },
                { titulo: 'Entradas (qtd)', largura: 7, alinhamento: 'direita' },
                { titulo: 'Entradas (R$)', largura: 11, alinhamento: 'direita' },
                { titulo: 'Saídas (qtd)', largura: 7, alinhamento: 'direita' },
                { titulo: 'Saídas (R$)', largura: 11, alinhamento: 'direita' },
            ],
            linhas: dados.linhas!.map(l => [
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
        }));
    };

    return (
        <Card>
            <div className="flex items-center gap-2">
                <button onClick={buscar} disabled={loading}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {loading ? 'Consolidando…' : '🔎 Consolidar competência'}
                </button>
                <BotaoPdf onClick={pdf} disabled={!dados?.ok || !dados.linhas?.length} gerando={gerando} />
            </div>
            {dados && !dados.ok && <p className="text-sm text-red-600">{dados.error}</p>}
            {dados?.ok && (
                <p className="text-xs text-slate-500">
                    {dados.linhas!.length} empresa(s) com movimento · entradas {fmtBRL(dados.totais!.entradasValor)} · saídas {fmtBRL(dados.totais!.saidasValor)} · {dados.semMovimento} sem movimento
                </p>
            )}
        </Card>
    );
};

// ─── 9. Impostos apurados × enviados ────────────────────────────────────────

const AbaImpostosEnviados: React.FC<{ competencia: string }> = ({ competencia }) => {
    const [dados, setDados] = useState<PainelRotina | null>(null);
    const [loading, setLoading] = useState(false);
    const { gerando, rodar } = usePdf();

    const buscar = async () => {
        setLoading(true);
        try { setDados(await carregarRotinaFiscal(competencia)); } finally { setLoading(false); }
    };

    const linhas = useMemo(() => (dados?.rotinas || []).map(r => {
        const ap = r.etapas.find(e => e.id === 'apuracao');
        const gu = r.etapas.find(e => e.id === 'guias');
        return {
            nome: r.empresa?.nome || '—', cnpj: r.empresa?.cnpj || '',
            regime: r.empresa?.regime === 'simples' ? 'SN' : 'LP/LR',
            apurado: ap?.status === 'concluida' ? (ap?.totalImpostos ?? null) : null,
            statusApuracao: ap?.status || '—',
            envios: gu?.envios ?? 0, completos: gu?.completos ?? 0,
            statusGuias: gu?.status || '—',
        };
    }), [dados]);

    const pdf = () => {
        if (!linhas.length) return;
        const rotulo: Record<string, string> = { concluida: 'OK', atencao: 'ATENÇÃO', pendente: 'PENDENTE', na: 'N/A' };
        rodar(() => gerarRelatorioPdf({
            titulo: `Impostos apurados × enviados — ${fmtComp(competencia)}`,
            subtitulo: `${linhas.length} empresa(s) · escopo: ${dados?.escopo === 'carteira' ? 'sua carteira' : 'todas'} · rito: SharePoint + gestor + baixa`,
            colunas: [
                { titulo: 'Cliente', largura: 28 }, { titulo: 'CNPJ', largura: 12 },
                { titulo: 'Regime', largura: 6 }, { titulo: 'Apuração', largura: 9 },
                { titulo: 'Impostos (R$)', largura: 10, alinhamento: 'direita' },
                { titulo: 'Envios', largura: 6, alinhamento: 'direita' },
                { titulo: 'Rito completo', largura: 7, alinhamento: 'direita' },
                { titulo: 'Situação guias', largura: 9 },
            ],
            linhas: linhas.map(l => [
                l.nome, fmtCnpj(l.cnpj), l.regime, rotulo[l.statusApuracao] || l.statusApuracao,
                l.apurado ?? '—', l.envios, l.completos, rotulo[l.statusGuias] || l.statusGuias,
            ]),
            observacoes: ['Apuração e envios saem do painel Rotina do Mês — nenhuma etapa se marca à mão; "rito completo" = cópia no SharePoint + baixa da obrigação.'],
            fileName: `impostos-apurados-enviados-${competencia}.pdf`,
        }));
    };

    return (
        <Card>
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
                    {linhas.length} empresa(s) · {linhas.filter(l => l.statusGuias === 'concluida').length} com guias pelo rito completo · {linhas.filter(l => l.statusApuracao !== 'concluida').length} sem apuração fechada
                </p>
            )}
        </Card>
    );
};

// ─── 10. DIPAM/FUNRURAL ─────────────────────────────────────────────────────

const AbaDipam: React.FC<{ competencia: string }> = ({ competencia }) => {
    const [dados, setDados] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const { gerando, rodar } = usePdf();

    const buscar = async () => {
        setLoading(true);
        try { setDados(await varrerDipam(competencia)); } finally { setLoading(false); }
    };

    const pdf = () => {
        const linhas: DipamVarreduraLinha[] = dados?.linhas || [];
        if (!linhas.length) return;
        rodar(() => gerarRelatorioPdf({
            titulo: `DIPAM 1.1 e FUNRURAL — ${fmtComp(competencia)}`,
            subtitulo: `${linhas.length} cliente(s) com compra de produtor rural · Manual da DIPAM 2026 (SPDIPAM11) · LC 224/2025`,
            colunas: [
                { titulo: 'Cliente', largura: 28 }, { titulo: 'CNPJ', largura: 12 },
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
            ],
            fileName: `dipam-funrural-${competencia}.pdf`,
        }));
    };

    return (
        <Card>
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
                    {dados.linhas.length} cliente(s) · DIPAM {fmtBRL(dados.linhas.reduce((s: number, l: any) => s + l.dipamTotal, 0))} · FUNRURAL {fmtBRL(dados.linhas.reduce((s: number, l: any) => s + l.funruralTotal, 0))}
                    {dados.linhas.some((l: any) => l.pendencias > 0) && ' · ⚠ há pendências'}
                </p>
            )}
        </Card>
    );
};

// ─── 11. Ficha Financeira (Lucro) ───────────────────────────────────────────

const AbaFicha: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<lucroPresumidoService.LucroEmpresaResumo[]>([]);
    const [empresaId, setEmpresaId] = useState('');
    const [loading, setLoading] = useState(false);
    const { gerando, rodar } = usePdf();

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        // Lista LEVE (só cadastro): baixar a ficha de TODAS as empresas para
        // escolher UMA era o caminho pesado dito no PR #684. A ficha vem no
        // efeito abaixo, da empresa escolhida, uma leitura por id.
        lucroPresumidoService.getEmpresasResumo(currentUser)
            .then(r => { if (alive) setEmpresas(r.empresas); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [currentUser]);

    const [empresaCompleta, setEmpresaCompleta] = useState<LucroPresumidoEmpresa | null>(null);
    React.useEffect(() => {
        let alive = true;
        if (!empresaId) { setEmpresaCompleta(null); return; }
        lucroPresumidoService.getEmpresaCompleta(empresaId)
            .then(e => { if (alive) setEmpresaCompleta(e); });
        return () => { alive = false; };
    }, [empresaId]);

    const empresa = empresaCompleta;
    const fichas = useMemo(
        () => (empresa?.fichaFinanceira || []).slice().sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia)),
        [empresa],
    );

    const pdf = () => {
        if (!empresa || !fichas.length) return;
        rodar(() => gerarRelatorioPdf({
            titulo: `Ficha Financeira — ${empresa.nome}`,
            subtitulo: `${fmtCnpj(empresa.cnpj)} · ${empresa.regimePadrao === 'Real' ? 'Lucro Real' : 'Lucro Presumido'} · ${fichas.length} mês(es)`,
            colunas: [
                { titulo: 'Mês', largura: 7 },
                { titulo: 'Faturamento', largura: 11, alinhamento: 'direita' },
                { titulo: 'Monofásico', largura: 9, alinhamento: 'direita' },
                { titulo: 'Devoluções', largura: 9, alinhamento: 'direita' },
                { titulo: 'IPI', largura: 8, alinhamento: 'direita' },
                { titulo: 'ICMS vendas', largura: 9, alinhamento: 'direita' },
                { titulo: 'Ret. PIS', largura: 8, alinhamento: 'direita' },
                { titulo: 'Ret. COFINS', largura: 8, alinhamento: 'direita' },
                { titulo: 'Ret. IRPJ', largura: 8, alinhamento: 'direita' },
                { titulo: 'Ret. CSLL', largura: 8, alinhamento: 'direita' },
                { titulo: 'Total impostos', largura: 10, alinhamento: 'direita' },
                { titulo: 'Carga %', largura: 6, alinhamento: 'direita' },
            ],
            linhas: fichas.map(f => [
                f.mesReferencia.split('-').reverse().join('/'),
                f.faturamentoMesTotal || 0, f.faturamentoMonofasico || 0, f.valorDevolucoes || 0,
                f.valorIpi || 0, f.icmsVendas || 0,
                f.retencaoPis || 0, f.retencaoCofins || 0, f.retencaoIrpj || 0, f.retencaoCsll || 0,
                f.totalImpostos || 0, f.cargaTributaria || 0,
            ]),
            identificacao: montarIdentificacao((empresa as any).dadosFiscais),
            observacoes: [
                'Mesmos números da Ficha Financeira do módulo Lucro Presumido/Real (retenções deduzidas na apuração — regra #298: conferência usa o LÍQUIDO).',
            ],
            fileName: `ficha-financeira-${empresa.cnpj.replace(/\D/g, '')}.pdf`,
        }));
    };

    return (
        <Card>
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[280px] flex-1">
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa (Lucro Presumido/Real)</label>
                    <EmpresaSearchSelect
                        empresas={opcoesLucro(empresas)}
                        value={empresaId}
                        onChange={setEmpresaId}
                        placeholder={loading ? 'Carregando…' : 'Buscar por código, nome ou CNPJ…'}
                    />
                </div>
                <BotaoPdf onClick={pdf} disabled={!fichas.length} gerando={gerando} />
            </div>
            {empresa && !fichas.length && <p className="text-sm text-slate-500">Esta empresa não tem fichas lançadas.</p>}
            {fichas.length > 0 && (
                <p className="text-xs text-slate-500">
                    {fichas.length} mês(es) · último: {fichas[fichas.length - 1]?.mesReferencia.split('-').reverse().join('/')} · faturamento acumulado {fmtBRL(fichas.reduce((s, f) => s + (f.faturamentoMesTotal || 0), 0))}
                </p>
            )}
        </Card>
    );
};

export default RelatoriosHub;

// ─── Declaração de faturamento ──────────────────────────────────────────────
//
// Pedido do Paulo (05/08) no modelo do PDF do SAGE, "de forma melhorada, com
// nossa assinatura de layout". É o ÚNICO item do menu que sai assinado do
// escritório (banco, licitação, locador) — por isso o app PROPÕE os valores a
// partir dos registros fiscais e o responsável CONFIRMA mês a mês. Valor
// ajustado à mão sai MARCADO no papel.
const AbaDeclaracao: React.FC<{
    empresas: EmpresaXmlOption[];
    onShowToast?: (m: string) => void;
}> = ({ empresas, onShowToast }) => {
    const { gerando, rodar } = usePdf();
    const hoje = new Date();
    const [empresaId, setEmpresaId] = useState('');
    const [de, setDe] = useState(`${hoje.getFullYear()}-01`);
    const [ate, setAte] = useState(competenciaAtual());
    const [destinatario, setDestinatario] = useState('');
    const [cidade, setCidade] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [meses, setMeses] = useState<MesDeclaracao[] | null>(null);
    const [ajustes, setAjustes] = useState<Record<string, number>>({});
    const [apurado, setApurado] = useState<Record<string, { valor: number; docs: number }>>({});
    const [dadosFiscais, setDadosFiscais] = useState<any>(null);

    const empresa = empresas.find(e => e.id === empresaId) || null;

    const buscar = async (idOverride?: unknown) => {
        const idAlvo = typeof idOverride === 'string' ? idOverride : empresaId;
        const alvo = empresas.find(e => e.id === idAlvo) || null;
        if (!alvo) { onShowToast?.('Escolha a empresa.'); return; }
        const competencias = mesesDoPeriodo(de, ate);
        if (!competencias.length) { onShowToast?.('Período inválido — confira o mês inicial e o final (máx. 60 meses).'); return; }
        setBuscando(true);
        try {
            const [r, df] = await Promise.all([
                carregarFaturamentoMensal(alvo.id, de, ate),
                getIdentificacaoEmpresa(alvo),
            ]);
            if (!r.ok) { onShowToast?.(r.error || 'Falha ao apurar o faturamento.'); return; }
            setDadosFiscais(df);
            setApurado(r.porMes || {});
            setAjustes({});
            setMeses(montarMeses(competencias, (r.porMes || {}) as any, {}));
        } finally {
            setBuscando(false);
        }
    };

    const editar = (competencia: string, texto: string) => {
        const v = Number(String(texto).replace(/\./g, '').replace(',', '.'));
        const novos = { ...ajustes };
        if (texto.trim() === '') delete novos[competencia];
        else if (Number.isFinite(v)) novos[competencia] = v;
        setAjustes(novos);
        setMeses(montarMeses(mesesDoPeriodo(de, ate), apurado as any, novos));
    };

    const total = meses ? totalDeclaracao(meses) : 0;
    const avisos = meses ? avisosDaDeclaracao(meses) : [];

    const pdf = () => rodar(() => gerarDeclaracaoFaturamentoPdf({
        destinatario: destinatario.trim() || null,
        empresa: {
            nome: empresa?.nome || '—',
            cnpj: empresa?.cnpj || '',
            endereco: [dadosFiscais?.logradouro, dadosFiscais?.numero, dadosFiscais?.complemento].filter(Boolean).join(', ') || null,
            bairro: dadosFiscais?.bairro || null,
            cidade: cidade.trim() || null,
            uf: dadosFiscais?.uf || null,
            telefone: dadosFiscais?.telefone || null,
            inscricaoEstadual: dadosFiscais?.inscricaoEstadual || null,
            inscricaoMunicipal: dadosFiscais?.ccmSp || dadosFiscais?.inscricaoMunicipal || null,
            cnae: dadosFiscais?.cnae || null,
            regimeTributario: empresa?.fonte === 'lucro' ? 'Lucro Presumido/Real' : 'Simples Nacional',
        },
        meses: (meses || []).map(m => ({ competencia: m.competencia, valor: m.valor, ajustado: m.ajustado })),
        localAssinatura: cidade.trim() || null,
        identificacao: montarIdentificacao(dadosFiscais),
        observacoes: avisos,
        fileName: `declaracao-faturamento-${(empresa?.cnpj || '').replace(/\D/g, '')}-${de}_${ate}.pdf`,
    }));

    return (
        <Card>
            <div className="flex flex-wrap gap-3 items-end">
                <div className="min-w-[260px] flex-1">
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa</label>
                    <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId}
                        onAtivar={id => void buscar(id)} />
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">De</label>
                    <input type="month" value={de} onChange={e => setDe(e.target.value)}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Até</label>
                    <input type="month" value={ate} onChange={e => setAte(e.target.value)}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                </div>
                <button onClick={buscar} disabled={buscando || !empresaId}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                    {buscando ? 'Apurando…' : '🔎 Apurar faturamento'}
                </button>
            </div>

            {meses && (
                <>
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="min-w-[240px] flex-1">
                            <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Destinatário (opcional)</label>
                            <input value={destinatario} onChange={e => setDestinatario(e.target.value)}
                                placeholder="Ex.: BANCO DO BRASIL S.A."
                                className="w-full p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Cidade (assinatura)</label>
                            <input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="São Paulo"
                                className="w-full p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                        </div>
                        <BotaoPdf onClick={pdf} disabled={!meses.length} gerando={gerando} />
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-1">Mês</th>
                                    <th className="py-1 text-right">Apurado (registros fiscais)</th>
                                    <th className="py-1 text-right">Vai no documento</th>
                                    <th className="py-1">&nbsp;</th>
                                </tr>
                            </thead>
                            <tbody>
                                {meses.map(m => (
                                    <tr key={m.competencia} className="border-b border-slate-100 dark:border-slate-700/50">
                                        <td className="py-1">{fmtComp(m.competencia)}</td>
                                        <td className="py-1 text-right tabular-nums text-slate-500">{fmtBRL(m.apurado)}</td>
                                        <td className="py-1 text-right">
                                            <input
                                                value={ajustes[m.competencia] !== undefined ? String(ajustes[m.competencia]) : ''}
                                                onChange={e => editar(m.competencia, e.target.value)}
                                                placeholder={m.apurado.toFixed(2)}
                                                className="w-32 p-1 text-sm text-right rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 tabular-nums"
                                            />
                                        </td>
                                        <td className="py-1 text-[11px]">
                                            {m.semDocumentos && <span className="text-amber-600">⚠ sem documento capturado</span>}
                                            {m.ajustado && <span className="text-indigo-600 ml-2">ajustado</span>}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="font-bold">
                                    <td className="py-1">TOTAL</td>
                                    <td className="py-1 text-right tabular-nums text-slate-500">
                                        {fmtBRL(meses.reduce((t, m) => t + m.apurado, 0))}
                                    </td>
                                    <td className="py-1 text-right tabular-nums">{fmtBRL(total)}</td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {avisos.map((a, i) => (
                        <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {a}</p>
                    ))}
                    <p className="text-[11px] text-slate-500">
                        O valor apurado é a soma das saídas autorizadas da competência (NF-e, NFC-e e NFS-e) — a mesma
                        régua do relatório de Faturamento por carteira. Este documento sai ASSINADO: confira mês a mês
                        antes de gerar.
                    </p>
                </>
            )}
        </Card>
    );
};

// ─── Apuração trimestral (Lucro Presumido) ──────────────────────────────────
//
// Paulo (05/08): "segue um resumo que já conseguimos extrair do CFI, porém o
// relatório ainda não existe, era feito em modelo Excel". É a tabela de
// apuração do trimestre — faturamento dos 3 meses, presunção, receita
// financeira, IRPJ, adicional e CSLL.
//
// REGRA DO MENU: conta nenhuma aqui. O trimestre é MONTADO por
// `montarApuracaoTrimestre` (seleção + somas) e os TRIBUTOS vêm de
// `calcularLucro` — o mesmo motor da ficha e do DARF, chamado do mesmo jeito
// que a ReportView do módulo Lucro (com as retenções acumuladas do trimestre).
const AbaTrimestre: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const { gerando, rodar } = usePdf();
    const [empresas, setEmpresas] = useState<lucroPresumidoService.LucroEmpresaResumo[]>([]);
    const [empresaId, setEmpresaId] = useState('');
    const [chaveTri, setChaveTri] = useState('');
    const [loading, setLoading] = useState(false);

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        // Lista LEVE (só cadastro): baixar a ficha de TODAS as empresas para
        // escolher UMA era o caminho pesado dito no PR #684. A ficha vem no
        // efeito abaixo, da empresa escolhida, uma leitura por id.
        lucroPresumidoService.getEmpresasResumo(currentUser)
            .then(r => { if (alive) setEmpresas(r.empresas); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [currentUser]);

    const [empresaCompleta, setEmpresaCompleta] = useState<LucroPresumidoEmpresa | null>(null);
    React.useEffect(() => {
        let alive = true;
        if (!empresaId) { setEmpresaCompleta(null); return; }
        lucroPresumidoService.getEmpresaCompleta(empresaId)
            .then(e => { if (alive) setEmpresaCompleta(e); });
        return () => { alive = false; };
    }, [empresaId]);

    const empresa = empresaCompleta;
    const fichas = useMemo(() => empresa?.fichaFinanceira || [], [empresa]);
    const trimestres = useMemo(() => trimestresDisponiveis(fichas), [fichas]);

    React.useEffect(() => {
        setChaveTri(trimestres.length ? `${trimestres[0].ano}-${trimestres[0].trimestre}` : '');
    }, [empresaId, trimestres.length]);

    const [anoSel, triSel] = chaveTri ? chaveTri.split('-').map(Number) : [0, 0];
    const tri = useMemo(
        () => (empresa && anoSel ? montarApuracaoTrimestre(fichas, anoSel, triSel) : null),
        [empresa, fichas, anoSel, triSel],
    );

    // Tributos do trimestre: MESMA chamada da ReportView do módulo Lucro.
    const resultado = useMemo(() => {
        if (!tri?.fichaFechamento || !empresa) return null;
        const base = convertFichaToInput(tri.fichaFechamento, empresa);
        const ret = getRetencoesAcumuladasTrimestre(empresa, tri.fichaFechamento.mesReferencia, 'Trimestral');
        return calcularLucro({
            ...base,
            retencaoIrpj: (base.retencaoIrpj || 0) + ret.irpj,
            retencaoCsll: (base.retencaoCsll || 0) + ret.csll,
        });
    }, [tri, empresa]);

    // IRPJ sai em DUAS linhas — 15% e adicional de 10% —, como o demonstrativo
    // do E-Fiscal e a planilha do escritório sempre mostraram (Paulo, 05/08:
    // "consegue desmembrar o IRPJ?"). O motor devolve o IRPJ somado; o
    // `adicional`/`baseAdicional` vêm junto só pra permitir esta separação.
    const linhasTributo = useMemo(() => {
        const out: Array<{ imposto: string; baseCalculo: number; aliquota: number; retencao: number; valor: number }> = [];
        for (const d of resultado?.detalhamento || []) {
            if (!/IRPJ|CSLL/i.test(d.imposto)) continue;
            const adicional = Number(d.adicional || 0);
            if (/IRPJ/i.test(d.imposto) && adicional > 0) {
                const bruto = Number(d.valorBruto || 0) - adicional;
                out.push({
                    imposto: 'IRPJ (15%)',
                    baseCalculo: d.baseCalculo,
                    aliquota: d.aliquota,
                    retencao: Number(d.retencao || 0),
                    valor: Math.max(0, bruto - Number(d.retencao || 0)),
                });
                out.push({
                    imposto: 'Adicional de IRPJ (10%)',
                    baseCalculo: Number(d.baseAdicional || 0),
                    aliquota: 10,
                    retencao: 0,
                    valor: adicional,
                });
                continue;
            }
            out.push({
                imposto: d.imposto,
                baseCalculo: d.baseCalculo,
                aliquota: d.aliquota,
                retencao: Number(d.retencao || 0),
                valor: d.valor,
            });
        }
        return out;
    }, [resultado]);

    const pdf = () => {
        if (!tri || !empresa) return;
        rodar(() => gerarRelatorioPdf({
            titulo: `Apuração trimestral — ${tri.rotulo}`,
            subtitulo: `${empresa.nome} · ${fmtCnpj(empresa.cnpj)} · ${empresa.regimePadrao === 'Real' ? 'Lucro Real' : 'Lucro Presumido'}`,
            orientacao: 'portrait',
            colunas: [
                { titulo: 'Composição do trimestre', largura: 30 },
                { titulo: 'Base', largura: 14, alinhamento: 'direita' },
                { titulo: 'Alíquota', largura: 8, alinhamento: 'direita' },
                { titulo: 'Retenção', largura: 12, alinhamento: 'direita' },
                { titulo: 'Valor', largura: 14, alinhamento: 'direita' },
            ],
            linhas: [
                ...tri.meses.map(m => [
                    `Faturamento ${fmtComp(m.competencia)}${m.ausente ? ' (sem ficha)' : ''}`,
                    '', '', '', m.faturamento,
                ]),
                ['Receita financeira do trimestre', '', '', '', tri.totalReceitaFinanceira],
                ['Retenções na fonte do trimestre (IRPJ / CSLL)', '', '',
                    tri.totalRetencaoIrpj, tri.totalRetencaoCsll],
                ...linhasTributo.map(d => [d.imposto, d.baseCalculo, `${d.aliquota}%`, d.retencao, d.valor]),
            ],
            totais: ['Faturamento total do trimestre', '', '', '', tri.totalFaturamento],
            identificacao: montarIdentificacao(empresa.dadosFiscais),
            observacoes: [
                'IRPJ e CSLL do Lucro Presumido são TRIMESTRAIS (Lei 9.430/96 art. 1º); PIS, COFINS e IPI seguem mensais e não entram nesta tabela.',
                'Tributos calculados pelo mesmo motor da ficha do módulo Lucro e do DARF — retenção na fonte deduzida na apuração (regra #298).',
                ...tri.pendencias,
            ],
            fileName: `apuracao-trimestral-${empresa.cnpj.replace(/\D/g, '')}-${tri.ano}T${tri.trimestre}.pdf`,
        }));
    };

    return (
        <Card>
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[280px] flex-1">
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa (Lucro Presumido/Real)</label>
                    <EmpresaSearchSelect
                        empresas={opcoesLucro(empresas)}
                        value={empresaId}
                        onChange={setEmpresaId}
                        placeholder={loading ? 'Carregando…' : 'Buscar por código, nome ou CNPJ…'}
                    />
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Trimestre</label>
                    <select value={chaveTri} onChange={e => setChaveTri(e.target.value)} disabled={!trimestres.length}
                        className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                        {trimestres.map(t => (
                            <option key={`${t.ano}-${t.trimestre}`} value={`${t.ano}-${t.trimestre}`}>{t.rotulo}</option>
                        ))}
                        {!trimestres.length && <option value="">— sem fichas —</option>}
                    </select>
                </div>
                <BotaoPdf onClick={pdf} disabled={!tri} gerando={gerando} />
            </div>

            {empresa && !trimestres.length && (
                <p className="text-sm text-slate-500">Esta empresa não tem fichas lançadas no módulo Lucro.</p>
            )}

            {tri && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <tbody>
                            {tri.meses.map(m => (
                                <tr key={m.competencia} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1">
                                        Faturamento {fmtComp(m.competencia)}
                                        {m.ausente && <span className="text-amber-600 text-[11px] ml-2">⚠ sem ficha lançada</span>}
                                        {m.lancadoComoMensal && <span className="text-amber-600 text-[11px] ml-2">⚠ lançado como Mensal</span>}
                                    </td>
                                    <td className="py-1 text-right tabular-nums">{fmtBRL(m.faturamento)}</td>
                                </tr>
                            ))}
                            <tr className="border-b border-slate-200 dark:border-slate-700 font-bold">
                                <td className="py-1">Total do trimestre</td>
                                <td className="py-1 text-right tabular-nums">{fmtBRL(tri.totalFaturamento)}</td>
                            </tr>
                            <tr className="border-b border-slate-100 dark:border-slate-700/50">
                                <td className="py-1">Receita financeira</td>
                                <td className="py-1 text-right tabular-nums">{fmtBRL(tri.totalReceitaFinanceira)}</td>
                            </tr>
                            <tr className="border-b border-slate-100 dark:border-slate-700/50">
                                <td className="py-1">Retenções na fonte (IRPJ / CSLL)</td>
                                <td className="py-1 text-right tabular-nums">
                                    {fmtBRL(tri.totalRetencaoIrpj)} / {fmtBRL(tri.totalRetencaoCsll)}
                                </td>
                            </tr>
                            {linhasTributo.map(d => (
                                <tr key={d.imposto} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1">
                                        {d.imposto}
                                        <span className="text-[11px] text-slate-500 ml-2">
                                            base {fmtBRL(d.baseCalculo)} · {d.aliquota}%
                                        </span>
                                    </td>
                                    <td className="py-1 text-right tabular-nums font-semibold">{fmtBRL(d.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {tri?.pendencias.map((p, i) => (
                <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {p}</p>
            ))}
            {tri && !tri.fechado && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                    O trimestre não está fechado — a tabela mostra o que existe, mas IRPJ/CSLL só saem
                    corretos com os 3 meses lançados e o mês de fechamento como Trimestral.
                </p>
            )}
            <p className="text-[11px] text-slate-500">
                IRPJ e CSLL do Presumido são trimestrais (Lei 9.430/96 art. 1º) — PIS, COFINS e IPI seguem
                mensais e não entram aqui. Os tributos vêm do mesmo motor da ficha do módulo Lucro.
            </p>
        </Card>
    );
};
