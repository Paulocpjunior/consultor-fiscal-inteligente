/**
 * components/AnaliseCredito/ModalInvoiceManual.tsx
 *
 * Modal pra cadastrar uma invoice manual (entra no calculo do credito como
 * uma NF normal). Extraido de AnaliseCreditoExtrato.tsx (que tinha 2152
 * linhas) - issue #100.
 */
import React, { useState } from 'react';
import { adicionarInvoice } from '../../services/invoicesManuaisService';
import { parseValorMoeda } from '../../services/valorDigitado';

export interface ModalInvoiceManualProps {
  empresaId: string;
  periodoNormalizado: string;
  onFechar: () => void;
  onSalvo: () => void;
}

// O número sai do DONO (`parseValorMoeda`): a cópia local apagava TODO ponto,
// então a forma JS "1234.56" virava 123456 (100×), e o ilegível virava 0
// calado. Vazio continua 0 (campo opcional); ilegível é RECUSA nomeando o campo.
const CAMPOS_DE_VALOR: Array<[string, string]> = [
  ['valorNf', 'Valor da NF'], ['baseCalculo', 'Base de Cálculo'], ['aliquota', 'Alíquota'],
  ['valorIss', 'Valor do ISS'], ['issRetido', 'ISS retido'],
];

const ModalInvoiceManual: React.FC<ModalInvoiceManualProps> = ({
  empresaId, periodoNormalizado, onFechar, onSalvo,
}) => {
  const [emissao, setEmissao] = useState('');
  const [numero, setNumero] = useState('');
  const [serie, setSerie] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [valorNf, setValorNf] = useState('');
  const [baseCalculo, setBaseCalculo] = useState('');
  const [aliquota, setAliquota] = useState('');
  const [valorIss, setValorIss] = useState('');
  const [issRetido, setIssRetido] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErroLocal] = useState<string | null>(null);

  const podeSalvar = !!(cnpjCpf.trim() && razaoSocial.trim() && baseCalculo.trim());

  const salvar = async () => {
    setErroLocal(null);
    if (!podeSalvar) {
      setErroLocal('CNPJ, Razão Social e Base de Cálculo são obrigatórios.');
      return;
    }
    const textos: Record<string, string> = { valorNf, baseCalculo, aliquota, valorIss, issRetido };
    const lidos: Record<string, number> = {};
    for (const [campo, rotulo] of CAMPOS_DE_VALOR) {
      const t = textos[campo].trim();
      if (!t) { lidos[campo] = 0; continue; }
      const n = parseValorMoeda(t);
      if (n === null) {
        setErroLocal(`Não entendi o campo ${rotulo} ("${t}") — use 1234,56. Nada foi salvo.`);
        return;
      }
      lidos[campo] = n;
    }
    setSalvando(true);
    try {
      const r = await adicionarInvoice({
      empresaId,
      periodo: periodoNormalizado,
      emissao: emissao.trim(),
      numero: numero.trim(),
      serie: serie.trim(),
      cnpjCpf: cnpjCpf.trim(),
      razaoSocial: razaoSocial.trim(),
      valorNf: lidos.valorNf || lidos.baseCalculo,
      baseCalculo: lidos.baseCalculo,
      aliquota: lidos.aliquota,
      valorIss: lidos.valorIss,
      issRetido: lidos.issRetido,
      });
      if (r.ok) {
        onSalvo();
        onFechar();
      } else {
        setErroLocal('Erro ao salvar: ' + (r.error || 'desconhecido'));
      }
    } catch (e: any) {
      setErroLocal('Erro ao salvar: ' + (e?.message || 'desconhecido'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onFechar}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto my-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Adicionar invoice manual</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Período: <strong>{periodoNormalizado}</strong>. A invoice manual entra no cálculo do crédito como uma NF normal.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Emissão</label>
              <input value={emissao} onChange={e => setEmissao(e.target.value)} placeholder="dd/mm/aaaa"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Número</label>
              <input value={numero} onChange={e => setNumero(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Série</label>
              <input value={serie} onChange={e => setSerie(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">CNPJ/CPF *</label>
              <input value={cnpjCpf} onChange={e => setCnpjCpf(e.target.value)} placeholder="00.000.000/0000-00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 font-mono bg-white dark:bg-gray-700" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-600 dark:text-gray-300">Razão Social *</label>
              <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Valor NF (R$)</label>
              <input value={valorNf} onChange={e => setValorNf(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Base de Cálculo (R$) *</label>
              <input value={baseCalculo} onChange={e => setBaseCalculo(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700 font-semibold" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Alíquota (%)</label>
              <input value={aliquota} onChange={e => setAliquota(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Valor ISS (R$)</label>
              <input value={valorIss} onChange={e => setValorIss(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">ISS Retido (R$)</label>
              <input value={issRetido} onChange={e => setIssRetido(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
          </div>

          {erro && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 text-xs text-red-700 dark:text-red-300">
              {erro}
            </div>
          )}

          <p className="text-[11px] text-gray-400">
            * obrigatorio. Use vírgula como separador decimal (ex: 1.234,56).
          </p>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onFechar}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!podeSalvar || salvando}
            className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalInvoiceManual;
