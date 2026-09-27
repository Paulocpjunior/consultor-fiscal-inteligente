/**
 * components/SpedFiscal/MensagemBlock.tsx
 *
 * Bloco visual de mensagem (info/warning/error/success) com layout em
 * card colorido conforme tipo. Reutilizado pelas varias abas do SPED
 * (Gerar, Contribuicoes, Editar) pra mostrar feedback do backend.
 *
 * ═══ 🚨 AVISO GRUDADO É AVISO QUE NINGUÉM LÊ (18/09, PWR · 08/2026) ═════════
 *
 * Paulo voltou pela TERCEIRA vez com a MESMA pergunta — *"ainda continua com a
 * diferença do valor da RECEITA"* —, 24h depois de a conciliação subir. Medido:
 * o arquivo dela sai `|M210|51|17775,31|15186,83|…`, que é EXATAMENTE o print
 * do PVA, e a geração empilha CINCO avisos que respondem a pergunta inteira —
 * inclusive um chamado *"Receita do M210/M610 × Memória de Apuração: os DOIS
 * estão certos e medem coisas diferentes"*.
 *
 * 🔴 **O QUE FALHOU FOI ESTA CAIXA**: `detalhes` era `string`, e os dois
 * caminhos chegavam aqui com `warnings.join(' — ')` — ~2.500 caracteres num
 * `<p>` de fonte 12px, **com o mesmo travessão separando os avisos e separando
 * as frases DENTRO de cada aviso**. Não há como saber onde um acaba e o outro
 * começa, e o que responde a pergunta é o quarto do muro.
 *
 * É a classe de 18/09 de manhã (o corte do `resumoPrevalidacao` escondendo o
 * que barra a importação) na outra ponta: lá o aviso certo caía fora da lista,
 * aqui ele está na lista e ninguém o enxerga. Nas duas, o defeito não é o
 * conteúdo — é o CAMINHO até o olho de quem lê.
 *
 * ✂️ `detalhes` passou a aceitar LISTA, e cada aviso ocupa uma linha com o
 * próprio rótulo à vista (*"Frete na base…"*, *"Receita do M210/M610 ×…"*).
 * `string` continua valendo para a mensagem de uma frase só — trocar as ~10
 * chamadas curtas seria mexer no que está certo.
 *
 * ⚠️ **NADA É CORTADO.** Lista longa é o preço de não esconder: foi o corte em
 * 12 que enterrou a única recusa que impedia o PVA de importar o arquivo
 * inteiro, no mesmo dia.
 */
import React from 'react';

export interface MensagemRetorno {
    tipo: 'info' | 'warning' | 'error' | 'success';
    titulo: string;
    /**
     * Uma frase (`string`) ou os avisos, **um por item** (`string[]`).
     *
     * 🚨 Quem tem mais de um aviso passa LISTA. Juntar com `join` devolve o
     * muro de texto que este componente existe para não produzir — travado em
     * `__tests__/avisoDaGeracaoNaoGruda.test.tsx`.
     */
    detalhes?: string | string[];
    extras?: { label: string; value: string }[];
}

interface Props {
    mensagem: MensagemRetorno;
}

const MensagemBlock: React.FC<Props> = ({ mensagem }) => {
    const cor = mensagem.tipo === 'success' ? 'var(--success)' :
                mensagem.tipo === 'error' ? 'var(--danger)' :
                mensagem.tipo === 'warning' ? 'var(--warning)' : 'var(--accent)';
    const corSoft = mensagem.tipo === 'success' ? 'rgba(34,197,94,0.1)' :
                    mensagem.tipo === 'error' ? 'rgba(239,68,68,0.1)' :
                    mensagem.tipo === 'warning' ? 'var(--warning-soft)' : 'rgba(91,127,255,0.1)';
    const corSoftBorder = mensagem.tipo === 'success' ? 'rgba(34,197,94,0.3)' :
                          mensagem.tipo === 'error' ? 'rgba(239,68,68,0.3)' :
                          mensagem.tipo === 'warning' ? 'var(--warning-soft-border)' : 'rgba(91,127,255,0.3)';

    return (
        <div
            className="p-4 rounded-xl flex items-start gap-3 animate-fade-in"
            style={{ background: corSoft, border: `1px solid ${corSoftBorder}`, borderLeft: `4px solid ${cor}` }}
        >
            <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: cor }}>
                    {mensagem.titulo}
                </p>
                {Array.isArray(mensagem.detalhes) ? (
                    // Um aviso por linha, com o rótulo de cada um à vista. O
                    // marcador é o que separa — o travessão não serve, porque
                    // as próprias frases o usam por dentro.
                    mensagem.detalhes.length > 0 && (
                        <ul className="text-xs mt-1.5 space-y-1.5 list-none" style={{ color: 'var(--text-secondary)' }}>
                            {mensagem.detalhes.map((d, i) => (
                                <li key={i} className="flex gap-1.5 items-start">
                                    <span aria-hidden="true" style={{ color: cor }}>•</span>
                                    <span className="flex-1">{d}</span>
                                </li>
                            ))}
                        </ul>
                    )
                ) : mensagem.detalhes ? (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {mensagem.detalhes}
                    </p>
                ) : null}
                {mensagem.extras && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {mensagem.extras.map(e => (
                            <div key={e.label} className="p-2 rounded" style={{ background: 'var(--bg-card)' }}>
                                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    {e.label}
                                </p>
                                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {e.value}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MensagemBlock;
