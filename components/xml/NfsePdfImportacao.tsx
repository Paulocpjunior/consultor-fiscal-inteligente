import React, { useState, useEffect, useRef } from 'react';
import { getApp } from 'firebase/app';
import { ref as storageRef, uploadBytes, getDownloadURL, getStorage } from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../services/firebaseConfig';
import { getEmpresasDisponiveis } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';
import { parseNfsePdf, matchNfseEmpresa, NfsePdfParseError } from '../../services/nfsePdfParserService';
import { recorteDaNfsePdf, idDaNfsePdf } from '../../services/nfsePdfRecorte';
// "Este PDF é MESMO da empresa escolhida?" — reconferido no SALVAR, porque os
// campos de prestador/tomador desta tela são editáveis depois do drop.
import { conferirPosseDaNfsePdf } from '../../services/nfsePdfPosse';
import type { NfsePdfParsed } from '../../services/nfsePdfParserService';
import type { User } from '../../types';

type EmpresaXmlOption = {
    id: string;
    nome: string;
    cnpj: string;
    fonte: 'simples' | 'lucro';
    createdBy?: string;
};

const storage = (() => { try { return getStorage(getApp()); } catch { return null as any; } })();

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

const fmtBRL = (v: number): string =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const NfsePdfImportacao: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    // A EMPRESA É A ATIVA DA SESSÃO — este painel não pergunta de novo.
    //
    // Paulo, 15/08: *"tira os seletores internos"*. Dava para ativar a empresa
    // A no cabeçalho e escolher a B aqui dentro, sem a tela denunciar nada:
    // dois lugares decidindo em qual CLIENTE o trabalho ia cair.
    const empresaId = useEmpresaAtivaId();
    const [file, setFile] = useState<File | null>(null);
    const [parsed, setParsed] = useState<NfsePdfParsed | null>(null);
    const [direcao, setDirecao] = useState<'entrada' | 'saida'>('entrada');
    // ⚠️ A direção saiu da POSIÇÃO no texto, não de um campo nomeado pelo
    // documento: ela é palpite, e a tela pede confirmação em vez de afirmar.
    const [direcaoDerivada, setDirecaoDerivada] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!currentUser) return;
        getEmpresasDisponiveis(currentUser)
            .then(list => setEmpresas(list as EmpresaXmlOption[]))
            .catch(() => setEmpresas([]));
    }, [currentUser]);

    const empresaSelecionada = empresas.find(e => e.id === empresaId) || null;

    const processarArquivo = async (f: File) => {
        setError(null);
        setParsed(null);
        if (!empresaSelecionada) {
            setError('Selecione a empresa antes de arrastar o PDF.');
            return;
        }
        if (!f.name.toLowerCase().endsWith('.pdf')) {
            setError(`${f.name}: somente arquivos PDF.`);
            return;
        }
        setFile(f);
        setLoading(true);
        try {
            const result = await parseNfsePdf(f);
            const match = matchNfseEmpresa(result, empresaSelecionada.cnpj);
            if (!match.ok) throw new Error(match.motivo || 'CNPJ nao bate com a empresa.');
            setDirecao(match.direcao);
            setDirecaoDerivada(Boolean(match.derivada));
            setParsed(result);
        } catch (err: any) {
            const msg = err instanceof NfsePdfParseError ? err.message : (err?.message || 'Erro ao extrair PDF.');
            setError(msg);
            setFile(null);
        } finally {
            setLoading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) processarArquivo(e.dataTransfer.files[0]);
    };

    const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) processarArquivo(e.target.files[0]);
        if (inputRef.current) inputRef.current.value = '';
    };

    const updateField = (key: keyof NfsePdfParsed, value: any) => {
        setParsed(p => p ? ({ ...p, [key]: value } as NfsePdfParsed) : p);
    };

    const updateNumber = (key: keyof NfsePdfParsed, raw: string) => {
        const n = parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
        updateField(key, n);
    };

    const handleSalvar = async () => {
        if (!parsed || !file || !empresaSelecionada || !currentUser) return;
        if (!auth?.currentUser?.uid) { setError('Sessao expirada. Faca login novamente.'); return; }
        if (!db || !storage) { setError('Firebase nao configurado.'); return; }

        setSaving(true);
        setError(null);
        try {
            const uid = auth.currentUser.uid;
            // 🚨 A COMPETÊNCIA E A DATA SAEM DO DONO, nunca do texto do PDF.
            // O papel escreve `08/2026` ou `18/08/2026`; o banco é `AAAA-MM`, e
            // a consulta é por IGUALDADE — gravar a forma do papel põe a nota
            // no banco e fora de todo recorte de mês (caso 0257, 01/09).
            const recorte = recorteDaNfsePdf(parsed);
            if (recorte.impedimento) { setError(recorte.impedimento); setSaving(false); return; }

            // 🚨 A CONFERÊNCIA DE POSSE SE REFAZ NO SALVAR (03/09, Paulo:
            // *"lancei uma nota da J.P. PISSATO na empresa SILVIO FREIRE, e o
            // consultor não deu nenhum erro"*). O `matchNfseEmpresa` roda no
            // DROP — e os campos de prestador e tomador desta tela são
            // EDITÁVEIS depois dele: entre a conferência e a gravação o CNPJ
            // pode ter virado outro, e nada reconferia. Conferência que roda
            // antes da edição não protege o que foi editado.
            //
            // ⚠️ E ela usa a RAIZ, não o CNPJ inteiro: matriz e filial são a
            // mesma empresa em todo o resto do app (a régua do certificado e a
            // do lote de XML). Nota da filial com a matriz ativa é legítima.
            const posse = conferirPosseDaNfsePdf({
                prestadorCnpj: parsed.prestador.cnpj,
                prestadorNome: parsed.prestador.nome,
                tomadorCnpj: parsed.tomador.cnpj,
                tomadorNome: parsed.tomador.nome,
                empresaCnpj: empresaSelecionada.cnpj,
                empresaNome: empresaSelecionada.nome,
                empresas,
            });
            if (posse.bloquear) { setError(posse.mensagem); setSaving(false); return; }

            const docId = idDaNfsePdf({
                chaveAcesso: parsed.chaveAcesso,
                empresaId: empresaSelecionada.id,
                numero: parsed.numero,
                serie: parsed.serie,
            });
            const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `nfse_pdfs/${empresaSelecionada.id}/${docId}_${safeFileName}`;

            const sref = storageRef(storage, path);
            const uploadResult = await uploadBytes(sref, file, { contentType: 'application/pdf' });
            const url = await getDownloadURL(uploadResult.ref);

            // Campos compativeis com o schema XML (emitente/destinatario/totais.vNF/dhEmi)
            // para que XmlDocumentosList consiga renderizar NFSe lado a lado com NF-e.
            const emitenteCompat = {
                cnpjCpf: parsed.prestador.cnpj || '',
                nome: parsed.prestador.nome || '',
                ie: parsed.prestador.inscricaoMunicipal || '',
                uf: parsed.prestador.uf || '',
                municipio: parsed.prestador.municipio || '',
            };
            const destinatarioCompat = {
                cnpjCpf: parsed.tomador.cnpj || '',
                nome: parsed.tomador.nome || '',
                uf: parsed.tomador.uf || '',
                municipio: parsed.tomador.municipio || '',
            };
            const totaisCompat = {
                vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0,
                vFCPST: 0, vProd: parsed.valorServicos || 0, vFrete: 0, vSeg: 0,
                vDesc: (parsed.valorDescIncondicional || 0) + (parsed.valorDescCondicional || 0),
                vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: parsed.valorPis || 0,
                vCOFINS: parsed.valorCofins || 0, vOutro: 0, vNF: parsed.valorLiquido || 0,
            };

            const payload = {
                tipo: 'nfse',
                origem: 'manual',
                direcao,
                modelo: '',
                status: 'autorizado',
                // ⚠️ Sem `|| new Date()`: data de HOJE num documento de outro mês
                // é a nota escriturada na competência errada, e na virada do mês
                // o PVA recusa (a régua de 22/08 — campo de data não recebe
                // default). Aqui ela nunca falta: o recorte já recusou o PDF em
                // que nem a data nem a competência são legíveis.
                dhEmi: recorte.dhEmi,
                emitente: emitenteCompat,
                destinatario: destinatarioCompat,
                totais: totaisCompat,
                itens: [],
                numero: parsed.numero,
                serie: parsed.serie,
                chave: parsed.chaveAcesso,
                competencia: recorte.competencia,
                competenciaOrigem: recorte.competenciaOrigem,
                dataEmissao: parsed.dataEmissao,
                codigoVerificacao: parsed.codigoVerificacao,
                municipioPrestacao: parsed.municipioPrestacao,
                municipioEmissor: parsed.municipioEmissor,
                empresaId: empresaSelecionada.id,
                empresaCnpj: empresaSelecionada.cnpj,
                empresaNome: empresaSelecionada.nome,
                prestador: parsed.prestador,
                tomador: parsed.tomador,
                codigoServico: parsed.codigoServico,
                discriminacao: parsed.discriminacao,
                naturezaOperacao: parsed.naturezaOperacao,
                valores: {
                    servicos: parsed.valorServicos,
                    baseCalculo: parsed.baseCalculo,
                    aliquotaIss: parsed.aliquotaIss,
                    iss: parsed.valorIss,
                    issRetido: parsed.valorIssRetido,
                    pis: parsed.valorPis,
                    cofins: parsed.valorCofins,
                    inss: parsed.valorInss,
                    irrf: parsed.valorIrrf,
                    csll: parsed.valorCsll,
                    outrasRetencoes: parsed.valorOutrasRetencoes,
                    deducoes: parsed.valorDeducoes,
                    descIncondicional: parsed.valorDescIncondicional,
                    descCondicional: parsed.valorDescCondicional,
                    liquido: parsed.valorLiquido,
                },
                storagePath: path,
                storageUrl: url,
                fileName: file.name,
                tamanhoBytes: file.size,
                createdBy: uid,
                createdByEmail: currentUser.email,
                importadoEm: Date.now(),
                importadoEmServer: serverTimestamp(),
            };

            // merge:true preserva campos do cron (eventos/NSU/captura state)
            // e nao quebra createdBy original quando o doc ja existe.
            // Pra docs novos: createdBy e setado normalmente.
            // Pra docs existentes do cron: NAO sobrescreve createdBy (regra rejeitaria).
            const docRef = doc(db, 'documentos_fiscais', docId);
            const existingSnap = await getDoc(docRef);
            const payloadFinal = existingSnap.exists()
                ? { ...payload, createdBy: existingSnap.data().createdBy ?? uid }
                : payload;
            await setDoc(docRef, payloadFinal, { merge: true });

            // 📌 A COMPETÊNCIA VAI NA FRASE porque é ela que decide ONDE a nota
            // aparece. "Importada com sucesso" sobre uma nota que não entra em
            // recorte nenhum foi exatamente o relato de 01/09 — o app afirmava
            // a gravação e a lista negava a nota.
            const mes = String(recorte.competencia || '').split('-').reverse().join('/');
            onShowToast?.(`NFSe ${parsed.numero}/${parsed.serie} importada em ${mes}`
                + ` — procure em XMLs (Entrada/Saída) com a competência ${mes}.`);
            setParsed(null);
            setFile(null);
            onImported?.();
        } catch (err: any) {
            console.error('Erro ao salvar NFSe:', err);
            setError(err?.message || 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => { setParsed(null); setFile(null); setError(null); };

    if (!currentUser) {
        return <p className="text-center text-xs text-slate-400 py-6">Faca login para importar NFSe.</p>;
    }

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Empresa para a qual a NFSe sera atribuida
                </label>
                {empresas.length === 0 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Nenhuma empresa disponivel. Cadastre uma em Simples Nacional ou Lucro Presumido/Real antes.
                    </p>
                ) : (
                    <EmpresaAtivaFixa />
                )}
                {empresaSelecionada && (
                    <p className="text-[11px] text-slate-400 mt-1">
                        Apenas NFSe em que <code>{empresaSelecionada.cnpj}</code> aparece como prestador ou tomador serao aceitas.
                    </p>
                )}
            </div>

            {!parsed && (
                <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-emerald-400'}`}
                >
                    <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={handleSelect} className="hidden" />
                    <svg className="w-12 h-12 mx-auto mb-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    {loading ? (
                        <p className="text-sm text-emerald-600 font-bold">Extraindo PDF...</p>
                    ) : (
                        <>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Arraste o PDF da NFSe aqui ou clique para selecionar</p>
                            <p className="text-xs text-slate-400 mt-1">Apenas PDFs gerados por sistema (com texto). PDFs digitalizados nao funcionam.</p>
                        </>
                    )}
                </div>
            )}

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{error}</p>
                </div>
            )}

            {parsed && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                        <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                            Validar dados extraidos - NFSe {parsed.numero}/{parsed.serie}
                        </h3>
                        {/* 🚨 PALPITE NÃO SE APRESENTA COMO FATO (02/09, RADIO E TV
                            SUL AMERICANA): o PDF veio com prestador e tomador VAZIOS
                            e o app afirmou "ENTRADA (somos tomador)" numa nota em que
                            a empresa é a PRESTADORA. A direção decide em QUAL LIVRO a
                            nota entra — quando ela foi DERIVADA (posição no texto, e
                            não um campo que o documento nomeia), quem confirma é a
                            pessoa, e o selo vira uma ESCOLHA. */}
                        {direcaoDerivada ? (
                            <select
                                value={direcao}
                                onChange={e => setDirecao(e.target.value as 'entrada' | 'saida')}
                                className="text-xs font-bold px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-400"
                                title="O PDF não nomeia o prestador e o tomador neste leiaute — o app deduziu pela posição no texto. Confirme antes de salvar."
                            >
                                <option value="saida">⚠ confirme: SAIDA (somos prestador)</option>
                                <option value="entrada">⚠ confirme: ENTRADA (somos tomador)</option>
                            </select>
                        ) : (
                            <span className={`text-xs font-bold px-2 py-1 rounded ${direcao === 'saida' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'}`}>
                                {direcao === 'saida' ? 'SAIDA (somos prestador)' : 'ENTRADA (somos tomador)'}
                            </span>
                        )}
                    </div>

                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Cabecalho</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Field label="Numero" value={parsed.numero} onChange={v => updateField('numero', v)} />
                            <Field label="Serie" value={parsed.serie} onChange={v => updateField('serie', v)} />
                            <Field label="Competencia" value={parsed.competencia} onChange={v => updateField('competencia', v)} />
                            <Field label="Data emissao" value={parsed.dataEmissao} onChange={v => updateField('dataEmissao', v)} />
                            <Field label="Cod. verificacao" value={parsed.codigoVerificacao} onChange={v => updateField('codigoVerificacao', v)} />
                            <Field label="Municipio prestacao" value={parsed.municipioPrestacao} onChange={v => updateField('municipioPrestacao', v)} />
                            <Field label="Cod. servico" value={parsed.codigoServico} onChange={v => updateField('codigoServico', v)} />
                            <Field label="Chave nacional" value={parsed.chaveAcesso} onChange={v => updateField('chaveAcesso', v)} />
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Prestador</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            <Field label="CNPJ" value={parsed.prestador.cnpj} onChange={v => updateField('prestador', { ...parsed.prestador, cnpj: v })} />
                            <Field label="Nome" value={parsed.prestador.nome} fullCol onChange={v => updateField('prestador', { ...parsed.prestador, nome: v })} />
                            <Field label="Insc. Municipal" value={parsed.prestador.inscricaoMunicipal} onChange={v => updateField('prestador', { ...parsed.prestador, inscricaoMunicipal: v })} />
                            <Field label="Municipio" value={parsed.prestador.municipio} onChange={v => updateField('prestador', { ...parsed.prestador, municipio: v })} />
                            <Field label="UF" value={parsed.prestador.uf} onChange={v => updateField('prestador', { ...parsed.prestador, uf: v })} />
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Tomador</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            <Field label="CNPJ/CPF" value={parsed.tomador.cnpj} onChange={v => updateField('tomador', { ...parsed.tomador, cnpj: v })} />
                            <Field label="Nome" value={parsed.tomador.nome} fullCol onChange={v => updateField('tomador', { ...parsed.tomador, nome: v })} />
                            <Field label="Municipio" value={parsed.tomador.municipio} onChange={v => updateField('tomador', { ...parsed.tomador, municipio: v })} />
                            <Field label="UF" value={parsed.tomador.uf} onChange={v => updateField('tomador', { ...parsed.tomador, uf: v })} />
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Discriminacao</p>
                        <textarea value={parsed.discriminacao} onChange={e => updateField('discriminacao', e.target.value)} rows={3} className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1" />
                    </div>

                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Valores (R$)</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <NumField label="Valor servicos" value={parsed.valorServicos} onChange={v => updateNumber('valorServicos', v)} />
                            <NumField label="Base de calculo" value={parsed.baseCalculo} onChange={v => updateNumber('baseCalculo', v)} />
                            <NumField label="Aliquota ISS (%)" value={parsed.aliquotaIss} onChange={v => updateNumber('aliquotaIss', v)} />
                            <NumField label="Valor ISS" value={parsed.valorIss} onChange={v => updateNumber('valorIss', v)} />
                            <NumField label="ISS retido" value={parsed.valorIssRetido} onChange={v => updateNumber('valorIssRetido', v)} />
                            <NumField label="PIS" value={parsed.valorPis} onChange={v => updateNumber('valorPis', v)} />
                            <NumField label="COFINS" value={parsed.valorCofins} onChange={v => updateNumber('valorCofins', v)} />
                            <NumField label="INSS" value={parsed.valorInss} onChange={v => updateNumber('valorInss', v)} />
                            <NumField label="IRRF" value={parsed.valorIrrf} onChange={v => updateNumber('valorIrrf', v)} />
                            <NumField label="CSLL" value={parsed.valorCsll} onChange={v => updateNumber('valorCsll', v)} />
                            <NumField label="Outras retencoes" value={parsed.valorOutrasRetencoes} onChange={v => updateNumber('valorOutrasRetencoes', v)} />
                            <NumField label="Deducoes" value={parsed.valorDeducoes} onChange={v => updateNumber('valorDeducoes', v)} />
                            <NumField label="Desc. incond." value={parsed.valorDescIncondicional} onChange={v => updateNumber('valorDescIncondicional', v)} />
                            <NumField label="Desc. cond." value={parsed.valorDescCondicional} onChange={v => updateNumber('valorDescCondicional', v)} />
                            <NumField label="Valor liquido" value={parsed.valorLiquido} onChange={v => updateNumber('valorLiquido', v)} highlight />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                        <p className="text-xs text-slate-500">Arquivo: <code>{file?.name}</code> ({((file?.size || 0) / 1024).toFixed(1)} KB)</p>
                        <div className="flex gap-2">
                            <button onClick={handleCancel} disabled={saving} className="text-xs px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
                            <button onClick={handleSalvar} disabled={saving} className="text-xs px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50">
                                {saving ? 'Salvando...' : `Confirmar e salvar (${fmtBRL(parsed.valorLiquido)})`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface FieldProps { label: string; value: string; onChange: (v: string) => void; fullCol?: boolean; }
const Field: React.FC<FieldProps> = ({ label, value, onChange, fullCol }) => (
    <div className={fullCol ? 'col-span-2' : ''}>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</label>
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1" />
    </div>
);

interface NumFieldProps { label: string; value: number; onChange: (v: string) => void; highlight?: boolean; }
const NumField: React.FC<NumFieldProps> = ({ label, value, onChange, highlight }) => (
    <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</label>
        <input type="text" value={value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} onChange={e => onChange(e.target.value)} className={`w-full text-xs text-right border rounded-md px-2 py-1 ${highlight ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 font-bold' : 'bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600'}`} />
    </div>
);

export default NfsePdfImportacao;
