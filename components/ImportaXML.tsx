import React, { useState, useRef, useCallback } from 'react';
import type { User } from '../types';

interface NFeData {
    id: string;
    nNF: string;
    serie: string;
    dhEmi: string;
    modelo: string;
    natOp: string;
    emitente: {
        cnpj: string;
        nome: string;
        fantasia: string;
        uf: string;
        municipio: string;
        ie: string;
    };
    destinatario: {
        cnpjCpf: string;
        nome: string;
        uf: string;
        municipio: string;
        ie: string;
    };
    produtos: {
        nItem: string;
        cProd: string;
        xProd: string;
        ncm: string;
        cfop: string;
        uCom: string;
        qCom: string;
        vUnCom: string;
        vProd: string;
        vICMS: string;
        vIPI: string;
        vPIS: string;
        vCOFINS: string;
        cst: string;
        orig: string;
    }[];
    totais: {
        vBC: string;
        vICMS: string;
        vICMSDeson: string;
        vFCP: string;
        vBCST: string;
        vST: string;
        vFCPST: string;
        vProd: string;
        vFrete: string;
        vSeg: string;
        vDesc: string;
        vII: string;
        vIPI: string;
        vIPIDevol: string;
        vPIS: string;
        vCOFINS: string;
        vOutro: string;
        vNF: string;
    };
    infAdic: string;
}

interface ImportaXMLProps {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

function getTextContent(el: Element | null, tag: string): string {
    if (!el) return '';
    const found = el.getElementsByTagName(tag);
    if (found.length === 0) return '';
    return found[0].textContent?.trim() || '';
}

function parseNFe(xmlText: string): NFeData {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new Error('Arquivo XML inválido ou corrompido.');
    }

    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) {
        throw new Error('XML não é uma NFe válida. Tag <infNFe> não encontrada.');
    }

    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const total = doc.getElementsByTagName('total')[0];
    const icmsTot = total ? total.getElementsByTagName('ICMSTot')[0] : null;
    const infAdFisco = doc.getElementsByTagName('infAdFisco')[0];
    const infCpl = doc.getElementsByTagName('infCpl')[0];

    const detElements = doc.getElementsByTagName('det');
    const produtos: NFeData['produtos'] = [];

    for (let i = 0; i < detElements.length; i++) {
        const det = detElements[i];
        const prod = det.getElementsByTagName('prod')[0];
        const icms = det.getElementsByTagName('ICMS')[0];
        const ipi = det.getElementsByTagName('IPI')[0];
        const pis = det.getElementsByTagName('PIS')[0];
        const cofins = det.getElementsByTagName('COFINS')[0];

        let cst = '';
        let vICMS = '0';
        if (icms) {
            const icmsInner = icms.children[0];
            if (icmsInner) {
                cst = getTextContent(icmsInner, 'CST') || getTextContent(icmsInner, 'CSOSN');
                vICMS = getTextContent(icmsInner, 'vICMS') || '0';
            }
        }

        let vIPI = '0';
        if (ipi) {
            const ipiTrib = ipi.getElementsByTagName('IPITrib')[0];
            if (ipiTrib) vIPI = getTextContent(ipiTrib, 'vIPI') || '0';
        }

        let vPIS = '0';
        if (pis) {
            const pisInner = pis.children[0];
            if (pisInner) vPIS = getTextContent(pisInner, 'vPIS') || '0';
        }

        let vCOFINS = '0';
        if (cofins) {
            const cofinsInner = cofins.children[0];
            if (cofinsInner) vCOFINS = getTextContent(cofinsInner, 'vCOFINS') || '0';
        }

        produtos.push({
            nItem: det.getAttribute('nItem') || String(i + 1),
            cProd: getTextContent(prod, 'cProd'),
            xProd: getTextContent(prod, 'xProd'),
            ncm: getTextContent(prod, 'NCM'),
            cfop: getTextContent(prod, 'CFOP'),
            uCom: getTextContent(prod, 'uCom'),
            qCom: getTextContent(prod, 'qCom'),
            vUnCom: getTextContent(prod, 'vUnCom'),
            vProd: getTextContent(prod, 'vProd'),
            vICMS,
            vIPI,
            vPIS,
            vCOFINS,
            cst,
            orig: getTextContent(icms?.children[0] || null as any, 'orig') || '',
        });
    }

    const emitEnder = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const destEnder = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    return {
        id: infNFe.getAttribute('Id') || '',
        nNF: getTextContent(ide, 'nNF'),
        serie: getTextContent(ide, 'serie'),
        dhEmi: getTextContent(ide, 'dhEmi'),
        modelo: getTextContent(ide, 'mod'),
        natOp: getTextContent(ide, 'natOp'),
        emitente: {
            cnpj: getTextContent(emit, 'CNPJ'),
            nome: getTextContent(emit, 'xNome'),
            fantasia: getTextContent(emit, 'xFant'),
            uf: getTextContent(emitEnder, 'UF'),
            municipio: getTextContent(emitEnder, 'xMun'),
            ie: getTextContent(emit, 'IE'),
        },
        destinatario: {
            cnpjCpf: getTextContent(dest, 'CNPJ') || getTextContent(dest, 'CPF'),
            nome: getTextContent(dest, 'xNome'),
            uf: getTextContent(destEnder, 'UF'),
            municipio: getTextContent(destEnder, 'xMun'),
            ie: getTextContent(dest, 'IE'),
        },
        produtos,
        totais: {
            vBC: getTextContent(icmsTot, 'vBC'),
            vICMS: getTextContent(icmsTot, 'vICMS'),
            vICMSDeson: getTextContent(icmsTot, 'vICMSDeson'),
            vFCP: getTextContent(icmsTot, 'vFCP'),
            vBCST: getTextContent(icmsTot, 'vBCST'),
            vST: getTextContent(icmsTot, 'vST'),
            vFCPST: getTextContent(icmsTot, 'vFCPST'),
            vProd: getTextContent(icmsTot, 'vProd'),
            vFrete: getTextContent(icmsTot, 'vFrete'),
            vSeg: getTextContent(icmsTot, 'vSeg'),
            vDesc: getTextContent(icmsTot, 'vDesc'),
            vII: getTextContent(icmsTot, 'vII'),
            vIPI: getTextContent(icmsTot, 'vIPI'),
            vIPIDevol: getTextContent(icmsTot, 'vIPIDevol'),
            vPIS: getTextContent(icmsTot, 'vPIS'),
            vCOFINS: getTextContent(icmsTot, 'vCOFINS'),
            vOutro: getTextContent(icmsTot, 'vOutro'),
            vNF: getTextContent(icmsTot, 'vNF'),
        },
        infAdic: infAdFisco?.textContent?.trim() || infCpl?.textContent?.trim() || '',
    };
}

