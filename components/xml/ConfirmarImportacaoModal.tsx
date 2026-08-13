/**
 * ConfirmarImportacaoModal — trava de segurança ANTES de importar XML.
 *
 * O combo de empresa vinha pré-selecionado com a primeira da lista: bastava
 * arrastar o ZIP sem olhar o seletor pro lote inteiro ir pro cliente errado
 * (Paulo, 27/07: "erro de cruzamento de informações desencontradas entre
 * empresa cliente e arquivo a ser importado"). Agora nada é importado sem que
 * alguém confirme, VENDO de quem são os arquivos.
 */
import React from 'react';
import type { ValidacaoLote, EmpresaConhecida } from '../../services/xmlLoteValidacao';
import { formatCnpjCpf } from '../../services/xmlParserService';

interface Props {
    aberto: boolean;
    empresa: EmpresaConhecida | null;
    validacao: ValidacaoLote | null;
    /** Nomes dos arquivos escolhidos (contexto pra quem confere). */
    arquivos: string[];
    onConfirmar: () => void;
    onCancelar: () => void;
    /** Troca a empresa selecionada pela dona de verdade dos arquivos. */
    onTrocarEmpresa?: (empresaId: string) => void;
}

const ConfirmarImportacaoModal: React.FC<Props> = ({
    aberto, empresa, validacao, arquivos, onConfirmar, onCancelar, onTrocarEmpresa,
}) => {
    if (!aberto || !validacao) return null;

    const donoSugerido = validacao.donosProvaveis.find((d) => d.empresa)?.empresa || null;
    const alerta = validacao.bloquear || validacao.incompativeis > 0;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] overflow-y-auto" onClick={onCancelar}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg my-auto" onClick={(e) => e.stopPropagation()}>
                <div className={`p-4 rounded-t-xl border-b ${alerta
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                    : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700'}`}>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">
                        {validacao.bloquear ? '⛔ Arquivo não é desta empresa' : alerta ? '⚠️ Confira antes de importar' : '✓ Confirmar importação'}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{validacao.mensagem}</p>
                </div>

                <div className="p-4 space-y-3 text-sm">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Empresa selecionada</p>
                        <p className="font-bold text-slate-800 dark:text-slate-100">{empresa?.nome || '—'}</p>
                        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{empresa ? formatCnpjCpf(empresa.cnpj) : ''}</p>
                    </div>

                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                        <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">O que veio nos arquivos</p>
                        <p className="text-slate-700 dark:text-slate-200">
                            {validacao.total} XML(s) · <span className="text-emerald-600 dark:text-emerald-400 font-bold">{validacao.compativeis} desta empresa</span>
                            {validacao.incompativeis > 0 && <span className="text-red-600 dark:text-red-400 font-bold"> · {validacao.incompativeis} de outro CNPJ</span>}
                            {validacao.semIdentificacao > 0 && <span className="text-slate-500"> · {validacao.semIdentificacao} sem CNPJ legível</span>}
                        </p>
                        {validacao.compativeis > 0 && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {validacao.comoEmitente} de saída (ela emitiu) · {validacao.comoDestinatario} de entrada (ela recebeu)
                            </p>
                        )}
                        {/* Só lista dono alheio quando há XML que NÃO é desta
                            empresa — antes o fornecedor da nota de entrada
                            aparecia como "não cadastrada" e assustava à toa. */}
                        {validacao.incompativeis > 0 && validacao.donosProvaveis.length > 0 && (
                            <>
                                <p className="text-[11px] font-bold uppercase text-red-600 dark:text-red-400">De outro CNPJ</p>
                                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                                    {validacao.donosProvaveis.map((d) => (
                                        <li key={d.cnpj}>
                                            <span className="font-mono">{formatCnpjCpf(d.cnpj)}</span> — {d.empresa ? d.empresa.nome : 'não cadastrada'} ({d.qtd} XML)
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        {arquivos.length > 0 && (
                            <p className="text-[11px] text-slate-400 break-all">
                                Arquivo(s): {arquivos.slice(0, 3).join(', ')}{arquivos.length > 3 ? ` +${arquivos.length - 3}` : ''}
                            </p>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
                    <button onClick={onCancelar}
                        className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200">
                        Cancelar
                    </button>
                    {donoSugerido && onTrocarEmpresa && (
                        <button onClick={() => onTrocarEmpresa(donoSugerido.id)}
                            className="px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-700 text-white">
                            Trocar para {donoSugerido.nome.slice(0, 28)}
                        </button>
                    )}
                    {!validacao.bloquear && (
                        <button onClick={onConfirmar}
                            className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white">
                            Importar {validacao.total} XML(s)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfirmarImportacaoModal;
