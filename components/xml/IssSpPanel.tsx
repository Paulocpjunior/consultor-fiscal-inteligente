/**
 * IssSpPanel — guia do ISS próprio da NFS-e de São Paulo capital.
 *
 * Paulo (05/08): *"devemos habilitar a emissão de ISS pelo CFI, criando este
 * modal"* · *"somente São Paulo capital"*.
 *
 * O QUE ESTA TELA NÃO FAZ, e é decisão: não gera número de guia. Quem emite é
 * a Prefeitura, no portal da NFS-e — o CSV do portal traz "nº da guia" e "data
 * de quitação da guia", prova de que o número é de lá. Mesma regra do DARE-SP.
 *
 * O que ela faz é o que faltava: apurar o que há a recolher no mês, separar o
 * que o tomador já reteve, travar quando o dado está incompleto e levar a guia
 * ao cliente pelo rito #293 (SharePoint + gestor em cópia + baixa + auditoria).
 */
import React, { useMemo, useState } from 'react';
import type { User } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, getDadosFiscaisEmpresa, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { apurarIssSp, empresaEhSpCapital, type ApuracaoIssSp } from '../../services/issSpApuracao';
import { enviarGuiaPeloServidor, mensagemEnvioServidor } from '../../services/envioImpostoService';
import EmpresaSearchSelect from './EmpresaSearchSelect';

interface SaudeCaptura {
    farol: 'ok' | 'atencao' | 'quebrado';
    motivo: string;
    acao: string | null;
    zeroConfiavel: boolean;
    empresaFalhou?: { erro: string; ccm: string | null } | null;
}

const PORTAL_NFSE_SP = 'https://nfe.prefeitura.sp.gov.br/';

const brl = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const compAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Falha ao LER a saúde não vira "está tudo bem": sem resposta, a tela trata
 * como não-confiável e diz isso.
 */
