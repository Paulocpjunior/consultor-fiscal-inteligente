/**
 * 💸 DARF DOS RETIDOS — emitir e enviar pela conferência EFD-Reinf × DCTFWeb (03/10).
 *
 * Paulo: "fiz a captura, subi as retenções, finalizo enviando imposto pela
 * DCTFWeb; nesse conferir Reinf × DCTFWeb, igual PIS/COFINS, envio pelo sistema
 * dos DARF RETIDOS". Decisões dele: os DOIS caminhos (avulso por código E
 * numerado da DCTFWeb) e TRAVA quando o Reinf não bate — a régua mora em
 * `services/efdReinfConference.ts` (`decidirEmissaoRetidos`).
 *
 * O envio é o MESMO rito do PIS/COFINS (`enviarGuiaPeloServidor`): servidor,
 * gestor em cópia oculta, SharePoint e auditoria do que saiu.
 */
import React, { useState } from 'react';
import { decidirEmissaoRetidos, eventosNaoLidosDoLote } from '../../services/efdReinfConference';
import type { ConferenciaReinfCompleta } from '../../services/efdReinfConferenceService';
import { gerarDarf, gerarDarfsSeparados } from '../../services/dctfwebService';
import { enviarGuiaPeloServidor, mensagemEnvioServidor } from '../../services/envioImpostoService';
import { getAuth } from 'firebase/auth';
import { nomeArquivoGuia } from '../../sefaz-backend/nome-arquivo-guia.js';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : iso || '—');

interface GuiaPronta { nome: string; base64: string; vencimento: string; valor: number; codigo: string; extensao: string | null; descricao: string }

interface Props {
    data: ConferenciaReinfCompleta;
    cnpj: string;
    onShowToast?: (msg: string) => void;
}

