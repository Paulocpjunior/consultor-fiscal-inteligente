/**
 * EmpresaDadosFiscaisModal — modal pra editar dados fiscais necessarios
 * pra geracao de SPED Fiscal e outras obrigacoes acessorias.
 *
 * Funciona pra empresas Simples Nacional E Lucro Presumido/Real.
 * Recebe os valores atuais via prop, dispara onSave com o objeto novo.
 */
import React, { useEffect, useState } from 'react';
import type { EmpresaDadosFiscais } from '../types';
import { CloseIcon, BuildingIcon } from './Icons';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    empresaNome: string;
    valoresAtuais?: EmpresaDadosFiscais;
    onSave: (dados: EmpresaDadosFiscais) => Promise<void>;
}

const UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const EmpresaDadosFiscaisModal: React.FC<Props> = ({
    isOpen,
    onClose,
    empresaNome,
    valoresAtuais,
    onSave,
}) => {
    const [dados, setDados] = useState<EmpresaDadosFiscais>(valoresAtuais || {});
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setDados(valoresAtuais || {});
            setErro(null);
        }
    }, [isOpen, valoresAtuais]);

    const handleField = (key: keyof EmpresaDadosFiscais, value: string) => {
        setDados(prev => ({ ...prev, [key]: value || undefined }));
    };

    const handleSave = async () => {
        setSalvando(true);
        setErro(null);
        try {
            // Sanitiza: aceita IE em maiusculas, remove espacos extras
            const limpo: EmpresaDadosFiscais = {
                ...dados,
                inscricaoEstadual: dados.inscricaoEstadual?.trim().toUpperCase(),
                uf: dados.uf?.trim().toUpperCase(),
                codMunIBGE: dados.codMunIBGE?.replace(/\D/g, ''),
                cep: dados.cep?.replace(/\D/g, ''),
                telefone: dados.telefone?.replace(/\D/g, ''),
            };
            await onSave(limpo);
            onClose();
        } catch (e: any) {
            setErro(e?.message || 'Erro ao salvar.');
        } finally {
            setSalvando(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70] animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <BuildingIcon className="w-5 h-5 text-sky-600" />
                        Dados Fiscais — {empresaNome}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex-grow overflow-y-auto bg-white dark:bg-slate-800 space-y-6">
                    {erro && (
                        <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-sm font-medium">
                            {erro}
                        </div>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Informações necessárias para geração de SPED Fiscal e outras obrigações acessórias.
                        Campos opcionais ficam em branco se não souber.
                    </p>

                    {/* Inscrição Estadual */}
                    <Section titulo="📋 Inscrições e Localização">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Field
                                label="Inscrição Estadual"
                                value={dados.inscricaoEstadual || ''}
                                onChange={v => handleField('inscricaoEstadual', v)}
                                placeholder="123.456.789.012 ou ISENTO"
                                hint="Sem pontos. Use 'ISENTO' se a empresa não é contribuinte ICMS."
                            />
                            <SelectField
                                label="UF"
                                value={dados.uf || ''}
                                onChange={v => handleField('uf', v)}
                                options={[{ value: '', label: '— Selecione —' }, ...UFS.map(u => ({ value: u, label: u }))]}
                            />
                            <Field
                                label="Código Município IBGE"
                                value={dados.codMunIBGE || ''}
                                onChange={v => handleField('codMunIBGE', v)}
                                placeholder="3550308"
                                hint="7 dígitos. Ex: São Paulo = 3550308."
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <Field
                                label="IE Substituto Tributário"
                                value={dados.inscEstSubstTrib || ''}
                                onChange={v => handleField('inscEstSubstTrib', v)}
                                placeholder="Opcional — só se for inscrito como ST em outra UF"
                            />
                            <Field
                                label="Código Suframa"
                                value={dados.codSuframa || ''}
                                onChange={v => handleField('codSuframa', v)}
                                placeholder="Opcional — só se em zona franca"
                            />
                        </div>
                    </Section>

                    {/* Endereço */}
                    <Section titulo="🏢 Endereço">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-2">
                                <Field
                                    label="Logradouro"
                                    value={dados.logradouro || ''}
                                    onChange={v => handleField('logradouro', v)}
                                    placeholder="Av. Paulista"
                                />
                            </div>
                            <Field
                                label="Número"
                                value={dados.numero || ''}
                                onChange={v => handleField('numero', v)}
                                placeholder="1000"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                            <Field
                                label="Complemento"
                                value={dados.complemento || ''}
                                onChange={v => handleField('complemento', v)}
                                placeholder="Sala 123"
                            />
                            <Field
                                label="Bairro"
                                value={dados.bairro || ''}
                                onChange={v => handleField('bairro', v)}
                                placeholder="Bela Vista"
                            />
                            <Field
                                label="CEP"
                                value={dados.cep || ''}
                                onChange={v => handleField('cep', v)}
                                placeholder="01310-100"
                                hint="Apenas números."
                            />
                        </div>
                    </Section>

                    {/* Contato */}
                    <Section titulo="📞 Contato">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field
                                label="Email"
                                value={dados.email || ''}
                                onChange={v => handleField('email', v)}
                                placeholder="contato@empresa.com.br"
                            />
                            <Field
                                label="Telefone"
                                value={dados.telefone || ''}
                                onChange={v => handleField('telefone', v)}
                                placeholder="(11) 91234-5678"
                                hint="Apenas números, com DDD."
                            />
                        </div>
                    </Section>

                    {/* SPED config */}
                    <Section titulo="📊 Configuração SPED Fiscal">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SelectField
                                label="Perfil EFD"
                                value={dados.perfilEFD || 'A'}
                                onChange={v => handleField('perfilEFD', v)}
                                options={[
                                    { value: 'A', label: 'A — Detalhamento completo (recomendado)' },
                                    { value: 'B', label: 'B — Detalhamento resumido' },
                                    { value: 'C', label: 'C — Anual (microprodutor)' },
                                ]}
                                hint="Perfil A é o mais comum e atende todos os casos."
                            />
                            <SelectField
                                label="Indicador de Atividade"
                                value={dados.indAtividade || 'outras'}
                                onChange={v => handleField('indAtividade', v as 'industrial' | 'outras')}
                                options={[
                                    { value: 'outras', label: 'Outras (comércio, serviços, transporte)' },
                                    { value: 'industrial', label: 'Industrial / equiparada' },
                                ]}
                            />
                            <SelectField
                                label="Natureza da Atividade (correlacao CFOP)"
                                value={dados.naturezaAtividade || ''}
                                onChange={v => handleField('naturezaAtividade', v as any)}
                                options={[
                                    { value: '', label: '— Derivar de Ind. Atividade —' },
                                    { value: 'comercio', label: 'Comercio (revenda)' },
                                    { value: 'industria', label: 'Industria' },
                                    { value: 'servicos', label: 'Servicos' },
                                    { value: 'misto', label: 'Misto (sem heuristica)' },
                                ]}
                            />
                        </div>
                    </Section>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-b-xl flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={salvando}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-semibold transition-colors disabled:opacity-40"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={salvando}
                        className="px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-40"
                    >
                        {salvando ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Componentes auxiliares ───────────────────────────────────────────

const Section: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
    <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
            {titulo}
        </h4>
        {children}
    </div>
);

interface FieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    hint?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder, hint }) => (
    <div>
        <label className="text-xs uppercase font-medium block mb-1 text-slate-500 dark:text-slate-400">
            {label}
        </label>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        {hint && <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
);

interface SelectFieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    hint?: string;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options, hint }) => (
    <div>
        <label className="text-xs uppercase font-medium block mb-1 text-slate-500 dark:text-slate-400">
            {label}
        </label>
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        >
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
        {hint && <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
);

export default EmpresaDadosFiscaisModal;
