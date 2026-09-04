/**
 * NotaDigitadaForm — a TERCEIRA porta de entrada de documento.
 *
 * Paulo, 15/08: *"importação de XML — automática ou manual — tem a mesma
 * finalidade: abastecer o sistema de lançamentos. Até mesmo o lançamento de
 * uma nota de forma manual, devemos poder fazer."*
 *
 * Grava em `documentos_fiscais`, na MESMA forma do importer — todo leitor que
 * já existe (livros, DIPAM, SPED, relatórios) enxerga a nota sem código novo.
 * A régua que manda: **XML vence digitação** — se o XML da mesma chave chegar
 * depois, ele substitui o lançamento; e uma digitada nunca sobrescreve um
 * documento que tem XML.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../services/firebaseConfig';
import {
    validarNotaDigitada, montarNotaDigitada, idNotaDigitada, podeGravarSobre,
    type ItemDigitado, type ServicoDigitado, type TransporteDigitado,
} from '../../services/notaDigitada';
import { ecoDaRetencaoDigitada } from '../../services/retencaoFederalDigitada';
import { lerParametrosRetencao } from '../../services/retencaoParametroService';
import { sugerirRetencoes, explicarSugestao } from '../../sefaz-backend/retencao-parametros.js';
import { parseValorMoeda, ecoDoValorDigitado } from '../../services/valorDigitado';
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../EmpresaAtivaFixa';
import type { User } from '../../types';
import { getAuth } from 'firebase/auth';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

/**
 * 🚨 O ITEM COMO ELE VIVE NA TELA — o valor é TEXTO, nunca número.
 *
 * Campo de dinheiro ligado a `String(número)` re-formata a cada tecla e COME a
 * vírgula: "1234,50" vira 123450 tecla a tecla, sem nenhum erro aparecer. É o
 * caso APATEL (21/08), que saiu num documento assinado — e estava vivo aqui,
 * numa porta que grava DOCUMENTO FISCAL. O número é derivado na gravação.
 */
type ItemNaTela = Omit<ItemDigitado, 'vProd'> & { vProdTexto: string };

const itemVazio = (): ItemNaTela => ({ cfop: '', vProdTexto: '' });

