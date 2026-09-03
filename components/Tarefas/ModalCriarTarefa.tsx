/**
 * components/Tarefas/ModalCriarTarefa.tsx
 *
 * Modal de criacao manual de tarefa. Recebe a lista de empresas
 * (EmpresaPerfilOption) -- usuario seleciona uma + titulo + vencimento
 * + tipo de obrigacao. Em sucesso, chama `onCriou()` que o pai usa pra
 * recarregar a lista.
 */
import React, { useState } from 'react';
import { criarTarefaManual, type ObrigacaoTarefa } from '../../services/tarefasService';
import type { EmpresaPerfilOption } from '../../services/xmlFiscalService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';
import { paraEmpresaOptions } from '../../services/empresaOption';

interface Props {
    empresas: EmpresaPerfilOption[];
    onFechar: () => void;
    onCriou: () => void;
}

const ModalCriarTarefa: React.FC<Props> = ({ empresas, onFechar, onCriou }) => {
    const [titulo, setTitulo] = useState('');
    const [descricao, setDescricao] = useState('');
    const [empresaId, setEmpresaId] = useState('');
    const [vencimento, setVencimento] = useState(''); // yyyy-mm-dd
    const [obrigacao, setObrigacao] = useState<ObrigacaoTarefa>('OUTRA');
    const [salvando, setSalvando] = useState(false);
    const [erro, setErroLocal] = useState<string | null>(null);

    const podeSalvar = !!titulo.trim() && !!empresaId && !!vencimento;

    const salvar = async () => {
        setErroLocal(null);
        if (!podeSalvar) {
            setErroLocal('Título, empresa e vencimento são obrigatórios.');
            return;
        }
        const emp = empresas.find(e => e.id === empresaId);
        if (!emp) { setErroLocal('Empresa inválida'); return; }
        const dataVenc = new Date(vencimento + 'T00:00:00');

        setSalvando(true);
        try {
            const r = await criarTarefaManual({
                titulo: titulo.trim(),
                descricao: descricao.trim(),
                empresaId: emp.id,
                empresaCnpj: emp.cnpj || '',
                empresaNome: emp.nome || '',
                obrigacao,
                vencimento: dataVenc,
            });
            if (r.ok) onCriou();
            else setErroLocal(r.error || 'Erro ao criar');
        } catch (e: any) {
            setErroLocal(e?.message || 'Erro ao criar');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onFechar}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full my-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Nova tarefa manual</h3>
                    <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>
                <div className="px-5 py-4 space-y-3">
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Título *</label>
                        <input value={titulo} onChange={e => setTitulo(e.target.value)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Empresa *</label>
                        <EmpresaSearchSelect
                        empresas={paraEmpresaOptions(empresas)}
                        value={empresaId}
                        onChange={setEmpresaId}
                        placeholder="Selecione — código, nome ou CNPJ"
                    />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs text-gray-600 dark:text-gray-300">Vencimento *</label>
                            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
                                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-600 dark:text-gray-300">Tipo</label>
                            <select value={obrigacao} onChange={e => setObrigacao(e.target.value as ObrigacaoTarefa)}
                                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                                <option value="OUTRA">Outra</option>
                                <option value="DAS">DAS</option>
                                <option value="DCTFWEB">DCTFWeb</option>
                                <option value="FGTS">FGTS</option>
                                <option value="SPED">SPED</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Descrição</label>
                        <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                    </div>
                    {erro && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 text-xs text-red-700 dark:text-red-300">
                            {erro}
                        </div>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                    <button onClick={onFechar} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600">Cancelar</button>
                    <button onClick={salvar} disabled={!podeSalvar || salvando}
                        className="px-3 py-1.5 text-sm rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                        {salvando ? 'Salvando…' : 'Criar tarefa'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ModalCriarTarefa;
