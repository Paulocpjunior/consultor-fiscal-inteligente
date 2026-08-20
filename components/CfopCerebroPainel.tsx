/**
 * 🧠 CfopCerebroPainel — os PARÂMETROS por fornecedor, num componente só.
 *
 * Paulo, 18/08: *"pode usar o modal"*. O painel mora aqui, e não dentro de uma
 * tela, justamente por isso: ele é usado NO MODAL 🔗 Correlação de CFOP e na aba
 * ✏️ CFOP por nota. Duas cópias fariam uma tela listar parâmetro que a outra não
 * conhece — o defeito que este projeto mais pagou.
 *
 * ⚠️ ELE NÃO DECIDE CFOP. Quem decide é `cfopDoLancamento` (régua única), com a
 * precedência NF > cérebro > override da empresa > régua automática. Aqui só se
 * CRIA, LISTA e DESLIGA.
 */
import React, { useMemo, useState } from 'react';
import type { User } from '../types';
import {
    lerParametrosCfop, gravarParametroCfop, desligarParametroCfop, type ParametroCfopDoc,
} from '../services/cfopEscrituradoService';
import { textoDoCfop } from '../sefaz-backend/cfop-catalogo.js';

export interface FornecedorOpcao {
    cnpj: string;
    nome: string;
    /** CFOPs que ESTE fornecedor emitiu — a lista de origem sai do dado real. */
    cfops: string[];
    notas: number;
}

interface Props {
    empresaId: string;
    user: User | null;
    /** Fornecedores lidos das notas de entrada — sem eles não há o que cadastrar. */
    fornecedores: FornecedorOpcao[];
    parametros: ParametroCfopDoc[];
    onMudou: (ps: ParametroCfopDoc[]) => void;
    /** Competência sugerida como início (a que está sendo conferida). */
    competenciaPadrao?: string;
}

