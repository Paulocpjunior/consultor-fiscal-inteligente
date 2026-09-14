/**
 * 🧭 DifalArt117 — o DIFAL de aquisição DENTRO da apuração (RICMS/SP art. 117).
 *
 * Paulo, 14/09, fechando a HYPE CAFÉ (Lucro Presumido): *"o diferencial de
 * alíquota nas aquisições dela é dentro da apuração, precisamos criar um campo
 * para fazermos um ajuste; no EFISCAL lançamos dentro da nota, depois fazemos
 * esse ajuste para sair na apuração"*.
 *
 * O que esta tela faz: mostra, nota a nota, o que o app PROPÕE (base por
 * dentro, alíquota interna, ICMS da origem) e deixa a pessoa INFORMAR por cima
 * — é o "campo dentro da nota" do e-Fiscal. O par de E111 (débito pela interna
 * + crédito da origem) entra no E110 sozinho na próxima geração.
 *
 * ⚠️ A tela NÃO calcula: os números vêm da rota, que chama o MESMO dono do
 * gerador (`difal-art117-apuracao.js`). Calcular aqui seria a réplica de CFOP
 * do modal (12/08) de novo — a tela prometendo um número e o arquivo gravando
 * outro.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { auth } from '../../services/firebaseConfig';
import {
    salvarDifalArt117Codigos, salvarDifalArt117Nota, type DifalArt117Informado,
} from '../../services/spedAjustesService';
import { validarCodigosArt117, type DifalArt117Consolidado } from '../../sefaz-backend/difal-art117-apuracao.js';
import { parseValorMoeda } from '../../services/valorDigitado';

interface Props {
    empresaId: string;
    empresaCnpj: string;
    competencia: string;
    uf: string;
    onShowToast?: (msg: string) => void;
}

type Resposta = DifalArt117Consolidado & {
    ok: boolean;
    aliqInternaPadrao: number;
    codigoDebito: string;
    codigoCredito: string;
    documentosLidos: number;
    avisoParametrosCfop: string | null;
    error?: string;
};

interface Rascunho { base: string; aliqInterna: string; icmsDestacado: string }

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const token = async () => auth?.currentUser?.getIdToken();

const inputStyle: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
};

const DifalArt117: React.FC<Props> = ({ empresaId, empresaCnpj, competencia, uf, onShowToast }) => {
    const [dados, setDados] = useState<Resposta | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [codigoDebito, setCodigoDebito] = useState('');
    const [codigoCredito, setCodigoCredito] = useState('');
    const [salvandoCodigos, setSalvandoCodigos] = useState(false);
    const [rascunho, setRascunho] = useState<Record<string, Rascunho>>({});
    const [salvandoNota, setSalvandoNota] = useState<string | null>(null);

    const carregar = async () => {
        if (!empresaId || !competencia) return;
        setCarregando(true);
        setErro(null);
        try {
            const t = await token();
            const r = await fetch(
                `/api/admin/sped-fiscal/difal-art117?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
                { headers: { Authorization: `Bearer ${t}` } },
            );
            const j = await r.json();
            if (!j.ok) { setErro(j.error || 'Falha ao ler o DIFAL da competência.'); setDados(null); return; }
            setDados(j);
            setCodigoDebito(j.codigoDebito || '');
            setCodigoCredito(j.codigoCredito || '');
            setRascunho({});
        } catch (e: any) {
            setErro(`Falha ao ler o DIFAL: ${e?.message || e}`);
            setDados(null);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { void carregar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [empresaId, competencia]);

    // A validação de FORMA é a mesma do gerador (importada, nunca copiada);
    // o que ela não sabe — se o número é o da tabela 5.1.1 — ninguém aqui sabe.
    const codigos = useMemo(
        () => validarCodigosArt117({ codigoDebito, codigoCredito, ufEmpresa: uf }),
        [codigoDebito, codigoCredito, uf],
    );

    const salvarCodigos = async () => {
        setSalvandoCodigos(true);
        try {
            await salvarDifalArt117Codigos({ empresaId, empresaCnpj, competencia, codigoDebito, codigoCredito });
            onShowToast?.('Códigos do art. 117 gravados. Entram no PRÓXIMO arquivo gerado desta competência.');
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Falha ao gravar os códigos: ${e?.message || e}`);
        } finally {
            setSalvandoCodigos(false);
        }
    };

    const gravarNota = async (chave: string, informado: DifalArt117Informado | null) => {
        setSalvandoNota(chave);
        try {
            await salvarDifalArt117Nota({ empresaId, empresaCnpj, competencia, chave, informado });
            onShowToast?.(informado
                ? (informado.naoDevido ? 'Nota marcada como "DIFAL não devido" — fica FORA do ajuste, nomeada no aviso da geração.' : 'Valor informado gravado por cima da proposta (carimbado com você).')
                : 'Voltou à proposta do app.');
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Falha ao gravar: ${e?.message || e}`);
        } finally {
            setSalvandoNota(null);
        }
    };

    const informar = async (chave: string) => {
        const r = rascunho[chave] || { base: '', aliqInterna: '', icmsDestacado: '' };
        const campo = (txt: string, nome: string): number | null | undefined => {
            if (!String(txt || '').trim()) return undefined;   // em branco = mantém a proposta
            const v = parseValorMoeda(txt);
            if (v === null) throw new Error(`${nome}: não entendi "${txt}" — use vírgula para os centavos (ex.: 178,26).`);
            return v;
        };
        try {
            const base = campo(r.base, 'Base');
            const aliqInterna = campo(r.aliqInterna, 'Alíquota interna');
            const icmsDestacado = campo(r.icmsDestacado, 'ICMS da origem');
            if (base === undefined && aliqInterna === undefined && icmsDestacado === undefined) {
                onShowToast?.('Nada a informar: os três campos estão em branco (a proposta já vale).');
                return;
            }
            await gravarNota(chave, { base, aliqInterna, icmsDestacado });
        } catch (e: any) {
            onShowToast?.(e?.message || String(e));
        }
    };

    const naoDevido = async (chave: string, numero: string) => {
        const motivo = window.prompt(
            `Marcar a nota nº ${numero} como "DIFAL NÃO devido"?\n\nEla fica FORA do débito e do crédito do art. 117 e sai NOMEADA no aviso da geração. `
            + 'Escreva o motivo (ex.: "Comunicado CAT 26/2008 — antecipação do 426-A já recolhida"):',
            '',
        );
        if (motivo === null) return;
        if (motivo.trim().length < 10) { onShowToast?.('Motivo curto demais — daqui a um mês ninguém lembra por que esta nota ficou de fora.'); return; }
        await gravarNota(chave, { naoDevido: true, motivo: motivo.trim() });
    };

    const setR = (chave: string, campo: keyof Rascunho, valor: string) => setRascunho((prev) => ({
        ...prev, [chave]: { ...(prev[chave] || { base: '', aliqInterna: '', icmsDestacado: '' }), [campo]: valor },
    }));

    const prontos = codigos.debito.ok && codigos.credito.ok;

    return (
        <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                🧭 DIFAL de aquisição na apuração (RICMS/SP art. 117)
            </h4>
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                Entrada <strong>de outro estado</strong> para <strong>uso/consumo ou ativo</strong> (CFOP escriturado 2551/2552/2555/2556/2557)
                no Lucro (RPA): o DIFAL <strong>não</strong> sai em guia à parte — entra no <strong>E110</strong> como
                <strong> Outros débitos</strong> (imposto pela alíquota interna, art. 117, II) e <strong>Outros créditos</strong> (imposto
                destacado na origem, art. 117, I). O app propõe a base <em>por dentro</em> — (valor − ICMS da origem) ÷ (1 − alíquota interna) —
                e você confirma ou informa por nota, como no e-Fiscal. O par de E111 entra sozinho na próxima geração.
            </p>

            <div className="flex flex-wrap items-end gap-3 mb-2">
                <div className="min-w-[220px]">
                    <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
                        Código do DÉBITO (art. 117, II) — tabela 5.1.1, 4º caractere '0'
                    </label>
                    <input
                        value={codigoDebito}
                        onChange={(e) => setCodigoDebito(e.target.value.toUpperCase())}
                        placeholder={`${uf || 'SP'}00____`}
                        maxLength={8}
                        className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                        style={{ ...inputStyle, border: `1px solid ${codigoDebito && !codigos.debito.ok ? 'var(--danger, #dc2626)' : 'var(--border-default)'}` }}
                    />
                    {codigoDebito && !codigos.debito.ok && <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--danger, #dc2626)' }}>⚠ {codigos.debito.erro}</p>}
                </div>
                <div className="min-w-[220px]">
                    <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>
                        Código do CRÉDITO (art. 117, I) — tabela 5.1.1, 4º caractere '2'
                    </label>
                    <input
                        value={codigoCredito}
                        onChange={(e) => setCodigoCredito(e.target.value.toUpperCase())}
                        placeholder={`${uf || 'SP'}02____`}
                        maxLength={8}
                        className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                        style={{ ...inputStyle, border: `1px solid ${codigoCredito && !codigos.credito.ok ? 'var(--danger, #dc2626)' : 'var(--border-default)'}` }}
                    />
                    {codigoCredito && !codigos.credito.ok && <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--danger, #dc2626)' }}>⚠ {codigos.credito.erro}</p>}
                </div>
                <button
                    onClick={salvarCodigos}
                    disabled={salvandoCodigos || (!!codigoDebito && !codigos.debito.ok) || (!!codigoCredito && !codigos.credito.ok)}
                    className="px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40 whitespace-nowrap"
                    style={{ background: 'var(--accent)' }}
                    title="Grava só os dois códigos; o informado por nota não é tocado"
                >{salvandoCodigos ? 'Gravando…' : '💾 Gravar códigos'}</button>
            </div>
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                O app <strong>não deduz</strong> o número da tabela 5.1.1 — ele confere só a forma (UF, apuração própria e o tipo pelo 4º caractere).
                <strong> Sem os DOIS códigos nada entra no E110</strong>: só o débito recolheria a maior; só o crédito, a menor.
            </p>

            {carregando && <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>Lendo as entradas interestaduais da competência…</p>}
            {erro && <p className="text-xs py-2 font-semibold" style={{ color: 'var(--danger, #dc2626)' }}>⚠ {erro}</p>}

            {dados && !carregando && (
                <>
                    {dados.porNota.length === 0 ? (
                        <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
                            Nenhuma entrada interestadual de uso/consumo/ativo nesta competência ({dados.documentosLidos} documento(s) lidos).
                            Se uma compra dessas existe e não aparece aqui, o CFOP escriturado dela não é 255x — confira em
                            Relatórios → ✏️ CFOP por nota (o fornecedor emite 6102; o destino "uso/consumo" é decisão sua).
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs" style={{ minWidth: 980 }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-muted)' }}>
                                        {['Nº NF', 'Emitente', 'UF', 'CFOP', 'Valor op.', 'ICMS origem', 'Aliq. interna', 'Base (por dentro)', 'Débito (II)', 'Crédito (I)', 'Diferença', 'Origem', ''].map((h) => (
                                            <th key={h} className="text-left py-1 pr-2 font-bold uppercase text-[10px]">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dados.porNota.map((n) => {
                                        const r = rascunho[n.chave] || { base: '', aliqInterna: '', icmsDestacado: '' };
                                        const foraDoAjuste = n.origem === 'nao-devido';
                                        const carimbo = n.informadoPor
                                            ? `${n.origem === 'nao-devido' ? 'não devido' : 'informada'} por ${n.informadoPor}${n.informadoEm ? ` em ${new Date(n.informadoEm).toLocaleDateString('pt-BR')}` : ''}${n.motivo ? ` — ${n.motivo}` : ''}`
                                            : 'proposta do app';
                                        return (
                                            <tr key={n.chave} style={{ borderTop: '1px solid var(--border-subtle)', opacity: foraDoAjuste ? 0.6 : 1 }}>
                                                <td className="py-1 pr-2 font-mono">{n.numero || '—'}</td>
                                                <td className="py-1 pr-2">{n.emitente || '—'}</td>
                                                <td className="py-1 pr-2">{n.ufOrigem}</td>
                                                <td className="py-1 pr-2 font-mono">{n.cfops.join(', ')}</td>
                                                <td className="py-1 pr-2 text-right font-mono">{fmtBRL(n.valorOperacao)}</td>
                                                <td className="py-1 pr-2">
                                                    <div className="font-mono text-right">{fmtBRL(n.icmsDestacado)}{n.icmsDestacadoZero && <span title="Sem ICMS destacado no item — o crédito saiu zero"> ⚠</span>}</div>
                                                    {!foraDoAjuste && <input value={r.icmsDestacado} onChange={(e) => setR(n.chave, 'icmsDestacado', e.target.value)} placeholder="informar" className="w-24 px-2 py-1 rounded font-mono text-right" style={inputStyle} />}
                                                </td>
                                                <td className="py-1 pr-2">
                                                    <div className="font-mono text-right">{fmtPct(n.aliqInterna)}</div>
                                                    {!foraDoAjuste && <input value={r.aliqInterna} onChange={(e) => setR(n.chave, 'aliqInterna', e.target.value)} placeholder="informar" className="w-20 px-2 py-1 rounded font-mono text-right" style={inputStyle} />}
                                                </td>
                                                <td className="py-1 pr-2">
                                                    <div className="font-mono text-right">{fmtBRL(n.base)}</div>
                                                    {!foraDoAjuste && <input value={r.base} onChange={(e) => setR(n.chave, 'base', e.target.value)} placeholder="informar" className="w-28 px-2 py-1 rounded font-mono text-right" style={inputStyle} />}
                                                </td>
                                                <td className="py-1 pr-2 text-right font-mono">{fmtBRL(n.debito)}</td>
                                                <td className="py-1 pr-2 text-right font-mono">{fmtBRL(n.credito)}</td>
                                                <td className="py-1 pr-2 text-right font-mono font-bold">{fmtBRL(n.diferenca)}</td>
                                                <td className="py-1 pr-2 text-[10px]" style={{ color: n.informadoPor ? 'var(--accent)' : 'var(--text-muted)' }}>{carimbo}</td>
                                                <td className="py-1 whitespace-nowrap">
                                                    {!foraDoAjuste && (
                                                        <button onClick={() => informar(n.chave)} disabled={salvandoNota === n.chave}
                                                            className="px-2 py-1 text-[11px] font-bold rounded mr-1"
                                                            style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                                                            title="Grava o que você digitou por cima da proposta (campo em branco mantém a proposta)">✍️ Informar</button>
                                                    )}
                                                    {!foraDoAjuste && (
                                                        <button onClick={() => naoDevido(n.chave, n.numero)} disabled={salvandoNota === n.chave}
                                                            className="px-2 py-1 text-[11px] font-bold rounded mr-1"
                                                            style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                                                            title="Esta operação não tem DIFAL devido — fica fora do ajuste, com motivo">🚫 Não devido</button>
                                                    )}
                                                    {n.informadoPor && (
                                                        <button onClick={() => gravarNota(n.chave, null)} disabled={salvandoNota === n.chave}
                                                            className="px-2 py-1 text-[11px] font-bold rounded"
                                                            style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                                                            title="Desfaz o informado e volta à proposta do app">↩ Proposta</button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--border-default)', fontWeight: 700 }}>
                                        <td className="py-1 pr-2" colSpan={4}>{dados.totais.notas} nota(s) no ajuste{dados.totais.naoDevidas ? ` · ${dados.totais.naoDevidas} não devida(s)` : ''}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.valorOperacao)}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.icmsDestacado)}</td>
                                        <td />
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.base)}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.debito)}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.credito)}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{fmtBRL(dados.totais.diferenca)}</td>
                                        <td colSpan={2} />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {dados.porNota.length > 0 && (
                        <div className="mt-3 p-3 rounded-lg text-[11px]" style={{ background: prontos && dados.ajustes.length ? 'var(--success-bg, rgba(22,163,74,.08))' : 'var(--warning-bg, rgba(217,119,6,.10))', color: 'var(--text-secondary)' }}>
                            {prontos && dados.ajustes.length ? (
                                <>
                                    <strong>O que vai ao próximo arquivo (E111 → E110):</strong>
                                    <ul className="list-disc ml-4 mt-1">
                                        {dados.ajustes.map((a) => (
                                            <li key={a.codigo} className="font-mono">{a.codigo} · {fmtBRL(a.valor)} — <span className="font-sans">{a.descricao}</span></li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <><strong>⚠ Nada entra no E110 ainda.</strong> {dados.avisos.find((a) => /NADA entrou/.test(a)) || 'Cadastre os dois códigos acima.'}</>
                            )}
                        </div>
                    )}
                    {dados.avisos.filter((a) => !/NADA entrou|entraram no E110/.test(a)).map((a, i) => (
                        <p key={i} className="text-[11px] mt-2" style={{ color: 'var(--warning, #b45309)' }}>⚠ {a}</p>
                    ))}
                    {dados.avisoParametrosCfop && <p className="text-[11px] mt-2" style={{ color: 'var(--warning, #b45309)' }}>⚠ {dados.avisoParametrosCfop}</p>}
                </>
            )}
        </div>
    );
};

export default DifalArt117;
