import React, { useState } from 'react';
import { ingerirXmlEmail, type XmlEmailIngestResultado } from '../../services/saeNfceService';

/**
 * CofreEmailPanel — o "cofre" do CFI que substitui o cofre da SIEG.
 *
 * O sistema emissor de cada cliente manda o XML de cada nota emitida para uma
 * caixa do escritório (Microsoft 365). Este painel dispara a leitura dessa
 * caixa: o CFI baixa os anexos .xml, descobre de qual cliente é a nota e
 * importa (saída mod 55 inclusive — que a SEFAZ não entrega ao emissor). Roda
 * sozinho a cada 30 min; este botão é para disparo manual.
 */
const CofreEmailPanel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [resp, setResp] = useState<XmlEmailIngestResultado | null>(null);

    const rodar = async (opts: { janelaDias?: number; maxMensagens?: number } = {}) => {
        setLoading(true);
        setResp(null);
        try {
            setResp(await ingerirXmlEmail(opts));
        } catch (e) {
            setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    const clientes = resp?.detalhePorEmpresa ? Object.entries(resp.detalhePorEmpresa) : [];

    return (
        <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-3">
            <div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    📬 Cofre CFI — XMLs por e-mail (substitui o cofre da SIEG)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Lê os XMLs que os <strong>emissores dos clientes enviam por e-mail</strong> para a caixa do escritório e importa
                    automaticamente — é assim que a <strong>saída mod 55</strong> entra (a SEFAZ não entrega a saída ao próprio emissor).
                    Aceita <strong>anexo .xml</strong>, <strong>.zip</strong> com os XMLs do dia e <strong>link de download</strong> no
                    corpo (prefeitura/ERP), varrendo Caixa de Entrada, subpastas e Lixo Eletrônico.
                    Roda sozinho a cada 30 min; este botão é disparo manual.
                </p>
            </div>

            <details className="text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-bold">Como migrar da SIEG (uma vez por cliente)</summary>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                    <li>No sistema emissor do cliente, na configuração de <em>envio de XML por e-mail</em>, adicione a caixa do CFI ao lado da do cofre SIEG (a maioria aceita vários destinatários);</li>
                    <li>A SIEG continua recebendo em paralelo — zero risco durante a transição;</li>
                    <li>Histórico: baixe os XMLs antigos do cofre SIEG (“Baixar Selecionados”) e use a Importação por ZIP acima.</li>
                </ol>
            </details>

            <div className="flex flex-wrap gap-2 items-center">
                <button onClick={() => rodar()} disabled={loading}
                    className="px-4 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
                    {loading ? 'Lendo a caixa…' : 'Ler caixa agora'}
                </button>
                {/* Até 27/07 o cofre só lia e-mail NÃO-LIDO: bastava alguém da
                    equipe abrir a mensagem no Outlook pra a nota nunca ser
                    importada. Esta varredura recupera o que ficou para trás
                    (é seguro: a importação deduplica e o registro por
                    messageId evita reprocesso). */}
                <button onClick={() => rodar({ janelaDias: 180, maxMensagens: 100 })} disabled={loading}
                    className="px-4 py-1.5 text-xs font-bold rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200">
                    Recuperar histórico (180 dias)
                </button>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    A recuperação varre 6 meses da caixa (inclusive e-mails já abertos pela equipe) — pode levar alguns minutos.
                </span>
            </div>

            {resp && !resp.ok && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">Falha na ingestão</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{resp.error || 'Erro desconhecido.'}</p>
                    {/(403|Forbidden|Access|permission|Authorization_RequestDenied)/i.test(resp.error || '') && (
                        <p className="text-[11px] text-red-500 dark:text-red-400 mt-1">
                            Falta autorizar o app no Azure: <strong>App registrations → API permissions → Microsoft Graph →
                            Application → <code>Mail.ReadWrite</code> → Grant admin consent</strong>. É a "senha" do app — sem isso o Graph barra a leitura.
                        </p>
                    )}
                    {/(404|NotFound|ErrorInvalidUser|MailboxNotEnabled|ResourceNotFound)/i.test(resp.error || '') && (
                        <p className="text-[11px] text-red-500 dark:text-red-400 mt-1">
                            A caixa <code>xml@spassessoriacontabil.com.br</code> não foi encontrada / não tem caixa de correio habilitada. Confirme que ela existe e tem licença de e-mail.
                        </p>
                    )}
                    {(resp.error || '').includes('não configurada') && (
                        <p className="text-[11px] text-red-500 dark:text-red-400 mt-1">
                            Defina a variável <code>XML_INGEST_MAILBOX</code> com a caixa que vai receber os XMLs.
                        </p>
                    )}
                </div>
            )}

            {resp && resp.ok && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">
                        ✓ {resp.mensagens ?? 0} e-mails · {resp.anexos ?? 0} anexos ·{' '}
                        <span className="text-emerald-600 dark:text-emerald-400">{resp.importadasSaida ?? 0} saídas</span> ·
                        {' '}{resp.importadasEntrada ?? 0} entradas · {resp.atualizadas ?? 0} completadas · {resp.duplicadas ?? 0} duplicadas · {resp.erros ?? 0} erros
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        caixa: {resp.caixa || '—'} · {resp.empresasMonitoradas ?? 0} empresas monitoradas · {resp.semDono ?? 0} anexos sem cliente monitorado
                        {(resp.links ?? 0) > 0 && ` · ${resp.links} link(s) no corpo, ${resp.linksBaixados ?? 0} baixado(s) → ${resp.xmlsDeLink ?? 0} XML(s)`}
                    </p>
                    {/* Link recusado pela allowlist: é exatamente a lista de
                        domínios a autorizar (só .gov.br entra por padrão). */}
                    {(resp.linksBloqueados?.length ?? 0) > 0 && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-400">
                            <p className="font-bold">⚠ Link de download recusado (domínio não autorizado):</p>
                            <ul className="list-disc list-inside mt-0.5 font-mono">
                                {(resp.linksBloqueados || []).map((h, i) => <li key={i}>{h}</li>)}
                            </ul>
                            <p className="mt-1">
                                Se o domínio for do ERP de um cliente e for confiável, acrescente-o à variável{' '}
                                <code>XML_INGEST_LINK_DOMINIOS</code> (lista separada por vírgula) e rode de novo.
                            </p>
                        </div>
                    )}
                    {(resp.errosDetalhe?.length ?? 0) > 0 && (
                        <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                            <p className="font-bold">✕ Erros de importação:</p>
                            <ul className="list-disc list-inside mt-0.5 font-mono break-all">
                                {(resp.errosDetalhe || []).map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        </div>
                    )}
                    {(resp.anexosNaoXml?.length ?? 0) > 0 && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                            <p className="font-bold">⚠ E-mail com anexo, mas nenhum <code>.xml</code> direto:</p>
                            <ul className="list-disc list-inside mt-0.5 font-mono">
                                {(resp.anexosNaoXml || []).map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                            <p className="mt-1 not-italic">
                                Se aparecer <code>itemAttachment</code> = e-mail encaminhado (o XML está aninhado — mande o XML como anexo direto, sem encaminhar).
                                <code>.zip</code> já é lido automaticamente; <code>.pdf</code> sozinho não serve — peça o <code>.xml</code>.
                            </p>
                        </div>
                    )}
                    {clientes.filter(([, d]) => d.saida > 0).length > 0 && (
                        <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400 space-y-0.5 max-h-40 overflow-y-auto">
                            {clientes.filter(([, d]) => d.saida > 0).map(([cnpj, d]) => (
                                <li key={cnpj}><span className="font-mono">{cnpj}</span> — {d.nome}: <strong>{d.saida}</strong> saída(s){d.atualizadas ? `, ${d.atualizadas} completadas` : ''}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

export default CofreEmailPanel;
