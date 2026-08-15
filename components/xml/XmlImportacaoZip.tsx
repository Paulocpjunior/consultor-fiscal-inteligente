import React, { useEffect, useRef, useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { formatCnpjCpf } from '../../services/xmlParserService';
import { importarXmlsLote, repararNotasSemDono, localizarDocumento, type ReparoSemDonoResultado, type DocLocalizado } from '../../services/saeNfceService';
import { useEmpresaAtivaId, useEmpresaAtiva } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';
import ConfirmarImportacaoModal from './ConfirmarImportacaoModal';
import { resumirLoteXmls, validarLoteParaEmpresa, type ValidacaoLote } from '../../services/xmlLoteValidacao';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

interface Conferencia {
    conferidas: number;
    porCompetencia: Record<string, number>;
    resumosSemValor: number;
    emOutraEmpresa: number;
    naoEncontradas: number;
}

interface Totais {
    arquivos: number;
    importadas: number;
    atualizadas: number;
    duplicadas: number;
    /** Já estavam na base sem dono (ou noutra empresa) e vieram pra esta. */
    reatribuidas: number;
    erros: number;
}

const LOTE_QTD = 50;              // máx. XMLs por requisição
const LOTE_BYTES = 8_000_000;     // máx. ~8 MB por requisição (limite do servidor: 20 MB)

// Decodifica bytes de XML respeitando a declaração de encoding (portais e
// sistemas emissores antigos ainda exportam ISO-8859-1/latin1).
function decodificarXml(bytes: Uint8Array): string {
    const utf8 = strFromU8(bytes);
    const decl = utf8.slice(0, 120).toLowerCase();
    if (decl.includes('iso-8859-1') || decl.includes('windows-1252') || utf8.slice(0, 4000).includes('�')) {
        try { return new TextDecoder('latin1').decode(bytes); } catch { return utf8; }
    }
    return utf8;
}

/**
 * XmlImportacaoZip — importação EM MASSA de XMLs (ZIP ou .xml múltiplos) pelo
 * importador do servidor: dedup por chave e — o ponto-chave — UPGRADE de
 * resumo→completa (aqueles "pendentes sem valor/data" ganham corpo).
 *
 * Alimenta o trilho de NF-e mod 55 de SAÍDA: o download em lote do portal da
 * SEFAZ (feito no escritório, logado com o certificado do cliente) sai como
 * ZIP — é só arrastar aqui. Também serve para exportas do sistema emissor e
 * arquivos históricos (ex. acervo SIEG).
 */
const XmlImportacaoZip: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    // A EMPRESA É A ATIVA DA SESSÃO — este painel não pergunta de novo.
    //
    // Paulo, 15/08: *"tira os seletores internos"*. Dava para ativar a empresa
    // A no cabeçalho e escolher a B aqui dentro, sem a tela denunciar nada:
    // dois lugares decidindo em qual CLIENTE o trabalho ia cair.
    const empresaId = useEmpresaAtivaId();
    // Trocar aqui troca a SESSÃO: o modal de validação oferece a troca quando
    // o lote é de outro cliente, e mandar ao trocador global perderia os
    // arquivos pendentes.
    const { ativar: ativarEmpresaSessao } = useEmpresaAtiva();
    const [dragOver, setDragOver] = useState(false);
    const [processando, setProcessando] = useState(false);
    const [progresso, setProgresso] = useState('');
    const [totais, setTotais] = useState<Totais | null>(null);
    const [errosDetalhe, setErrosDetalhe] = useState<string[]>([]);
    const [conferencia, setConferencia] = useState<Conferencia | null>(null);
    // Reparo do PASSADO: notas importadas antes de 27/07 ficaram com empresaId
    // nulo (a rota de lote não passava o dono) e somem do filtro por empresa.
    const [reparo, setReparo] = useState<ReparoSemDonoResultado | null>(null);
    const [reparando, setReparando] = useState(false);
    // "Onde está esta nota?" — busca global, sem filtro de empresa.
    const [buscaNota, setBuscaNota] = useState('');
    const [achados, setAchados] = useState<DocLocalizado[] | null>(null);
    const [buscandoNota, setBuscandoNota] = useState(false);

    const localizar = async () => {
        if (buscaNota.replace(/\D/g, '').length < 3) return;
        setBuscandoNota(true);
        setAchados(null);
        try {
            const r = await localizarDocumento(buscaNota.trim());
            if (r.ok) setAchados(r.docs || []);
            else onShowToast?.(r.error || 'Falha na busca.');
        } catch (e) {
            onShowToast?.(e instanceof Error ? e.message : String(e));
        } finally {
            setBuscandoNota(false);
        }
    };

    const rodarReparo = async (aplicar: boolean) => {
        setReparando(true);
        setReparo(null);
        try {
            let acumulado: ReparoSemDonoResultado | null = null;
            let cursor: string | null | undefined = null;
            // Segue o cursor até varrer tudo (acervo grande vai em fatias).
            for (let volta = 0; volta < 20; volta++) {
                const r: ReparoSemDonoResultado = await repararNotasSemDono({ aplicar, cursor });
                if (!r.ok) { setReparo(r); return; }
                acumulado = acumulado ? {
                    ...r,
                    analisados: (acumulado.analisados || 0) + (r.analisados || 0),
                    reparados: (acumulado.reparados || 0) + (r.reparados || 0),
                    semDonoConhecido: (acumulado.semDonoConhecido || 0) + (r.semDonoConhecido || 0),
                    semCnpjNoDoc: (acumulado.semCnpjNoDoc || 0) + (r.semCnpjNoDoc || 0),
                    porEmpresa: Object.entries(r.porEmpresa || {}).reduce(
                        (acc: Record<string, number>, [k, v]) => { acc[k] = (acc[k] || 0) + (v as number); return acc; },
                        { ...((acumulado?.porEmpresa || {}) as Record<string, number>) },
                    ),
                } : r;
                setReparo(acumulado);
                if (r.acabou || !r.cursor) break;
                cursor = r.cursor;
            }
            if (aplicar) onImported?.();
        } catch (e) {
            setReparo({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setReparando(false);
        }
    };
    // Lote lido e AGUARDANDO confirmação (a importação só começa depois que
    // alguém conferiu de quem são os XMLs — ver ConfirmarImportacaoModal).
    const [pendente, setPendente] = useState<{ xmls: string[]; nomes: string[]; erros: string[] } | null>(null);
    const [validacao, setValidacao] = useState<ValidacaoLote | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => {
            if (!alive) return;
            setEmpresas(list);
            // NÃO pré-seleciona a primeira empresa: era exatamente assim que o
            // ZIP de um cliente entrava no cadastro de outro (27/07).
        });
        return () => { alive = false; };
    }, [currentUser]);

    const empresa = empresas.find(e => e.id === empresaId);

    /** Lê os arquivos e ABRE a confirmação — não importa nada ainda. */
    const prepararLote = async (files: FileList | File[]) => {
        if (!empresa) { onShowToast?.('Selecione a empresa antes de arrastar os arquivos.'); return; }
        setProcessando(true);
        setTotais(null);
        setErrosDetalhe([]);
        setConferencia(null);
        const erros: string[] = [];
        try {
            setProgresso('Lendo arquivos…');
            const xmls: string[] = [];
            const nomes: string[] = [];
            const lista = Array.from(files as ArrayLike<File>);
            for (const file of lista) {
                const nome = file.name.toLowerCase();
                nomes.push(file.name);
                if (nome.endsWith('.zip')) {
                    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
                    for (const [entrada, bytes] of Object.entries(zip)) {
                        if (entrada.toLowerCase().endsWith('.xml') && bytes.length > 0) {
                            xmls.push(decodificarXml(bytes));
                        }
                    }
                } else if (nome.endsWith('.xml')) {
                    xmls.push(decodificarXml(new Uint8Array(await file.arrayBuffer())));
                } else {
                    erros.push(`${file.name}: não é .zip nem .xml — ignorado`);
                }
            }
            if (xmls.length === 0) {
                onShowToast?.('Nenhum XML encontrado nos arquivos.');
                setTotais({ arquivos: 0, importadas: 0, atualizadas: 0, duplicadas: 0, reatribuidas: 0, erros: 0 });
                setErrosDetalhe(erros);
                return;
            }
            setPendente({ xmls, nomes, erros });
            setValidacao(validarLoteParaEmpresa(resumirLoteXmls(xmls), empresa.cnpj, empresas));
        } catch (e) {
            setErrosDetalhe([e instanceof Error ? e.message : String(e)]);
        } finally {
            setProgresso('');
            setProcessando(false);
        }
    };

    const processar = async (xmls: string[], errosIniciais: string[]) => {
        if (!empresa) return;
        setProcessando(true);
        const acc: Totais = { arquivos: xmls.length, importadas: 0, atualizadas: 0, duplicadas: 0, reatribuidas: 0, erros: 0 };
        const erros: string[] = [...errosIniciais];
        try {
            // Envia em lotes limitados por quantidade E tamanho.
            let enviados = 0;
            let lote: string[] = [];
            let loteBytes = 0;
            const enviar = async () => {
                if (lote.length === 0) return;
                const r = await importarXmlsLote(empresa.cnpj, lote);
                if (r.ok) {
                    acc.importadas += r.importadas || 0;
                    acc.atualizadas += r.atualizadas || 0;
                    acc.duplicadas += r.duplicadas || 0;
                    acc.reatribuidas += r.reatribuidas || 0;
                    // Acumula a conferência dos lotes (o ZIP vai em fatias de 50).
                    if (r.conferencia) {
                        setConferencia(prev => {
                            const base: Conferencia = prev || { conferidas: 0, porCompetencia: {}, resumosSemValor: 0, emOutraEmpresa: 0, naoEncontradas: 0 };
                            const porCompetencia = { ...base.porCompetencia };
                            for (const [k, v] of Object.entries(r.conferencia!.porCompetencia || {})) {
                                porCompetencia[k] = (porCompetencia[k] || 0) + (v as number);
                            }
                            return {
                                conferidas: base.conferidas + r.conferencia!.conferidas,
                                porCompetencia,
                                resumosSemValor: base.resumosSemValor + r.conferencia!.resumosSemValor,
                                emOutraEmpresa: base.emOutraEmpresa + r.conferencia!.emOutraEmpresa,
                                naoEncontradas: base.naoEncontradas + r.conferencia!.naoEncontradas,
                            };
                        });
                    }
                    acc.erros += r.erros || 0;
                    if (r.errosDetalhe) for (const e of r.errosDetalhe) if (erros.length < 30) erros.push(e);
                } else {
                    acc.erros += lote.length;
                    if (erros.length < 30) erros.push(r.error || 'falha no envio do lote');
                }
                enviados += lote.length;
                setProgresso(`Enviando… ${enviados}/${xmls.length} XMLs`);
                setTotais({ ...acc });
                lote = [];
                loteBytes = 0;
            };
            for (const xml of xmls) {
                const tam = xml.length;
                if (lote.length >= LOTE_QTD || (loteBytes + tam) > LOTE_BYTES) await enviar();
                lote.push(xml);
                loteBytes += tam;
            }
            await enviar();

            onShowToast?.(`Massa concluída — ${acc.importadas} novas, ${acc.atualizadas} atualizadas (resumo→completa), ${acc.reatribuidas} reatribuídas a esta empresa, ${acc.duplicadas} duplicadas, ${acc.erros} erros.`);
            onImported?.();
        } catch (e) {
            erros.push(e instanceof Error ? e.message : String(e));
        } finally {
            setTotais({ ...acc });
            setErrosDetalhe(erros);
            setProgresso('');
            setProcessando(false);
        }
    };

    return (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
            <div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    📦 Importação em Massa (ZIP) — inclui NF-e mod 55 de saída
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Arraste um <strong>.zip com centenas/milhares de XMLs</strong> (ou vários .xml). Vai para o
                    importador do servidor: além de deduplicar, <strong>completa os resumos pendentes</strong> —
                    notas de saída que estavam “sem valor e sem data” ganham o corpo inteiro.
                </p>
            </div>

            <details className="text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-bold">Como obter o ZIP das NF-e (mod 55) emitidas — portal SEFAZ</summary>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                    <li>Num computador do escritório (não funciona de servidor/nuvem), com o certificado do cliente
                        instalado no navegador (A1) ou o cartão A3 na leitora;</li>
                    <li>Acesse o portal da NF-e da SEFAZ e entre na área do contribuinte com o certificado;</li>
                    <li>Use a consulta/download de <em>notas emitidas</em> do período e solicite o <em>download em lote</em> (ZIP);</li>
                    <li>Arraste o ZIP baixado aqui. Pronto — os 1.700+ resumos de saída pendentes se completam sozinhos.</li>
                </ol>
                <p className="mt-1 text-slate-400">Também aceita exportas do sistema emissor do cliente e acervos antigos (ex.: SIEG).</p>
            </details>

            <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Empresa</label>
                <EmpresaAtivaFixa />
                {empresa ? (
                    <p className="text-[11px] text-slate-400 mt-1">
                        Só entram XMLs em que a raiz do CNPJ {formatCnpjCpf(empresa.cnpj)} apareça como emitente ou destinatário.
                    </p>
                ) : (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Escolha a empresa primeiro — nada é pré-selecionado, para o arquivo não cair no cliente errado.
                    </p>
                )}
            </div>

            <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) prepararLote(e.dataTransfer.files); }}
                onClick={() => !processando && inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                    processando ? 'opacity-60 cursor-wait'
                        : dragOver ? 'border-amber-500 bg-amber-100/60 dark:bg-amber-900/30 cursor-pointer'
                            : 'border-amber-300 dark:border-amber-700 hover:border-amber-500 cursor-pointer'
                }`}
            >
                <input ref={inputRef} type="file" accept=".zip,.xml" multiple className="hidden"
                    onChange={e => {
                        if (e.target.files?.length) prepararLote(e.target.files);
                        if (inputRef.current) inputRef.current.value = '';
                    }} />
                {processando ? (
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{progresso || 'Processando…'}</p>
                ) : (
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Arraste o ZIP (ou XMLs) aqui</p>
                )}
            </div>

            {totais && (
                <div className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="font-bold text-slate-700 dark:text-slate-200">
                        {totais.arquivos} XMLs no lote → {totais.importadas} novas · {totais.atualizadas} atualizadas
                        (resumo→completa) · {totais.duplicadas} duplicadas · {totais.erros} erros
                    </p>
                    {/* Onde as notas foram parar. Sem isto, "36 duplicadas"
                        mandava o operador procurar na competência da PASTA
                        ("entradas 06.2026") enquanto o app arquiva pela
                        competência da EMISSÃO (dhEmi) — caso GUARANI 27/07. */}
                    {conferencia && conferencia.conferidas > 0 && (
                        <div className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                Onde estas {conferencia.conferidas} nota(s) estão na base:
                            </p>
                            <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                                {Object.entries(conferencia.porCompetencia)
                                    .sort(([a], [b]) => b.localeCompare(a))
                                    .map(([comp, qtd]) => (
                                        <li key={comp}>
                                            <span className="font-mono">{comp === 'sem-competencia' ? 'sem competência' : comp.split('-').reverse().join('/')}</span> — {qtd} nota(s)
                                        </li>
                                    ))}
                            </ul>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                A competência é a da <strong>emissão da nota</strong> (dhEmi), não a do nome da pasta —
                                por isso um arquivo "entradas 06/2026" costuma espalhar notas por vários meses.
                            </p>
                            {conferencia.resumosSemValor > 0 && (
                                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                    ⚠ {conferencia.resumosSemValor} continua(m) como <strong>resumo sem valor</strong> — o XML completo não entrou.
                                    Confira se o arquivo tem o <code>nfeProc</code> inteiro (não só o resumo da SEFAZ).
                                </p>
                            )}
                            {conferencia.emOutraEmpresa > 0 && (
                                <p className="text-[11px] text-red-700 dark:text-red-400">
                                    ⚠ {conferencia.emOutraEmpresa} está(ão) atribuída(s) a OUTRA empresa — provável importação anterior no cliente errado.
                                </p>
                            )}
                            {conferencia.naoEncontradas > 0 && (
                                <p className="text-[11px] text-red-700 dark:text-red-400">
                                    ⚠ {conferencia.naoEncontradas} não foi(ram) encontrada(s) na base depois da importação — reimporte e, se persistir, avise.
                                </p>
                            )}
                        </div>
                    )}
                    {totais.reatribuidas > 0 && (
                        <p className="text-[11px] text-sky-700 dark:text-sky-400 mt-0.5">
                            ↪ {totais.reatribuidas} nota(s) já estavam na base sem dono (ou em outra empresa) e foram
                            atribuídas a esta — agora aparecem no filtro por empresa.
                        </p>
                    )}
                    {errosDetalhe.length > 0 && (
                        <details className="mt-1">
                            <summary className="cursor-pointer text-slate-500">Ver ocorrências ({errosDetalhe.length})</summary>
                            <ul className="mt-1 list-disc list-inside text-red-600 dark:text-red-400">
                                {errosDetalhe.map((e, i) => <li key={i} className="break-all">{e}</li>)}
                            </ul>
                        </details>
                    )}
                </div>
            )}

            {/* Busca GLOBAL por nota: a aba XMLs sempre procura DENTRO da
                empresa filtrada, então nota no cliente errado ficava invisível.
                Aqui não há filtro nenhum — é o "cadê a nota". */}
            <div className="border-t border-amber-200 dark:border-amber-800 pt-3 space-y-2">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">🔍 Onde está esta nota?</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Procura em <strong>todas as empresas</strong> pela chave (44 dígitos) ou pelo número da NF — inclusive
                    notas sem dono ou atribuídas ao cliente errado.
                </p>
                <div className="flex gap-2 flex-wrap">
                    <input value={buscaNota} onChange={e => setBuscaNota(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') localizar(); }}
                        placeholder="Chave de 44 dígitos ou nº da nota (ex.: 17850)"
                        className="flex-1 min-w-[240px] px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                    <button onClick={localizar} disabled={buscandoNota}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white">
                        {buscandoNota ? '⏳…' : 'Localizar'}
                    </button>
                </div>
                {achados && achados.length === 0 && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                        Não existe na base — nem em outra empresa, nem sem dono. A nota não chegou a ser gravada.
                    </p>
                )}
                {achados && achados.length > 0 && (
                    <ul className="text-[11px] space-y-1">
                        {achados.map(d => (
                            <li key={d.chave} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2">
                                <p className="font-bold text-slate-700 dark:text-slate-200">
                                    nº {d.numero}/{d.serie} · {d.dhEmi?.slice(0, 10)} · {d.direcao} ·{' '}
                                    <span className={d.empresaId ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{d.empresaNome}</span>
                                </p>
                                <p className="text-slate-500 dark:text-slate-400">
                                    competência {d.competencia || '—'} · {d.tipoDoc}{d.temItens === false ? ' (resumo, sem valor)' : ''} ·
                                    origem {d.origem || '—'} · emitente {d.xNomeEmit || d.cnpjEmit}
                                </p>
                                <p className="font-mono text-[10px] text-slate-400 break-all">{d.chave}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Reparo do acervo importado ANTES do conserto de 27/07: essas
                notas existem na base, mas com empresaId nulo — invisíveis no
                filtro por empresa. Reimportar não resolvia (o fast-path de
                duplicidade saía antes de reatribuir). */}
            <div className="border-t border-amber-200 dark:border-amber-800 pt-3 space-y-2">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">🔧 Notas importadas que não aparecem no filtro por empresa</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Importações em lote feitas até 27/07/2026 gravavam a nota <strong>sem dono</strong>. Ela está na base,
                    mas some ao filtrar o cliente. Rode o ensaio para ver quantas são e de quem; depois aplique.
                </p>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => rodarReparo(false)} disabled={reparando}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200">
                        {reparando ? '⏳ Varrendo…' : '🔎 Ensaio (não grava)'}
                    </button>
                    <button onClick={() => rodarReparo(true)} disabled={reparando}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
                        {reparando ? '⏳…' : '✅ Aplicar reparo'}
                    </button>
                </div>
                {reparo && !reparo.ok && <p className="text-xs text-red-600 dark:text-red-400">{reparo.error}</p>}
                {reparo && reparo.ok && (
                    <div className="text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1">
                        <p className="font-bold text-slate-700 dark:text-slate-200">
                            {reparo.analisados} sem dono analisada(s) → <span className="text-emerald-600 dark:text-emerald-400">{reparo.reparados} {reparo.aplicar ? 'reparada(s)' : 'seriam reparadas'}</span>
                            {(reparo.semDonoConhecido ?? 0) > 0 && <span className="text-slate-500"> · {reparo.semDonoConhecido} de terceiros (nenhuma ponta é cliente)</span>}
                            {(reparo.semCnpjNoDoc ?? 0) > 0 && <span className="text-slate-500"> · {reparo.semCnpjNoDoc} sem CNPJ gravado</span>}
                        </p>
                        {Object.keys(reparo.porEmpresa || {}).length > 0 && (
                            <ul className="text-slate-600 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
                                {Object.entries(reparo.porEmpresa || {}).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => (
                                    <li key={nome}>{nome}: <strong>{qtd}</strong> nota(s)</li>
                                ))}
                            </ul>
                        )}
                        {reparo.aplicar && (reparo.reparados ?? 0) > 0 && (
                            <p className="text-emerald-700 dark:text-emerald-400">Pronto — agora elas aparecem ao filtrar a empresa na aba XMLs.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Trava: confere de quem são os XMLs ANTES de importar. */}
            <ConfirmarImportacaoModal
                aberto={!!pendente}
                empresa={empresa ? { id: empresa.id, nome: empresa.nome, cnpj: empresa.cnpj } : null}
                validacao={validacao}
                arquivos={pendente?.nomes || []}
                onCancelar={() => { setPendente(null); setValidacao(null); }}
                onTrocarEmpresa={(id) => {
                    const nova = empresas.find(e => e.id === id);
                    if (nova) {
                        ativarEmpresaSessao({
                            id: nova.id, nome: nova.nome,
                            cnpj: String(nova.cnpj || '').replace(/\D/g, ''),
                            fonte: nova.fonte, codCliente: nova.codCliente, uf: nova.uf,
                        });
                    }
                    // Revalida contra a empresa nova sem obrigar a arrastar de novo.
                    if (nova && pendente) setValidacao(validarLoteParaEmpresa(resumirLoteXmls(pendente.xmls), nova.cnpj, empresas));
                }}
                onConfirmar={() => {
                    const lote = pendente;
                    setPendente(null);
                    setValidacao(null);
                    if (lote) processar(lote.xmls, lote.erros);
                }}
            />
        </div>
    );
};

export default XmlImportacaoZip;
