import React, { useState, useEffect } from 'react';
import { getView } from '../../services/xmlDocumentoView';
import type { DocumentoFiscal, User } from '../../types';
import { formatCnpjCpf, formatCurrency, formatDate } from '../../services/xmlParserService';
import { procedenciaDoDocumento, hashCurto, dataLegivel } from '../../services/documentoProcedencia';
// 🚨 A SAÍDA PARA A NOTA QUE ENTROU NA EMPRESA ERRADA (03/09, Paulo: *"lancei
// uma nota da J.P. PISSATO na empresa SILVIO FREIRE … como resolver?"*). Não
// tinha como: `deleteDocumento` existia e NENHUMA tela o chamava.
import { explicarRetirada, MIN_MOTIVO_RETIRADA } from '../../services/documentoRetirada';
// 🚨 A SAÍDA PARA A NOTA DIGITADA COM O NÚMERO ERRADO (10/09, Paulo, HANAMI:
// *"O correto seria 9792, oq eu posso fazer nesse caso?"*). Relançar pelo ✍️
// não corrige: número e série formam o id, então nasceria um SEGUNDO documento
// e a mesma venda contaria duas vezes — sem nenhum validador acusar.
import { explicarCorrecao } from '../../services/documentoCorrecaoNumero';
import {
    tirarDocumentoDaEmpresa, marcarNotaCancelada, desmarcarNotaCancelada, corrigirNumeroDaNota,
} from '../../services/xmlFiscalService';
// 🚨 A PORTA PARA A NOTA QUE FOI CANCELADA DEPOIS DA CAPTURA (10/09, Paulo, JG
// SOLUCOES · Barueri: *"essas duas notas são canceladas, importei as notas pelo
// portal nacional e as mesmas subiram como ativas … poderia existir um campo
// para cancelarmos quando acontecer isso"*). O cancelamento aconteceu no portal
// da PREFEITURA, e o CFI não fala com aquele portal.
import { MIN_MOTIVO_CANCELAMENTO } from '../../services/cancelamentoDeclarado';
// 🚨 A PORTA PARA A RETENÇÃO QUE O CLIENTE ESQUECEU DE INFORMAR (04/09,
// FRONTINI ENGENHEIROS): a nota já está capturada com retenção ZERO, e
// corrigi-la no portal não muda o que o CFI capturou.
import {
    gravarAjusteRetencao, removerAjusteRetencao, lerAjustesDaCompetencia,
} from '../../services/retencaoAjusteService';
import { chaveDoAjuste, MIN_MOTIVO } from '../../sefaz-backend/retencao-pj-ajuste.js';
import { parseValorMoeda, ecoDoValorDigitado } from '../../services/valorDigitado';
// 🚨 A PORTA PARA O CFOP/CST QUE SOBEM COM BASE E ICMS DESTACADOS (09/09,
// Paulo, MV LIDER — comércio do SIMPLES: *"como faço para editar esses CFOPs
// que sobem com base e ICMS destacados? Poderia ter uma opção igual essa das
// retenções"*). Os dois campos existem desde 17-19/08 e moravam SÓ em
// Relatórios → ✏️ CFOP por nota — a tela existia e ninguém achava.
import { gravarCfopEscriturado, gravarEscrituracaoItem } from '../../services/cfopEscrituradoService';
import { gravarCstEscriturado } from '../../services/cstEscrituradoService';
import { direcaoEfetivaDoc, origemDoCancelamento } from '../../sefaz-backend/xml-metadata-helper.js';
import { cfopsDistintosDaNota, cfopDoLancamento } from '../../sefaz-backend/cfop-correlacao.js';
import { escrituracaoDoItem, resumoEscrituracaoItens, chaveDoItem } from '../../sefaz-backend/escrituracao-item.js';

interface Props {
    documento: DocumentoFiscal;
    onClose: () => void;
    currentUser?: User | null;
    /** Avisado quando a nota sai — a lista tem de recarregar. */
    onRetirado?: () => void;
    onShowToast?: (msg: string) => void;
}