const NotaDigitadaForm: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const { empresa } = useEmpresaAtiva();
    // DUAS ESPÉCIES porque são dois documentos: serviço não tem CFOP nem NCM,
    // e forçar tudo num formulário só faria a pessoa inventar um CFOP para
    // conseguir salvar — CFOP inventado entra no livro.
    const [especie, setEspecie] = useState<'mercadoria' | 'servico' | 'transporte'>('mercadoria');
    const [servico, setServico] = useState<ServicoDigitado>({ discriminacao: '' });
    // CT-e / CT-e OS: o MODELO é escolha da pessoa (57 e 67 são documentos
    // diferentes com a mesma cara no papel) e decide o bloco do SPED.
    const [transporte, setTransporte] = useState<TransporteDigitado>({ modelo: '67', cfop: '' });
    const [vBcTexto, setVBcTexto] = useState('');
    const [aliqIcmsTexto, setAliqIcmsTexto] = useState('');
    const [vIcmsTexto, setVIcmsTexto] = useState('');
    // Retenção federal — vale para as TRÊS espécies. Texto, nunca número: o
    // round-trip do campo controlado come a vírgula (caso APATEL).
    const [ret, setRet] = useState<Record<'ir' | 'inss' | 'csll' | 'pis' | 'cofins', string>>(
        { ir: '', inss: '', csll: '', pis: '', cofins: '' },
    );
    const [parametros, setParametros] = useState<any[]>([]);
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    const [numero, setNumero] = useState('');
    const [serie, setSerie] = useState('1');
    const [dhEmi, setDhEmi] = useState('');
    const [chave, setChave] = useState('');
    const [participanteNome, setParticipanteNome] = useState('');
    const [participanteDoc, setParticipanteDoc] = useState('');
    const [participanteUf, setParticipanteUf] = useState('');
    const [valorTotal, setValorTotal] = useState('');
    // Alíquota e ISS também são rascunho de TEXTO — o campo de % sofria o mesmo
    // round-trip: "2,5" virava 25.
    const [aliquotaTexto, setAliquotaTexto] = useState('');
    const [valorIssTexto, setValorIssTexto] = useState('');
    const [itens, setItens] = useState<ItemNaTela[]>([itemVazio()]);
    const [erros, setErros] = useState<string[]>([]);
    const [salvando, setSalvando] = useState(false);
    const [salva, setSalva] = useState<string | null>(null);

    // 🚨 OS HOOKS VÊM ANTES DO EARLY RETURN. Hook depois de um `return`
    // condicional é hook CONDICIONAL, e o React derruba a tela inteira com
    // "Rendered more hooks than during the previous render" (29/08).
    const empresaId = empresa?.id || '';
    useEffect(() => {
        let vivo = true;
        lerParametrosRetencao(empresaId).then(p => { if (vivo) setParametros(p); });
        return () => { vivo = false; };
    }, [empresaId]);

    /**
     * A SUGESTÃO do parâmetro daquele prestador, na competência da nota.
     *
     * ⚠️ Ela é MOSTRADA, nunca aplicada sozinha — no caso medido a conta dá
     * 39,01 e o documento diz 39,02. Quem manda é o papel.
     */
    const sugestoes = useMemo(() => sugerirRetencoes(parametros, {
        cnpjPrestador: direcao === 'entrada' ? participanteDoc : (empresa?.cnpj || ''),
        competencia: String(dhEmi || '').slice(0, 7),
        base: parseValorMoeda(valorTotal),
    }), [parametros, direcao, participanteDoc, empresa?.cnpj, dhEmi, valorTotal]);

    if (!empresa) return <EmpresaAtivaFixa rotulo="Lançar nota" />;

    const setItem = (idx: number, patch: Partial<ItemNaTela>) =>
        setItens(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

    /**
     * O que a pessoa digitou e o app NÃO entendeu. Ilegível vira RECUSA com o
     * campo nomeado — nunca zero, nunca `parseFloat(...) || 0`: num campo que
     * alimenta livro, SPED e DIPAM, o zero de conveniência é a nota entrando a
     * menor sem nada acusar.
     */
    const ilegiveis = (): string[] => {
        const fora: string[] = [];
        const conferir = (rotulo: string, texto: string) => {
            if (String(texto || '').trim() && parseValorMoeda(texto) === null) {
                fora.push(`${rotulo}: não entendi "${texto}". Use o formato 1234,56 (ou deixe vazio).`);
            }
        };
        conferir(especie === 'servico' ? 'Valor dos serviços'
            : especie === 'transporte' ? 'Valor da prestação' : 'Valor total da nota', valorTotal);
        if (especie === 'servico') {
            conferir('Alíquota do ISS', aliquotaTexto);
            conferir('ISS devido', valorIssTexto);
        } else if (especie === 'transporte') {
            conferir('Base de cálculo do ICMS', vBcTexto);
            conferir('Alíquota do ICMS', aliqIcmsTexto);
            conferir('ICMS destacado', vIcmsTexto);
        } else {
            itens.forEach((it, idx) => conferir(`Item ${idx + 1} — valor`, it.vProdTexto));
        }
        // A retenção passa pelo MESMO conferidor: ilegível é recusa com o campo
        // nomeado, nunca zero — zero aqui AFIRMA que não houve retenção.
        (Object.keys(ret) as Array<keyof typeof ret>).forEach(k => conferir(`${k.toUpperCase()} retido`, ret[k]));
        return fora;
    };

    const salvar = async () => {
        setErros([]); setSalva(null);
        const naoEntendidos = ilegiveis();
        if (naoEntendidos.length) { setErros(naoEntendidos); return; }
        const input = {
            especie,
            servico: {
                ...servico,
                aliquota: parseValorMoeda(aliquotaTexto),
                valorIss: parseValorMoeda(valorIssTexto),
            },
            transporte: {
                ...transporte,
                vBC: parseValorMoeda(vBcTexto),
                aliqIcms: parseValorMoeda(aliqIcmsTexto),
                vICMS: parseValorMoeda(vIcmsTexto),
            },
            // Texto cru: quem decide o que é ausência e o que é zero é o dono
            // (`camposDaRetencaoDigitada`), e ele deixa o ausente FORA do
            // objeto — `undefined` viraria `null`, que o relatório lê como 0,00.
            retencao: ret,
            empresaId: empresa.id,
            empresaCnpj: empresa.cnpj,
            empresaNome: empresa.nome,
            direcao, numero, serie, dhEmi, chave,
            participanteNome, participanteDoc, participanteUf,
            valorTotal: parseValorMoeda(valorTotal),
            itens: itens.map(({ vProdTexto, ...resto }) => ({ ...resto, vProd: parseValorMoeda(vProdTexto) })),
            digitadaPorEmail: currentUser.email || '',
            // Sem o UID o Firestore RECUSA a criação — a regra de
            // `documentos_fiscais` exige createdBy == auth.uid no CREATE, e não
            // há escape nem para admin. Era o "Missing or insufficient
            // permissions" de 17/08.
            createdByUid: getAuth().currentUser?.uid || '',
        };
        const v = validarNotaDigitada(input as any);
        if (v.length) { setErros(v); return; }
        if (!isFirebaseConfigured || !db) { setErros(['Sem conexão com o banco.']); return; }
        setSalvando(true);
        try {
            const id = idNotaDigitada(input as any);
            const ref = doc(db, 'documentos_fiscais', id);
            const atual = await getDoc(ref);
            // XML VENCE DIGITAÇÃO: digitada não sobrescreve doc com XML — e a
            // recusa DIZ o estado e a saída, nunca só "já existe".
            const pode = podeGravarSobre(atual.exists() ? (atual.data() as any) : null);
            if (!pode.ok) { setErros([pode.motivo!]); return; }
            const regravando = atual.exists();
            await setDoc(ref, JSON.parse(JSON.stringify(montarNotaDigitada(input as any))));
            setSalva(regravando
                ? `Nota nº ${numero} REGRAVADA (corrigiu a digitação anterior).`
                : `Nota nº ${numero} lançada. Ela já conta em livros, DIPAM e relatórios — e se o XML chegar depois, ele assume o lugar.`);
            onShowToast?.(`Nota nº ${numero} ${regravando ? 'regravada' : 'lançada'} para ${empresa.nome}.`);
            onImported?.();
            setNumero(''); setChave(''); setValorTotal(''); setItens([itemVazio()]);
            setParticipanteNome(''); setParticipanteDoc(''); setParticipanteUf('');
            setServico({ discriminacao: '' }); setAliquotaTexto(''); setValorIssTexto('');
            setTransporte(t => ({ modelo: t.modelo, cfop: '' }));
            setVBcTexto(''); setAliqIcmsTexto(''); setVIcmsTexto('');
            setRet({ ir: '', inss: '', csll: '', pis: '', cofins: '' });
        } catch (e: any) {
            setErros([`Falha ao gravar: ${e?.message || 'erro desconhecido'}.`]);
        } finally {
            setSalvando(false);
        }
    };

    const campo = 'w-full p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600';
    const rotulo = 'text-[10px] uppercase font-bold block mb-1 text-slate-500 dark:text-slate-400';

    /**
     * O que o app ENTENDEU, ao lado do campo — a outra metade da correção do
     * APATEL. Aqui vale dobrado: o que se digita nesta tela vira DOCUMENTO
     * FISCAL, e a interpretação tem de ser visível antes de gravar.
     */
    const Eco: React.FC<{ texto: string; sufixo?: string }> = ({ texto, sufixo }) => {
        const eco = ecoDoValorDigitado(texto);
        if (!eco) return null;
        return (
            <p className={`text-[10px] mt-0.5 ${eco.ok ? 'text-slate-500 dark:text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
                {eco.ok ? `${eco.texto}${sufixo || ''}` : `⚠ ${eco.texto}`}
            </p>
        );
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">✍️ Lançar nota sem XML</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Mesmo trilho da importação: a nota entra em <strong>documentos fiscais</strong> e conta em livros,
                    DIPAM, SPED e relatórios. Fica carimbada como <strong>digitada</strong> com o seu nome — e se o XML
                    for capturado depois (informe a chave, se tiver), <strong>ele substitui o lançamento</strong>.
                </p>
            </div>

            <EmpresaAtivaFixa rotulo="Lançando na empresa" semTrocar />

            {/* flex-wrap: três botões numa fileira sem wrap transbordam a
                viewport e empurram o cabeçalho (a lição de 13/08). */}
            <div className="flex flex-wrap gap-2">
                {(['mercadoria', 'servico', 'transporte'] as const).map(e => (
                    <button key={e} onClick={() => setEspecie(e)}
                        className={`btn-press px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap ${especie === e
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                        {e === 'mercadoria' ? '📦 Mercadoria (NF-e)'
                            : e === 'servico' ? '🧰 Serviço (NFS-e)'
                                : '🚚 Transporte (CT-e / CT-e OS)'}
                    </button>
                ))}
            </div>

            {especie === 'transporte' && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                    O CT-e OS (modelo 67) <strong>não é NF-e nem NFS-e</strong>: ele vai ao <strong>bloco D</strong> do
                    SPED e tem <strong>ICMS destacado</strong>. Lançá-lo como serviço o mandaria para o bloco A e faria
                    o ICMS sumir da apuração. Use esta espécie quando o cliente só manda o <strong>PDF do DACTE-OS</strong>.
                </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                    <label className={rotulo}>Direção</label>
                    <select value={direcao} onChange={e => setDirecao(e.target.value as any)} className={campo}>
                        <option value="entrada">{especie === 'servico' ? 'Entrada (serviço tomado)'
                            : especie === 'transporte' ? 'Entrada (frete contratado)' : 'Entrada (compra)'}</option>
                        <option value="saida">{especie === 'servico' ? 'Saída (serviço prestado)'
                            : especie === 'transporte' ? 'Saída (frete prestado)' : 'Saída (venda)'}</option>
                    </select>
                </div>
                <div>
                    <label className={rotulo}>Número da nota</label>
                    <input value={numero} onChange={e => setNumero(e.target.value)} className={campo} placeholder="ex.: 4512" />
                </div>
                <div>
                    <label className={rotulo}>Série</label>
                    <input value={serie} onChange={e => setSerie(e.target.value)} className={campo} />
                </div>
                <div>
                    <label className={rotulo}>Data de emissão</label>
                    <input type="date" value={dhEmi} onChange={e => setDhEmi(e.target.value)} className={campo} />
                </div>
            </div>

            {especie === 'mercadoria' || especie === 'transporte' ? (
                <div>
                    <label className={rotulo}>Chave de acesso (44 dígitos — opcional, mas recomendada)</label>
                    <input value={chave} onChange={e => setChave(e.target.value)} className={`${campo} font-mono`}
                        placeholder={especie === 'transporte'
                            ? 'está impressa no DACTE, acima do código de barras'
                            : 'com a chave, o XML capturado depois cai NO MESMO documento'} />
                </div>
            ) : (
                // A NFS-e do portal NÃO tem chave de 44 dígitos, e isso é
                // NATUREZA, não falha (07/08). Ela se identifica por
                // prestador + tomador + número — os mesmos três campos que os
                // importadores usam, então a nota capturada depois substitui
                // esta sozinha.
                <p className="text-[11px] px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-800 dark:text-sky-300">
                    NFS-e não tem chave de 44 dígitos — ela se identifica por <strong>prestador + tomador + número</strong>.
                    Se a captura trouxer esta mesma nota depois, ela <strong>substitui</strong> este lançamento em vez de duplicar.
                </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label className={rotulo}>{especie === 'servico'
                        ? (direcao === 'entrada' ? 'Prestador do serviço' : 'Tomador (cliente)')
                        : especie === 'transporte'
                            ? (direcao === 'entrada' ? 'Transportador (emitente)' : 'Tomador do frete')
                            : (direcao === 'entrada' ? 'Fornecedor' : 'Cliente (destinatário)')}</label>
                    <input value={participanteNome} onChange={e => setParticipanteNome(e.target.value)} className={campo} />
                </div>
                <div>
                    <label className={rotulo}>CNPJ/CPF</label>
                    <input value={participanteDoc} onChange={e => setParticipanteDoc(e.target.value)} className={`${campo} font-mono`} />
                </div>
                <div>
                    <label className={rotulo}>UF</label>
                    <input value={participanteUf} onChange={e => setParticipanteUf(e.target.value)} className={campo} maxLength={2} placeholder="SP" />
                </div>
            </div>

            {especie === 'transporte' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <label className={rotulo}>Modelo do documento</label>
                            <select value={transporte.modelo}
                                onChange={e => setTransporte(t => ({ ...t, modelo: e.target.value as '57' | '67' }))}
                                className={campo}>
                                <option value="67">67 — CT-e OS (DACTE-OS)</option>
                                <option value="57">57 — CT-e</option>
                            </select>
                        </div>
                        <div>
                            <label className={rotulo}>CFOP da prestação</label>
                            <input value={transporte.cfop}
                                onChange={e => setTransporte(t => ({ ...t, cfop: e.target.value }))}
                                className={`${campo} font-mono`} maxLength={4} placeholder="—" />
                        </div>
                        <div className="md:col-span-2">
                            <label className={rotulo}>Descrição da prestação</label>
                            <input value={transporte.descricao || ''}
                                onChange={e => setTransporte(t => ({ ...t, descricao: e.target.value }))}
                                className={campo} placeholder="ex.: Transporte de Valores" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <label className={rotulo}>CST do ICMS</label>
                            <input value={transporte.cst || ''}
                                onChange={e => setTransporte(t => ({ ...t, cst: e.target.value }))}
                                className={`${campo} font-mono`} maxLength={3} placeholder="ex.: 00" />
                        </div>
                        <div>
                            <label className={rotulo}>Base do ICMS (R$)</label>
                            <input value={vBcTexto} onChange={e => setVBcTexto(e.target.value)}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={vBcTexto} />
                        </div>
                        <div>
                            <label className={rotulo}>Alíquota ICMS (%)</label>
                            <input value={aliqIcmsTexto} onChange={e => setAliqIcmsTexto(e.target.value)}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={aliqIcmsTexto} sufixo="%" />
                        </div>
                        <div>
                            <label className={rotulo}>ICMS destacado (R$)</label>
                            <input value={vIcmsTexto} onChange={e => setVIcmsTexto(e.target.value)}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={vIcmsTexto} />
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Na <strong>entrada</strong> se lança o CFOP da <strong>escrituração</strong>: o
                        <span className="font-mono"> 5357</span> do transportador vira
                        <span className="font-mono"> 1357</span> aqui. O ICMS <strong>não é recalculado</strong> —
                        o CT-e pode ter redução de base, e refazer a conta acusaria documento correto.
                    </p>
                </div>
            )}

            {especie === 'servico' ? (
                <div className="space-y-3">
                    <div>
                        <label className={rotulo}>Discriminação do serviço</label>
                        <input value={servico.discriminacao}
                            onChange={e => setServico(s2 => ({ ...s2, discriminacao: e.target.value }))}
                            className={campo} placeholder="o que foi prestado — é isto que aparece nos livros" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <label className={rotulo}>Código de serviço (município)</label>
                            <input value={servico.codigoServico || ''}
                                onChange={e => setServico(s2 => ({ ...s2, codigoServico: e.target.value }))}
                                className={campo} placeholder="ex.: 07498" />
                        </div>
                        <div>
                            <label className={rotulo}>Alíquota ISS (%)</label>
                            <input value={aliquotaTexto}
                                onChange={e => setAliquotaTexto(e.target.value)}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={aliquotaTexto} sufixo="%" />
                        </div>
                        <div>
                            <label className={rotulo}>ISS devido (R$)</label>
                            <input value={valorIssTexto}
                                onChange={e => setValorIssTexto(e.target.value)}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={valorIssTexto} />
                        </div>
                        <label className="flex items-center gap-2 text-xs mt-5">
                            <input type="checkbox" checked={!!servico.issRetido}
                                onChange={e => setServico(s2 => ({ ...s2, issRetido: e.target.checked }))} />
                            ISS retido pelo tomador
                        </label>
                    </div>
                    {/* AUSENTE ≠ ZERO, e aqui vale dobrado: zero digitado por
                        comodidade fabricaria pendência falsa de "inconsistente"
                        no painel 🏛️ ISS. Vazio tem causa própria e outra ação. */}
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        ⚠ Não sabe a alíquota ou o ISS? <strong>Deixe vazio.</strong> Vazio é lido como
                        “falta conferir”; zero é lido como “a nota diz que não há ISS” — são coisas
                        diferentes e levam a ações diferentes.
                    </p>
                </div>
            ) : especie === 'transporte' ? null : (
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className={rotulo}>Itens (CFOP da ESCRITURAÇÃO: {direcao === 'entrada' ? '1xxx/2xxx/3xxx' : '5xxx/6xxx/7xxx'})</label>
                    <button onClick={() => setItens(p => [...p, itemVazio()])}
                        className="text-[11px] px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                        + item
                    </button>
                </div>
                <div className="space-y-2">
                    {itens.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-2 md:grid-cols-6 gap-2">
                            <input value={it.cfop} onChange={e => setItem(idx, { cfop: e.target.value })} className={campo} placeholder="CFOP" />
                            <input value={it.ncm || ''} onChange={e => setItem(idx, { ncm: e.target.value })} className={campo} placeholder="NCM (opcional)" />
                            <input value={it.xProd || ''} onChange={e => setItem(idx, { xProd: e.target.value })} className={`${campo} md:col-span-2`} placeholder="Descrição" />
                            <div>
                                <input value={it.vProdTexto}
                                    onChange={e => setItem(idx, { vProdTexto: e.target.value })}
                                    className={campo} placeholder="Valor" />
                                <Eco texto={it.vProdTexto} />
                            </div>
                            {itens.length > 1 && (
                                <button onClick={() => setItens(p => p.filter((_, i) => i !== idx))}
                                    className="text-xs text-red-500">remover</button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* ═══ RETENÇÃO FEDERAL — vale para as TRÊS espécies ═══════════
                O CT-e OS de transporte de valores retém IRRF de 1% (art. 55 da
                Lei 7.713/1988) e não tem ISS nenhum; a NFS-e tomada tem os dois.
                Sem estes campos, `retencoesFederaisGravadas` fica false e o
                Relatório de Retenções imprime "?" numa nota que DIZ o valor
                retido no corpo — o caso da J.P. PISSATO. */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <label className={rotulo}>Retenção federal declarada no documento</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {(['ir', 'inss', 'csll', 'pis', 'cofins'] as const).map(k => (
                        <div key={k}>
                            <label className="text-[10px] font-bold block mb-1 text-slate-500 dark:text-slate-400">
                                {k === 'ir' ? 'IRRF' : k.toUpperCase()} (R$)
                            </label>
                            <input value={ret[k]} onChange={e => setRet(r => ({ ...r, [k]: e.target.value }))}
                                className={campo} placeholder="vazio ≠ zero" />
                            <Eco texto={ret[k]} />
                            {!ret[k] && !!sugestoes[k] && (
                                <p className="text-[10px] mt-0.5 text-sky-700 dark:text-sky-300">
                                    {explicarSugestao(k, sugestoes[k])}{' '}
                                    <button
                                        onClick={() => setRet(r => ({
                                            ...r,
                                            [k]: String(sugestoes[k]!.valor).replace('.', ','),
                                        }))}
                                        className="btn-press underline font-bold whitespace-nowrap">usar</button>
                                </p>
                            )}
                        </div>
                    ))}
                </div>
                {/* O eco do que VAI GRAVAR, antes do clique — a mesma régua do
                    campo de valor: quem digita precisa ver o que o app entendeu,
                    e aqui isto vira evento da EFD-Reinf. */}
                {ecoDaRetencaoDigitada(ret, parseValorMoeda(valorTotal)) ? (
                    <p className="text-[11px] mt-2 text-slate-600 dark:text-slate-300">
                        {ecoDaRetencaoDigitada(ret, parseValorMoeda(valorTotal))}
                    </p>
                ) : (
                    <p className="text-[11px] mt-2 text-amber-700 dark:text-amber-400">
                        ⚠ Nada preenchido: a nota vai sair com <strong>“?”</strong> na coluna de retenções, e não
                        com 0,00. Vazio é “falta conferir”; zero é “o documento diz que não houve retenção”.
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <div>
                    <label className={rotulo}>{especie === 'servico' ? 'Valor dos serviços'
                        : especie === 'transporte' ? 'Valor da prestação' : 'Valor total da nota'}</label>
                    <input value={valorTotal} onChange={e => setValorTotal(e.target.value)} className={campo} placeholder="0,00" />
                    <Eco texto={valorTotal} />
                </div>
                <button onClick={salvar} disabled={salvando}
                    className="btn-press px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                    {salvando ? '⏳ gravando…' : '✍️ Lançar nota'}
                </button>
            </div>

            {erros.length > 0 && (
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc ml-4">
                    {erros.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
            )}
            {salva && <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {salva}</p>}
        </div>
    );
};

export default NotaDigitadaForm;
