/**
 * 🏛️ TriagemTerceiroSetorPanel — a fila CURTA de quem parece imune/isenta.
 *
 * Paulo, 18/08, depois de ver uma igreja cadastrada como Lucro Presumido:
 * *"é uma falta grave… o que eu tenho que pedir p colaborador?"*
 *
 * O pedido errado é "preencham o regime das ~390". Este painel existe para o
 * pedido ser **"confirme estes N"** — e N é pequeno, porque o regime deduzido
 * acerta na esmagadora maioria e o que falta é só quem é imune, isenta ou
 * entidade sem fins lucrativos.
 *
 * ⚠️ ELE NÃO DECIDE NADA. É SUGESTÃO carimbada com a origem (mesma figura do
 * `tipoSocietarioNoNome` no FUNRURAL): o app aponta e o link leva ao cadastro,
 * onde uma PESSOA marca. Enquanto ninguém marcar, a empresa segue como está.
 */
import React, { useState } from 'react';
import { auth } from '../services/firebaseConfig';

interface Linha {
    id: string | null;
    cnpj: string | null;
    nome: string;
    regimeTributario: string | null;
    sinais: string[];
    explicacao: string | null;
    societario?: string | null;
}

interface Resultado {
    aConfirmar: Linha[];
    jaClassificadas: Linha[];
    barradasPorSociedade: Linha[];
    resumo: { total: number; aConfirmar: number; jaClassificadas: number; barradasPorSociedade: number };
}

const fmtCnpj = (c?: string | null) =>
    String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || '—';

const TriagemTerceiroSetorPanel: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [r, setR] = useState<Resultado | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [verBarradas, setVerBarradas] = useState(false);

    const rodar = async () => {
        setErro(null);
        setCarregando(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const resp = await fetch('/api/admin/cadastro/triagem-terceiro-setor', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j = await resp.json();
            if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
            setR(j);
            onShowToast?.(`${j.resumo.aConfirmar} empresa(s) a confirmar.`);
        } catch (e: any) {
            // Falha de leitura NÃO vira "não há ninguém" — lista vazia por erro
            // seria lida como carteira limpa, que é o oposto do que aconteceu.
            setErro(e?.message || 'Falha ao consultar. A lista abaixo pode estar incompleta.');
        } finally {
            setCarregando(false);
        }
    };

    const Tabela: React.FC<{ linhas: Linha[]; mostrarSocietario?: boolean }> = ({ linhas, mostrarSocietario }) => (
        <table className="w-full text-xs mt-2">
            <thead className="text-slate-500">
                <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                    <th className="py-1 pr-2">Empresa</th>
                    <th className="py-1 pr-2">CNPJ</th>
                    <th className="py-1 pr-2">{mostrarSocietario ? 'Tipo societário' : 'Por que apareceu'}</th>
                    <th className="py-1 pr-2">Regime hoje</th>
                </tr>
            </thead>
            <tbody>
                {linhas.map(l => (
                    <tr key={l.id || l.cnpj || l.nome} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-2">{l.nome}</td>
                        <td className="py-1 pr-2 font-mono whitespace-nowrap">{fmtCnpj(l.cnpj)}</td>
                        <td className="py-1 pr-2 text-slate-500">
                            {mostrarSocietario ? (l.societario || '—') : (l.sinais.join(' · ') || '—')}
                        </td>
                        <td className="py-1 pr-2">{l.regimeTributario || <span className="text-slate-400">deduzido do cadastro</span>}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );

    return (
        <div className="text-xs">
            <h4 className="font-bold text-slate-700 dark:text-slate-200">🏛️ Imunes, isentas e terceiro setor — quem confirmar</h4>
            <p className="mt-1 text-slate-500">
                O CFI deduz Simples/Presumido/Real de como a empresa foi cadastrada, e isso acerta na maioria.
                O que ele <strong>não tem como saber</strong> é quem é <strong>imune, isenta ou entidade sem fins
                lucrativos</strong> — e entidade classificada errada herda a apuração do Presumido, apurando
                PIS/COFINS sobre faturamento de quem recolhe PIS sobre a folha.
            </p>
            <p className="mt-1 text-slate-500">
                Esta é a lista de quem <strong>parece</strong> ser, pela razão social e pelo CNAE. É{' '}
                <strong>sugestão, não decisão</strong>: quem marca é uma pessoa, no cadastro da empresa
                (Dados Fiscais → 🏛️ Regime tributário).
            </p>

            <button
                onClick={rodar}
                disabled={carregando}
                className="btn-press mt-2 px-4 py-2 rounded-lg bg-blue-700 text-white font-bold disabled:opacity-40 whitespace-nowrap"
            >{carregando ? 'Consultando…' : '🔎 Levantar a fila'}</button>

            {erro && (
                <div className="mt-2 rounded-lg border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-2 text-red-700 dark:text-red-300">
                    {erro}
                </div>
            )}

            {r && (
                <div className="mt-3">
                    <p className="text-slate-600 dark:text-slate-300">
                        <strong>{r.resumo.aConfirmar}</strong> a confirmar · {r.resumo.jaClassificadas} já
                        classificada(s) · de {r.resumo.total} empresa(s) no cadastro.
                    </p>

                    {!r.aConfirmar.length ? (
                        <p className="mt-2 text-slate-500">
                            Nenhuma empresa com sinal de terceiro setor sem classificação. ⚠️ Isso quer dizer que
                            a <strong>razão social e o CNAE</strong> não apontaram nenhuma — não que a carteira
                            não tenha imunes ou isentas. Quem souber de uma, marque direto no cadastro.
                        </p>
                    ) : <Tabela linhas={r.aConfirmar} />}

                    {!!r.jaClassificadas.length && (
                        <details className="mt-3">
                            <summary className="cursor-pointer text-slate-500">
                                {r.jaClassificadas.length} já classificada(s)
                            </summary>
                            <Tabela linhas={r.jaClassificadas} />
                        </details>
                    )}

                    {!!r.barradasPorSociedade.length && (
                        <div className="mt-3">
                            <button className="underline text-slate-500" onClick={() => setVerBarradas(v => !v)}>
                                {verBarradas ? 'ocultar' : 'ver'} {r.barradasPorSociedade.length} que a régua
                                BARROU (razão social diz LTDA/S.A./EIRELI)
                            </button>
                            {verBarradas && (
                                <>
                                    <p className="mt-1 text-slate-500">
                                        Sociedade empresária não é entidade sem fins lucrativos (CC art. 44), então o
                                        app não as sugere. Se alguma for imune ou isenta mesmo assim, marque na mão —
                                        o app não contraria a razão social sozinho.
                                    </p>
                                    <Tabela linhas={r.barradasPorSociedade} mostrarSocietario />
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TriagemTerceiroSetorPanel;
