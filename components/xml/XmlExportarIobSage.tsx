import React, { useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, getDadosFiscaisEmpresa, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { exportarParaIobSage, downloadBlob, participanteDoDoc } from '../../services/iobSageExportService';
import { conferirAntesDeGerar, type ResultadoPreflight } from '../../services/iobSagePreflight';
import { conferirCorrelacaoCfop } from '../../services/cfopConferencia';
import type { CfopCtx } from '../../services/iobSageExportService';
import { formatCurrency } from '../../services/xmlParserService';
import EmpresaSearchSelect from './EmpresaSearchSelect';
import { direcaoEfetivaDoc } from '../../sefaz-backend/xml-metadata-helper.js';
import { parseLogEfiscal, cruzarLogComFml, type CruzamentoLogEfiscal } from '../../services/iobSageLogEfiscal';
import { carregarCodigosParticipantes, salvarCodigosParticipantes } from '../../services/sageCodigosService';
import { parsearCadastroClientesFornecedores } from '../../services/efiscalCadastroParticipantesParser';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

/**
 * Exportar IOB SAGE — SOB DEMANDA.
 *
 * Antes: ao abrir a aba, varria a base inteira (~20 mil docs) só para montar
 * os filtros — lento e desnecessário. Agora abre EM BRANCO: o colaborador
 * define competência (obrigatória — vai como filtro no servidor), empresa e
 * direção, e clica Buscar. Só então os documentos do recorte são carregados.
 */
const XmlExportarIobSage: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [buscou, setBuscou] = useState(false);
    const [truncado, setTruncado] = useState(false);
    const [loading, setLoading] = useState(false);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>('');
    const [direcao, setDirecao] = useState<'entrada' | 'saida' | ''>('');
    const [numeroEmpresaEfiscal, setNumeroEmpresaEfiscal] = useState<number>(1);
    // E020 campo 11. Cada escritório cadastra os próprios tipos de inventário
    // no E-Fiscal; mandar um código inexistente recusa TODOS os produtos.
    // Em branco (padrão) o campo não é informado — e o layout permite.
    const [tipoInventario, setTipoInventario] = useState<string>('');
    // E222 campo 56 — alguns E-Fiscal exigem 1-4 (caso JOTASUL 01/08).
    const [redfNfPaulista, setRedfNfPaulista] = useState<string>('');
    // NFC-e a consumidor final não tem CNPJ do comprador — é o normal dela.
    // O código do participante "Consumidor" vem do cadastro do E-Fiscal de
    // CADA cliente (não é tabela oficial), igual ao Tipo p/ Inventário.
    const [codigoConsumidor, setCodigoConsumidor] = useState<string>('');
    // O que está GRAVADO no cadastro da empresa — o botão só aparece quando o
    // campo diverge, senão o colaborador não sabe se salvou.
    const [consumidorSalvo, setConsumidorSalvo] = useState<string>('');
    const [salvandoConsumidor, setSalvandoConsumidor] = useState(false);
    // Notas que ficaram FORA do arquivo. Antes isso era console.warn: o .FML
    // saía só com produtos e o E-Fiscal ainda dizia "importado com sucesso".
    const [falhas, setFalhas] = useState<Array<{ documento: string; motivo: string }>>([]);
    // Natureza da atividade + overrides da empresa (tela Correlação CFOP).
    // Sem isso, a configuração da equipe não chegava ao arquivo.
    const [cfopCtx, setCfopCtx] = useState<CfopCtx | undefined>(undefined);
    const [exporting, setExporting] = useState(false);

    const [corrigindoEnderecos, setCorrigindoEnderecos] = useState(false);
    // UF de participante resolvida na própria base (sem reler XML): quase todo
    // destinatário é empresa que TAMBÉM emite nota, e a chave dela diz a UF.
    const [ufResolvida, setUfResolvida] = useState<Record<string, string>>({});
    const [resolvendoUf, setResolvendoUf] = useState(false);

    const handleResolverUf = async () => {
        setResolvendoUf(true);
        try {
            const faltando = new Set<string>();
            for (const d of filtrados) {
                const p = participanteDoDoc(d);
                if (p && !p.uf) faltando.add(p.cnpjCpf);
            }
            if (faltando.size === 0) {
                onShowToast?.('Nenhum participante sem UF neste recorte.');
                return;
            }
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada — entre de novo.');
            const res = await fetch('/api/admin/sefaz/uf-participantes', {
                method: 'POST',
                headers: { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cnpjs: Array.from(faltando) }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            const mapa: Record<string, string> = {};
            for (const [cnpj, v] of Object.entries(j.encontradas || {})) {
                mapa[cnpj] = (v as any).uf;
            }
            setUfResolvida(mapa);
            onShowToast?.(j.mensagem || `${Object.keys(mapa).length} UF(s) resolvida(s).`);
        } catch (e: any) {
            onShowToast?.(`Não foi possível resolver as UFs: ${e?.message || e}`);
        } finally {
            setResolvendoUf(false);
        }
    };

    const handleCorrigirEnderecos = async () => {
        if (!competencia) return;
        setCorrigindoEnderecos(true);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada — entre de novo.');
            const token = await u.getIdToken();
            const res = await fetch('/api/admin/sefaz/corrigir-endereco-destinatario', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    empresaId: empresaSelecionada?.id || null,
                    competencia,
                }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            onShowToast?.(j.mensagem || 'Endereços conferidos.');
            await buscar();
        } catch (e: any) {
            onShowToast?.(`Não foi possível corrigir os endereços: ${e?.message || e}`);
        } finally {
            setCorrigindoEnderecos(false);
        }
    };


    // Catálogo de empresas (leve) para o seletor pesquisável — não carrega docs.
    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => { if (alive) setEmpresas(list); });
        return () => { alive = false; };
    }, [currentUser]);

    const empresaSelecionada = empresas.find(e => e.id === empresaId) || null;

    // Configuração de CFOP + código do CONSUMIDOR da empresa escolhida.
    useEffect(() => {
        let alive = true;
        if (!empresaSelecionada) { setCfopCtx(undefined); setCodigoConsumidor(''); setConsumidorSalvo(''); return; }
        getDadosFiscaisEmpresa(empresaSelecionada.fonte, empresaSelecionada.id)
            .then(df => {
                if (!alive) return;
                setCfopCtx(df ? { naturezaAtividade: df.naturezaAtividade, cfopOverrides: df.cfopOverrides } : undefined);
                const cod = String(df?.codigoParticipanteConsumidor || '');
                setCodigoConsumidor(cod);
                setConsumidorSalvo(cod);
                // Cod.Cliente do cadastro = Nº Empresa no E-Fiscal (E001).
                // A equipe digitava de cabeça a cada exportação; agora vem do
                // cadastro (modal Dados Fiscais → Código no E-Fiscal).
                const codEmp = parseInt(String(df?.codCliente || ''), 10);
                if (Number.isFinite(codEmp) && codEmp > 0) setNumeroEmpresaEfiscal(codEmp);
            });
        return () => { alive = false; };
    }, [empresaSelecionada?.id, empresaSelecionada?.fonte]);

    // O código do CONSUMIDOR não é código oficial: vem do cadastro do E-Fiscal
    // de CADA cliente. Redigitar a cada competência é o caminho pra esquecer e
    // gerar o arquivo sem as NFC-e — por isso ele fica no cadastro da empresa.
    const handleSalvarConsumidor = async () => {
        if (!empresaSelecionada) return;
        setSalvandoConsumidor(true);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada — entre de novo.');
            const res = await fetch('/api/admin/sefaz/empresa-dados-fiscais', {
                method: 'POST',
                headers: { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cnpj: empresaSelecionada.cnpj,
                    dadosFiscais: { codigoParticipanteConsumidor: codigoConsumidor.trim() },
                }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            setConsumidorSalvo(codigoConsumidor.trim());
            onShowToast?.(codigoConsumidor.trim()
                ? 'Código do Consumidor guardado no cadastro desta empresa.'
                : 'Código do Consumidor apagado do cadastro desta empresa.');
        } catch (e: any) {
            onShowToast?.(`Não foi possível guardar o código: ${e?.message || e}`);
        } finally {
            setSalvandoConsumidor(false);
        }
    };

    const buscar = async (empresaIdOverride?: unknown) => {
        // onClick passa o event como 1º argumento — só string interessa.
        const idAlvo = typeof empresaIdOverride === 'string' ? empresaIdOverride : empresaId;
        const alvo = empresas.find(e => e.id === idAlvo) || null;
        if (!competencia) {
            onShowToast?.('Informe a competência antes de buscar.');
            return;
        }
        setLoading(true);
        setBuscou(false);
        setTruncado(false);
        try {
            // Competência vai ao servidor (where ==). Empresa é filtrada aqui no
            // cliente por id OU CNPJ — docs capturados server-side (autXML/ZIP/
            // SAE) podem não ter empresaId preenchido, só o CNPJ.
            const meta: { truncado?: boolean } = {};
            // Empresa selecionada vai ao SERVIDOR (por id E por CNPJ): a leitura
            // fica do tamanho da empresa, não do mês inteiro. Sem isso, em
            // competência cheia batia no teto e o recorte saía incompleto —
            // "limite de leitura atingido", relato comum dos colaboradores.
            const d = await listDocumentos(currentUser, {
                competencia,
                ...(alvo ? {
                    empresaId: alvo.id,
                    empresaCnpj: alvo.cnpj,
                } : {}),
            }, meta);
            setTruncado(!!meta.truncado);
            const cnpjSel = (alvo?.cnpj || '').replace(/\D/g, '');
            const raizSel = cnpjSel.slice(0, 8);
            const filtradosEmpresa = alvo
                ? d.filter(doc =>
                    doc.empresaId === alvo.id
                    || (raizSel && String(doc.empresaCnpj || '').replace(/\D/g, '').startsWith(raizSel)))
                : d;
            // Régua única de direção: nota própria de ENTRADA (tpNF=0, compra
            // de produtor rural etc.) gravada como 'saida' pelo importer antigo
            // é corrigida NA LEITURA — o E-Fiscal recebe essas notas como
            // entrada (CFOP 1xxx/2xxx), não como saída. O backfill do sync-cron
            // arruma o banco; aqui a tela não espera o próximo ciclo.
            setDocs(filtradosEmpresa.map(doc => {
                const efetiva = direcaoEfetivaDoc(doc);
                return efetiva !== doc.direcao ? { ...doc, direcao: efetiva as any } : doc;
            }));
            setBuscou(true);
        } catch (err: any) {
            onShowToast?.(`Falha na busca: ${err?.message || err}`);
        } finally {
            setLoading(false);
        }
    };

    const filtrados = useMemo(() => {
        return docs.filter(d => {
            if (direcao && d.direcao !== direcao) return false;
            // IOB/SAGE Folhamatic Fiscal so aceita NFe/NFCe (modelo 55/65). CTe (57),
            // MDFe (58) e NFSe seguem fluxo proprio e nao entram neste arquivo .FML.
            const tipo = (d as any).tipoDoc || (d as any).tipo;
            if (tipo && !['NFe', 'NFCe'].includes(tipo)) return false;
            return true;
        });
    }, [docs, direcao]);

    // FREIO: confere o que seria enviado ANTES de baixar. Roda sobre o recorte
    // atual, sem clique — o colaborador vê o problema antes de gastar uma
    // rodada de importação no E-Fiscal (Paulo, 29/07).
    const preflight: ResultadoPreflight | null = useMemo(() => {
        if (!buscou || filtrados.length === 0) return null;
        try {
            return conferirAntesDeGerar(filtrados, {
                numeroEmpresaEfiscal,
                tipoInventario: tipoInventario.trim(),
                cfopCtx,
                codigoParticipanteConsumidor: codigoConsumidor.trim(),
                ufPorParticipante: ufResolvida,
            });
        } catch {
            return null;
        }
    }, [buscou, filtrados, numeroEmpresaEfiscal, tipoInventario, cfopCtx, codigoConsumidor, ufResolvida]);

    // Evidência da correlação: origem → destino, com o motivo da decisão.
    const correlacao = useMemo(
        () => (buscou && filtrados.length > 0 ? conferirCorrelacaoCfop(filtrados, cfopCtx) : null),
        [buscou, filtrados, cfopCtx],
    );

    const totalValor = useMemo(
        () => filtrados.reduce((acc, d) => acc + (d.totais?.vNF || 0), 0),
        [filtrados],
    );

    // De→Para de códigos do E-Fiscal (participantes que já existem lá com
    // outro código) + o conteúdo da última geração (pra cruzar com o log).
    const [codigosPart, setCodigosPart] = useState<Record<string, string>>({});
    const [ultimoConteudo, setUltimoConteudo] = useState<string | null>(null);
    const [logCruzado, setLogCruzado] = useState<CruzamentoLogEfiscal | null>(null);
    const [codigosDigitados, setCodigosDigitados] = useState<Record<string, string>>({});
    const [salvandoCodigos, setSalvandoCodigos] = useState(false);

    useEffect(() => {
        let alive = true;
        setCodigosPart({});
        setLogCruzado(null);
        if (!empresaSelecionada) return;
        carregarCodigosParticipantes(empresaSelecionada.id)
            .then(m => { if (alive) setCodigosPart(m); });
        return () => { alive = false; };
    }, [empresaSelecionada?.id]);

    const lerLogEfiscal = async (file: File | null) => {
        if (!file) return;
        if (!ultimoConteudo) {
            onShowToast?.('Gere o arquivo .FML nesta tela primeiro — as linhas do log apontam pra ele.');
            return;
        }
        const txt = await file.text();
        const erros = parseLogEfiscal(txt);
        if (erros.length === 0) {
            onShowToast?.('Nenhum erro "(X)" encontrado neste arquivo — é o log de erros do E-Fiscal?');
            return;
        }
        setLogCruzado(cruzarLogComFml(erros, ultimoConteudo));
        setCodigosDigitados({});
    };

    // Importa a listagem de Clientes/Fornecedores do E-Fiscal (XLSX/XFRX) e
    // carrega o De→Para inteiro de uma vez (Paulo, 05/08 — S&P tinha 187).
    const [importandoCadastro, setImportandoCadastro] = useState(false);
    const [resultadoImportCadastro, setResultadoImportCadastro] = useState<string | null>(null);

    const importarCadastroEfiscal = async (file: File | null) => {
        if (!file || !empresaSelecionada) return;
        setImportandoCadastro(true);
        setResultadoImportCadastro(null);
        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
            const r = parsearCadastroClientesFornecedores(rows);

            if (r.participantes.length === 0 && Object.keys(r.codigos).length === 0) {
                throw new Error('Não achei blocos "Nome:/CNPJ:/Código:" — é a Listagem do Cadastro de '
                    + 'Clientes/Fornecedores exportada em XLSX pelo E-Fiscal?');
            }
            // TRAVA: o cabeçalho diz de QUAL empresa é o arquivo. Importar o
            // cadastro da empresa errada mapearia códigos de outro E-Fiscal.
            const codSelecionada = String(numeroEmpresaEfiscal).padStart(4, '0');
            if (r.empresaCodigo && codSelecionada !== '0001' && r.empresaCodigo !== codSelecionada) {
                throw new Error(`Este arquivo é da empresa ${r.empresaCodigo} — ${r.empresaNome || ''}, `
                    + `mas a selecionada tem o código ${codSelecionada}. Confira antes de importar.`);
            }

            // Nunca sobrescreve em silêncio: divergência com o já salvo é
            // listada e fica como está — decisão humana.
            const novos: Record<string, string> = {};
            const divergentes: string[] = [];
            let jaIguais = 0;
            for (const [cnpj, cod] of Object.entries(r.codigos)) {
                const atual = codigosPart[cnpj];
                if (!atual) novos[cnpj] = cod;
                else if (atual === cod) jaIguais++;
                else divergentes.push(`${cnpj}: salvo "${atual}" × arquivo "${cod}"`);
            }
            if (Object.keys(novos).length > 0) {
                const s = await salvarCodigosParticipantes(empresaSelecionada.id, novos);
                if (!s.ok) throw new Error(s.error || 'Falha ao salvar o De→Para.');
                setCodigosPart(await carregarCodigosParticipantes(empresaSelecionada.id));
            }

            const linhas = [
                `Arquivo da empresa ${r.empresaCodigo || '?'} — ${r.empresaNome || ''}: `
                + `${r.participantes.length} participante(s) no cadastro.`,
                `✅ ${Object.keys(novos).length} código(s) novo(s) importados`
                + (jaIguais > 0 ? ` · ${jaIguais} já estavam iguais` : '') + '.',
            ];
            if (divergentes.length > 0) {
                linhas.push(`⚠ ${divergentes.length} divergem do De→Para salvo e NÃO foram alterados: `
                    + divergentes.slice(0, 5).join(' · ') + (divergentes.length > 5 ? ' …' : ''));
            }
            if (r.conflitos.length > 0) {
                linhas.push(`⚠ ${r.conflitos.length} documento(s) com códigos diferentes DENTRO do arquivo `
                    + '(ficaram de fora): ' + r.conflitos.slice(0, 3).map(c => c.cnpjCpf).join(' · '));
            }
            if (r.ignorados.length > 0) {
                linhas.push(`ℹ ${r.ignorados.length} participante(s) sem documento aproveitável no relatório `
                    + '(não mapeiam): ' + r.ignorados.slice(0, 3).map(i => i.nome).join(' · ')
                    + (r.ignorados.length > 3 ? ' …' : ''));
            }
            setResultadoImportCadastro(linhas.join('\n'));
            onShowToast?.(`De→Para importado: ${Object.keys(novos).length} código(s) novo(s).`);
        } catch (e: any) {
            setResultadoImportCadastro(`✕ ${e?.message || e}`);
            onShowToast?.(`Importação não concluída: ${e?.message || e}`);
        } finally {
            setImportandoCadastro(false);
        }
    };

    const salvarDePara = async () => {
        if (!empresaSelecionada) return;
        setSalvandoCodigos(true);
        const r = await salvarCodigosParticipantes(empresaSelecionada.id, codigosDigitados);
        setSalvandoCodigos(false);
        if (!r.ok) { onShowToast?.(r.error || 'Falha ao salvar o De→Para.'); return; }
        const novos = await carregarCodigosParticipantes(empresaSelecionada.id);
        setCodigosPart(novos);
        onShowToast?.('De→Para salvo. Gere o arquivo de novo — os participantes mapeados saem com o código do E-Fiscal.');
    };

    // Relê os XMLs guardados e preenche o endereço do destinatário do RECORTE
    // atual. Sem isso, o colaborador com o botão bloqueado só teria a opção de
    // esperar o cron drenar — e a tela está aberta agora (caso 04/08).
    const handleExportar = async () => {
        if (filtrados.length === 0) {
            onShowToast?.('Nenhum documento para exportar com os filtros atuais.');
            return;
        }
        // BLOQUEIO DURO (Paulo, 29/07): erro conhecido não gera arquivo. Gerar,
        // importar e voltar com recusa é perda de tempo — corrige antes.
        if (preflight && preflight.bloqueios > 0) {
            onShowToast?.(
                `Arquivo NÃO gerado: ${preflight.bloqueios} nota(s) seriam recusadas pelo E-Fiscal. `
                + `Corrija o que está no quadro de conferência e clique em Reconferir.`,
            );
            return;
        }
        setExporting(true);
        try {
            const result = exportarParaIobSage({
                documentos: filtrados,
                numeroEmpresaEfiscal,
                tipoInventario: tipoInventario.trim(),
                cfopCtx,
                codigosParticipantes: codigosPart,
                redfNfPaulista,
                codigoParticipanteConsumidor: codigoConsumidor.trim(),
            });
            // Guarda o conteúdo: o log de erros do E-Fiscal referencia LINHAS
            // deste arquivo, e o leitor cruza os dois.
            setUltimoConteudo(result.conteudo);
            const st = result.estatisticas;
            setFalhas(result.falhas);
            // Só baixa se ALGUMA nota entrou. Arquivo só com produtos importa
            // "com sucesso" no E-Fiscal e não lança nada — pior que erro.
            if (st.notasNoArquivo === 0) {
                onShowToast?.(
                    `Nenhuma das ${st.documentos} nota(s) pôde ser gerada — arquivo NÃO baixado. Veja os motivos abaixo.`,
                );
                return;
            }
            downloadBlob(result.blob, result.fileName);
            onShowToast?.(
                `Arquivo ${result.fileName}: ${st.notasNoArquivo} de ${st.documentos} NF, ` +
                `${st.participantes} participantes, ${st.produtos} produtos.`
                // Farol honesto: "foi tudo pro CONSUMIDOR" não pode ficar
                // invisível — é escrituração no participante genérico.
                + (st.nfceConsumidor > 0
                    ? ` ${st.nfceConsumidor} NFC-e no participante CONSUMIDOR`
                      + (st.nfceConsumidorComCpf > 0
                          ? ` (${st.nfceConsumidorComCpf} com CPF no cupom).`
                          : '.')
                    : '')
                + (result.falhas.length > 0 ? ` ⚠ ${result.falhas.length} item(ns) ficaram de fora.` : ''),
            );
        } catch (err: any) {
            onShowToast?.(`Falha ao gerar arquivo: ${err?.message || err}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-3">
            {preflight && preflight.problemas.length > 0 && (
                <div className={`rounded-lg border p-3 space-y-2 ${
                    preflight.farol === 'bloqueado'
                        ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                        : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                }`}>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {preflight.farol === 'bloqueado' ? '🔒' : '🚦'} Conferência antes de gerar — {preflight.resumo}
                        {preflight.farol === 'bloqueado' && (
                            <span className="block font-normal text-[11px] mt-0.5">
                                Os itens marcados com ✕ IMPEDEM a geração do arquivo. Corrija-os e clique em Reconferir.
                            </span>
                        )}
                    </p>
                    {preflight.problemas.map((p, i) => (
                        <div key={i} className="border-l-2 pl-2"
                            style={{ borderColor: p.gravidade === 'bloqueia' ? '#dc2626' : '#d97706' }}>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                {p.gravidade === 'bloqueia' ? '✕' : '!'} {p.qtd}× {p.causa}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                No E-Fiscal: {p.oQueAconteceLa}
                            </p>
                            <p className="text-[11px] text-sky-700 dark:text-sky-400">→ {p.acao}</p>
                            <details>
                                <summary className="text-[10px] cursor-pointer text-slate-500">ver exemplos</summary>
                                <ul className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 space-y-0.5">
                                    {p.exemplos.map((e, j) => <li key={j}>{e}</li>)}
                                </ul>
                            </details>
                        </div>
                    ))}
                </div>
            )}
            {preflight && preflight.problemas.length === 0 && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2">
                    🚦 {preflight.resumo}
                </p>
            )}

            {correlacao && correlacao.linhas.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            🔁 Correlação de CFOP (entrada) — {correlacao.resumo}
                        </p>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Natureza da empresa: <strong>{correlacao.naturezaAtividade || 'não declarada'}</strong>
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="text-slate-500 dark:text-slate-400">
                                <tr className="text-left">
                                    <th className="py-1 pr-2">Do emitente</th>
                                    <th className="py-1 pr-2">Escriturado</th>
                                    <th className="py-1 pr-2 text-right">Itens</th>
                                    <th className="py-1 pr-2 text-right">Valor</th>
                                    <th className="py-1">Por quê</th>
                                </tr>
                            </thead>
                            <tbody>
                                {correlacao.linhas.map((l, i) => (
                                    <tr key={i} className={`border-t border-slate-100 dark:border-slate-700 ${
                                        l.conferir ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                                        <td className="py-1 pr-2 font-mono">{l.origem}</td>
                                        <td className="py-1 pr-2 font-mono font-bold">
                                            {l.conferir && '⚠ '}{l.destino}
                                        </td>
                                        <td className="py-1 pr-2 text-right">{l.qtd}</td>
                                        <td className="py-1 pr-2 text-right">{formatCurrency(l.valor)}</td>
                                        <td className="py-1 text-slate-600 dark:text-slate-300">{l.explicacao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {correlacao.aConferir > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            As linhas em âmbar dependem de decisão do contador — o app preservou o CFOP do emitente.
                            Para fixar a regra desta empresa, use <strong>Correlação CFOP</strong> no cadastro
                            (o override vale aqui também) ou declare a <strong>natureza da atividade</strong> nos
                            dados fiscais.
                        </p>
                    )}
                </div>
            )}

            {falhas.length > 0 && (
                <div className="border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                    <p className="text-xs font-bold text-red-800 dark:text-red-300">
                        {falhas.length} item(ns) ficaram FORA do arquivo
                    </p>
                    <p className="text-[11px] text-red-700 dark:text-red-400">
                        O E-Fiscal importa o que receber e diz "sucesso" mesmo assim — o que está aqui simplesmente
                        não vai chegar lá.
                    </p>
                    <ul className="mt-1 text-[11px] text-slate-700 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
                        {falhas.slice(0, 50).map((f, i) => (
                            <li key={i}><strong>{f.documento}</strong> — {f.motivo}</li>
                        ))}
                    </ul>
                    {falhas.length > 50 && (
                        <p className="text-[11px] text-slate-500 mt-1">…e mais {falhas.length - 50}.</p>
                    )}
                </div>
            )}
            {/* ── Leitor do LOG DE ERROS do E-Fiscal ──────────────────────────
                O E-Fiscal recusa em cascata (participante → nota) e o log só
                fala em "Linha NNNNNN". Cruzando com o arquivo gerado nesta
                tela, viram ações: UF (regerar resolve) e De→Para de código. */}
            {ultimoConteudo && (
                <div className="border border-slate-300 dark:border-slate-600 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            🧾 O E-Fiscal recusou a importação? Leia o log de erros aqui
                        </p>
                        <label className="text-[11px] px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 cursor-pointer font-semibold">
                            📄 Abrir log (.txt)
                            <input
                                type="file"
                                accept=".txt,.log"
                                className="hidden"
                                onChange={e => { lerLogEfiscal(e.target.files?.[0] || null); e.target.value = ''; }}
                            />
                        </label>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        É o arquivo .txt que o E-Fiscal gera ao importar. As linhas dele apontam pro .FML
                        gerado NESTA tela — leia logo após gerar/importar, sem buscar de novo.
                    </p>

                    {logCruzado && (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {logCruzado.totalErros} erro(s) no log → {logCruzado.resumo}
                            </p>
                            {logCruzado.semUf.length > 0 && (
                                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                    ✓ {logCruzado.semUf.length} participante(s) recusados por UF: esta versão já
                                    preenche a UF pela cidade (IBGE) — <strong>gere o arquivo de novo</strong> e importe.
                                </p>
                            )}
                            {logCruzado.codigoExistente.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                        ⚠ {logCruzado.codigoExistente.length} participante(s) já existem no E-Fiscal com
                                        OUTRO código. Abra o cadastro de Clientes/Fornecedores lá, copie o
                                        <strong> Código de Faturamento</strong> de cada um e preencha abaixo — as notas
                                        passarão a apontar pro cadastro que o E-Fiscal já tem (sem duplicar).
                                    </p>
                                    <div className="max-h-56 overflow-y-auto space-y-1">
                                        {logCruzado.codigoExistente.map(p => (
                                            <div key={p.cnpjCpf} className="flex items-center gap-2 text-[11px]">
                                                <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-300" title={p.nome}>
                                                    {p.nome} <span className="text-slate-400 font-mono">({p.cnpjCpf})</span>
                                                </span>
                                                <input
                                                    value={codigosDigitados[p.cnpjCpf] ?? codigosPart[p.cnpjCpf] ?? ''}
                                                    onChange={e => setCodigosDigitados(prev => ({ ...prev, [p.cnpjCpf]: e.target.value }))}
                                                    placeholder="código no E-Fiscal"
                                                    className="w-40 p-1.5 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={salvarDePara}
                                        disabled={salvandoCodigos || Object.values(codigosDigitados).every(v => !v.trim())}
                                        className="px-3 py-1.5 text-[11px] rounded bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-40"
                                    >
                                        {salvandoCodigos ? 'Salvando…' : '💾 Salvar De→Para e usar nas próximas gerações'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {Object.keys(codigosPart).length > 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    🔗 De→Para ativo: {Object.keys(codigosPart).length} participante(s) desta empresa usam o código
                    já existente no E-Fiscal (não geram cadastro novo no arquivo).
                </p>
            )}

            {/* Importação do cadastro OFICIAL do E-Fiscal (Paulo, 05/08): a
                listagem de Clientes/Fornecedores em XLSX carrega o De→Para
                inteiro de uma vez — na S&P eram 187 códigos digitados à mão. */}
            {empresaSelecionada && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                📥 Importar cadastro do E-Fiscal — De→Para completo de uma vez
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5 max-w-2xl">
                                No E-Fiscal: Relatórios → <i>Clientes e fornecedores (completo)</i> → exportar
                                <b> XLSX</b>. Suba o arquivo aqui: cada cliente/fornecedor entra no De→Para com o
                                código que JÁ existe lá — nenhum é recadastrado, nenhuma nota cai por código.
                            </p>
                        </div>
                        <label className={`px-3 py-2 text-sm rounded-lg font-semibold cursor-pointer ${importandoCadastro ? 'bg-slate-200 text-slate-500' : 'bg-blue-700 hover:bg-blue-800 text-white'}`}>
                            {importandoCadastro ? 'Importando…' : '📥 Escolher XLSX'}
                            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importandoCadastro}
                                onChange={e => { void importarCadastroEfiscal(e.target.files?.[0] || null); e.target.value = ''; }} />
                        </label>
                    </div>
                    {resultadoImportCadastro && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line border-t border-slate-100 dark:border-slate-700 pt-2">
                            {resultadoImportCadastro}
                        </div>
                    )}
                </div>
            )}

            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    Gera arquivo <strong>.FML</strong> no Layout Folhamatic Fiscal v2.0.06 (largura fixa, Windows-1252, CRLF) para importação no E-Fiscal IOB SAGE.
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                    Inclui registros E001, E010 (clientes/fornecedores), E020 (produtos), E200, E201, E221, E222 e E342 (chave NF-e).
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Competência <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Empresa (opcional — vazio = todas)</label>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId}
                                    placeholder="Todas — busque por código, nome ou CNPJ…"
                                    onAtivar={id => { if (competencia) void buscar(id); }} />
                            </div>
                            {empresaId && (
                                <button onClick={() => setEmpresaId('')} title="Limpar empresa (todas)"
                                    className="px-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 text-xs">✕</button>
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Direção</label>
                        <select
                            value={direcao}
                            onChange={(e) => setDirecao(e.target.value as any)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Entradas e saídas</option>
                            <option value="entrada">Apenas entradas</option>
                            <option value="saida">Apenas saídas</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Nº empresa no E-Fiscal
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={9999}
                            value={numeroEmpresaEfiscal}
                            onChange={(e) => setNumeroEmpresaEfiscal(parseInt(e.target.value) || 1)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="Código da empresa no cadastro do E-Fiscal Folhamatic (campo do registro E001). Preenchido sozinho quando o Cod.Cliente está no cadastro da empresa (modal Dados Fiscais → Código no E-Fiscal)."
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                            Vem sozinho do <strong>Cod.Cliente</strong> do cadastro (Dados Fiscais). Se precisou
                            digitar aqui, cadastre lá — vale pra sempre e é a amarração da migração.
                        </p>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Tipo p/ inventário (opcional)
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="deixe vazio"
                            value={tipoInventario}
                            onChange={(e) => setTipoInventario(e.target.value.replace(/\D/g, ''))}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="E020 campo 11. Só preencha com um código que EXISTA em Cadastros → Tipos de Inventário do E-Fiscal do cliente."
                        />
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Consumidor final (NFC-e) — opcional
                        </label>
                        <input
                            type="text"
                            value={codigoConsumidor}
                            onChange={(e) => setCodigoConsumidor(e.target.value)}
                            placeholder="código do participante CONSUMIDOR no E-Fiscal"
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="NFC-e (modelo 65) de venda a consumidor não vira participante — nem quando o cupom traz o CPF do comprador, porque ele vem sem endereço. Informe aqui o código do participante 'Consumidor' que EXISTE no cadastro de Clientes/Fornecedores do E-Fiscal deste cliente."
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                            Só para quem emite <strong>NFC-e</strong> (bar, restaurante, varejo): a venda de balcão
                            não identifica o comprador. Vale também quando o cupom traz <strong>só o CPF</strong> —
                            o CPF da Nota Fiscal Paulista vem sem endereço e o E-Fiscal recusaria o participante.
                            Sem este código, essas notas ficam de fora do arquivo.
                        </p>
                        {empresaSelecionada && (
                            codigoConsumidor.trim() !== consumidorSalvo.trim() ? (
                                <button
                                    onClick={handleSalvarConsumidor}
                                    disabled={salvandoConsumidor}
                                    className="mt-1 px-2 py-1 text-[10px] rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold disabled:opacity-40"
                                >
                                    {salvandoConsumidor ? 'Guardando…' : '💾 Guardar no cadastro desta empresa'}
                                </button>
                            ) : consumidorSalvo.trim() ? (
                                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
                                    ✓ guardado no cadastro — não precisa digitar de novo na próxima competência
                                </p>
                            ) : null
                        )}
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            REDF NF Paulista (opcional)
                        </label>
                        <select
                            value={redfNfPaulista}
                            onChange={(e) => setRedfNfPaulista(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="E222 campo 56. Alguns E-Fiscal exigem 1-4 ('deve ser informado 1, 2, 3 ou 4'); o valor certo é o que aparece num lançamento MANUAL desta empresa lá (aba Lançamento Produtos/Serviços). Vazio = não informar."
                        >
                            <option value="">deixe vazio (padrão)</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">
                            Só preencha se o log do E-Fiscal pedir "1, 2, 3 ou 4" no E222 campo 56 —
                            copie o valor de um lançamento manual da MESMA empresa lá.
                        </p>
                    </div>
                </div>

                <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
                    <strong>Tipo p/ inventário:</strong> deixe <strong>vazio</strong> salvo orientação em contrário. Esse
                    código vem da tabela <em>Cadastros → Tipos de Inventário</em> do E-Fiscal de cada cliente — se você
                    mandar um número que não existe lá, o E-Fiscal recusa <strong>todos</strong> os produtos (E020) e as
                    notas entram sem item.
                </p>

                <div className="flex justify-between items-center pt-1">
                    <p className="text-[11px] text-slate-400">
                        {buscou
                            ? `${filtrados.length} documento(s) no recorte.`
                            : 'Defina a competência (e a empresa, se quiser) e clique em Buscar — nada é carregado antes disso.'}
                    </p>
                    <button
                        onClick={buscar}
                        disabled={loading || !competencia}
                        className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                    >
                        {loading ? 'Buscando…' : '🔎 Buscar documentos'}
                    </button>
                </div>

                {buscou && truncado && (
                    <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3">
                        <p className="text-xs font-bold text-red-800 dark:text-red-300">
                            ⚠️ Recorte possivelmente incompleto — limite de leitura atingido.
                        </p>
                        <p className="text-[11px] text-red-700 dark:text-red-400 mt-1">
                            A competência {competencia} retornou o máximo de documentos que o navegador
                            carrega de uma vez. O arquivo gerado pode <strong>não conter todas as notas</strong>.
                            {empresaSelecionada
                                ? <> Isso com uma empresa <strong>já selecionada</strong> significa que ela sozinha
                                    passa do teto no mês — <strong>não gere o arquivo assim</strong>. Avise o Paulo
                                    com o nome da empresa e a competência.</>
                                : <> Selecione uma <strong>empresa específica</strong> acima e busque de novo: a
                                    consulta passa a ser do tamanho da empresa, não do mês inteiro.</>}
                        </p>
                    </div>
                )}

                {buscou && (
                    <>
                        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 grid grid-cols-3 gap-3">
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Documentos</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{filtrados.length}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Valor total</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalValor)}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Itens (E222)</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                    {filtrados.reduce((a, d) => a + (d.itens?.length || 0), 0)}
                                </p>
                            </div>
                            {/* Conferência ao lado dos totais: o colaborador vê o
                                veredito no MESMO lugar onde decide gerar. */}
                            <div className={`rounded-lg p-3 text-center ${
                                !preflight ? 'bg-slate-50 dark:bg-slate-700/40'
                                : preflight.farol === 'bloqueado' ? 'bg-red-50 dark:bg-red-900/20'
                                : preflight.farol === 'atencao' ? 'bg-amber-50 dark:bg-amber-900/20'
                                : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                                <p className="text-[10px] uppercase text-slate-500">
                                    {preflight?.farol === 'bloqueado' ? 'Chegariam (depois de corrigir)' : 'Vão chegar no E-Fiscal'}
                                </p>
                                <p className={`text-lg font-bold ${
                                    preflight?.farol === 'bloqueado' ? 'text-red-700 dark:text-red-400'
                                    : 'text-emerald-700 dark:text-emerald-400'}`}>
                                    {preflight ? `${preflight.notasNoArquivo}/${preflight.documentos}` : '—'}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-between items-center gap-3 flex-wrap pt-2">
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 min-w-[240px]">
                                {preflight?.farol === 'bloqueado'
                                    ? <><strong className="text-red-700 dark:text-red-400">Geração bloqueada:</strong> {preflight.bloqueios} nota(s) seriam recusadas pelo E-Fiscal — sobram {preflight.notasNoArquivo} de {preflight.documentos}. <strong>Reconferir só relê</strong>: quem corrige são os botões ao lado (e os campos acima) conforme a causa do quadro. Sem isso, as recusas continuam iguais.</>
                                    : preflight?.farol === 'atencao'
                                        ? <>Nada trava a importação — as ressalvas do quadro acima são para conferir.</>
                                        : preflight
                                            ? <>Conferência feita: nada que o E-Fiscal costume recusar.</>
                                            : <>Busque um recorte para o app conferir antes de gerar.</>}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={buscar}
                                    disabled={loading || !competencia}
                                    className="px-3 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40"
                                    title="Recarrega os documentos e refaz a conferência — use depois de corrigir."
                                >
                                    {loading ? 'Conferindo…' : '↻ Reconferir'}
                                </button>
                                {(preflight?.bloqueios ?? 0) > 0 && (
                                    <button
                                        onClick={handleCorrigirEnderecos}
                                        disabled={corrigindoEnderecos || !competencia}
                                        className="px-3 py-2 text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-40"
                                        title="Relê os XMLs guardados e preenche o endereço do destinatário das notas deste recorte — resolve o 'participante sem UF'."
                                    >
                                        {corrigindoEnderecos ? 'Corrigindo…' : '🔧 Corrigir endereços (relê XMLs)'}
                                    </button>
                                )}
                                {(preflight?.bloqueios ?? 0) > 0 && (
                                    <button
                                        onClick={handleResolverUf}
                                        disabled={resolvendoUf}
                                        className="px-3 py-2 text-sm bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300 rounded-lg hover:bg-sky-200 dark:hover:bg-sky-900/50 disabled:opacity-40"
                                        title="Resolve a UF dos participantes usando a PRÓPRIA BASE (a chave de acesso das notas que eles emitiram). É instantâneo — tente este antes de reler os XMLs."
                                    >
                                        {resolvendoUf ? 'Resolvendo…' : '⚡ Resolver UF pela base'}
                                    </button>
                                )}
                                <button
                                    onClick={handleExportar}
                                    disabled={exporting || filtrados.length === 0 || (preflight?.bloqueios ?? 0) > 0}
                                    title={(preflight?.bloqueios ?? 0) > 0
                                        ? 'Há erro que o E-Fiscal recusa. Corrija e clique em Reconferir.'
                                        : 'Gera o .FML para importar no E-Fiscal.'}
                                    className="px-4 py-2 text-sm text-white rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {exporting ? 'Gerando...'
                                        : (preflight?.bloqueios ?? 0) > 0
                                            ? `🔒 Corrija ${preflight!.bloqueios} nota(s) para gerar`
                                            : 'Gerar arquivo .FML'}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {buscou && filtrados.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            Pré-visualização ({Math.min(filtrados.length, 100)} de {filtrados.length})
                        </h3>
                    </div>
                    <div className="overflow-x-auto max-h-[320px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left">Empresa</th>
                                    <th className="px-3 py-2 text-left">Comp.</th>
                                    <th className="px-3 py-2 text-left">Tipo</th>
                                    <th className="px-3 py-2 text-left">Nº</th>
                                    <th className="px-3 py-2 text-left">Direção</th>
                                    <th className="px-3 py-2 text-right">Valor</th>
                                    <th className="px-3 py-2 text-center">Itens</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {filtrados.slice(0, 100).map(d => (
                                    <tr key={d.id}>
                                        <td className="px-3 py-1.5 truncate max-w-[180px]" title={d.empresaNome || d.empresaCnpj}>{d.empresaNome || d.empresaCnpj || '—'}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.competencia}</td>
                                        <td className="px-3 py-1.5">{d.tipo}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.numero}/{d.serie}</td>
                                        <td className="px-3 py-1.5">{d.direcao}</td>
                                        <td className="px-3 py-1.5 text-right font-bold">{formatCurrency(d.totais?.vNF || 0)}</td>
                                        <td className="px-3 py-1.5 text-center">{d.itens?.length || 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {buscou && filtrados.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-4">
                    Nenhum documento NFe/NFCe encontrado para {competencia}{empresaSelecionada ? ` · ${empresaSelecionada.nome}` : ''}{direcao ? ` · ${direcao}` : ''}.
                </p>
            )}
        </div>
    );
};

export default XmlExportarIobSage;
