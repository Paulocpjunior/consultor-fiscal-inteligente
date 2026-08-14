import React, { useEffect, useRef, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import {
    importXmlManual,
    getEmpresasDisponiveis,
    DocumentoDuplicadoError,
    type EmpresaXmlOption,
} from '../../services/xmlFiscalService';
import { XmlParseError, formatCnpjCpf } from '../../services/xmlParserService';
import EmpresaSearchSelect from './EmpresaSearchSelect';
import ConfirmarImportacaoModal from './ConfirmarImportacaoModal';
import { resumirLoteXmls, validarLoteParaEmpresa, type ValidacaoLote } from '../../services/xmlLoteValidacao';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
    onImported?: (doc: DocumentoFiscal) => void;
}

interface ProcessedItem {
    fileName: string;
    status: 'ok' | 'duplicado' | 'erro';
    mensagem: string;
    /** O que fazer. Fica numa 2ª linha porque a ação é o que resolve. */
    acao?: string | null;
    /** Vermelho: alguém precisa agir (nota gravada em OUTRA empresa). */
    exigeAcao?: boolean;
}

const XmlImportacaoManual: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [dragOver, setDragOver] = useState(false);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<ProcessedItem[]>([]);
    const [loadingEmpresas, setLoadingEmpresas] = useState(true);
    // Arquivos escolhidos aguardando confirmação de que são da empresa certa.
    const [pendentes, setPendentes] = useState<File[] | null>(null);
    const [validacao, setValidacao] = useState<ValidacaoLote | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let alive = true;
        setLoadingEmpresas(true);
        getEmpresasDisponiveis(currentUser).then(list => {
            if (!alive) return;
            setEmpresas(list);
            // Sem pré-seleção: a primeira empresa da lista pré-marcada fazia o
            // XML cair no cliente errado quando ninguém olhava o combo (27/07).
            setLoadingEmpresas(false);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    const empresaSelecionada = empresas.find(e => e.id === empresaId);

    /** Lê os .xml escolhidos e abre a confirmação — não importa nada ainda. */
    const prepararArquivos = async (files: FileList | File[]) => {
        if (!empresaSelecionada) {
            onShowToast?.('Selecione a empresa antes de escolher os arquivos.');
            return;
        }
        const lista = Array.from(files as ArrayLike<File>).filter(f => f.name.toLowerCase().endsWith('.xml'));
        if (lista.length === 0) {
            onShowToast?.('Nenhum arquivo .xml selecionado.');
            return;
        }
        setLoading(true);
        try {
            const textos = await Promise.all(lista.map(f => f.text()));
            setPendentes(lista);
            setValidacao(validarLoteParaEmpresa(resumirLoteXmls(textos), empresaSelecionada.cnpj, empresas));
        } catch (e) {
            onShowToast?.(`Falha lendo os arquivos: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleFiles = async (files: FileList | File[]) => {
        if (!empresaSelecionada) {
            onShowToast?.('Selecione uma empresa antes de importar.');
            return;
        }
        setLoading(true);
        const out: ProcessedItem[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = (files as FileList).item ? (files as FileList).item(i)! : (files as File[])[i];
            if (!file.name.toLowerCase().endsWith('.xml')) {
                out.push({ fileName: file.name, status: 'erro', mensagem: 'Não é um arquivo .xml' });
                continue;
            }
            try {
                const res = await importXmlManual({
                    file,
                    empresa: { id: empresaSelecionada.id, nome: empresaSelecionada.nome, cnpj: empresaSelecionada.cnpj },
                    user: currentUser,
                    origem: 'manual',
                });
                if (res.status === 'ok') {
                    out.push({ fileName: file.name, status: 'ok', mensagem: `NF ${res.documento.numero} importada (${res.documento.direcao}).` });
                    onImported?.(res.documento);
                } else {
                    // "Já importado (chave …)" é VERDADE e não serve para
                    // nada: não diz em qual empresa, quando, nem por qual
                    // trilho — e a saída que sobra é repetir o clique, que
                    // nunca muda de resposta (Paulo, 14/08, 12 arquivos).
                    out.push({
                        fileName: file.name,
                        status: 'duplicado',
                        mensagem: res.leitura.mensagem,
                        acao: res.leitura.acao,
                        exigeAcao: res.leitura.exigeAcao,
                    });
                }
            } catch (err: any) {
                let msg = err?.message || 'Falha desconhecida.';
                if (err instanceof XmlParseError) msg = `XML inválido: ${msg}`;
                if (err instanceof DocumentoDuplicadoError) msg = `Duplicado: ${msg}`;
                out.push({ fileName: file.name, status: 'erro', mensagem: msg });
            }
        }
        setResults(prev => [...out, ...prev]);
        setLoading(false);
        const ok = out.filter(x => x.status === 'ok').length;
        const dup = out.filter(x => x.status === 'duplicado').length;
        const err = out.filter(x => x.status === 'erro').length;
        // "12 duplicado(s)" trata como iguais duas coisas opostas: nota que já
        // está aqui (nada a fazer) e nota gravada em OUTRA empresa (que não se
        // resolve reimportando). Contar junto esconde a que custa dinheiro.
        const outraEmpresa = out.filter(x => x.exigeAcao).length;
        onShowToast?.(
            `Importação concluída — ${ok} ok, ${dup} já estava(m) no banco, ${err} erro(s).`
            + (outraEmpresa ? ` ⚠ ${outraEmpresa} está(ão) em OUTRA empresa — veja a lista abaixo.` : ''),
        );
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) prepararArquivos(e.dataTransfer.files);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wider">
                    Empresa para a qual o XML será atribuído
                </label>
                {loadingEmpresas ? (
                    <p className="text-xs text-slate-400">Carregando empresas...</p>
                ) : empresas.length === 0 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Nenhuma empresa cadastrada disponível para o seu perfil. Cadastre uma no Simples Nacional ou Lucro Presumido/Real antes de importar XMLs.
                    </p>
                ) : (
                    <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId} />
                )}
                {empresaSelecionada ? (
                    <p className="text-[11px] text-slate-500 mt-2">
                        Apenas XMLs em que <strong>{formatCnpjCpf(empresaSelecionada.cnpj)}</strong> apareça como emitente ou destinatário serão aceitos.
                    </p>
                ) : empresas.length > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                        Escolha a empresa primeiro — nada vem pré-selecionado, para o XML não cair no cliente errado.
                    </p>
                )}
            </div>

            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    !empresaSelecionada
                        ? 'border-slate-200 dark:border-slate-700 opacity-60 cursor-not-allowed'
                        : dragOver
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                            : 'border-slate-300 dark:border-slate-600 hover:border-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml"
                    multiple
                    onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) prepararArquivos(e.target.files);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="hidden"
                    disabled={!empresaSelecionada}
                />
                <svg className={`w-12 h-12 mx-auto mb-3 ${dragOver ? 'text-emerald-500' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {loading ? (
                    <p className="text-sm text-emerald-600 font-bold">Processando...</p>
                ) : !empresaSelecionada ? (
                    <p className="text-sm text-slate-400">Selecione uma empresa para liberar a importação</p>
                ) : (
                    <>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            Arraste XMLs aqui ou clique para selecionar
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                            NFe e NFCe — múltiplos arquivos. O XML original vai para o Firebase Storage.
                        </p>
                    </>
                )}
            </div>

            {results.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Resultado da importação</h3>
                        <button onClick={() => setResults([])} className="text-xs text-slate-500 hover:text-red-500">Limpar</button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-[260px] overflow-y-auto">
                        {results.map((r, i) => (
                            <div key={i} className="px-4 py-2 text-xs">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                                        r.status === 'ok' ? 'bg-emerald-500'
                                        // Vermelho quando alguém precisa AGIR — nota gravada em
                                        // outra empresa não se resolve reimportando, e âmbar
                                        // igual ao resto faria ela passar batida no meio de 12.
                                        : r.status === 'duplicado' ? (r.exigeAcao ? 'bg-red-500' : 'bg-amber-500')
                                        : 'bg-red-500'
                                    }`} />
                                    <span className="font-mono truncate flex-1 min-w-0 text-slate-600 dark:text-slate-400">{r.fileName}</span>
                                    <span className={`flex-[2] min-w-0 ${r.exigeAcao
                                        ? 'text-red-600 dark:text-red-400 font-semibold'
                                        : 'text-slate-500 dark:text-slate-400'}`}>{r.mensagem}</span>
                                </div>
                                {r.acao && (
                                    <p className="mt-0.5 ml-4 text-[11px] text-slate-500 dark:text-slate-400">→ {r.acao}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Trava: confere de quem são os XMLs ANTES de importar. */}
            <ConfirmarImportacaoModal
                aberto={!!pendentes}
                empresa={empresaSelecionada
                    ? { id: empresaSelecionada.id, nome: empresaSelecionada.nome, cnpj: empresaSelecionada.cnpj }
                    : null}
                validacao={validacao}
                arquivos={(pendentes || []).map(f => f.name)}
                onCancelar={() => { setPendentes(null); setValidacao(null); }}
                onTrocarEmpresa={async (id) => {
                    setEmpresaId(id);
                    const nova = empresas.find(e => e.id === id);
                    if (nova && pendentes) {
                        const textos = await Promise.all(pendentes.map(f => f.text()));
                        setValidacao(validarLoteParaEmpresa(resumirLoteXmls(textos), nova.cnpj, empresas));
                    }
                }}
                onConfirmar={() => {
                    const arquivos = pendentes;
                    setPendentes(null);
                    setValidacao(null);
                    if (arquivos) handleFiles(arquivos);
                }}
            />
        </div>
    );
};

export default XmlImportacaoManual;