const CfopCerebroPainel: React.FC<Props> = ({
    empresaId, user, fornecedores, parametros, onMudou, competenciaPadrao,
}) => {
    const [erro, setErro] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [cnpj, setCnpj] = useState('');
    const [cfopOrigem, setCfopOrigem] = useState('');
    const [cfopDestino, setCfopDestino] = useState('');
    const hoje = new Date();
    const [vigencia, setVigencia] = useState(
        competenciaPadrao || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`,
    );

    const escolhido = useMemo(() => fornecedores.find(f => f.cnpj === cnpj), [fornecedores, cnpj]);
    const ativos = parametros.filter(p => p.ativo !== false);

    const recarregar = async () => onMudou(await lerParametrosCfop(empresaId));

    const criar = async () => {
        setErro(null);
        setSalvando(true);
        try {
            await gravarParametroCfop({
                empresaId,
                cnpjFornecedor: cnpj,
                nomeFornecedor: escolhido?.nome || null,
                // Vazio = QUALQUER CFOP daquele fornecedor (escopo largo).
                cfopOrigem: cfopOrigem || null,
                cfopDestino,
                vigenciaInicio: vigencia,
                porEmail: user?.email || '',
            });
            await recarregar();
            setCfopDestino('');
        } catch (e: any) {
            setErro(e?.message || 'Falha ao criar o parâmetro.');
        } finally {
            setSalvando(false);
        }
    };

    /**
     * O que ainda falta para o botão funcionar — dito NA TELA, nunca só no
     * `disabled`. Paulo tentou criar o parâmetro da POXPUR (5101 → 1556) e o
     * botão estava apagado porque o "Escriturar como" continuava VAZIO: o
     * placeholder cinza `1556` parecia valor preenchido.
     */
    const falta = [
        !cnpj && 'escolher o fornecedor',
        cfopDestino.replace(/\D/g, '').length !== 4 && 'preencher "Escriturar como" com os 4 dígitos do CFOP',
    ].filter(Boolean) as string[];

    const descricaoDestino = cfopDestino.replace(/\D/g, '').length === 4
        ? textoDoCfop(cfopDestino) as { temDescricao: boolean; texto: string }
        : null;

    return (
        <div className="text-xs">
            <p className="text-slate-500">
                O que uma pessoa corrigiu numa nota vira parâmetro <strong>daquele fornecedor</strong>. Vale{' '}
                <strong>da competência de início em diante</strong> — competência anterior não muda, e uma nota com
                CFOP informado à mão continua vencendo o parâmetro.
            </p>

            {erro && (
                <div className="mt-2 rounded-lg border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-2 text-red-700 dark:text-red-300">
                    {erro}
                </div>
            )}

            {/* ── Criar ─────────────────────────────────────────────────── */}
            {!fornecedores.length ? (
                <p className="mt-3 text-slate-500">
                    Nenhum fornecedor lido nas entradas desta empresa — sem isso não dá para cadastrar parâmetro.
                    Se ela compra, isto é buraco de captura.
                </p>
            ) : (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                    <label className="md:col-span-2 block">
                        <span className="block text-slate-500 mb-1">Fornecedor</span>
                        <select
                            value={cnpj}
                            onChange={e => { setCnpj(e.target.value); setCfopOrigem(''); }}
                            className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                        >
                            <option value="">— escolha —</option>
                            {fornecedores.map(f => (
                                <option key={f.cnpj} value={f.cnpj}>{f.nome} ({f.notas} nota{f.notas > 1 ? 's' : ''})</option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="block text-slate-500 mb-1">CFOP de origem</span>
                        <select
                            value={cfopOrigem}
                            onChange={e => setCfopOrigem(e.target.value)}
                            disabled={!escolhido}
                            className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 disabled:opacity-50"
                        >
                            <option value="">qualquer CFOP</option>
                            {(escolhido?.cfops || []).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="block text-slate-500 mb-1">Escriturar como</span>
                        <input
                            value={cfopDestino}
                            onChange={e => setCfopDestino(e.target.value)}
                            maxLength={4}
                            /* 🚨 O PLACEHOLDER ERA `1556` E PARECIA VALOR PREENCHIDO (Paulo,
                               20/08, no teste da PWR: POXPUR 5101 → o campo mostrava um 1556
                               cinza e o botão ficava apagado, sem dizer por quê). Campo de
                               CFOP tem UM placeholder nesta casa — o mesmo "—" da aba ✏️ CFOP
                               por nota. Exemplo em cinza dentro de campo obrigatório é a
                               família do "botão que não faz nada": a pessoa lê como feito. */
                            placeholder="—"
                            title="Os 4 dígitos do CFOP de ENTRADA que passa a valer para este fornecedor."
                            /* 🚨 VAZIO NÃO PODE PARECER DESLIGADO (Paulo, 20/08, segundo print:
                               "o componente Escriturar como continua desabilitado"). Ele NÃO está
                               — um teste de render digita nele e o botão liga. O que engana é a
                               VIZINHANÇA: os dois campos ao lado são <select> com valor, e um
                               input de texto com um `—` cinza no meio deles lê-se como célula de
                               saída, não como campo. O anel marca o que espera digitação. */
                            className={`w-full p-2 font-mono rounded border bg-white dark:bg-slate-700 ${
                                cfopDestino
                                    ? 'border-slate-300 dark:border-slate-600'
                                    : 'border-blue-400 dark:border-blue-600 ring-1 ring-blue-300 dark:ring-blue-700'
                            }`}
                        />
                    </label>
                    <label className="block">
                        <span className="block text-slate-500 mb-1">A partir de</span>
                        <input
                            type="month"
                            value={vigencia}
                            onChange={e => setVigencia(e.target.value)}
                            className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                        />
                    </label>
                </div>
            )}

            {/* A descrição oficial junto do número — é ela que faz o erro
                aparecer antes de virar livro (caso Kalunga, 17/08). E, ENQUANTO
                O CAMPO ESTÁ VAZIO, o mesmo lugar diz que ali se DIGITA: é a
                pergunta que o campo em branco deixou em aberto. O exemplo fica
                FORA do campo de propósito — dentro dele viraria o `1556` cinza
                que já foi lido como valor preenchido. */}
            {descricaoDestino ? (
                <p className={`mt-2 ${descricaoDestino.temDescricao ? 'text-slate-500' : 'text-red-600 dark:text-red-400'}`}>
                    {descricaoDestino.texto}
                </p>
            ) : !!fornecedores.length && (
                <p className="mt-2 text-slate-500">
                    <strong>Escriturar como</strong> é campo de digitação: informe os <strong>4 dígitos</strong> do
                    CFOP de entrada que passa a valer para este fornecedor — por exemplo{' '}
                    <span className="font-mono">1556</span> (uso ou consumo),{' '}
                    <span className="font-mono">1551</span> (ativo imobilizado) ou{' '}
                    <span className="font-mono">1102</span> (revenda). A descrição oficial aparece aqui assim que
                    você digitar.
                </p>
            )}

            {!!fornecedores.length && (
                <>
                    <button
                        onClick={criar}
                        disabled={salvando || !!falta.length}
                        className="btn-press mt-2 px-4 py-2 rounded-lg bg-blue-700 text-white font-bold disabled:opacity-40 whitespace-nowrap"
                    >{salvando ? 'Gravando…' : '🧠 Criar parâmetro'}</button>
                    {/* 🚨 BOTÃO DESLIGADO DIZ POR QUÊ. Sem esta linha o painel vira
                        beco: o clique não faz nada e a única saída que sobra é
                        clicar de novo (a família do "Já importado" sem estado). */}
                    {!!falta.length && !salvando && (
                        <p className="mt-1 text-amber-600 dark:text-amber-400">
                            Falta {falta.join(' e ')} para criar o parâmetro.
                        </p>
                    )}
                </>
            )}

            {/* ── Listar ────────────────────────────────────────────────── */}
            <h4 className="mt-4 font-bold text-slate-700 dark:text-slate-200">
                Parâmetros ativos ({ativos.length})
            </h4>
            {!parametros.length ? (
                <p className="mt-1 text-slate-500">
                    Nenhum ainda. Também dá para criar corrigindo um CFOP na aba ✏️ CFOP por nota — ao gravar, o
                    app pergunta se deve aprender.
                </p>
            ) : (
                <ul className="mt-1 space-y-1">
                    {parametros.map(p => (
                        <li key={p.id} className={`flex flex-wrap items-center gap-2 ${p.ativo === false ? 'opacity-50 line-through' : ''}`}>
                            <span className="font-mono">{p.cfopOrigem || 'qualquer'} → {p.cfopDestino}</span>
                            <span>{p.nomeFornecedor || p.cnpjFornecedor}</span>
                            <span className="text-slate-500">desde {p.vigenciaInicio} · {p.criadoPor || '—'}</span>
                            {p.ativo !== false && (
                                <button
                                    className="btn-press underline text-red-600 whitespace-nowrap"
                                    onClick={async () => {
                                        try {
                                            await desligarParametroCfop(p.id!, user?.email || '');
                                            await recarregar();
                                        } catch (e: any) { setErro(e?.message || 'Falha ao desligar.'); }
                                    }}
                                >desligar</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {parametros.some(p => p.ativo === false) && (
                <p className="mt-2 text-slate-500">
                    ⚠️ Desligar não apaga: o parâmetro continua explicando as competências que ele já datou.
                </p>
            )}
        </div>
    );
};

export default CfopCerebroPainel;