async function carregarSaude(cnpj: string): Promise<SaudeCaptura> {
    try {
        const { getAuth } = await import('firebase/auth');
        const token = await getAuth().currentUser?.getIdToken();
        const r = await fetch(`/api/admin/sefaz/nfsesp-saude?cnpj=${encodeURIComponent(cnpj)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const d = await r.json();
        if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        return d as SaudeCaptura;
    } catch (e: any) {
        return {
            farol: 'atencao',
            motivo: `Não consegui conferir a saúde da captura de NFS-e SP (${e?.message || e}).`,
            acao: 'Confira a aba Captura antes de concluir que o cliente não emitiu nota.',
            zeroConfiavel: false,
        };
    }
}

const IssSpPanel: React.FC<{ currentUser: User | null; onShowToast?: (m: string) => void }> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [empresaId, setEmpresaId] = useState('');
    const [competencia, setCompetencia] = useState(compAtual());
    const [carregando, setCarregando] = useState(false);
    const [apuracao, setApuracao] = useState<ApuracaoIssSp | null>(null);
    const [foraDaPraca, setForaDaPraca] = useState(false);
    const [pdfGuia, setPdfGuia] = useState<{ base64: string; nome: string } | null>(null);
    // Saúde do trilho de captura — sem ela, "0 notas" e "não conseguimos
    // buscar" ficam idênticos na tela, e o colaborador só descobre tentando.
    const [saude, setSaude] = useState<SaudeCaptura | null>(null);
    const [enviando, setEnviando] = useState(false);
    // Diagnóstico do WS da Prefeitura — UMA chamada, resposta crua. Existe pra
    // o Paulo reproduzir o erro 1102 com um clique, em vez de navegar no
    // portal atrás de um dado que o app consegue buscar sozinho.
    const [ccmDiag, setCcmDiag] = useState('');
    /** De onde veio o CCM da caixinha — cadastro, nota, ou nenhum dos dois. */
    const [ccmOrigem, setCcmOrigem] = useState<'cadastro' | 'divergente' | 'ausente'>('ausente');
    /** CCM que aparece nas NOTAS — serve pra denunciar, não pra preencher. */
    const [ccmDaNota, setCcmDaNota] = useState('');
    const [diagWs, setDiagWs] = useState<any>(null);
    // Visão de carteira: a apuração acima resolve UM cliente; esta responde
    // quem falta. Sem ela, "quem tem ISS este mês?" seria 157 perguntas.
    const [sonda, setSonda] = useState<any>(null);
    const [sondando, setSondando] = useState(false);
    const [carteira, setCarteira] = useState<any>(null);
    const [carregandoCarteira, setCarregandoCarteira] = useState(false);
    const [testandoWs, setTestandoWs] = useState(false);

    React.useEffect(() => {
        let alive = true;
        if (currentUser) getEmpresasDisponiveis(currentUser).then(l => { if (alive) setEmpresas(l); });
        return () => { alive = false; };
    }, [currentUser]);

    const empresa = useMemo(() => empresas.find(e => e.id === empresaId) || null, [empresas, empresaId]);

    const apurar = async (idOverride?: unknown) => {
        const idAlvo = typeof idOverride === 'string' ? idOverride : empresaId;
        const alvo = empresas.find(e => e.id === idAlvo) || null;
        if (!alvo || !currentUser) { onShowToast?.('Escolha a empresa.'); return; }
        setCarregando(true);
        setApuracao(null);
        setPdfGuia(null);
        try {
            const df = await getDadosFiscaisEmpresa(alvo.fonte, alvo.id);
            // Fora de SP capital a guia é de outra prefeitura, com outra regra
            // de vencimento e outro portal — dizer isso é melhor que apurar
            // um número que ninguém pode pagar aqui.
            setForaDaPraca(!empresaEhSpCapital(df));
            setDiagWs(null);
            const [docs, s] = await Promise.all([
                listDocumentos(currentUser, { competencia, empresaId: alvo.id, empresaCnpj: alvo.cnpj }),
                carregarSaude(alvo.cnpj),
            ]);
            setSaude(s);
            const ap = apurarIssSp(docs, competencia, { issConfig: (df as any)?.issConfig || null });
            setApuracao(ap);
            // CCM vem do CADASTRO, e só. Preencher sozinho pela nota seria
            // contornar cadastro em branco — e cadastro errado ou faltando
            // ACENDE ALERTA pro colaborador arrumar, não vira ferramenta de
            // conserto (Paulo, 06/08). A nota serve só pra DENUNCIAR: ausência
            // e divergência viram aviso, nunca preenchimento automático.
            const doCadastro = String((df as any)?.ccmSp || (df as any)?.inscricaoMunicipal || '').replace(/\D/g, '');
            const daNota = ap.ccmDasNotas[0] || '';
            setCcmDiag(doCadastro);
            setCcmDaNota(daNota);
            setCcmOrigem(
                doCadastro
                    ? (daNota && daNota !== doCadastro ? 'divergente' : 'cadastro')
                    : 'ausente',
            );
        } finally {
            setCarregando(false);
        }
    };

    const carregarCarteira = async () => {
        setCarregandoCarteira(true);
        setCarteira(null);
        try {
            const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
            const r = await fetch(`/api/admin/sefaz/iss-carteira?competencia=${encodeURIComponent(competencia)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j = await r.json();
            // Falha na varredura NÃO pode virar tela vazia parecendo "ninguém
            // deve nada" — o motivo aparece.
            setCarteira(j.ok ? j : { erro: j.error || `Falha ao varrer a carteira (HTTP ${r.status}).` });
        } catch (e: any) {
            setCarteira({ erro: `Falha ao varrer a carteira: ${e?.message || e}` });
        } finally {
            setCarregandoCarteira(false);
        }
    };

    // Com o envelope descartado pelo contrato do WSDL, sobram duas causas
    // OPOSTAS pro 1102. A sonda separa as duas comparando códigos de erro
    // entre variantes conhecidas — evidência, não tentativa.
    const sondarWs = async () => {
        if (!empresa) { onShowToast?.('Escolha a empresa.'); return; }
        setSondando(true);
        setSonda(null);
        try {
            const t = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
            const r = await fetch('/api/admin/sefaz/nfsesp-ws-sonda', {
                method: 'POST',
                headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cnpj: empresa.cnpj, ccm: ccmDiag, anoMes: competencia }),
            });
            setSonda(await r.json());
        } catch (e: any) {
            setSonda({ ok: false, erro: String(e?.message || e) });
        } finally {
            setSondando(false);
        }
    };

    const testarWs = async () => {
        if (!empresa) { onShowToast?.('Escolha a empresa.'); return; }
        setTestandoWs(true);
        setDiagWs(null);
        try {
            const { getAuth } = await import('firebase/auth');
            const token = await getAuth().currentUser?.getIdToken();
            const r = await fetch('/api/admin/sefaz/nfsesp-ws-diagnostico', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cnpj: empresa.cnpj, ccm: ccmDiag, anoMes: competencia }),
            });
            setDiagWs(await r.json());
        } catch (e: any) {
            setDiagWs({ ok: false, erro: String(e?.message || e) });
        } finally {
            setTestandoWs(false);
        }
    };

    const anexarPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const buf = await file.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        setPdfGuia({ base64: btoa(bin), nome: file.name });
        e.target.value = '';
    };

    const enviarAoCliente = async () => {
        if (!apuracao || !empresa) return;
        if (!pdfGuia) { onShowToast?.('Anexe o PDF da guia emitida no portal antes de enviar.'); return; }
        setEnviando(true);
        try {
            const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
            const resp = token ? await fetch(`/api/admin/empresa-contato/${encodeURIComponent(empresa.cnpj)}`, {
                headers: { Authorization: `Bearer ${token}` },
            }) : null;
            const contato = resp?.ok ? await resp.json() : { email: '' };
            if (!contato.email) {
                onShowToast?.('E-mail do cliente não cadastrado — preencha em "Dados Fiscais" da empresa.');
                return;
            }
            const venc = apuracao.vencimento.split('-').reverse().join('/');
            const r = await enviarGuiaPeloServidor({
                empresaId: empresa.id,
                empresaCnpj: empresa.cnpj,
                empresaNome: empresa.nome,
                tipo: 'ISS',
                competencia,
                para: contato.email,
                assunto: `ISS ${competencia.split('-').reverse().join('/')} — ${empresa.nome}`,
                mensagem: [
                    'Olá, tudo bem?',
                    '',
                    `Segue a guia do ISS referente à competência ${competencia.split('-').reverse().join('/')}.`,
                    `Valor: ${brl(apuracao.aRecolher)}`,
                    `Vencimento: ${venc}`,
                    '',
                    'A guia segue anexa. Por gentileza, confirme o pagamento após a quitação.',
                    '',
                    'Atenciosamente,',
                    'SP Assessoria Contábil',
                ].join('\n'),
                pdfBase64: pdfGuia.base64,
                pdfFileName: pdfGuia.nome,
                valor: apuracao.aRecolher,
                vencimento: apuracao.vencimento,
            });
            if (r.ok) onShowToast?.(mensagemEnvioServidor(r));
            else onShowToast?.(`Falha no envio: ${r.error}`);
        } catch (err: any) {
            onShowToast?.(`Falha no envio: ${err?.message || err}`);
        } finally {
            setEnviando(false);
        }
    };

    const SITUACAO_ROTULO: Record<string, { txt: string; cls: string }> = {
        'sem-ccm':         { txt: '🚨 sem CCM',        cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
        'captura-incerta': { txt: '⚠ captura incerta', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
        'iss-zerado':      { txt: '❓ ISS zerado',      cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
        // Zero que a PRÓPRIA NOTA explica não é pendência — é resposta.
        'iss-zerado-explicado': { txt: '✓ zero explicado', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
        'a-recolher':      { txt: '💰 a recolher',     cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
        'iss-no-das':      { txt: '📦 dentro do DAS',  cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
        'iss-fixo':        { txt: '🏛 ISS fixo (SUP)', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300' },
        'so-retido':       { txt: '↩ só retido',       cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
        'so-tomado':       { txt: '↩ só tomador',      cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
        'sem-movimento':   { txt: '— sem movimento',   cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
    };

    return (
        <div className="space-y-4">
            {/* Visão de CARTEIRA: a apuração abaixo resolve o cliente que está
                na mão; esta responde QUEM FALTA — a onda 1 são 157 empresas. */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">📋 ISS da carteira — quem falta neste mês</h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Só empresas de SP capital. Zero notas só vale como "sem movimento" quando a captura do mês
                            rodou — senão fica como <strong>incerto</strong>, porque guia que não sai não avisa.
                        </p>
                    </div>
                    <button onClick={carregarCarteira} disabled={carregandoCarteira}
                        className="px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40">
                        {carregandoCarteira ? 'Varrendo…' : '📋 Varrer carteira'}
                    </button>
                </div>

                {/* A CAUSA vem antes da consequência. Sem isto, a tela mostra
                    "209 empresas com captura incerta" e ninguém sabe POR QUÊ —
                    o colaborador vê 209 alertas e nenhuma ação. O farol honesto
                    manda o motivo dominante ficar AO LADO do número. */}
                {carteira?.saudeCaptura && carteira.saudeCaptura.farol !== 'ok' && (
                    <div className={`rounded-lg border p-2 text-[11px] ${
                        carteira.saudeCaptura.farol === 'quebrado'
                            ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                    }`}>
                        <p className="font-bold">
                            {carteira.saudeCaptura.farol === 'quebrado' ? '🚨' : '⚠'} É POR ISSO que há empresas
                            incertas: {carteira.saudeCaptura.motivo}
                        </p>
                        {carteira.saudeCaptura.acao && <p>{carteira.saudeCaptura.acao}</p>}
                        <p className="mt-1">
                            Enquanto a captura não rodar com sucesso, "zero nota" não vale como "sem movimento" —
                            e é por isso que a coluna de incertas está cheia.
                        </p>
                    </div>
                )}
                {carteira?.saudeCaptura?.farol === 'ok' && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        ✓ Captura de NFS-e SP saudável: {carteira.saudeCaptura.motivo}
                    </p>
                )}

                {carteira?.resumo && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                            <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 p-2">
                                <p className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">A recolher</p>
                                <p className="font-bold text-emerald-800 dark:text-emerald-300">
                                    {carteira.resumo.aRecolher} empresa(s) · {brl(carteira.resumo.totalARecolher)}
                                </p>
                                <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">guia do município</p>
                            </div>
                            {/* Optante do Simples NÃO recolhe o ISS próprio em
                                guia: ele já está DENTRO do DAS (LC 123 art. 13).
                                Somar aqui seria cobrar duas vezes — por isso o
                                valor aparece, mas FORA do total a recolher. */}
                            <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-2">
                                <p className="text-[10px] uppercase font-bold text-slate-500">Dentro do DAS (Simples)</p>
                                <p className="font-bold text-slate-700 dark:text-slate-200">
                                    {carteira.resumo.issNoDas ?? 0} empresa(s) · {brl(carteira.resumo.totalIssNoDas ?? 0)}
                                </p>
                                <p className="text-[10px] text-slate-500">fora do total — sem guia própria</p>
                            </div>
                            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-2">
                                <p className="text-[10px] uppercase font-bold text-red-700 dark:text-red-400">Sem CCM</p>
                                <p className="font-bold text-red-800 dark:text-red-300">{carteira.resumo.semCcm}</p>
                            </div>
                            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2">
                                <p className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Captura incerta · ISS zerado</p>
                                <p className="font-bold text-amber-800 dark:text-amber-300">
                                    {carteira.resumo.capturaIncerta} · {carteira.resumo.issZerado ?? 0}
                                </p>
                                {/* O zerado que a nota EXPLICA sai do balde de
                                    pendência — senão o número engorda com casos
                                    que não pedem ação nenhuma. */}
                                <p className="text-[10px] text-slate-500">
                                    + {carteira.resumo.issZeradoExplicado ?? 0} com o zero já explicado pela nota
                                </p>
                            </div>
                            <div className="rounded-lg border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-2">
                                <p className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400">ISS retido (tomador)</p>
                                <p className="font-bold text-indigo-800 dark:text-indigo-300">
                                    {carteira.resumo.comIssTomado ?? 0} empresa(s) · {brl(carteira.resumo.totalIssTomado ?? 0)}
                                </p>
                            </div>
                            <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-2">
                                <p className="text-[10px] uppercase font-bold text-slate-500">ISS fixo · só retido · sem mov.</p>
                                <p className="font-bold text-slate-700 dark:text-slate-200">
                                    {carteira.resumo.issFixo} · {carteira.resumo.soRetido} · {carteira.resumo.semMovimento}
                                </p>
                            </div>
                        </div>

                        {(carteira.avisos || []).map((a: string, i: number) => (
                            <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {a}</p>
                        ))}

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                        <th className="py-1">Empresa</th><th>Regime</th><th>Situação</th>
                                        <th className="text-right">Notas</th>
                                        <th className="text-right">ISS devido</th>
                                        <th className="text-right">Retido</th>
                                        <th className="text-right">A recolher</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {carteira.linhas.slice(0, 60).map((l: any) => (
                                        <tr key={l.empresaId} className="border-b border-slate-100 dark:border-slate-700/50 align-top">
                                            <td className="py-1 pr-2">
                                                <span className="font-semibold">{l.nome}</span>
                                                {l.acao && <span className="block text-[10px] text-slate-500">{l.acao}</span>}
                                                {/* Cadastro diz X, a nota diz Y ⇒ acende. As duas
                                                    respostas dão guias diferentes. */}
                                                {l.divergenciaRegime && (
                                                    <span className="block text-[10px] font-bold text-red-600 dark:text-red-400">
                                                        🚨 {l.divergenciaRegime.texto}
                                                    </span>
                                                )}
                                                {/* Causa por causa: sem isto, "ISS zerado" é um
                                                    balde só e não dá pra começar por lugar nenhum. */}
                                                {l.causasIssZerado?.porCausa && (
                                                    <span className="block text-[10px] text-slate-400">
                                                        {Object.entries(l.causasIssZerado.porCausa)
                                                            .map(([c, n]) => `${n}× ${c}`).join(' · ')}
                                                        {l.causasIssZerado.codigosServico?.length
                                                            ? ` · cód. serviço ${l.causasIssZerado.codigosServico.join(', ')}`
                                                            : ''}
                                                    </span>
                                                )}
                                            </td>
                                            {/* O REGIME manda: no optante o ISS
                                                próprio vai no DAS. Sem esta
                                                coluna, "0 empresas dentro do
                                                DAS" é adivinhação. */}
                                            <td className="pr-2 text-[10px] text-slate-500 whitespace-nowrap">
                                                {l.regime === 'simples' ? 'Simples' : l.regime === 'lucro' ? 'Lucro' : '—'}
                                            </td>
                                            <td className="pr-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${SITUACAO_ROTULO[l.situacao]?.cls || ''}`}>
                                                    {SITUACAO_ROTULO[l.situacao]?.txt || l.situacao}
                                                </span>
                                            </td>
                                            <td className="text-right">{l.notas}</td>
                                            <td className="text-right">{brl(l.issDevido)}</td>
                                            <td className="text-right">{l.issRetido ? brl(l.issRetido) : '—'}</td>
                                            <td className="text-right font-bold">{l.aRecolher ? brl(l.aRecolher) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {/* Lista cortada SEMPRE diz quanto ficou de fora. */}
                            {carteira.linhas.length > 60 && (
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Mostrando 60 de {carteira.linhas.length} empresas.
                                </p>
                            )}
                        </div>
                    </>
                )}
                {carteira?.erro && <p className="text-xs text-red-600 dark:text-red-400">{carteira.erro}</p>}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">🏛️ ISS próprio — NFS-e São Paulo capital</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Apura o ISS do mês a partir das NFS-e emitidas, separando o que o tomador reteve.
                        A <strong>alíquota vem da nota</strong> (varia por código de serviço — não é 5% para todos)
                        e empresa de <strong>ISS fixo (sociedade uniprofissional)</strong> não apura por faturamento.
                        A <strong>guia é emitida no portal da Prefeitura</strong> — o app não cria número de guia.
                        Depois de emitir, anexe o PDF aqui para arquivar no SharePoint, mandar ao cliente com o gestor
                        em cópia e dar baixa na obrigação.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="min-w-[260px] flex-1">
                        <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Empresa</label>
                        <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId}
                            onAtivar={id => void apurar(id)} />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Competência</label>
                        <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                    </div>
                    <button onClick={() => void apurar()} disabled={carregando || !empresaId}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                        {carregando ? 'Apurando…' : '🔎 Apurar ISS'}
                    </button>
                </div>

                {empresa && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            <strong>🔌 Testar o Web Service da Prefeitura</strong> — faz UMA consulta de notas
                            emitidas e mostra a resposta CRUA. Não emite nada.
                            <br />
                            <strong>Achado de 06/08:</strong> o WS <strong>não está aposentado</strong> — ele
                            respondeu HTTP 200 e recusou o pedido com o erro 1102 ("mensagem XML sem conteúdo").
                            Ou seja, o defeito é do lado do CFI, não da Prefeitura. Por isso o bloco abaixo
                            devolve também o envelope que ENVIAMOS.
                        </p>
                        <div className="flex flex-wrap gap-2 items-end">
                            <div>
                                <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">CCM</label>
                                <input value={ccmDiag} onChange={e => setCcmDiag(e.target.value)}
                                    placeholder="inscrição municipal"
                                    className="w-40 p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-mono" />
                            </div>
                            <button onClick={testarWs} disabled={testandoWs || !ccmDiag}
                                className="px-3 py-2 text-sm font-bold rounded-lg border border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 disabled:opacity-40">
                                {testandoWs ? 'Consultando…' : '🔌 Testar WS'}
                            </button>
                            <button onClick={sondarWs} disabled={sondando || !ccmDiag}
                                className="px-3 py-2 text-sm font-bold rounded-lg border border-violet-400 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 disabled:opacity-40"
                                title="Manda 5 variantes CONTROLADAS e compara os códigos de erro. Só consulta — não emite nada.">
                                {sondando ? 'Sondando…' : '🧪 Sondar o 1102'}
                            </button>
                        </div>
                        {ccmOrigem === 'divergente' && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                ⚠ <strong>Cadastro e nota discordam:</strong> o cadastro diz <strong>{ccmDiag}</strong> e
                                as NFS-e da competência saíram com <strong>{ccmDaNota}</strong>. Um dos dois está errado
                                e o app NÃO escolhe por você — confira e corrija em Dados fiscais → CCM.
                            </p>
                        )}
                        {ccmOrigem === 'ausente' && apuracao && (
                            <p className="text-[11px] text-red-700 dark:text-red-400">
                                🚨 <strong>CCM não cadastrado.</strong> Sem ele a captura da NFS-e SP não roda pra esta
                                empresa e o WS não pode ser consultado — preencha em <strong>Dados fiscais → CCM</strong>.
                                {ccmDaNota && <> As notas da competência saíram com <strong>{ccmDaNota}</strong>; confira
                                antes de cadastrar — o app não preenche cadastro sozinho.</>}
                            </p>
                        )}
                        {diagWs?.leitura && (
                            <div className={`rounded-lg border p-2 text-[11px] ${
                                diagWs.leitura.veredicto === 'servico-vivo-ok'
                                    ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                                    : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                            }`}>
                                <p className="font-bold">{diagWs.leitura.motivo}</p>
                                {diagWs.leitura.acao && <p>{diagWs.leitura.acao}</p>}
                            </div>
                        )}
                        {diagWs?.contrato && (
                            <div className={`rounded-lg border p-2 text-[11px] ${
                                diagWs.contrato.ok
                                    ? 'border-slate-300 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300'
                                    : 'border-rose-300 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300'
                            }`}>
                                <p className="font-bold">
                                    📜 Contrato do WSDL da Prefeitura {diagWs.contrato.conclusivo === false ? '(não lido)' : ''}
                                </p>
                                <p>{diagWs.contrato.motivo}</p>
                                {Array.isArray(diagWs.contrato.esperados) && diagWs.contrato.esperados.length > 0 && (
                                    <p className="font-mono mt-1">
                                        declara: {diagWs.contrato.esperados.join(', ')} · enviamos:{' '}
                                        {(diagWs.contrato.enviados || []).join(', ') || '—'}
                                    </p>
                                )}
                                {typeof diagWs.contrato.schemasEncontrados === 'number' && (
                                    <p className="mt-1">
                                        WSDL: {diagWs.contrato.tamanhoWsdl} bytes · schemas importados{' '}
                                        {diagWs.contrato.schemasImportados}/{diagWs.contrato.schemasEncontrados}
                                        {diagWs.contrato.elementoProcurado ? ` · elemento procurado: ${diagWs.contrato.elementoProcurado}` : ''}
                                    </p>
                                )}
                                {diagWs.contrato.trechoWsdl && (
                                    <>
                                        <p className="mt-1 font-semibold">Trecho do WSDL (é a forma real que o leitor não entendeu):</p>
                                        <pre className="text-[10px] font-mono whitespace-pre-wrap break-all mt-1 p-1 rounded bg-white/50 dark:bg-slate-900/50 max-h-40 overflow-y-auto">
{diagWs.contrato.trechoWsdl}
                                        </pre>
                                    </>
                                )}
                            </div>
                        )}
                        {sonda?.leitura && (
                            <div className={`rounded-lg border p-2 text-[11px] ${
                                sonda.leitura.conclusivo
                                    ? 'border-violet-300 bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-300'
                                    : 'border-slate-300 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300'
                            }`}>
                                <p className="font-bold">🧪 Sonda do 1102 {sonda.leitura.conclusivo ? '' : '(não conclusiva)'}</p>
                                <p>{sonda.leitura.veredicto}</p>
                                <p className="font-semibold mt-1">{sonda.leitura.acao}</p>
                                <pre className="text-[10px] font-mono whitespace-pre-wrap mt-1 p-1 rounded bg-white/50 dark:bg-slate-900/50">
{(sonda.leitura.linhas || []).join('\n')}
                                </pre>
                            </div>
                        )}
                        {sonda?.erro && <p className="text-[11px] text-red-700 dark:text-red-400">Sonda falhou: {sonda.erro}</p>}
                        {diagWs && (
                            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded p-2 max-h-64 overflow-y-auto">
{JSON.stringify(diagWs, null, 2)}
                            </pre>
                        )}
                        {diagWs && (
                            <p className="text-[11px] text-slate-500">
                                Copie este bloco e mande no chat — é ele que diz se o problema é autorização do
                                escritório, CCM, certificado ou endpoint.
                            </p>
                        )}
                    </div>
                )}

                {foraDaPraca && apuracao && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                        ⚠ Esta empresa não está cadastrada em São Paulo capital (código IBGE 3550308). A guia de ISS
                        dela é de outra prefeitura, com outro portal e outro vencimento — confira antes de usar
                        estes números.
                    </p>
                )}
            </div>

            {saude && saude.farol !== 'ok' && (
                <div className={`rounded-xl border p-3 text-xs space-y-1 ${
                    saude.farol === 'quebrado'
                        ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                        : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                }`}>
                    <p className="font-bold">
                        {saude.farol === 'quebrado' ? '🚨' : '⚠'} Captura de NFS-e SP: {saude.motivo}
                    </p>
                    {saude.acao && <p>{saude.acao}</p>}
                    {saude.empresaFalhou && (
                        <p className="font-semibold">
                            Esta empresa está entre as que falharam na última varredura: {saude.empresaFalhou.erro}
                            {saude.empresaFalhou.ccm ? ` (CCM ${saude.empresaFalhou.ccm})` : ''}.
                        </p>
                    )}
                    {!saude.zeroConfiavel && (
                        <p className="font-semibold">
                            Enquanto isso, um total ZERO aqui embaixo NÃO significa que o cliente não emitiu nota —
                            pode ser nota que não conseguimos buscar. Não prometa guia ao cliente com base neste número.
                        </p>
                    )}
                </div>
            )}

            {apuracao && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                            ['Serviços', brl(apuracao.totalServicos)],
                            ['ISS devido', brl(apuracao.totalIssDevido)],
                            ['Retido pelo tomador', brl(apuracao.totalIssRetido)],
                            [apuracao.issFixoSup ? 'A RECOLHER (não se aplica)' : 'A RECOLHER',
                                apuracao.issFixoSup ? '—' : brl(apuracao.aRecolher)],
                        ].map(([r, v], i) => (
                            <div key={r} className={`rounded-lg p-3 border ${i === 3 ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                <div className="text-[10px] uppercase text-slate-500">{r}</div>
                                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{v}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                        {apuracao.notas.length} NFS-e emitida(s) · vencimento{' '}
                        <strong>{apuracao.vencimento.split('-').reverse().join('/') || '—'}</strong> (dia 10 do mês seguinte).
                    </p>

                    {/* ISS RETIDO COMO TOMADORA — outra obrigação, outra guia.
                        Paulo, 06/08: "essa empresa tem ISS de tomador e
                        prestador, aqui só aparece a de prestados". */}
                    {/* AUSÊNCIA FALA: sem retenção encontrada, o bloco NÃO some —
                        ele explica se é falta de captura ou de marcação. Sumir
                        fez o colaborador achar que o app ignorava o ISS de
                        tomador (Paulo, 06/08). */}
                    {apuracao.tomado && apuracao.tomado.totalRetido === 0 && (
                        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3">
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                                ↩ ISS retido como TOMADORA — nada encontrado nesta competência
                            </p>
                            {(apuracao.tomado.avisos || []).map((a, i) => (
                                <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">{a}</p>
                            ))}
                            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                                Notas tomadas capturadas no mês: <strong>{apuracao.tomado.notasNoMes}</strong>
                                {apuracao.tomado.semRetencao > 0 && <> · sem retenção de ISS: <strong>{apuracao.tomado.semRetencao}</strong></>}
                            </p>
                        </div>
                    )}
                    {apuracao.tomado?.totalRetido > 0 && (
                        <div className="mt-3 rounded-lg border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-3">
                            <p className="text-sm font-bold text-indigo-800 dark:text-indigo-300">
                                ↩ ISS retido como TOMADORA — {brl(apuracao.tomado.totalRetido)}
                            </p>
                            <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                                {apuracao.tomado.notas.length} nota(s) de serviço tomada(s) com retenção.
                                <strong> Esta é OUTRA guia</strong>: quem recolhe o ISS retido na fonte é a empresa,
                                no lugar do prestador. Não some com o ISS próprio acima.
                            </p>
                            {(apuracao.tomado.avisos || []).filter(a => !/Não some com o ISS próprio/.test(a)).map((a, i) => (
                                <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">⚠ {a}</p>
                            ))}
                            <div className="overflow-x-auto mt-2">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-indigo-200 dark:border-indigo-800">
                                            <th className="py-1">Data</th><th>Nº</th><th>Prestador</th>
                                            <th className="text-right">Serviços</th>
                                            <th className="text-right">ISS retido</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {apuracao.tomado.notas.map(n => (
                                            <tr key={n.id} className="border-b border-indigo-100 dark:border-indigo-900/40">
                                                <td className="py-1">{n.data.split('-').reverse().join('/')}</td>
                                                <td>{n.numero}</td>
                                                <td>{n.prestador}</td>
                                                <td className="text-right">{brl(n.valorServicos)}</td>
                                                <td className="text-right font-bold">{brl(n.issRetido)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {apuracao.avisos.map((a, i) => (
                        <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {a}</p>
                    ))}

                    <div className="flex flex-wrap gap-2 items-center">
                        <a href={PORTAL_NFSE_SP} target="_blank" rel="noreferrer"
                            className="px-3 py-2 text-sm font-bold rounded-lg border border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30">
                            🌐 Portal da NFS-e (emitir a guia)
                        </a>
                        <label className="px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                            📎 {pdfGuia ? pdfGuia.nome : 'Anexar PDF da guia'}
                            <input type="file" accept="application/pdf" onChange={anexarPdf} className="hidden" />
                        </label>
                        <button onClick={enviarAoCliente} disabled={enviando || !pdfGuia || !apuracao.apta}
                            title={!apuracao.apta
                                ? 'A apuração tem pendência (veja os avisos) — resolva antes de mandar guia ao cliente.'
                                : 'Envia pelo servidor, com o PDF anexado, gestor em cópia oculta, cópia no SharePoint e baixa da obrigação.'}
                            className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                            {enviando ? 'Enviando…' : '📤 Enviar guia ao cliente'}
                        </button>
                    </div>

                    {apuracao.notas.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                    <tr>
                                        <th className="py-1">Data</th><th>Nº</th><th>Tomador</th>
                                        <th className="text-right">Serviços</th>
                                        <th>Cód. serv.</th>
                                        <th className="text-right">Alíq.</th>
                                        <th className="text-right">ISS devido</th>
                                        <th className="text-right">Retido</th>
                                        <th>Guia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {apuracao.notas.map(n => (
                                        <tr key={n.id} className="border-b border-slate-100 dark:border-slate-700/50">
                                            <td className="py-1">{n.data.split('-').reverse().join('/')}</td>
                                            <td>{n.numero}</td>
                                            <td className="truncate max-w-[220px]">{n.tomador}</td>
                                            <td className="text-right tabular-nums">{brl(n.valorServicos)}</td>
                                            <td className="font-mono text-[10px]">{n.codigoServico || '—'}</td>
                                            <td className="text-right tabular-nums">
                                                {n.aliquota != null ? `${n.aliquota}%` : '—'}
                                            </td>
                                            <td className="text-right tabular-nums">
                                                {n.semValorGravado
                                                    ? <span className="text-amber-600">não gravado</span>
                                                    : brl(n.issDevido)}
                                            </td>
                                            <td className="text-right tabular-nums">{n.issRetido > 0 ? brl(n.issRetido) : '—'}</td>
                                            <td className="text-[10px]">{n.guia || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default IssSpPanel;
