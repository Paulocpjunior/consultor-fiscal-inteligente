/**
 * components/LucroPresumidoReal/NewCompanyView.tsx
 *
 * View "new_company" do LucroPresumidoRealDashboard - formulario de
 * cadastro de nova empresa (CNPJ + razao social + CNAE + regime).
 * Inclui botao de verificacao na Receita via BrasilAPI.
 * Extraido de LucroPresumidoRealDashboard.tsx - issue #100.
 */
import React from 'react';

export interface NewCompanyViewProps {
    newCnpj: string;
    newName: string;
    newCnae: string;
    newRegime: 'Presumido' | 'Real';
    isCnpjLoading: boolean;
    cnpjError: string | null;
    loading: boolean;
    onChangeCnpj: (v: string) => void;
    onChangeName: (v: string) => void;
    onChangeCnae: (v: string) => void;
    onChangeRegime: (v: 'Presumido' | 'Real') => void;
    onVerificarCnpj: () => void;
    onSubmit: (e: React.FormEvent) => void;
    onCancelar: () => void;
}

const NewCompanyView: React.FC<NewCompanyViewProps> = ({
    newCnpj, newName, newCnae, newRegime, isCnpjLoading, cnpjError, loading,
    onChangeCnpj, onChangeName, onChangeCnae, onChangeRegime,
    onVerificarCnpj, onSubmit, onCancelar,
}) => (
    <div className="max-w-xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-sm animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">Nova Empresa</h2>
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CNPJ</label>
                <div className="mt-1 flex gap-2">
                    <input
                        type="text"
                        value={newCnpj}
                        onChange={e => onChangeCnpj(e.target.value)}
                        placeholder="00.000.000/0001-00"
                        required
                        className="flex-grow p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                    <button
                        type="button"
                        onClick={onVerificarCnpj}
                        disabled={isCnpjLoading}
                        className="btn-press flex-shrink-0 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-wait"
                    >
                        {isCnpjLoading ? '...' : 'Verificar Receita'}
                    </button>
                </div>
                {cnpjError && <p className="mt-1 text-xs text-red-500">{cnpjError}</p>}
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Razão Social</label>
                <input type="text" value={newName} onChange={e => onChangeName(e.target.value)} required className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CNAE Principal (Opcional)</label>
                <input type="text" value={newCnae} onChange={e => onChangeCnae(e.target.value)} className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Regime Tributário Padrão</label>
                <select value={newRegime} onChange={e => onChangeRegime(e.target.value as 'Presumido' | 'Real')} className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500">
                    <option value="Presumido">Lucro Presumido</option>
                    <option value="Real">Lucro Real</option>
                </select>
            </div>
            <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onCancelar} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300">Cancelar</button>
                <button type="submit" disabled={loading} className="px-4 py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700">{loading ? 'Salvando...' : 'Salvar Empresa'}</button>
            </div>
        </form>
    </div>
);

export default NewCompanyView;
