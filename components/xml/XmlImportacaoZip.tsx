import React, { useEffect, useRef, useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { formatCnpjCpf } from '../../services/xmlParserService';
import { importarXmlsLote } from '../../services/saeNfceService';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

interface Totais {
    arquivos: number;
    importadas: number;
    atualizadas: number;
    duplicadas: number;
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
    const [empresaId, setEmpresaId] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [processando, setProcessando] = useState(false);
    const [progresso, setProgresso] = useState('');
    const [totais, setTotais] = useState<Totais | null>(null);
    const [errosDetalhe, setErrosDetalhe] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => {
            if (!alive) return;
            setEmpresas(list);
            if (list.length > 0) setEmpresaId(prev => prev || list[0].id);
        });
        return () => { alive = false; };
    }, [currentUser]);

    const empresa = empresas.find(e => e.id === empresaId);

    const processar = async (files: FileList | File[]) => {
        if (!empresa) { onShowToast?.('Selecione uma empresa antes de importar.'); return; }
        setProcessando(true);
        setTotais(null);
        setErrosDetalhe([]);
        const acc: Totais = { arquivos: 0, importadas: 0, atualizadas: 0, duplicadas: 0, erros: 0 };
        const erros: string[] = [];
        try {
            // 1. Extrai todos os XMLs (de ZIPs e/ou .xml soltos).
            setProgresso('Lendo arquivos…');
            const xmls: string[] = [];
            const lista = Array.from(files as ArrayLike<File>);
            for (const file of lista) {
                const nome = file.name.toLowerCase();
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
            acc.arquivos = xmls.length;
            if (xmls.length === 0) {
                onShowToast?.('Nenhum XML encontrado nos arquivos.');
                setTotais(acc);
                setErrosDetalhe(erros);
                return;
            }

            // 2. Envia em lotes limitados por quantidade E tamanho.
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

            onShowToast?.(`Massa concluída — ${acc.importadas} novas, ${acc.atualizadas} atualizadas (resumo→completa), ${acc.duplicadas} duplicadas, ${acc.erros} erros.`);
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
                <select value={empresaId} onChange={e => setEmpresaId(e.target.value)}
                    className="w-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                    {empresas.map(e => (
                        <option key={e.id} value={e.id}>{e.nome} — {formatCnpjCpf(e.cnpj)}</option>
                    ))}
                </select>
                {empresa && (
                    <p className="text-[11px] text-slate-400 mt-1">
                        Só entram XMLs em que a raiz do CNPJ {formatCnpjCpf(empresa.cnpj)} apareça como emitente ou destinatário.
                    </p>
                )}
            </div>

            <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) processar(e.dataTransfer.files); }}
                onClick={() => !processando && inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                    processando ? 'opacity-60 cursor-wait'
                        : dragOver ? 'border-amber-500 bg-amber-100/60 dark:bg-amber-900/30 cursor-pointer'
                            : 'border-amber-300 dark:border-amber-700 hover:border-amber-500 cursor-pointer'
                }`}
            >
                <input ref={inputRef} type="file" accept=".zip,.xml" multiple className="hidden"
                    onChange={e => {
                        if (e.target.files?.length) processar(e.target.files);
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
        </div>
    );
};

export default XmlImportacaoZip;
