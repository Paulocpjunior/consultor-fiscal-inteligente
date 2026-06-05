/**
 * components/NfseNacional/EmitirModal.tsx
 * Modal pra emitir NFS-e Nacional a partir da tela de empresa Simples.
 */
import React, { useEffect, useState } from 'react';
import type { User, SimplesNacionalEmpresa, NbsCodigo, NfseNacRuntimeStatus } from '../../types';
import { emitirNfse, getNbsCodigos, getNfseNacionalStatus, formatBRL } from '../../services/nfseNacionalService';

interface Props {
    empresa: SimplesNacionalEmpresa;
    currentUser: User | null;
    onClose: () => void;
    onShowToast: (msg: string) => void;
}

const EmitirModal: React.FC<Props> = ({ empresa, currentUser, onClose, onShowToast }) => {
    const municipioFiscalInicial = empresa.dadosFiscais?.codMunIBGE || '';
    const inscricaoMunicipal = empresa.dadosFiscais?.ccmSp || empresa.ccmSp || '';
    const [nbsCodigos, setNbsCodigos] = useState<NbsCodigo[]>([]);
    const [runtimeStatus, setRuntimeStatus] = useState<NfseNacRuntimeStatus | null>(null);
    const [emitindo, setEmitindo] = useState(false);

    // Form
    const [tomadorTipo, setTomadorTipo] = useState<'cnpj' | 'cpf'>('cnpj');
    const [tomadorDoc, setTomadorDoc] = useState('');
    const [tomadorNome, setTomadorNome] = useState('');
    const [codigoNbs, setCodigoNbs] = useState('101010100');
    const [descricao, setDescricao] = useState('');
    const [valor, setValor] = useState('');
    const [aliquotaIss, setAliquotaIss] = useState('5');
    const [issRetido, setIssRetido] = useState(false);
    const [cIndOp, setCIndOp] = useState('050201');
    const [cClassTrib, setCClassTrib] = useState('00000000');
    const [municipioEmissor, setMunicipioEmissor] = useState(municipioFiscalInicial);
    const [municipioPrestacao, setMunicipioPrestacao] = useState(municipioFiscalInicial);
    const [cTribNac, setCTribNac] = useState('');
    const [serieDps, setSerieDps] = useState('1');
    const [numeroDps, setNumeroDps] = useState('');
    const [dpsXml, setDpsXml] = useState('');

    useEffect(() => {
        getNbsCodigos().then(setNbsCodigos).catch(() => {});
        getNfseNacionalStatus().then(setRuntimeStatus).catch(() => {});
    }, []);

    useEffect(() => {
        // Quando troca o NBS, sugere cIndOp + cClassTrib
        const nbs = nbsCodigos.find(n => n.codigo === codigoNbs);
        if (nbs) {
            if (nbs.cIndOpSugerido) setCIndOp(nbs.cIndOpSugerido);
            if (nbs.cClassTribSugerido) setCClassTrib(nbs.cClassTribSugerido);
            if (nbs.cTribNacSugerido) setCTribNac(nbs.cTribNacSugerido);
        }
    }, [codigoNbs, nbsCodigos]);

    const valorNum = parseFloat(valor.replace(',', '.')) || 0;
    const aliquotaNum = parseFloat(aliquotaIss.replace(',', '.')) || 0;
    const issCalculado = +(valorNum * aliquotaNum / 100).toFixed(2);
    const issRetidoValor = issRetido ? issCalculado : 0;
    const liquido = +(valorNum - issRetidoValor).toFixed(2);
    const isSerpro = runtimeStatus?.mode !== 'mock';
    const dpsXmlManual = dpsXml.trim();
    const municipioEmissorLimpo = municipioEmissor.replace(/\D/g, '');
    const municipioPrestacaoLimpo = municipioPrestacao.replace(/\D/g, '');
    const cTribNacLimpo = cTribNac.replace(/\D/g, '');
    const serieDpsLimpa = serieDps.replace(/\D/g, '');
    const numeroDpsLimpo = numeroDps.replace(/\D/g, '');
    const geraDpsPorFormulario = isSerpro && !dpsXmlManual;
    const serproCamposInvalidos = geraDpsPorFormulario && (
        municipioEmissorLimpo.length !== 7
        || municipioPrestacaoLimpo.length !== 7
        || cTribNacLimpo.length !== 6
        || !/^\d{1,5}$/.test(serieDpsLimpa)
        || !/^[1-9]\d{0,14}$/.test(numeroDpsLimpo)
    );

    const handleEmitir = async () => {
        if (!tomadorDoc || !tomadorNome) return onShowToast('Preencha CNPJ/CPF e nome do tomador');
        if (!descricao) return onShowToast('Preencha a descrição do serviço');
        if (valorNum <= 0) return onShowToast('Valor deve ser maior que zero');
        const tomadorDocLimpo = tomadorDoc.replace(/\D/g, '');
        if (tomadorTipo === 'cnpj' && tomadorDocLimpo.length !== 14) {
            return onShowToast('CNPJ do tomador deve ter 14 dígitos');
        }
        if (tomadorTipo === 'cpf' && tomadorDocLimpo.length !== 11) {
            return onShowToast('CPF do tomador deve ter 11 dígitos');
        }
        if (geraDpsPorFormulario) {
            if (municipioEmissorLimpo.length !== 7) return onShowToast('Município emissor deve ter código IBGE com 7 dígitos');
            if (municipioPrestacaoLimpo.length !== 7) return onShowToast('Município de prestação deve ter código IBGE com 7 dígitos');
            if (cTribNacLimpo.length !== 6) return onShowToast('Código de tributação nacional deve ter 6 dígitos');
            if (!/^\d{1,5}$/.test(serieDpsLimpa)) return onShowToast('Série DPS deve ter de 1 a 5 dígitos');
            if (!/^[1-9]\d{0,14}$/.test(numeroDpsLimpo)) {
                return onShowToast('Número DPS deve ter de 1 a 15 dígitos e não iniciar com zero');
            }
        }

        // Validacao fiscal de aliquota ISS (LC 116/03 art. 8º II + EC 37/02 art. 88)
        if (aliquotaNum > 5) {
            return onShowToast(`Alíquota ${aliquotaNum}% excede o máximo legal de 5% (LC 116/03 art. 8º II).`);
        }
        if (aliquotaNum > 0 && aliquotaNum < 2) {
            const ok = window.confirm(
                `Alíquota ${aliquotaNum}% está abaixo do piso constitucional de 2% (EC 37/02 art. 88). ` +
                `Só é válida se houver benefício formal do município pra este serviço. Continuar?`
            );
            if (!ok) return;
        }
        if (aliquotaNum === 0) {
            const ok = window.confirm(
                'Alíquota zero — só é válida com isenção/imunidade formal do município. Continuar?'
            );
            if (!ok) return;
        }

        setEmitindo(true);
        try {
            const r = await emitirNfse(currentUser, {
                empresaId: empresa.id,
                prestador: {
                    cnpj: empresa.cnpj,
                    im: inscricaoMunicipal,
                    nome: empresa.nome,
                    municipioIbge: municipioEmissorLimpo || municipioFiscalInicial,
                    opSimpNac: '3',
                    regApTribSN: '1',
                    regEspTrib: '0',
                },
                tomador: tomadorTipo === 'cnpj'
                    ? { cnpj: tomadorDocLimpo, nome: tomadorNome }
                    : { cpf: tomadorDocLimpo, nome: tomadorNome },
                servico: {
                    codigoNbs,
                    descricao,
                    valor: valorNum,
                    aliquotaIss: aliquotaNum,
                    issRetido,
                    municipioPrestacao: municipioPrestacaoLimpo,
                    cTribNac: cTribNacLimpo || undefined,
                    cIndOp,
                    cClassTrib,
                },
                serieDps: serieDpsLimpa || undefined,
                numeroDps: numeroDpsLimpo || undefined,
                ...(dpsXmlManual ? { dpsXml: dpsXmlManual } : {}),
            });
            onShowToast(`NFSe Nº ${r.numero} emitida com sucesso!`);
            onClose();
        } catch (err: any) {
            onShowToast(`Erro: ${err.message}`);
        } finally {
            setEmitindo(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80] animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold">📑 Emitir NFS-e Nacional</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        Prestador: <strong>{empresa.nome}</strong> ({empresa.cnpj})
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Tomador */}
                    <div>
                        <h4 className="text-sm font-bold mb-2">Tomador do serviço</h4>
                        <div className="flex gap-2 mb-2">
                            <select
                                value={tomadorTipo}
                                onChange={e => setTomadorTipo(e.target.value as 'cnpj' | 'cpf')}
                                className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                            >
                                <option value="cnpj">CNPJ</option>
                                <option value="cpf">CPF</option>
                            </select>
                            <input
                                value={tomadorDoc}
                                onChange={e => setTomadorDoc(e.target.value)}
                                placeholder={tomadorTipo === 'cnpj' ? '00.000.000/0001-00' : '000.000.000-00'}
                                className="flex-1 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                            />
                        </div>
                        <input
                            value={tomadorNome}
                            onChange={e => setTomadorNome(e.target.value)}
                            placeholder="Nome / Razão social do tomador"
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                        />
                    </div>

                    {/* Servico */}
                    <div>
                        <h4 className="text-sm font-bold mb-2">Serviço prestado</h4>
                        <select
                            value={codigoNbs}
                            onChange={e => setCodigoNbs(e.target.value)}
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm mb-2"
                        >
                            {nbsCodigos.map(n => (
                                <option key={n.codigo} value={n.codigo}>{n.codigo} — {n.descricao}</option>
                            ))}
                        </select>
                        <textarea
                            value={descricao}
                            onChange={e => setDescricao(e.target.value)}
                            placeholder="Descrição detalhada do serviço (livre)..."
                            rows={3}
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm resize-none"
                        />

                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <div>
                                <label className="text-xs text-slate-500 block mb-1">cIndOp <span className="text-amber-600">(Reforma Tributária)</span></label>
                                <input
                                    value={cIndOp}
                                    onChange={e => setCIndOp(e.target.value)}
                                    placeholder="050201"
                                    maxLength={6}
                                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                />
                                <div className="text-[10px] text-slate-400 mt-0.5">Indicador de Operação (DPS)</div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 block mb-1">cClassTrib <span className="text-amber-600">(IBS/CBS)</span></label>
                                <input
                                    value={cClassTrib}
                                    onChange={e => setCClassTrib(e.target.value)}
                                    placeholder="00000000"
                                    maxLength={8}
                                    className={`w-full px-3 py-2 rounded border bg-white dark:bg-slate-800 text-sm font-mono ${cClassTrib === '00000000' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-300 dark:border-slate-600'}`}
                                />
                                <div className="text-[10px] text-slate-400 mt-0.5">Classificação Tributária IBS/CBS</div>
                            </div>
                        </div>

                        {cClassTrib === '00000000' && (
                            <div className="mt-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                ⚠️ <strong>cClassTrib em modo placeholder.</strong> A tabela oficial Anexo VIII RFB tem códigos específicos por serviço.
                                Antes de emitir em produção, importe a tabela via <code>POST /api/admin/nfse-nacional/import-nbs-csv</code> ou ajuste manualmente.
                            </div>
                        )}
                    </div>

                    {isSerpro && (
                        <div>
                            <h4 className="text-sm font-bold mb-2">Dados fiscais da DPS Nacional</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Município emissor IBGE</label>
                                    <input
                                        value={municipioEmissor}
                                        onChange={e => setMunicipioEmissor(e.target.value)}
                                        placeholder="3550308"
                                        maxLength={7}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Município prestação IBGE</label>
                                    <input
                                        value={municipioPrestacao}
                                        onChange={e => setMunicipioPrestacao(e.target.value)}
                                        placeholder="3550308"
                                        maxLength={7}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Código tributação nacional</label>
                                    <input
                                        value={cTribNac}
                                        onChange={e => setCTribNac(e.target.value)}
                                        placeholder="171801"
                                        maxLength={6}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Série DPS</label>
                                    <input
                                        value={serieDps}
                                        onChange={e => setSerieDps(e.target.value)}
                                        placeholder="1"
                                        maxLength={5}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Número DPS</label>
                                    <input
                                        value={numeroDps}
                                        onChange={e => setNumeroDps(e.target.value)}
                                        placeholder="1"
                                        maxLength={15}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <details className="mt-3">
                                <summary className="text-xs text-slate-500 cursor-pointer">DPS XML manual</summary>
                                <textarea
                                    value={dpsXml}
                                    onChange={e => setDpsXml(e.target.value)}
                                    placeholder="<DPS versao=&quot;1.01&quot; xmlns=&quot;http://www.sped.fazenda.gov.br/nfse&quot;>..."
                                    rows={6}
                                    spellCheck={false}
                                    className="mt-2 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-mono resize-none"
                                />
                            </details>
                        </div>
                    )}

                    {/* Valores */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Valor do serviço (R$)</label>
                            <input
                                value={valor}
                                onChange={e => setValor(e.target.value)}
                                placeholder="1500,00"
                                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Alíquota ISS (%)</label>
                            <input
                                value={aliquotaIss}
                                onChange={e => setAliquotaIss(e.target.value)}
                                placeholder="5"
                                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                            />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={issRetido}
                            onChange={e => setIssRetido(e.target.checked)}
                            className="rounded"
                        />
                        ISS retido pelo tomador
                    </label>

                    {/* Resumo calculado */}
                    {valorNum > 0 && (
                        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 grid grid-cols-3 gap-3 text-sm">
                            <div>
                                <div className="text-xs text-slate-500">Bruto</div>
                                <div className="font-bold">{formatBRL(valorNum)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500">ISS ({aliquotaNum}%)</div>
                                <div className="font-bold">{formatBRL(issCalculado)}</div>
                                {issRetido && (
                                    <div className="text-xs text-red-600 mt-0.5">retido</div>
                                )}
                            </div>
                            <div>
                                <div className="text-xs text-slate-500">Líquido</div>
                                <div className="font-bold text-emerald-600">{formatBRL(liquido)}</div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} className="btn-press px-4 py-2 text-slate-700 rounded-lg hover:bg-slate-100">
                        Cancelar
                    </button>
                    <button
                        onClick={handleEmitir}
                        disabled={emitindo || valorNum <= 0 || !tomadorDoc || !tomadorNome || !descricao || serproCamposInvalidos}
                        className="btn-press px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50"
                    >
                        {emitindo ? '⏳ Emitindo...' : '📑 Emitir NFSe'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmitirModal;
