/**
 * components/NfseNacional/EmitirModal.tsx
 * Modal pra emitir NFS-e Nacional a partir da tela de empresa Simples.
 */
import React, { useEffect, useState } from 'react';
import type { User, SimplesNacionalEmpresa, NbsCodigo } from '../../types';
import { emitirNfse, getNbsCodigos, formatBRL } from '../../services/nfseNacionalService';
import { useConfirm } from '../dialog/DialogProvider';
import { parseValorMoeda, ecoDoValorDigitado } from '../../services/valorDigitado';

interface Props {
    empresa: SimplesNacionalEmpresa;
    currentUser: User | null;
    onClose: () => void;
    onShowToast: (msg: string) => void;
}

const EmitirModal: React.FC<Props> = ({ empresa, currentUser, onClose, onShowToast }) => {
    const confirm = useConfirm();
    const [nbsCodigos, setNbsCodigos] = useState<NbsCodigo[]>([]);
    // Lista que não carregou é DITA: dropdown vazio calado fazia parecer que
    // não havia serviço a escolher, quando a chamada é que tinha falhado.
    const [nbsErro, setNbsErro] = useState<string | null>(null);
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

    useEffect(() => {
        let ativo = true;
        getNbsCodigos(currentUser)
            .then(lista => { if (ativo) { setNbsCodigos(lista); setNbsErro(null); } })
            .catch((e: any) => { if (ativo) setNbsErro(e?.message || 'falha desconhecida'); });
        return () => { ativo = false; };
    }, [currentUser]);

    useEffect(() => {
        // Quando troca o NBS, sugere cIndOp + cClassTrib
        const nbs = nbsCodigos.find(n => n.codigo === codigoNbs);
        if (nbs) {
            if (nbs.cIndOpSugerido) setCIndOp(nbs.cIndOpSugerido);
            if (nbs.cClassTribSugerido) setCClassTrib(nbs.cClassTribSugerido);
        }
    }, [codigoNbs, nbsCodigos]);

    // O número sai do DONO da pergunta "que número a pessoa digitou?". Com
    // `parseFloat(valor.replace(',', '.'))`, "1.500,00" virava 1.5 e a NFS-e
    // era EMITIDA por R$ 1,50 — documento fiscal, não se desfaz. Ilegível é
    // null e a emissão RECUSA nomeando o campo; nunca zero de conveniência.
    const valorLido = parseValorMoeda(valor);
    const aliquotaLida = parseValorMoeda(aliquotaIss);
    const valorNum = valorLido ?? 0;
    const aliquotaNum = aliquotaLida ?? 0;
    // O que o app ENTENDEU do que foi digitado, ao lado do campo — com texto
    // ilegível o resumo mostrava "ISS 0,00 · líquido 0,00" como se fosse
    // conta feita sobre um valor real. Ilegível é dito, nunca calculado.
    const ecoValor = ecoDoValorDigitado(valor);
    const ecoAliquota = ecoDoValorDigitado(aliquotaIss);
    const valorIlegivel = !!valor.trim() && valorLido === null;
    const aliquotaIlegivel = !!aliquotaIss.trim() && aliquotaLida === null;
    const motivoBloqueio = emitindo ? 'Emitindo…'
        : valorIlegivel ? `Não entendi o valor do serviço "${valor}" — use 1234,56. A emissão será recusada.`
        : aliquotaIlegivel ? `Não entendi a alíquota do ISS "${aliquotaIss}" — use 5 ou 2,5. A emissão será recusada.`
        : !valor.trim() ? 'Falta o valor do serviço.'
        : valorLido !== null && valorLido <= 0 ? 'O valor do serviço deve ser maior que zero.'
        : !tomadorDoc ? 'Falta o CNPJ/CPF do tomador.'
        : !tomadorNome ? 'Falta o nome do tomador.'
        : !descricao ? 'Falta a descrição do serviço.'
        : null;
    const issCalculado = +(valorNum * aliquotaNum / 100).toFixed(2);
    const issRetidoValor = issRetido ? issCalculado : 0;
    const liquido = +(valorNum - issRetidoValor).toFixed(2);

    const handleEmitir = async () => {
        if (!tomadorDoc || !tomadorNome) return onShowToast('Preencha CNPJ/CPF e nome do tomador');
        if (!descricao) return onShowToast('Preencha a descrição do serviço');
        if (valor.trim() && valorLido === null) return onShowToast(`Não entendi o valor do serviço "${valor}" — use 1234,56. Nada foi emitido.`);
        if (aliquotaIss.trim() && aliquotaLida === null) return onShowToast(`Não entendi a alíquota do ISS "${aliquotaIss}" — use 5 ou 2,5. Nada foi emitido.`);
        if (valorNum <= 0) return onShowToast('Valor deve ser maior que zero');

        // Validacao fiscal de aliquota ISS (LC 116/03 art. 8º II + EC 37/02 art. 88)
        if (aliquotaNum > 5) {
            return onShowToast(`Alíquota ${aliquotaNum}% excede o máximo legal de 5% (LC 116/03 art. 8º II).`);
        }
        if (aliquotaNum > 0 && aliquotaNum < 2) {
            const ok = await confirm({
                title: `Alíquota ${aliquotaNum}% abaixo do piso constitucional`,
                message: 'O piso é 2% (EC 37/02 art. 88). Só é válida se houver benefício formal do município pra este serviço.',
                variant: 'warning',
                confirmLabel: 'Continuar',
            });
            if (!ok) return;
        }
        if (aliquotaNum === 0) {
            const ok = await confirm({
                title: 'Alíquota zero',
                message: 'Só é válida com isenção/imunidade formal do município. Continuar?',
                variant: 'warning',
                confirmLabel: 'Continuar',
            });
            if (!ok) return;
        }

        setEmitindo(true);
        try {
            const r = await emitirNfse(currentUser, {
                empresaId: empresa.id,
                prestador: { cnpj: empresa.cnpj, nome: empresa.nome },
                tomador: tomadorTipo === 'cnpj'
                    ? { cnpj: tomadorDoc.replace(/\D/g, ''), nome: tomadorNome }
                    : { cpf: tomadorDoc.replace(/\D/g, ''), nome: tomadorNome },
                servico: {
                    codigoNbs,
                    descricao,
                    valor: valorNum,
                    aliquotaIss: aliquotaNum,
                    issRetido,
                    cIndOp,
                    cClassTrib,
                },
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
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] animate-fade-in overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col my-auto" onClick={e => e.stopPropagation()}>
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
                        {nbsErro && (
                            <div className="text-xs text-red-600 dark:text-red-400 mb-2">
                                ⛔ A tabela NBS não carregou ({nbsErro}) — a lista de serviços está vazia por isso, não porque não há serviço. Feche e abra o modal para tentar de novo.
                            </div>
                        )}
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
                            {ecoValor && (
                                <div className={`text-[11px] mt-0.5 ${ecoValor.ok ? 'text-slate-500' : 'text-red-600 dark:text-red-400 font-semibold'}`}>
                                    {ecoValor.ok ? ecoValor.texto : `⛔ ${ecoValor.texto}`}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Alíquota ISS (%)</label>
                            <input
                                value={aliquotaIss}
                                onChange={e => setAliquotaIss(e.target.value)}
                                placeholder="5"
                                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                            />
                            {ecoAliquota && !ecoAliquota.ok && (
                                <div className="text-[11px] mt-0.5 text-red-600 dark:text-red-400 font-semibold">⛔ {ecoAliquota.texto}</div>
                            )}
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

                    {/* Resumo calculado — só sobre valor LIDO; ilegível não vira conta */}
                    {(valorIlegivel || aliquotaIlegivel) && (
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                            Sem resumo: {valorIlegivel ? 'o valor do serviço' : 'a alíquota do ISS'} está ilegível — não há ISS nem líquido a mostrar até corrigir o campo.
                        </div>
                    )}
                    {valorNum > 0 && !valorIlegivel && !aliquotaIlegivel && (
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
                        title={motivoBloqueio || 'Emitir a NFS-e Nacional com os dados acima'}
                        // Ilegível NÃO desliga o botão: o clique é o que devolve a recusa
                        // NOMEANDO o campo (toast) — botão apagado sem motivo se lê como
                        // função inexistente. O `title` diz por que vai ser recusado.
                        disabled={emitindo || !valor.trim() || (valorLido !== null && valorLido <= 0) || !tomadorDoc || !tomadorNome || !descricao}
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