const DarfRetidosBloco: React.FC<Props> = ({ data, cnpj, onShowToast }) => {
    const [emitindo, setEmitindo] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [guias, setGuias] = useState<GuiaPronta[]>([]);
    const [naoEmitidos, setNaoEmitidos] = useState<string[]>([]);
    const [origem, setOrigem] = useState<'avulso' | 'numerado' | null>(null);

    const decisao = decidirEmissaoRetidos({
        resultado: data.resultado,
        dctfwebLido: data.dctfwebLido,
        eventosNaoLidos: eventosNaoLidosDoLote(data.eventos as any),
    });
    const cnpj14 = String(cnpj || '').replace(/\D/g, '');
    const comp = data.resultado?.competencia || data.consolidacaoReinf?.competencia || '';
    const [anoPA, mesPA] = [Number(comp.slice(0, 4)), Number(comp.slice(5, 7))];
    const faltaCnpj = cnpj14.length !== 14;
    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    const emitirAvulsos = async () => {
        setEmitindo(true); setGuias([]); setNaoEmitidos([]); setOrigem('avulso');
        try {
            const r = await gerarDarfsSeparados(null, {
                empresaCnpj: cnpj14, anoPA, mesPA, apenasCodigos: decisao.avulsos.map((a) => a.codigo),
            });
            setGuias((r.guias || []).filter((g: any) => g.pdfBase64).map((g: any) => ({
                nome: nomeArquivoGuia({ tipo: `DARF ${g.codigo}${g.extensao || ''}`, competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}` }),
                base64: g.pdfBase64, vencimento: g.vencimento, valor: Number(g.valor ?? g.valorPrincipal ?? 0),
                codigo: String(g.codigo), extensao: g.extensao ? String(g.extensao) : null, descricao: g.descricao || '',
            })));
            setNaoEmitidos((r.naoEmitidos || []).map((n: any) => `${n.codigo}${n.extensao || ''} ${brl(Number(n.valor || 0))} — ${n.motivo}`));
        } catch (e: any) {
            onShowToast?.(`Falha ao emitir: ${e?.message || e}`);
        } finally { setEmitindo(false); }
    };

    const emitirNumerado = async () => {
        setEmitindo(true); setGuias([]); setNaoEmitidos([]); setOrigem('numerado');
        try {
            const r = await gerarDarf(null, { empresaCnpj: cnpj14, anoPA, mesPA });
            if (!r.pdfBase64) throw new Error('a DCTFWeb não devolveu o PDF do DARF.');
            setGuias([{
                nome: nomeArquivoGuia({ tipo: 'DARF', competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}` }),
                base64: r.pdfBase64, vencimento: r.vencimento || '', valor: Number(r.valor ?? 0),
                codigo: 'DCTFWeb', extensao: null, descricao: 'DARF numerado da DCTFWeb (todos os débitos do mês)',
            }]);
        } catch (e: any) {
            onShowToast?.(`Falha ao emitir: ${e?.message || e}`);
        } finally { setEmitindo(false); }
    };

    const enviar = async () => {
        if (!guias.length) return;
        setEnviando(true);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada');
            const resp = await fetch(`/api/admin/empresa-contato/${encodeURIComponent(cnpj14)}`, { headers: { Authorization: `Bearer ${token}` } });
            const contato = resp.ok ? await resp.json() : { email: '' };
            if (!contato.email) { onShowToast?.('E-mail do cliente não cadastrado — preencha em "Dados Fiscais" da empresa.'); return; }
            const competencia = `${anoPA}-${String(mesPA).padStart(2, '0')}`;
            const total = guias.reduce((t, g) => t + (g.valor || 0), 0);
            const linhas = guias.map((g) => `• ${g.codigo}${g.extensao || ''} ${g.descricao} — ${g.valor ? brl(g.valor) : 'valor no PDF'}${g.vencimento ? ` — vence ${dataBr(g.vencimento)}` : ''}`);
            const [primeira, ...resto] = guias;
            const r = await enviarGuiaPeloServidor({
                empresaCnpj: cnpj14,
                empresaNome: cnpj14,
                // "DARF RETIDOS" cai na obrigação DCTFWEB (`obrigacaoDoTipo`) — sem
                // citar PIS/CSLL no tipo, que mandariam baixar a tarefa errada.
                tipo: origem === 'numerado' ? 'DARF' : 'DARF RETIDOS',
                competencia,
                para: contato.email,
                assunto: `${origem === 'numerado' ? 'DARF DCTFWeb' : 'DARF dos tributos retidos'} ${String(mesPA).padStart(2, '0')}/${anoPA}`,
                mensagem: [
                    'Olá, tudo bem?', '',
                    origem === 'numerado'
                        ? `Segue o DARF da DCTFWeb da competência ${String(mesPA).padStart(2, '0')}/${anoPA}, com os débitos do mês (inclui os tributos retidos).`
                        : `Seguem os DARF dos tributos retidos (IRRF/CSRF) da competência ${String(mesPA).padStart(2, '0')}/${anoPA}.`,
                    '', ...linhas, '',
                    ...(total ? [`Total: ${brl(total)}`, ''] : []),
                    'Por gentileza, confirme o pagamento após a quitação.', '', 'Atenciosamente,', 'SP Assessoria Contábil',
                ].join('\n'),
                pdfBase64: primeira.base64,
                pdfFileName: primeira.nome,
                pdfs: resto.map((g) => ({ nome: g.nome, base64: g.base64 })),
                valor: total || undefined,
                vencimento: primeira.vencimento || null,
                ...(origem === 'avulso' ? {
                    debitos: guias.map((g) => ({ codigo: g.codigo, extensao: g.extensao, descricao: g.descricao, valor: g.valor || null })),
                } : {}),
            });
            onShowToast?.(r.ok ? mensagemEnvioServidor(r) : `Falha no envio: ${r.error}`);
        } catch (e: any) {
            onShowToast?.(`Falha no envio: ${e?.message || e}`);
        } finally { setEnviando(false); }
    };

    return (
        <div className="p-5 rounded-xl space-y-3" style={{ ...card, borderLeft: `4px solid ${decisao.pode ? 'var(--success)' : 'var(--warning)'}` }}>
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                💸 DARF dos retidos {comp && `· competência ${comp}`}
            </h3>
            {!decisao.pode ? (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>🔒 Emissão travada: {decisao.motivo}</p>
            ) : faltaCnpj ? (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>
                    Informe o CNPJ completo do estabelecimento (14 dígitos) no campo acima — é com ele que a DCTFWeb emite e o cliente recebe.
                </p>
            ) : (
                <>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Reinf e DCTFWeb conferem.
                        {decisao.avulsos.length > 0 && <> A recolher: {decisao.avulsos.map((a) => `${a.familia} ${a.codigo} ${brl(a.valor)}`).join(' · ')} (vencimento dia 20).</>}
                        {decisao.inssSoNumerado > 0 && <> INSS retido {brl(decisao.inssSoNumerado)}: só sai no DARF numerado da DCTFWeb.</>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {decisao.avulsos.length > 0 && (
                            <button onClick={() => void emitirAvulsos()} disabled={emitindo || enviando}
                                className="px-3 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>
                                {emitindo && origem === 'avulso' ? 'Emitindo…' : `Emitir DARF avulso (${decisao.avulsos.map((a) => a.codigo).join(' / ')})`}
                            </button>
                        )}
                        <button onClick={() => void emitirNumerado()} disabled={emitindo || enviando}
                            className="px-3 py-2 text-xs font-bold rounded-lg border disabled:opacity-40" style={{ borderColor: 'var(--accent)', color: 'var(--text-primary)' }}>
                            {emitindo && origem === 'numerado' ? 'Emitindo…' : 'Emitir DARF numerado da DCTFWeb (todos os débitos do mês)'}
                        </button>
                    </div>
                </>
            )}

            {guias.length > 0 && (
                <div className="space-y-2">
                    <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                        {guias.map((g) => (
                            <li key={g.nome}>
                                📄 {g.codigo}{g.extensao || ''} {g.descricao} — {g.valor ? brl(g.valor) : 'valor no PDF'}{g.vencimento ? ` — vence ${dataBr(g.vencimento)}` : ''}
                                {' '}<a href={`data:application/pdf;base64,${g.base64}`} download={g.nome} className="underline">baixar</a>
                            </li>
                        ))}
                    </ul>
                    {origem === 'numerado' && (
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            O DARF numerado traz TODOS os débitos da DCTFWeb do mês (não só os retidos), com o vencimento do mais próximo. Confira o PDF antes de enviar.
                        </p>
                    )}
                    <button onClick={() => void enviar()} disabled={enviando}
                        className="px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40" style={{ background: 'var(--success)' }}>
                        {enviando ? 'Enviando…' : '📤 Enviar ao cliente pelo sistema'}
                    </button>
                </div>
            )}
            {naoEmitidos.length > 0 && (
                <ul className="text-[11px] ml-4 list-disc" style={{ color: 'var(--warning)' }}>
                    {naoEmitidos.map((t) => <li key={t}>Não emitido: {t}</li>)}
                </ul>
            )}
        </div>
    );
};

export default DarfRetidosBloco;