const XmlDocumentoDetalhe: React.FC<Props> = ({ documento: d, onClose, currentUser, onRetirado, onShowToast }) => {
    const [abrirRetirada, setAbrirRetirada] = useState(false);
    const [abrirCancel, setAbrirCancel] = useState(false);
    const [motivoCancel, setMotivoCancel] = useState('');
    const [erroCancel, setErroCancel] = useState<string | null>(null);
    const [gravandoCancel, setGravandoCancel] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [tirando, setTirando] = useState(false);
    const [erroRetirada, setErroRetirada] = useState<string | null>(null);
    // ── Ajuste de retenção: TEXTO, nunca número (round-trip come a vírgula) ──
    const [abrirRet, setAbrirRet] = useState(false);
    const [ret, setRet] = useState<Record<'ir' | 'inss' | 'csll' | 'pis' | 'cofins', string>>(
        { ir: '', inss: '', csll: '', pis: '', cofins: '' },
    );
    const [motivoRet, setMotivoRet] = useState('');
    const [gravandoRet, setGravandoRet] = useState(false);
    const [erroRet, setErroRet] = useState<string | null>(null);
    const [okRet, setOkRet] = useState<string | null>(null);
    // 🚨 O QUE JÁ FOI INFORMADO. Sem isto o painel só GRAVAVA: quem informava a
    // retenção reabria a nota, via os campos vazios e concluía — com toda razão
    // — que "não ficou salvo" (04/09, FRONTINI, notas 794 e 795).
    const [ajusteAtual, setAjusteAtual] = useState<any | null>(null);
    const [erroLerAjuste, setErroLerAjuste] = useState<string | null>(null);
    // ── CFOP e CST informados NESTA nota (Paulo, 09/09) ─────────────────────
    const [abrirEscr, setAbrirEscr] = useState(false);
    const [cfopIn, setCfopIn] = useState('');
    const [cstIn, setCstIn] = useState('');
    const [gravandoEscr, setGravandoEscr] = useState(false);
    const [erroEscr, setErroEscr] = useState<string | null>(null);
    const [okEscr, setOkEscr] = useState<string | null>(null);
    // ✂️ POR ITEM (Sandra, 11/09): a nota mista recebe um CFOP/CST por produto.
    // Rascunho é TEXTO por item; o que está gravado sai do documento.
    const [modoItem, setModoItem] = useState(false);
    const [itemIn, setItemIn] = useState<Record<string, { cfop: string; cst: string }>>({});
    // ── Número/série corrigidos NESTA nota (Paulo, 10/09) ──────────────────
    const [abrirNum, setAbrirNum] = useState(false);
    const [numIn, setNumIn] = useState('');
    const [serieIn, setSerieIn] = useState('');
    const [gravandoNum, setGravandoNum] = useState(false);
    const [erroNum, setErroNum] = useState<string | null>(null);
    // ⚠️ A CORREÇÃO É LIDA ANTES DA RETIRADA: as duas usam a MESMA lápide, e
    // `explicarRetirada` diria "tirada desta empresa" sobre uma nota que não
    // saiu da empresa — ela só virou outro número. Dizer a causa errada manda
    // procurar no lugar errado.
    const jaCorrigida = explicarCorrecao(d as any);
    const jaRetirada = jaCorrigida ? null : explicarRetirada(d as any);

    // Só documento de MERCADORIA tem CFOP/CST de item — na NFS-e o campo não
    // existe, e oferecê-lo ali prometeria o que a tela não cumpre.
    const ehMercadoria = ['NFe', 'NFCe'].includes(String((d as any).tipoDoc || d.tipo));
    const direcaoDoDoc = direcaoEfetivaDoc(d as any) as 'entrada' | 'saida';
    const cfopEscriturado = String((d as any).cfopEscriturado || '');
    const cstEscriturado = String((d as any).cstEscriturado || '');
    // ⚠️ A decisão é por NOTA (Paulo, 17/08: "é por NF"), então nota com itens
    // de CFOPs diferentes passa a sair com UM só. A tela DIZ isso ANTES do
    // clique, em vez de o total mudar sozinho depois.
    // 🚨 SÓ NOTA DIGITADA E SEM CHAVE tem número corrigível. Documento com XML
    // tem o número que ele DECLARA (corrigi-lo seria reescrever a nota do
    // cliente), e a chave de 44 carrega o número nas posições 26-34 — mudar um
    // sem o outro produz uma nota que se desmente por dentro.
    const digitadaSemChave = String((d as any).origem || '') === 'digitada'
        && String((d as any).chave || '').replace(/\D/g, '').length !== 44;

    const cfopsDaNota: string[] = ehMercadoria
        ? (cfopsDistintosDaNota(d as any, direcaoDoDoc, {}) as string[]) || []
        : [];
    const itensDaNota: any[] = ehMercadoria ? ((d as any).itens || []) : [];
    const porItem = resumoEscrituracaoItens(d as any);
    /** Linhas do editor por item — o que está gravado, o que a régua daria e o rascunho. */
    const linhasItem = itensDaNota.map((it: any) => {
        const k = chaveDoItem(it);
        const gravado = escrituracaoDoItem(d as any, it);
        const cru = String(it?.cfop || '').replace(/\D/g, '');
        const rascunho = itemIn[k];
        return {
            k, it,
            cru,
            cstCru: String(it?.cstIcms || it?.cst || ''),
            // O que ESTE item recebe hoje pela régua (com o que a nota já informou).
            regua: cru ? String(cfopDoLancamento(d as any, cru, direcaoDoDoc, {}, it) || cru) : '',
            gravado,
            cfopIn: rascunho ? rascunho.cfop : (gravado?.cfop || ''),
            cstIn: rascunho ? rascunho.cst : (gravado?.cst || ''),
        };
    });
    const abrirPorItem = () => {
        setItemIn({});
        setModoItem(true);
    };
    const gravarPorItem = async () => {
        setGravandoEscr(true); setErroEscr(null); setOkEscr(null);
        try {
            const email = String(currentUser?.email || '');
            let mudados = 0;
            for (const l of linhasItem) {
                if (!l.k) continue;
                const atualCfop = l.gravado?.cfop || '';
                const atualCst = l.gravado?.cst || '';
                const novoCfop = String(l.cfopIn || '').trim();
                const novoCst = String(l.cstIn || '').trim();
                if (novoCfop === atualCfop && novoCst === atualCst) continue;
                await gravarEscrituracaoItem({
                    documentoId: d.id, direcao: direcaoDoDoc, nItem: l.k, cfop: novoCfop, cst: novoCst, porEmail: email,
                });
                mudados += 1;
            }
            setOkEscr(mudados
                ? `${mudados} item(ns) informado(s). O item informado VENCE o CFOP/CST da nota; os outros seguem a nota. `
                  + 'Vale no Livro, no Resumo por CFOP, no SPED e no Exportar SAGE — gere de novo.'
                : 'Nada mudou — nenhum item foi alterado.');
            if (mudados) onShowToast?.(`Escrituração por item da nota ${d.numero} gravada.`);
            setModoItem(false);
            setAbrirEscr(false);
            if (mudados) onRetirado?.();
        } catch (e: any) {
            setErroEscr(e?.message || 'Falha ao gravar.');
        } finally {
            setGravandoEscr(false);
        }
    };

    const gravarEscr = async (limpar = false) => {
        setGravandoEscr(true); setErroEscr(null); setOkEscr(null);
        try {
            const email = String(currentUser?.email || '');
            const alvo = { documentoId: d.id, porEmail: email };
            await gravarCfopEscriturado({ ...alvo, direcao: direcaoDoDoc, cfop: limpar ? '' : cfopIn });
            await gravarCstEscriturado({ ...alvo, cst: limpar ? '' : cstIn });
            setOkEscr(limpar
                ? 'Nota devolvida à régua automática.'
                : 'Informado. Vale no Livro, no Resumo por CFOP, no SPED e no Exportar SAGE — '
                  + 'gere os relatórios de novo.');
            onShowToast?.(`Escrituração da nota ${d.numero} informada.`);
            setAbrirEscr(false);
            onRetirado?.();
        } catch (e: any) {
            setErroEscr(e?.message || 'Falha ao gravar.');
        } finally {
            setGravandoEscr(false);
        }
    };

    const corrigirNumero = async () => {
        setGravandoNum(true); setErroNum(null);
        try {
            const r = await corrigirNumeroDaNota(d.id, numIn, serieIn, currentUser || null);
            if (!r.ok) { setErroNum(r.mensagem); return; }
            onShowToast?.(r.mensagem);
            setAbrirNum(false);
            setNumIn(''); setSerieIn('');
            onRetirado?.();
            // A nota corrigida é OUTRO documento (o id carrega o número): o
            // detalhe aberto passou a apontar para a versão enterrada, e deixá-lo
            // na tela mostraria a nota errada como se fosse a que vale.
            onClose();
        } catch (e: any) {
            setErroNum(e?.message || 'Falha ao corrigir o número.');
        } finally {
            setGravandoNum(false);
        }
    };

    const tirar = async () => {
        setTirando(true); setErroRetirada(null);
        try {
            const r = await tirarDocumentoDaEmpresa(d.id, motivo, currentUser || null);
            if (!r.ok) { setErroRetirada(r.mensagem); return; }
            onShowToast?.(r.mensagem);
            setAbrirRetirada(false);
            setMotivo('');
            onRetirado?.();
            onClose();
        } catch (e: any) {
            setErroRetirada(e?.message || 'Falha ao tirar a nota.');
        } finally {
            setTirando(false);
        }
    };

    const declararCancelada = async () => {
        setGravandoCancel(true); setErroCancel(null);
        try {
            const r = await marcarNotaCancelada(d.id, motivoCancel, currentUser || null);
            if (!r.ok) { setErroCancel(r.mensagem); return; }
            onShowToast?.(r.mensagem);
            setAbrirCancel(false);
            setMotivoCancel('');
            onRetirado?.();
            onClose();
        } catch (e: any) {
            setErroCancel(e?.message || 'Falha ao declarar o cancelamento.');
        } finally {
            setGravandoCancel(false);
        }
    };

    const desfazerCancelada = async () => {
        setGravandoCancel(true); setErroCancel(null);
        try {
            const r = await desmarcarNotaCancelada(d.id);
            if (!r.ok) { setErroCancel(r.mensagem); return; }
            onShowToast?.(r.mensagem);
            onRetirado?.();
            onClose();
        } catch (e: any) {
            setErroCancel(e?.message || 'Falha ao remover a declaração.');
        } finally {
            setGravandoCancel(false);
        }
    };

    /**
     * O que a nota JÁ TEM gravado de retenção — é o que a tela mostra ao lado,
     * para a pessoa ver o que está corrigindo. Ausente ≠ zero.
     */
    const retDoDoc = {
        ir: (d as any).valorIr ?? (d as any).valores?.ir,
        inss: (d as any).valorInss ?? (d as any).valores?.inss,
        csll: (d as any).valorCsll ?? (d as any).valores?.csll,
        pis: (d as any).valorPis ?? (d as any).valores?.pis,
        cofins: (d as any).valorCofins ?? (d as any).valores?.cofins,
    };
    const semRetencaoNoDoc = Object.values(retDoDoc).every(v => v === undefined || v === null || v === '');
    const chaveAjuste = chaveDoAjuste(d as any);
    const competenciaDoc = String((d as any).competencia || String(d.dhEmi || '').slice(0, 7));

    // Carrega o que já foi informado — ANTES de a pessoa digitar de novo. Ela
    // roda no MOUNT, não no clique: o carimbo ("informado por X") precisa
    // aparecer mesmo com o painel fechado, senão a nota parece intocada.
    useEffect(() => {
        let vivo = true;
        const cnpj = String((d as any).empresaCnpj || '').replace(/\D/g, '');
        if (!cnpj || !chaveAjuste) { setAjusteAtual(null); return; }
        lerAjustesDaCompetencia(cnpj, competenciaDoc)
            .then(mapa => { if (vivo) { setAjusteAtual(mapa?.[chaveAjuste] || null); setErroLerAjuste(null); } })
            // ⚠️ FALHA DE LEITURA NÃO VIRA "não há ajuste": mostrar o zero do
            // documento aqui faria a pessoa informar de novo por cima de um
            // ajuste que já existe.
            .catch(e => { if (vivo) { setAjusteAtual(null); setErroLerAjuste(e?.message || 'Não consegui ler o ajuste desta nota.'); } });
        return () => { vivo = false; };
    }, [(d as any).empresaCnpj, competenciaDoc, chaveAjuste, okRet]);

    // 🚨 O QUE JÁ FOI INFORMADO ENTRA NO FORMULÁRIO (11/09, WALDESA — duas NFS-e
    // da mesma prestadora: *"quando eu lanço uma NF com as retenções e salvo e
    // vou lançar a outra retenção na outra NF, as retenções some da outra NF"*).
    // O ajuste ESTAVA gravado (o R-4020 do Contábil trazia as duas) — o que
    // sumia era a TELA: reabrir o formulário mostrava os cinco campos VAZIOS e
    // o carimbo saía de vista, e vazio sobre ajuste gravado se lê como
    // "sumiu". Reabrir para editar traz o que foi informado; gravar de novo
    // substitui esses campos e MANTÉM o que você não mexer.
    const aTextoPtBr = (v: unknown) =>
        (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))
            ? '' : Number(v).toFixed(2).replace('.', ','));
    const abrirFormRet = () => {
        if (ajusteAtual) {
            setRet({
                ir: aTextoPtBr(ajusteAtual.ir), inss: aTextoPtBr(ajusteAtual.inss),
                csll: aTextoPtBr(ajusteAtual.csll), pis: aTextoPtBr(ajusteAtual.pis),
                cofins: aTextoPtBr(ajusteAtual.cofins),
            });
            setMotivoRet(String(ajusteAtual.motivo || ''));
        }
        setAbrirRet(true);
    };

    const gravarRet = async (remover = false) => {
        setGravandoRet(true); setErroRet(null); setOkRet(null);
        try {
            const alvo = {
                cnpj: String((d as any).empresaCnpj || '').replace(/\D/g, ''),
                competencia: competenciaDoc,
                chave: chaveAjuste,
            };
            if (remover) {
                await removerAjusteRetencao(alvo);
                setOkRet('Ajuste desfeito — a nota voltou ao valor do documento.');
            } else {
                await gravarAjusteRetencao({
                    ...alvo,
                    base: (d as any).valorServicos ?? d.valorTotal ?? null,
                    ir: parseValorMoeda(ret.ir), inss: parseValorMoeda(ret.inss),
                    csll: parseValorMoeda(ret.csll), pis: parseValorMoeda(ret.pis),
                    cofins: parseValorMoeda(ret.cofins),
                    motivo: motivoRet,
                });
                setOkRet('Retenção informada. Ela já vale no Relatório de Retenções e no F600 do '
                    + 'EFD-Contribuições (o abatimento do M200/M600 muda) — gere o arquivo de novo.');
                onShowToast?.(`Retenção da nota ${d.numero} informada.`);
            }
            setAbrirRet(false);
            setMotivoRet('');
            onRetirado?.();
        } catch (e: any) {
            setErroRet(e?.message || 'Falha ao gravar o ajuste.');
        } finally {
            setGravandoRet(false);
        }
    };

    // Por que campos como chave e hash podem faltar. A NFS-e do portal entra
    // por CSV/TXT: sem arquivo XML, sem hash, sem chave de 44 dígitos — e
    // tratar isso como defeito foi o que derrubou a tela (07/08).
    const procedencia = procedenciaDoDocumento(d);
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-emerald-800 dark:text-emerald-300">
                            {d.tipo} Nº {d.numero} — Série {d.serie}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {d.natOp} • Emissão: {formatDate(d.dhEmi)} • Status: {d.status} • {d.direcao}
                        </p>
                        {procedencia.temChave && (
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Chave: {d.chave}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {d.storageUrl && (
                            <a href={d.storageUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 dark:text-emerald-300 underline">
                                Baixar XML
                            </a>
                        )}
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Emitente</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{getView(d).emitente.nome || '—'}</p>
                        {getView(d).emitente.fantasia && <p className="text-xs text-slate-500">{getView(d).emitente.fantasia}</p>}
                        <p className="text-xs text-slate-500 mt-1">CNPJ: {formatCnpjCpf(getView(d).emitente.cnpj)}</p>
                        <p className="text-xs text-slate-500">IE: {getView(d).emitente.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{getView(d).emitente.municipio || '—'}/{getView(d).emitente.uf}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Destinatário</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{getView(d).destinatario.nome || '—'}</p>
                        <p className="text-xs text-slate-500 mt-1">CNPJ/CPF: {formatCnpjCpf(getView(d).destinatario.cnpj)}</p>
                        <p className="text-xs text-slate-500">IE: {getView(d).destinatario.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{getView(d).destinatario.municipio || '—'}/{getView(d).destinatario.uf}</p>
                    </div>
                </div>

                {getView(d).resumoOnly ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Resumo SEFAZ</p>
                        <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">
                            Este documento veio como resumo (resNFe) da SEFAZ. O XML completo (procNFe) ainda não foi baixado, então itens e detalhes de impostos não estão disponíveis.
                        </p>
                    </div>
                ) : (
                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Resumo de Impostos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                            { label: 'Valor Produtos', value: getView(d).valores.produtos },
                            { label: 'Valor NF', value: getView(d).valores.total },
                            { label: 'BC ICMS', value: getView(d).valores.bc },
                            { label: 'ICMS', value: getView(d).valores.icms },
                            { label: 'BC ICMS ST', value: getView(d).valores.bcST },
                            { label: 'ICMS ST', value: getView(d).valores.icmsST },
                            { label: 'IPI', value: getView(d).valores.ipi },
                            { label: 'PIS', value: getView(d).valores.pis },
                            { label: 'COFINS', value: getView(d).valores.cofins },
                            { label: 'Frete', value: getView(d).valores.frete },
                            { label: 'Desconto', value: getView(d).valores.desconto },
                            { label: 'Outros', value: getView(d).valores.outros },
                        ].map(item => (
                            <div key={item.label} className="bg-slate-50 dark:bg-slate-700/30 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</p>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatCurrency(item.value)}</p>
                            </div>
                        ))}
                    </div>
                </div>
                )}

                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Itens ({(d as any).itens?.length || 0})
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 max-h-[360px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2 text-left">#</th>
                                    <th className="px-2 py-2 text-left">Produto</th>
                                    <th className="px-2 py-2 text-center">NCM</th>
                                    <th className="px-2 py-2 text-center">CFOP</th>
                                    <th className="px-2 py-2 text-center">CST</th>
                                    <th className="px-2 py-2 text-right">Qtd</th>
                                    <th className="px-2 py-2 text-right">Vl. Unit.</th>
                                    <th className="px-2 py-2 text-right">Vl. Total</th>
                                    <th className="px-2 py-2 text-right">ICMS</th>
                                    <th className="px-2 py-2 text-right">IPI</th>
                                    <th className="px-2 py-2 text-right">PIS</th>
                                    <th className="px-2 py-2 text-right">COFINS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {((d as any).itens || []).map((p: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="px-2 py-1.5 text-slate-400">{p.nItem}</td>
                                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={p.xProd}>{p.xProd}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.ncm}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cfop}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cst}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{typeof p.qCom === 'number' ? p.qCom.toLocaleString('pt-BR') : '—'} {p.uCom || ''}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{formatCurrency(p.vUnCom)}</td>
                                        <td className="px-2 py-1.5 text-right font-bold">{formatCurrency(p.vProd)}</td>
                                        <td className="px-2 py-1.5 text-right text-blue-600">{formatCurrency(p.vICMS)}</td>
                                        <td className="px-2 py-1.5 text-right text-amber-600">{formatCurrency(p.vIPI)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vPIS)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vCOFINS)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* 🚨 Uma linha de "—" se lê como CAPTURA QUE FALHOU. O ✍️ Lançar
                        nota sem XML recebe CFOP, NCM, CST, valor e — opcionais — BC,
                        ICMS e IPI; unitário, PIS e COFINS só existem no XML. Dizer
                        isso aqui é o que separa "ninguém informou" de "o app perdeu". */}
                    {String((d as any).origem || '') === 'digitada' && ((d as any).itens || []).length > 0 && (
                        <p className="text-[10px] text-slate-500 mt-1.5">
                            ℹ Nota lançada à mão: o ✍️ recebe CFOP, NCM, CST, valor e, opcionais,
                            BC/ICMS/IPI — unitário, PIS e COFINS só existem no XML.{' '}
                            <strong>—</strong> é campo não informado, nunca zero.
                        </p>
                    )}
                </div>

                {d.infAdic && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informações Adicionais</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{d.infAdic}</p>
                    </div>
                )}

                <div className="text-[10px] text-slate-400 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div><span className="font-bold">Origem:</span> {d.origem}</div>
                    <div><span className="font-bold">Importado por:</span> {d.importadoPorEmail || d.importadoPor}</div>
                    <div><span className="font-bold">Em:</span> {dataLegivel(d.importadoEm) || '—'}</div>
                    <div className="truncate" title={d.xmlHash}>
                        <span className="font-bold">Hash:</span> {hashCurto(d.xmlHash) || '—'}
                    </div>
                </div>
                {/* Campo vazio SEM explicação faz procurar problema que não existe.
                    A NFS-e do portal entra por CSV/TXT: não tem XML, hash nem chave
                    de 44 dígitos — e isso é a natureza dela, não falha de captura. */}
                {procedencia.explicacao && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 leading-snug">
                        ℹ {procedencia.explicacao}
                    </p>
                )}

                {/* ═══ RETENÇÃO QUE O DOCUMENTO NÃO TRAZ ═════════════════════
                    04/09, Paulo (FRONTINI ENGENHEIROS): *"ele esqueceu de
                    informar as retenções de 2 notas… como eu faço agora no
                    consultor? incluir um campo para informar manual?"*

                    A nota já foi capturada com retenção ZERO. Corrigi-la no
                    portal não muda o que o CFI capturou — e sem o número o F600
                    sai a menos, ou seja a empresa recolhe PIS/COFINS que já
                    foram retidos na fonte. */}
                {!jaRetirada && chaveAjuste && (
                    !abrirRet ? (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={abrirFormRet}
                                className="text-xs rounded-md border border-sky-300 text-sky-700 dark:text-sky-300 px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/20 btn-press whitespace-nowrap"
                                title="Para quando o documento saiu sem a retenção (ou com ela errada). Fica gravado com o motivo e com quem informou."
                            >
                                {ajusteAtual ? '✍️ Editar a retenção informada' : '✍️ Informar retenção desta nota'}
                            </button>
                            {semRetencaoNoDoc && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                    Este documento <strong>não traz nenhuma retenção</strong> — no Relatório de
                                    Retenções ele aparece com <strong>“?”</strong>, que é “falta conferir”, não “não houve”.
                                </p>
                            )}
                            {/* 🚨 O CARIMBO DO QUE JÁ FOI INFORMADO. Sem ele o painel só
                                gravava, e quem reabria a nota via os campos vazios e
                                concluía que "não ficou salvo" (04/09, FRONTINI 794/795). */}
                            {ajusteAtual && (
                                <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 p-2">
                                    <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                                        ✍️ Retenção INFORMADA nesta nota — ela vence o documento
                                    </p>
                                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                                        {(['ir', 'inss', 'csll', 'pis', 'cofins'] as const)
                                            .filter(k => ajusteAtual[k] !== undefined && ajusteAtual[k] !== null)
                                            .map(k => `${k === 'ir' ? 'IRRF' : k.toUpperCase()} ${formatCurrency(Number(ajusteAtual[k]))}`)
                                            .join(' · ') || 'sem valores'}
                                    </p>
                                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                                        por {ajusteAtual.autor || 'autor não informado'}
                                        {ajusteAtual.em ? ` em ${String(ajusteAtual.em).slice(0, 10).split('-').reverse().join('/')}` : ''}
                                        {ajusteAtual.motivo ? ` — “${ajusteAtual.motivo}”` : ''}
                                    </p>
                                </div>
                            )}
                            {/* Falha de leitura NÃO vira "não há ajuste": informar de novo
                                por cima de um ajuste existente é o que se evita aqui. */}
                            {erroLerAjuste && (
                                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">⚠ {erroLerAjuste}</p>
                            )}
                            {okRet && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">✓ {okRet}</p>}
                        </div>
                    ) : (
                        <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-900/20 p-3">
                            <p className="text-xs font-bold text-sky-800 dark:text-sky-300">
                                Retenção da nota {d.numero} · competência {competenciaDoc}
                            </p>
                            {/* O carimbo fica À VISTA com o formulário aberto: sem ele, os campos
                                pré-preenchidos parecem valores do documento, e o formulário vazio
                                (antes do prefill) parecia ajuste perdido. */}
                            {ajusteAtual && (
                                <p className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-1">
                                    ✍️ Editando a retenção já INFORMADA nesta nota
                                    {ajusteAtual.autor ? ` por ${ajusteAtual.autor}` : ''}
                                    {ajusteAtual.em ? ` em ${String(ajusteAtual.em).slice(0, 10).split('-').reverse().join('/')}` : ''}
                                    {' '}— os campos já trazem o que foi gravado. Gravar de novo substitui o que você
                                    mudar e mantém o resto; para voltar ao documento, use ↩ desfazer.
                                </p>
                            )}
                            <p className="text-[11px] text-sky-800 dark:text-sky-300 mt-1 leading-snug">
                                O documento <strong>não é reescrito</strong>: o que você informa aqui é uma
                                <strong> declaração</strong>, gravada com o seu nome e o motivo, e ela
                                <strong> vence o documento</strong> no Relatório de Retenções e no
                                <strong> F600</strong> do EFD-Contribuições. Dá para desfazer.
                            </p>
                            <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2">
                                {(['ir', 'inss', 'csll', 'pis', 'cofins'] as const).map(k => (
                                    <div key={k}>
                                        <label className="text-[10px] font-bold block mb-1 text-slate-600 dark:text-slate-300">
                                            {k === 'ir' ? 'IRRF' : k.toUpperCase()} (R$)
                                        </label>
                                        <input
                                            value={ret[k]}
                                            onChange={e => setRet(r => ({ ...r, [k]: e.target.value }))}
                                            placeholder="vazio ≠ zero"
                                            className="w-full p-1.5 text-xs rounded border border-sky-300 bg-white dark:bg-slate-800"
                                        />
                                        {ecoDoValorDigitado(ret[k]) && (
                                            <p className={`text-[10px] mt-0.5 ${ecoDoValorDigitado(ret[k])!.ok
                                                ? 'text-slate-500' : 'text-red-600 dark:text-red-400'}`}>
                                                {ecoDoValorDigitado(ret[k])!.texto}
                                            </p>
                                        )}
                                        {/* O que o DOCUMENTO diz, ao lado — é contra isto que a
                                            pessoa está corrigindo. */}
                                        <p className="text-[10px] mt-0.5 text-slate-400">
                                            doc: {retDoDoc[k] === undefined || retDoDoc[k] === null || retDoDoc[k] === ''
                                                ? 'não informado' : formatCurrency(Number(retDoDoc[k]))}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <textarea
                                value={motivoRet}
                                onChange={e => setMotivoRet(e.target.value)}
                                rows={2}
                                placeholder='Ex.: "cliente emitiu sem informar a retenção; carta de correção enviada em 04/09"'
                                className="mt-2 w-full rounded border border-sky-300 bg-white dark:bg-slate-800 p-2 text-xs"
                            />
                            <p className="text-[10px] text-sky-700 dark:text-sky-400 mt-0.5">
                                {motivoRet.trim().length}/{MIN_MOTIVO} caracteres — este número muda o valor a
                                recolher, e daqui a três meses ninguém lembra de onde ele veio.
                            </p>
                            {erroRet && (
                                <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erroRet}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => gravarRet(false)}
                                    disabled={gravandoRet}
                                    className="text-xs rounded-md bg-sky-700 text-white px-3 py-1.5 font-bold disabled:opacity-50 btn-press whitespace-nowrap"
                                >
                                    {gravandoRet ? 'gravando…' : '✍️ Gravar retenção'}
                                </button>
                                <button
                                    onClick={() => gravarRet(true)}
                                    disabled={gravandoRet}
                                    className="text-xs underline text-slate-600 dark:text-slate-300 btn-press whitespace-nowrap"
                                    title="Devolve a nota ao valor que o documento traz."
                                >
                                    ↩ desfazer ajuste
                                </button>
                                <button
                                    onClick={() => { setAbrirRet(false); setErroRet(null); }}
                                    className="text-xs underline text-slate-500 btn-press">cancelar</button>
                            </div>
                        </div>
                    )
                )}

                {/* ═══ CFOP E CST DESTA NOTA ═════════════════════════════════
                    09/09, Paulo, MV LIDER (comércio do SIMPLES): *"como faço
                    para editar esses CFOPs que sobem com base e ICMS
                    destacados? Poderia ter uma opção igual essa das retenções,
                    senão a escrituração fica errada"*.

                    Os dois campos existem desde 17-19/08 e moravam SÓ em
                    Relatórios → ✏️ CFOP por nota: quem está olhando a nota não
                    tinha como chegar neles. É a lição de 18/08 outra vez — a
                    tela existia, funcionava, e a única pessoa que sabia onde
                    era, era eu. */}
                {!jaRetirada && ehMercadoria && (
                    !abrirEscr ? (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => {
                                    setCfopIn(cfopEscriturado);
                                    setCstIn(cstEscriturado);
                                    setAbrirEscr(true);
                                }}
                                className="text-xs rounded-md border border-indigo-300 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 btn-press whitespace-nowrap"
                                title="O CFOP e o CST com que ESTA nota entra no livro. O XML de uma compra traz o CFOP do FORNECEDOR."
                            >
                                ✏️ Informar CFOP e CST desta nota
                            </button>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {direcaoDoDoc === 'entrada'
                                    ? <>Numa compra o documento é do <strong>fornecedor</strong> e traz o CFOP de saída dele — quem escritura a entrada lança 1xxx/2xxx.</>
                                    : <>Na saída o documento é seu: o CFOP informado aqui vence a régua automática.</>}
                            </p>
                            {(cfopEscriturado || cstEscriturado) && (
                                <div className="mt-2 rounded-md border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-2">
                                    <p className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300">
                                        ✏️ Escrituração INFORMADA nesta nota — vence a régua automática
                                    </p>
                                    <p className="text-[11px] text-indigo-800 dark:text-indigo-300 mt-0.5">
                                        {cfopEscriturado ? `CFOP ${cfopEscriturado}` : 'CFOP pela régua'}
                                        {' · '}
                                        {cstEscriturado ? `CST ${cstEscriturado}` : 'CST pela régua'}
                                    </p>
                                    <p className="text-[10px] text-indigo-700 dark:text-indigo-400 mt-0.5">
                                        por {(d as any).cfopEscrituradoPor || (d as any).cstEscrituradoPor || 'autor não informado'}
                                    </p>
                                </div>
                            )}
                            {porItem.total > 0 && (
                                <div className="mt-2 rounded-md border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-2">
                                    <p className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300">
                                        ✂️ {porItem.total} item(ns) com CFOP/CST próprios — item nº {porItem.nItens.join(', ')}
                                    </p>
                                    <p className="text-[10px] text-indigo-700 dark:text-indigo-400 mt-0.5">
                                        O item informado vence o da nota; os demais seguem a nota (ou a régua).
                                    </p>
                                </div>
                            )}
                            {okEscr && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">✓ {okEscr}</p>}
                        </div>
                    ) : (
                        <div className="mt-3 rounded-md border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-3">
                            <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">
                                Escrituração da nota {d.numero} · {direcaoDoDoc === 'entrada' ? 'entrada' : 'saída'}
                            </p>
                            {/* A decisão é por NOTA: nota com CFOPs diferentes entre os
                                itens passa a sair com UM só, e isso vai DITO antes do
                                clique — total que muda sozinho faz desconfiar do número
                                certo (a lição do ✕ do FUNRURAL, 30/08). */}
                            {!modoItem && cfopsDaNota.length > 1 && (
                                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                                    ⚠ Esta nota tem <strong>{cfopsDaNota.length} CFOPs</strong> pela régua
                                    ({cfopsDaNota.join(' · ')}). O informado aqui vale para <strong>todos os itens</strong> —
                                    para um CFOP/CST por produto (item com ST e item sem na mesma nota), use o ✂️ por item.
                                </p>
                            )}
                            {/* ✂️ A PORTA POR ITEM nasce ONDE a limitação aparecia: Sandra
                                (11/09) leu "só consigo colocar um CFOP e um CST" nesta
                                caixa. Nota com um item só não ganha o botão — por item e
                                por nota seriam a mesma coisa, e botão a mais confunde. */}
                            {!modoItem && itensDaNota.length > 1 && (
                                <button
                                    onClick={abrirPorItem}
                                    className="mt-2 text-xs rounded-md border border-indigo-300 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 btn-press whitespace-nowrap"
                                    title="Um CFOP e um CST por PRODUTO desta nota. O item informado vence o da nota."
                                >
                                    ✂️ Informar por item ({itensDaNota.length} itens)
                                    {porItem.total > 0 ? ` · ${porItem.total} já informado(s)` : ''}
                                </button>
                            )}
                            {modoItem && (
                                <div className="mt-2">
                                    <p className="text-[11px] text-indigo-800 dark:text-indigo-300">
                                        Um CFOP/CST por <strong>produto</strong>. Linha em branco segue a nota (ou a régua).
                                        O item informado <strong>vence</strong> o CFOP/CST da nota.
                                    </p>
                                    <div className="overflow-x-auto mt-1 rounded border border-indigo-200 dark:border-indigo-800">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-indigo-100/60 dark:bg-indigo-900/40">
                                                <tr>
                                                    <th className="px-1.5 py-1 text-left">#</th>
                                                    <th className="px-1.5 py-1 text-left">Produto</th>
                                                    <th className="px-1.5 py-1 text-center" title="CFOP como veio no XML (o do fornecedor, na compra)">CFOP na nota</th>
                                                    <th className="px-1.5 py-1 text-center" title="O que este item recebe hoje: pela nota informada, pelo cérebro ou pela régua">Hoje</th>
                                                    <th className="px-1.5 py-1 text-center">CST na nota</th>
                                                    <th className="px-1.5 py-1 text-center">CFOP do item</th>
                                                    <th className="px-1.5 py-1 text-center">CST do item</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-indigo-100 dark:divide-indigo-900">
                                                {linhasItem.map((l) => (
                                                    <tr key={l.k || String(l.it?.xProd)}>
                                                        <td className="px-1.5 py-1 text-slate-500">{l.k || '—'}</td>
                                                        <td className="px-1.5 py-1 max-w-[180px] truncate" title={l.it?.xProd}>{l.it?.xProd || '—'}</td>
                                                        <td className="px-1.5 py-1 text-center font-mono">{l.cru || '—'}</td>
                                                        <td className="px-1.5 py-1 text-center font-mono">{l.regua || '—'}</td>
                                                        <td className="px-1.5 py-1 text-center font-mono">{l.cstCru || '—'}</td>
                                                        <td className="px-1.5 py-1 text-center">
                                                            <input
                                                                value={l.cfopIn}
                                                                disabled={!l.k}
                                                                onChange={e => setItemIn(x => ({ ...x, [l.k]: { cfop: e.target.value, cst: l.cstIn } }))}
                                                                placeholder="—"
                                                                inputMode="numeric"
                                                                maxLength={4}
                                                                className="w-16 rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1 text-xs font-mono text-center"
                                                            />
                                                        </td>
                                                        <td className="px-1.5 py-1 text-center">
                                                            <input
                                                                value={l.cstIn}
                                                                disabled={!l.k}
                                                                onChange={e => setItemIn(x => ({ ...x, [l.k]: { cfop: l.cfopIn, cst: e.target.value } }))}
                                                                placeholder="—"
                                                                inputMode="numeric"
                                                                maxLength={3}
                                                                className="w-12 rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1 text-xs font-mono text-center"
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        CFOP com 4 dígitos na faixa {direcaoDoDoc === 'entrada' ? '1/2/3' : '5/6/7'}; CST só a tributação
                                        (ex.: 60 para ST, 90 para Outras) — a origem continua vindo do item.
                                    </p>
                                </div>
                            )}
                            {!modoItem && <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <label className="block text-[11px] font-bold text-indigo-800 dark:text-indigo-300">CFOP</label>
                                    <input
                                        value={cfopIn}
                                        onChange={e => setCfopIn(e.target.value)}
                                        placeholder="—"
                                        inputMode="numeric"
                                        className="mt-0.5 w-full rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        4 dígitos, faixa {direcaoDoDoc === 'entrada' ? '1/2/3' : '5/6/7'}. Vazio = régua automática.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-indigo-800 dark:text-indigo-300">CST (tributação)</label>
                                    <input
                                        value={cstIn}
                                        onChange={e => setCstIn(e.target.value)}
                                        placeholder="—"
                                        inputMode="numeric"
                                        className="mt-0.5 w-full rounded border border-indigo-300 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                    />
                                    {/* A ORIGEM (1º dígito) é fato da MERCADORIA e continua
                                        vindo do item: gravar "090" cru faria produto
                                        IMPORTADO virar NACIONAL dentro do SPED. */}
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        2 dígitos (00 · 40 · 60 · 90…). A <strong>origem</strong> continua vindo do item.
                                    </p>
                                </div>
                            </div>}
                            <p className="text-[10px] text-indigo-700 dark:text-indigo-400 mt-2">
                                Vale no Livro, no Resumo por CFOP, no SPED e no Exportar SAGE — as quatro
                                telas leem a mesma régua, então elas não divergem.
                            </p>
                            {erroEscr && (
                                <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erroEscr}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {modoItem ? (
                                    <>
                                        <button
                                            onClick={gravarPorItem}
                                            disabled={gravandoEscr}
                                            className="text-xs rounded-md bg-indigo-700 text-white px-3 py-1.5 font-bold disabled:opacity-50 btn-press whitespace-nowrap"
                                        >
                                            {gravandoEscr ? 'gravando…' : '✂️ Gravar por item'}
                                        </button>
                                        <button
                                            onClick={() => { setModoItem(false); setItemIn({}); }}
                                            disabled={gravandoEscr}
                                            className="text-xs underline text-slate-600 dark:text-slate-300 btn-press whitespace-nowrap"
                                        >
                                            ← voltar ao campo por nota
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => gravarEscr(false)}
                                            disabled={gravandoEscr}
                                            className="text-xs rounded-md bg-indigo-700 text-white px-3 py-1.5 font-bold disabled:opacity-50 btn-press whitespace-nowrap"
                                        >
                                            {gravandoEscr ? 'gravando…' : '✏️ Gravar escrituração'}
                                        </button>
                                        <button
                                            onClick={() => gravarEscr(true)}
                                            disabled={gravandoEscr}
                                            className="text-xs underline text-slate-600 dark:text-slate-300 btn-press whitespace-nowrap"
                                            title="Devolve a nota à régua automática (CFOP correlacionado e CST derivado). Itens informados um a um continuam valendo — limpe-os no ✂️."
                                        >
                                            ↩ voltar à régua automática
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => { setAbrirEscr(false); setModoItem(false); setErroEscr(null); }}
                                    className="text-xs underline text-slate-500 btn-press">cancelar</button>
                            </div>
                        </div>
                    )
                )}

                {/* ═══ O NÚMERO DA NOTA DIGITADA ESTÁ ERRADO ════════════════
                    10/09, Paulo (HANAMI EMBALAGENS, NF-e de saída lançada à mão):
                    *"precisava fazer uma correção em uma nota q eu lancei
                    manualmente … O correto seria 9792"* — ela está como 792.

                    🚨 RELANÇAR PELO ✍️ NÃO CORRIGE: número, série e competência
                    formam o id do documento, então o relançamento monta um id
                    DIFERENTE e nasce um SEGUNDO documento. A mesma venda passa a
                    contar duas vezes no Livro, no Resumo por CFOP, na competência,
                    no faturamento e no bloco C/A do SPED — e nenhum validador
                    acusa, porque os dois documentos são formalmente corretos.

                    Por isso a correção é UM ATO SÓ: grava a nota certa e enterra
                    a errada junto. Deixar como procedimento em dois passos é
                    apostar que ninguém esquece a segunda metade — e a metade
                    esquecida é justamente a que duplica o faturamento. */}
                {digitadaSemChave && !jaRetirada && !jaCorrigida && (
                    !abrirNum ? (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => {
                                    setNumIn(String(d.numero || ''));
                                    setSerieIn(String((d as any).serie || ''));
                                    setErroNum(null);
                                    setAbrirNum(true);
                                }}
                                className="text-xs rounded-md border border-sky-300 text-sky-700 dark:text-sky-300 px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/20 btn-press whitespace-nowrap"
                                title="Para a nota lançada à mão com o número errado. A nota certa entra e a errada sai no mesmo ato."
                            >
                                ✏️ Corrigir o número desta nota
                            </button>
                        </div>
                    ) : (
                        <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-900/20 p-3">
                            <p className="text-xs font-bold text-sky-900 dark:text-sky-300">
                                ✏️ Corrigir o número da nota {d.numero}
                            </p>
                            {/* A CONSEQUÊNCIA VAI DITA ANTES DO CLIQUE — é o que
                                separa esta porta de "relançar e torcer". */}
                            <p className="text-[11px] text-sky-900 dark:text-sky-300 mt-1 leading-snug">
                                A nota passa a valer com o número novo, e a de nº <strong>{d.numero}</strong> sai
                                do livro <strong>no mesmo ato</strong> — a venda não conta duas vezes. O documento
                                antigo <strong>não é apagado</strong>: fica guardado apontando para o novo.
                                <br />
                                ⚠️ Isto é só para nota <strong>lançada à mão</strong>. Se o número certo é de
                                outra nota (outro valor, outra data), não é correção: tire esta do livro e lance
                                a certa.
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                                <label className="text-[11px] text-sky-900 dark:text-sky-300">
                                    Número certo
                                    <input
                                        value={numIn}
                                        onChange={(e) => setNumIn(e.target.value)}
                                        className="mt-0.5 block w-32 rounded border border-sky-300 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                        placeholder="9792"
                                    />
                                </label>
                                <label className="text-[11px] text-sky-900 dark:text-sky-300">
                                    Série
                                    <input
                                        value={serieIn}
                                        onChange={(e) => setSerieIn(e.target.value)}
                                        className="mt-0.5 block w-20 rounded border border-sky-300 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                        placeholder="1"
                                    />
                                </label>
                            </div>
                            {erroNum && (
                                <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erroNum}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                    onClick={corrigirNumero}
                                    disabled={gravandoNum || !numIn.trim()}
                                    className="text-xs rounded-md bg-sky-600 text-white px-3 py-1.5 font-semibold hover:bg-sky-700 disabled:opacity-50 btn-press whitespace-nowrap"
                                    title={!numIn.trim() ? 'Informe o número certo da nota.' : 'Corrige o número e enterra a nota antiga no mesmo ato'}
                                >
                                    {gravandoNum ? 'corrigindo…' : '✏️ Corrigir o número'}
                                </button>
                                <button
                                    onClick={() => { setAbrirNum(false); setErroNum(null); }}
                                    className="text-xs underline text-slate-500 btn-press">cancelar</button>
                            </div>
                        </div>
                    )
                )}

                {/* ═══ A NOTA FOI CANCELADA DEPOIS DA CAPTURA ════════════════
                    10/09, Paulo (JG SOLUCOES · Barueri · NFS-e 76 de R$ 15.004,06):
                    *"essas duas notas são canceladas, importei as notas pelo portal
                    nacional e as mesmas subiram como ativas … poderia existir um
                    campo para cancelarmos quando acontecer isso"*.

                    O documento veio `autorizado` porque o cancelamento aconteceu
                    DEPOIS, no portal da PREFEITURA — e o CFI não fala com aquele
                    portal. É o "dedup por EXISTÊNCIA" (02/09) num trilho municipal:
                    todo fato que nasce depois da captura é invisível para quem só
                    pergunta uma vez. E o custo é RECEITA INFLADA. */}
                {!jaRetirada && (origemDoCancelamento(d as any) === 'declarado' ? (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3">
                        <p className="text-xs font-bold text-amber-900 dark:text-amber-300">
                            🚫 Nota declarada CANCELADA
                        </p>
                        {/* 🚨 O CARIMBO: número que sai de declaração humana NÃO se
                            apresenta como lido. Sem ele, o faturamento cai e quem
                            confere procura buraco de captura. */}
                        <p className="text-[11px] text-amber-900 dark:text-amber-300 mt-1 leading-snug">
                            Ela não conta no faturamento, no Livro, no Resumo por CFOP nem no SPED.
                            {' '}O documento capturado continua dizendo <strong>{String((d as any).status || 'autorizado')}</strong> —
                            {' '}o que vale aqui é a declaração.
                            {(d as any).cancelamentoDeclarado?.porEmail && (
                                <> Declarado por <strong>{(d as any).cancelamentoDeclarado.porEmail}</strong>
                                {(d as any).cancelamentoDeclarado?.em
                                    ? <> em {dataLegivel((d as any).cancelamentoDeclarado.em)}</> : null}.</>
                            )}
                            {(d as any).cancelamentoDeclarado?.motivo && (
                                <> Motivo: <em>{(d as any).cancelamentoDeclarado.motivo}</em></>
                            )}
                        </p>
                        {erroCancel && (
                            <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erroCancel}</p>
                        )}
                        {/* O ↩ nasce junto do botão que tira do total (14/08). */}
                        <button
                            onClick={desfazerCancelada}
                            disabled={gravandoCancel}
                            className="mt-2 text-xs underline text-amber-800 dark:text-amber-300 disabled:opacity-50 btn-press"
                            title="Remove a declaração: a nota volta a valer pelo que o próprio documento diz."
                        >
                            {gravandoCancel ? 'removendo…' : '↩ remover a declaração (a nota volta ao livro)'}
                        </button>
                    </div>
                ) : origemDoCancelamento(d as any) === 'documento' ? null : !abrirCancel ? (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setAbrirCancel(true)}
                            className="text-xs rounded-md border border-amber-400 text-amber-800 dark:text-amber-300 px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 btn-press whitespace-nowrap"
                            title="Para a nota que foi cancelada no portal do município DEPOIS de o app capturá-la."
                        >
                            🚫 Esta nota está CANCELADA
                        </button>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                            O documento capturado diz <strong>{String((d as any).status || 'autorizado')}</strong>. Use isto quando
                            a nota foi cancelada <strong>no portal do município</strong> depois da captura — o app não fala
                            com aquele portal e não tem como saber sozinho.
                        </p>
                    </div>
                ) : (
                    <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3">
                        <p className="text-xs font-bold text-amber-900 dark:text-amber-300">
                            Declarar a nota {d.numero} como CANCELADA
                        </p>
                        {/* 🚨 A CONSEQUÊNCIA VAI ANTES DO CLIQUE: marcar como
                            cancelada uma nota VÁLIDA apaga receita do livro, e esse
                            é o lado caro do erro (02/09). */}
                        <p className="text-[11px] text-amber-900 dark:text-amber-300 mt-1 leading-snug">
                            Ela sai do faturamento, do Livro, do Resumo por CFOP, da competência e do SPED.
                            {' '}<strong>Marcar como cancelada uma nota que vale apaga receita do livro</strong> — confira
                            o carimbo de cancelada no papel antes. O documento <strong>não é apagado</strong> e o
                            status capturado <strong>não é reescrito</strong>: fica registrado quem declarou e por quê,
                            e dá para voltar atrás.
                        </p>
                        <textarea
                            value={motivoCancel}
                            onChange={(e) => setMotivoCancel(e.target.value)}
                            rows={2}
                            placeholder='Onde está a prova? Ex.: "cancelada no portal de Barueri, PDF com carimbo CANCELADA"'
                            className="mt-2 w-full rounded border border-amber-300 bg-white dark:bg-slate-800 p-2 text-xs"
                        />
                        <p className="text-[10px] text-amber-800 dark:text-amber-400 mt-0.5">
                            {motivoCancel.trim().length}/{MIN_MOTIVO_CANCELAMENTO} caracteres — daqui a um mês
                            ninguém lembra por que esta nota saiu do faturamento.
                        </p>
                        {erroCancel && (
                            <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">{erroCancel}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                                onClick={declararCancelada}
                                disabled={gravandoCancel || motivoCancel.trim().length < MIN_MOTIVO_CANCELAMENTO}
                                className="text-xs rounded-md bg-amber-700 text-white px-3 py-1.5 font-bold disabled:opacity-50 btn-press whitespace-nowrap"
                                title={motivoCancel.trim().length < MIN_MOTIVO_CANCELAMENTO
                                    ? `Escreva o motivo (mínimo ${MIN_MOTIVO_CANCELAMENTO} caracteres).`
                                    : 'Grava a declaração com o seu nome e a data.'}
                            >
                                {gravandoCancel ? 'gravando…' : '🚫 Declarar cancelada'}
                            </button>
                            <button
                                onClick={() => { setAbrirCancel(false); setErroCancel(null); }}
                                className="text-xs underline text-slate-500 btn-press">cancelar</button>
                        </div>
                    </div>
                ))}

                {/* ═══ A NOTA ENTROU NA EMPRESA ERRADA ═══════════════════════
                    03/09, Paulo: *"lancei uma nota da J.P. PISSATO na empresa
                    SILVIO FREIRE … como resolver?"* — e não tinha como. A nota
                    INFLA o livro de quem não a tomou e SOME do livro de quem
                    tomou, sem nenhum validador acusar: o documento é legítimo
                    e o cadastro das duas empresas está certo. */}
                {jaCorrigida ? (
                    <div className="mt-3 rounded-md border border-slate-300 bg-slate-100 dark:bg-slate-700/50 p-3">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">✏️ Nota corrigida</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{jaCorrigida}</p>
                    </div>
                ) : jaRetirada ? (
                    <div className="mt-3 rounded-md border border-slate-300 bg-slate-100 dark:bg-slate-700/50 p-3">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">🚫 Nota tirada desta empresa</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{jaRetirada}</p>
                    </div>
                ) : !abrirRetirada ? (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setAbrirRetirada(true)}
                            className="text-xs rounded-md border border-red-300 text-red-700 dark:text-red-300 px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 btn-press whitespace-nowrap"
                            title="Para a nota que entrou na empresa errada — ou que foi lançada errada e já existe a certa. Ela sai do livro DESTA empresa; o documento não é apagado."
                        >
                            🚫 Tirar esta nota do livro
                        </button>
                        {/* 🚨 O RÓTULO ANTIGO ERA "Esta nota não é desta empresa"
                            — e ele NOMEAVA UMA CAUSA SÓ. Quem tinha lançado a nota
                            certa da empresa CERTA com o número errado lia aquilo e
                            concluía, com razão, que o botão não servia: a saída
                            existia, funcionava, e o nome dela dizia o contrário
                            (o achado 18, 21/08). As duas causas vão DITAS. */}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                            Para a nota que <strong>não é desta empresa</strong> — ou que foi lançada errada e a
                            certa já está no livro (duplicata).
                        </p>
                    </div>
                ) : (
                    <div className="mt-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 p-3">
                        <p className="text-xs font-bold text-red-800 dark:text-red-300">
                            Tirar a nota {d.numero} de {d.empresaNome || 'esta empresa'}
                        </p>
                        {/* 🚨 A LINHA QUE IMPEDE O LIVRO A MENOS: tirar daqui NÃO
                            põe na empresa certa. Sem isto, quem tira acha que
                            resolveu e a nota fica faltando nas DUAS. */}
                        <p className="text-[11px] text-red-800 dark:text-red-300 mt-1 leading-snug">
                            Ela sai do livro desta empresa (lista, competência, Livro de Serviços e SPED).
                            <strong> Isto NÃO a move para a empresa certa</strong> — importe-a lá depois, senão
                            ela fica faltando nas duas. O documento <strong>não é apagado</strong>: fica
                            registrado com o motivo e com quem tirou, e dá para voltar atrás.
                        </p>
                        <textarea
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={2}
                            placeholder='Por que ela sai daqui? Ex.: "nota é da J.P. PISSATO, importada aqui por engano"'
                            className="mt-2 w-full rounded border border-red-300 bg-white dark:bg-slate-800 p-2 text-xs"
                        />
                        <p className="text-[10px] text-red-700 dark:text-red-400 mt-0.5">
                            {motivo.trim().length}/{MIN_MOTIVO_RETIRADA} caracteres — daqui a um mês ninguém
                            lembra por que a nota saiu.
                        </p>
                        {erroRetirada && (
                            <p className="mt-2 text-[11px] font-semibold text-red-800 dark:text-red-300">{erroRetirada}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                                onClick={tirar}
                                disabled={tirando || motivo.trim().length < MIN_MOTIVO_RETIRADA}
                                className="text-xs rounded-md bg-red-600 text-white px-3 py-1.5 font-semibold hover:bg-red-700 disabled:opacity-50 btn-press whitespace-nowrap"
                                title={motivo.trim().length < MIN_MOTIVO_RETIRADA
                                    ? `Escreva o motivo (mínimo ${MIN_MOTIVO_RETIRADA} caracteres)`
                                    : 'Tira a nota do livro desta empresa'}
                            >
                                {tirando ? 'Tirando…' : 'Confirmar — tirar do livro desta empresa'}
                            </button>
                            <button
                                onClick={() => { setAbrirRetirada(false); setErroRetirada(null); }}
                                className="text-xs rounded-md border border-slate-300 px-3 py-1.5 btn-press whitespace-nowrap"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default XmlDocumentoDetalhe;
