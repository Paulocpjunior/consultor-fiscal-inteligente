import React, { useMemo, useState } from 'react';
import type {
  DocumentoFiscalMeta,
  SpedFiscalConferenceResult,
  SpedFiscalInconsistencia,
  SpedFiscalParseResult,
  User,
} from '../../types';
import { parseSpedFiscalFile } from '../../services/spedFiscalParserService';
import { conferXmlContraSped } from '../../services/spedFiscalConferenceService';
import { listarDocumentos } from '../../services/xmlFiscalService';
import { isFirebaseConfigured } from '../../services/firebaseConfig';

interface SpedFiscalDashboardProps {
  currentUser: User | null;
  onShowToast?: (message: string) => void;
}

function onlyDigits(value?: string): string {
  return (value || '').replace(/\D+/g, '');
}

function formatCurrency(value?: number): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function getGravidadeClass(gravidade: SpedFiscalInconsistencia['gravidade']): string {
  switch (gravidade) {
    case 'CRITICA':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'ALTA':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
    case 'MEDIA':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'BAIXA':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

const SpedFiscalDashboard: React.FC<SpedFiscalDashboardProps> = ({
  currentUser,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<
    'painel' | 'importar' | 'documentos' | 'conferencia' | 'apuracao'
  >('painel');

  const [spedResult, setSpedResult] = useState<SpedFiscalParseResult | null>(null);
  const [conferenceResult, setConferenceResult] = useState<SpedFiscalConferenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const resumo = useMemo(() => {
    if (!spedResult) {
      return {
        documentos: 0,
        itens: 0,
        participantes: 0,
        produtos: 0,
        valorTotal: 0,
        icms: 0,
        ipi: 0,
      };
    }

    const documentos = spedResult.documentosC100.length;
    const itens = spedResult.documentosC100.reduce((acc, doc) => acc + doc.itens.length, 0);
    const valorTotal = spedResult.documentosC100.reduce(
      (acc, doc) => acc + (doc.valorDocumento || 0),
      0
    );
    const icms = spedResult.documentosC100.reduce(
      (acc, doc) => acc + (doc.valorIcms || 0),
      0
    );
    const ipi = spedResult.documentosC100.reduce(
      (acc, doc) => acc + (doc.valorIpi || 0),
      0
    );

    return {
      documentos,
      itens,
      participantes: spedResult.participantes.length,
      produtos: spedResult.produtos.length,
      valorTotal,
      icms,
      ipi,
    };
  }, [spedResult]);

  const handleImportFile = async (file?: File) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.txt')) {
      setErro('Selecione um arquivo TXT do SPED Fiscal.');
      return;
    }

    setLoading(true);
    setErro(null);

    try {
      const parsed = await parseSpedFiscalFile(file, {
        id: currentUser?.id,
        name: currentUser?.name,
      });

      setSpedResult(parsed);

      // Busca XMLs reais em documentos_fiscais filtrando por CNPJ do registro
      // 0000 e pela competência do SPED. Se Firebase não estiver configurado
      // ou a leitura falhar, segue com lista vazia — todos os C100 cairão em
      // "SPED sem XML", que ainda é uma conferência útil.
      let xmls: DocumentoFiscalMeta[] = [];
      if (isFirebaseConfigured && currentUser) {
        try {
          const todos = await listarDocumentos(currentUser, {
            competencia: parsed.arquivo.competencia,
            pageSize: 1000,
          });
          const cnpjSped = onlyDigits(parsed.arquivo.cnpj);
          xmls = cnpjSped
            ? todos.filter(x => onlyDigits(x.empresaCnpj) === cnpjSped)
            : todos;
        } catch (err) {
          console.warn('Falha ao ler documentos_fiscais para conferência:', err);
        }
      }

      const conference = conferXmlContraSped(xmls, parsed);
      setConferenceResult(conference);

      onShowToast?.(
        `SPED importado: ${parsed.documentosC100.length} C100 vs. ${xmls.length} XML(s) em documentos_fiscais ` +
        `· ${conference.inconsistencias.length} inconsistência(s).`,
      );
      setActiveTab('painel');
    } catch (err: any) {
      setErro(err.message || 'Erro ao importar SPED Fiscal.');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'painel', label: 'Painel' },
    { id: 'importar', label: 'Importar SPED TXT' },
    { id: 'documentos', label: 'Documentos Escriturados' },
    { id: 'conferencia', label: 'Conferência XML x SPED' },
    { id: 'apuracao', label: 'Apuração ICMS/IPI' },
  ] as const;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bg-gradient-to-r from-blue-700 to-indigo-700 p-5 rounded-xl text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">SPED Fiscal</h2>
            <p className="text-blue-100 text-sm">
              Conferência da EFD ICMS/IPI com base nos XMLs capturados e arquivo TXT importado.
            </p>
          </div>

          {spedResult && (
            <div className="text-sm bg-white/15 rounded-lg px-4 py-2">
              <div className="font-semibold">{spedResult.registro0000?.nome || 'Empresa não identificada'}</div>
              <div className="text-blue-100">
                CNPJ: {spedResult.registro0000?.cnpj || '-'} · Competência:{' '}
                {spedResult.arquivo.competencia || '-'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl whitespace-pre-wrap dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
          {erro}
        </div>
      )}

      {activeTab === 'painel' && (
        <div className="space-y-5">
          {!spedResult ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">
                Nenhum SPED importado
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mb-4">
                Importe um arquivo TXT da EFD ICMS/IPI para iniciar a conferência.
              </p>
              <button
                onClick={() => setActiveTab('importar')}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium"
              >
                Importar SPED Fiscal
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <p className="text-sm text-slate-500">Documentos C100</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{resumo.documentos}</p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <p className="text-sm text-slate-500">Itens C170</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{resumo.itens}</p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <p className="text-sm text-slate-500">Valor Documentos</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">
                    {formatCurrency(resumo.valorTotal)}
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <p className="text-sm text-slate-500">Inconsistências</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">
                    {conferenceResult?.inconsistencias.length || 0}
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <h3 className="font-bold text-slate-900 dark:text-white mb-3">Resumo do Arquivo</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-slate-500">Arquivo:</span>{' '}
                    <strong>{spedResult.arquivo.nomeArquivo}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Período:</span>{' '}
                    <strong>
                      {spedResult.arquivo.periodoInicial || '-'} até {spedResult.arquivo.periodoFinal || '-'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Participantes:</span>{' '}
                    <strong>{resumo.participantes}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Produtos:</span>{' '}
                    <strong>{resumo.produtos}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">ICMS C100:</span>{' '}
                    <strong>{formatCurrency(resumo.icms)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">IPI C100:</span>{' '}
                    <strong>{formatCurrency(resumo.ipi)}</strong>
                  </div>
                </div>
              </div>

              {(spedResult.erros.length > 0 || spedResult.avisos.length > 0) && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-5">
                  <h3 className="font-bold text-yellow-800 dark:text-yellow-300 mb-2">
                    Avisos e erros de importação
                  </h3>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-200 list-disc pl-5 space-y-1">
                    {[...spedResult.erros, ...spedResult.avisos].slice(0, 20).map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'importar' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
            Importar arquivo SPED Fiscal TXT
          </h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-5">
            Selecione o arquivo `.txt` da EFD ICMS/IPI para leitura dos registros fiscais.
          </p>

          <label className="block border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <input
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0])}
            />
            <div className="text-slate-700 dark:text-slate-200 font-semibold">
              {loading ? 'Processando arquivo...' : 'Clique para selecionar o SPED TXT'}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              Registros iniciais: 0000, 0150, 0200, C100, C170, C190, D100, E110 e E520
            </div>
          </label>
        </div>
      )}

      {activeTab === 'documentos' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-bold text-slate-900 dark:text-white">Documentos Escriturados C100</h3>
          </div>

          {!spedResult || spedResult.documentosC100.length === 0 ? (
            <div className="p-6 text-slate-500">Nenhum documento C100 encontrado.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="text-left p-3">Chave</th>
                    <th className="text-left p-3">Documento</th>
                    <th className="text-left p-3">Modelo</th>
                    <th className="text-left p-3">Série</th>
                    <th className="text-left p-3">Data</th>
                    <th className="text-right p-3">Valor</th>
                    <th className="text-right p-3">ICMS</th>
                    <th className="text-right p-3">IPI</th>
                  </tr>
                </thead>
                <tbody>
                  {spedResult.documentosC100.slice(0, 200).map((doc, idx) => (
                    <tr key={`${doc.chave}-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="p-3 font-mono text-xs">{doc.chave || '-'}</td>
                      <td className="p-3">{doc.numDoc || '-'}</td>
                      <td className="p-3">{doc.codMod || '-'}</td>
                      <td className="p-3">{doc.serie || '-'}</td>
                      <td className="p-3">{doc.dataDoc || '-'}</td>
                      <td className="p-3 text-right">{formatCurrency(doc.valorDocumento)}</td>
                      <td className="p-3 text-right">{formatCurrency(doc.valorIcms)}</td>
                      <td className="p-3 text-right">{formatCurrency(doc.valorIpi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'conferencia' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">Conferência XML x SPED</h3>
              <p className="text-sm text-slate-500">
                Nesta primeira versão, a conferência está preparada para comparar com a base de XMLs do Firestore.
              </p>
            </div>
          </div>

          {!conferenceResult ? (
            <div className="p-6 text-slate-500">Importe um SPED para gerar a conferência.</div>
          ) : conferenceResult.inconsistencias.length === 0 ? (
            <div className="p-6 text-emerald-600 font-medium">
              Nenhuma inconsistência encontrada na conferência inicial.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {conferenceResult.inconsistencias.map((inc) => (
                <div key={inc.id} className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {inc.tipo}
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${getGravidadeClass(inc.gravidade)}`}>
                      {inc.gravidade}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{inc.descricao}</p>
                  <div className="mt-2 text-xs text-slate-500">
                    Chave: {inc.chave || '-'} · XML: {formatCurrency(inc.valorXml)} · SPED:{' '}
                    {formatCurrency(inc.valorSped)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'apuracao' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Apuração ICMS — E110</h3>
            {!spedResult?.apuracaoIcms ? (
              <p className="text-slate-500 text-sm">Registro E110 não encontrado.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total Débitos</span>
                  <strong>{formatCurrency(spedResult.apuracaoIcms.valorTotalDebitos)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Total Créditos</span>
                  <strong>{formatCurrency(spedResult.apuracaoIcms.valorTotalCreditos)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Saldo Devedor</span>
                  <strong>{formatCurrency(spedResult.apuracaoIcms.valorSaldoDevedor)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>ICMS a Recolher</span>
                  <strong>{formatCurrency(spedResult.apuracaoIcms.valorIcmsRecolher)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Saldo Credor a Transportar</span>
                  <strong>{formatCurrency(spedResult.apuracaoIcms.valorSaldoCredorTransportar)}</strong>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Apuração IPI — E520</h3>
            {!spedResult?.apuracaoIpi ? (
              <p className="text-slate-500 text-sm">Registro E520 não encontrado.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Saldo Devedor IPI</span>
                  <strong>{formatCurrency(spedResult.apuracaoIpi.valorSaldoDevedorIpi)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Deduções IPI</span>
                  <strong>{formatCurrency(spedResult.apuracaoIpi.valorDeducoesIpi)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>IPI a Recolher</span>
                  <strong>{formatCurrency(spedResult.apuracaoIpi.valorIpiRecolher)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Saldo Credor IPI</span>
                  <strong>{formatCurrency(spedResult.apuracaoIpi.valorSaldoCredorIpi)}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SpedFiscalDashboard;