function formatCnpjCpf(val: string): string {
    if (!val) return '-';
    if (val.length === 14) return val.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (val.length === 11) return val.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return val;
}

function formatCurrency(val: string): string {
    const n = parseFloat(val || '0');
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

const ImportaXML: React.FC<ImportaXMLProps> = ({ onShowToast }) => {
    const [nfeList, setNfeList] = useState<NFeData[]>([]);
    const [selectedNfe, setSelectedNfe] = useState<NFeData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFiles = useCallback(async (files: FileList | File[]) => {
        setError(null);
        setLoading(true);
        const newNfes: NFeData[] = [];
        const errors: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.name.toLowerCase().endsWith('.xml')) {
                errors.push(`${file.name}: não é um arquivo XML`);
                continue;
            }
            try {
                const text = await file.text();
                const nfe = parseNFe(text);
                newNfes.push(nfe);
            } catch (err: any) {
                errors.push(`${file.name}: ${err.message}`);
            }
        }

        if (newNfes.length > 0) {
            setNfeList(prev => [...prev, ...newNfes]);
            onShowToast?.(`${newNfes.length} XML(s) importado(s) com sucesso!`);
        }
        if (errors.length > 0) {
            setError(errors.join('\n'));
        }
        setLoading(false);
    }, [onShowToast]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    }, [processFiles]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            processFiles(e.target.files);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleRemove = (index: number) => {
        setNfeList(prev => {
            const updated = prev.filter((_, i) => i !== index);
            if (selectedNfe && prev[index] === selectedNfe) setSelectedNfe(null);
            return updated;
        });
    };

    const handleClearAll = () => {
        setNfeList([]);
        setSelectedNfe(null);
        onShowToast?.('Lista limpa');
    };

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 rounded-xl text-white">
                <div className="flex items-center gap-3 mb-2">
                    <div className="bg-white/20 p-2.5 rounded-lg">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Importa XML</h2>
                        <p className="text-emerald-200 text-sm">Importe XMLs de NFe/NFSe para visualizar dados fiscais e impostos</p>
                    </div>
                </div>
            </div>

            {/* Drop Zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    dragOver
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-slate-300 dark:border-slate-600 hover:border-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
                <svg className={`w-12 h-12 mx-auto mb-3 ${dragOver ? 'text-emerald-500' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {loading ? (
                    <p className="text-sm text-emerald-600 font-bold">Processando...</p>
                ) : (
                    <>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            Arraste XMLs aqui ou clique para selecionar
                        </p>
                        <p className="text-xs text-slate-400 mt-1">NFe, NFSe, CTe — aceita múltiplos arquivos</p>
                    </>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-xs text-red-600 dark:text-red-400 font-bold mb-1">Erros na importação:</p>
                    <pre className="text-xs text-red-500 whitespace-pre-wrap">{error}</pre>
                </div>
            )}

            {/* NFe List */}
            {nfeList.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">
                            XMLs Importados ({nfeList.length})
                        </h3>
                        <button
                            onClick={handleClearAll}
                            className="text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                            Limpar tudo
                        </button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-[300px] overflow-y-auto">
                        {nfeList.map((nfe, idx) => (
                            <div
                                key={nfe.id + idx}
                                className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors ${
                                    selectedNfe === nfe ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-emerald-500' : ''
                                }`}
                                onClick={() => setSelectedNfe(nfe)}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                            NF {nfe.nNF}
                                        </span>
                                        <span className="text-xs text-slate-400">Série {nfe.serie}</span>
                                        <span className="text-xs text-slate-400">{formatDate(nfe.dhEmi).split(' ')[0]}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
                                        {nfe.emitente.fantasia || nfe.emitente.nome} → {nfe.destinatario.nome}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                        {formatCurrency(nfe.totais.vNF)}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemove(idx); }}
                                        className="text-slate-400 hover:text-red-500 transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* NFe Detail */}
            {selectedNfe && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                    {/* Detail Header */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-emerald-800 dark:text-emerald-300">
                                    NFe Nº {selectedNfe.nNF} — Série {selectedNfe.serie}
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {selectedNfe.natOp} • Emissão: {formatDate(selectedNfe.dhEmi)}
                                </p>
                            </div>
                            <button onClick={() => setSelectedNfe(null)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div className="p-4 space-y-4">
                        {/* Emitente + Destinatário */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Emitente</p>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{selectedNfe.emitente.nome}</p>
                                {selectedNfe.emitente.fantasia && (
                                    <p className="text-xs text-slate-500">{selectedNfe.emitente.fantasia}</p>
                                )}
                                <p className="text-xs text-slate-500 mt-1">CNPJ: {formatCnpjCpf(selectedNfe.emitente.cnpj)}</p>
                                <p className="text-xs text-slate-500">IE: {selectedNfe.emitente.ie || '-'}</p>
                                <p className="text-xs text-slate-500">{selectedNfe.emitente.municipio}/{selectedNfe.emitente.uf}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Destinatário</p>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{selectedNfe.destinatario.nome}</p>
                                <p className="text-xs text-slate-500 mt-1">CNPJ/CPF: {formatCnpjCpf(selectedNfe.destinatario.cnpjCpf)}</p>
                                <p className="text-xs text-slate-500">IE: {selectedNfe.destinatario.ie || '-'}</p>
                                <p className="text-xs text-slate-500">{selectedNfe.destinatario.municipio}/{selectedNfe.destinatario.uf}</p>
                            </div>
                        </div>

                        {/* Totais de Impostos */}
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Resumo de Impostos</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { label: 'Valor Produtos', value: selectedNfe.totais.vProd, color: 'slate' },
                                    { label: 'Valor NF', value: selectedNfe.totais.vNF, color: 'emerald' },
                                    { label: 'BC ICMS', value: selectedNfe.totais.vBC, color: 'blue' },
                                    { label: 'ICMS', value: selectedNfe.totais.vICMS, color: 'blue' },
                                    { label: 'BC ICMS ST', value: selectedNfe.totais.vBCST, color: 'indigo' },
                                    { label: 'ICMS ST', value: selectedNfe.totais.vST, color: 'indigo' },
                                    { label: 'IPI', value: selectedNfe.totais.vIPI, color: 'amber' },
                                    { label: 'PIS', value: selectedNfe.totais.vPIS, color: 'orange' },
                                    { label: 'COFINS', value: selectedNfe.totais.vCOFINS, color: 'orange' },
                                    { label: 'Frete', value: selectedNfe.totais.vFrete, color: 'slate' },
                                    { label: 'Desconto', value: selectedNfe.totais.vDesc, color: 'red' },
                                    { label: 'Outros', value: selectedNfe.totais.vOutro, color: 'slate' },
                                ].map(item => (
                                    <div key={item.label} className={`bg-${item.color}-50 dark:bg-${item.color}-900/20 rounded-lg p-2 text-center`}>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</p>
                                        <p className={`text-xs font-bold text-${item.color}-700 dark:text-${item.color}-300`}>
                                            {formatCurrency(item.value)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Produtos */}
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                Produtos/Serviços ({selectedNfe.produtos.length} itens)
                            </p>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-700">
                                            <th className="px-2 py-2 text-left font-bold text-slate-600 dark:text-slate-400">#</th>
                                            <th className="px-2 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Produto</th>
                                            <th className="px-2 py-2 text-center font-bold text-slate-600 dark:text-slate-400">NCM</th>
                                            <th className="px-2 py-2 text-center font-bold text-slate-600 dark:text-slate-400">CFOP</th>
                                            <th className="px-2 py-2 text-center font-bold text-slate-600 dark:text-slate-400">CST</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Qtd</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Vl. Unit.</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Vl. Total</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">ICMS</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">IPI</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">PIS</th>
                                            <th className="px-2 py-2 text-right font-bold text-slate-600 dark:text-slate-400">COFINS</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {selectedNfe.produtos.map((prod, i) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                                <td className="px-2 py-1.5 text-slate-400">{prod.nItem}</td>
                                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-300 max-w-[200px] truncate" title={prod.xProd}>{prod.xProd}</td>
                                                <td className="px-2 py-1.5 text-center text-slate-500">{prod.ncm}</td>
                                                <td className="px-2 py-1.5 text-center text-slate-500">{prod.cfop}</td>
                                                <td className="px-2 py-1.5 text-center text-slate-500">{prod.cst}</td>
                                                <td className="px-2 py-1.5 text-right text-slate-500">{parseFloat(prod.qCom).toLocaleString('pt-BR')} {prod.uCom}</td>
                                                <td className="px-2 py-1.5 text-right text-slate-500">{formatCurrency(prod.vUnCom)}</td>
                                                <td className="px-2 py-1.5 text-right font-bold text-slate-700 dark:text-slate-300">{formatCurrency(prod.vProd)}</td>
                                                <td className="px-2 py-1.5 text-right text-blue-600">{formatCurrency(prod.vICMS)}</td>
                                                <td className="px-2 py-1.5 text-right text-amber-600">{formatCurrency(prod.vIPI)}</td>
                                                <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(prod.vPIS)}</td>
                                                <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(prod.vCOFINS)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Info Adicional */}
                        {selectedNfe.infAdic && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informações Adicionais</p>
                                <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{selectedNfe.infAdic}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {nfeList.length === 0 && !error && (
                <div className="text-center py-8">
                    <svg className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm text-slate-400">Nenhum XML importado ainda</p>
                    <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">Arraste arquivos XML de notas fiscais para começar</p>
                </div>
            )}
        </div>
    );
};

export default ImportaXML;
