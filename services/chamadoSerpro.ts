/**
 * services/chamadoSerpro.ts  (PURO — sem React, sem I/O)
 * ----------------------------------------------------------------------------
 * O TEXTO DO CHAMADO AO SERPRO, montado a partir da evidência da sonda.
 *
 * ═══ POR QUE ISTO É CÓDIGO, E NÃO "o Paulo escreve o chamado" ════════════════
 *
 * A sonda do "sem movimento" (ELS 07/2026) já respondeu o que dava pra
 * responder daqui: as 6 formas voltaram com o MESMO código, logo a recusa NÃO
 * olha a estrutura. Daí em diante quem responde é o SERPRO — e abrir chamado é
 * uma ENTREGA como qualquer outra: mal montado, volta como "reenvie com mais
 * detalhes" e a competência continua vencendo.
 *
 * O botão antigo copiava um DESPEJO (veredito + candidatos). Despejo não é
 * chamado: falta a identificação (CNPJ, PA, ambiente, serviço), falta dizer que
 * NADA foi transmitido — sem isso o atendente lê "declaração recusada" e
 * responde sobre entrega — e falta a PERGUNTA. Pedir que a pessoa monte isso na
 * mão é a mesma armadilha do "descreva seu problema": quem abre o chamado não
 * tem por que saber que o `TRANSDECLARACAO11` tem dois modos.
 *
 * ═══ AS TRAVAS DESTE MÓDULO ═════════════════════════════════════════════════
 *
 * 1. **A PERGUNTA SEGUE O VEREDITO.** Código único ⇒ a estrutura não foi
 *    avaliada, e perguntar "qual o leiaute do sem movimento" jogaria fora o
 *    achado (e traria de volta uma resposta genérica sobre payload). Códigos
 *    diferentes ⇒ aí sim a pergunta é sobre o campo.
 * 2. **A MENSAGEM DO SERPRO VAI INTEIRA.** Foi o corte do toast que fez a
 *    primeira rodada não servir pra nada. Sem truncar, sem resumir.
 * 3. **CHAMADO SEM EVIDÊNCIA É RECUSADO AQUI.** Rodada só com indeterminado
 *    (rede/credencial) não vira chamado — abrir com "não consegui perguntar"
 *    queima o canal e a próxima resposta demora mais.
 * 4. **NADA FOI TRANSMITIDO fica na PRIMEIRA linha do corpo**, não no rodapé.
 */

export interface CandidatoSonda {
    nome: string;
    hipotese: string;
    situacao: 'aceita' | 'recusada' | 'indeterminado';
    codigo: string | null;
    mensagem: string;
}

export interface VereditoSonda {
    destravou?: boolean;
    forma?: string | null;
    resumo?: string;
    aEstruturaFoiAvaliada?: boolean;
    codigoUnico?: string | null;
}

export interface ResultadoSonda {
    competencia?: string;
    candidatos?: CandidatoSonda[];
    veredito?: VereditoSonda;
}

export interface DadosChamado {
    razaoSocial?: string | null;
    cnpj?: string | null;
    competencia?: string | null;
    /** Data da rodada, em ISO ou timestamp. Quem chama passa — o módulo é puro. */
    rodadoEm?: string | null;
    resultado: ResultadoSonda | null | undefined;
}

export interface Chamado {
    assunto: string;
    corpo: string;
    /** Falso quando não há evidência que justifique abrir chamado. */
    podeAbrir: boolean;
    motivoDoBloqueio: string | null;
}

const fmtCnpj = (v?: string | null) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length === 14
        ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
        : (v || '—');
};

/** AAAA-MM → MM/AAAA (é assim que o e-CAC e o SERPRO chamam o período). */
const fmtPa = (v?: string | null) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length >= 6 ? `${d.slice(4, 6)}/${d.slice(0, 4)}` : (v || '—');
};

/**
 * A pergunta objetiva do chamado.
 *
 * É a parte que decide se o chamado serve: o atendente responde a PERGUNTA que
 * está escrita, não a que estava na cabeça de quem abriu.
 */
export function perguntaDoChamado(dados: DadosChamado): string {
    const v = dados.resultado?.veredito || {};
    const cnpj = fmtCnpj(dados.cnpj);
    const pa = fmtPa(dados.competencia);

    if (v.aEstruturaFoiAvaliada === false && v.codigoUnico) {
        // O achado: seis estruturas diferentes, um código só. Perguntar sobre
        // leiaute aqui desperdiçaria a rodada inteira.
        return `Por que a VALIDAÇÃO do PGDAS-D (TRANSDECLARACAO11 com `
            + `indicadorTransmissao = false) retorna ${v.codigoUnico} para o CNPJ ${cnpj} no período `
            + `de apuração ${pa}?\n\n`
            + `Especificamente: ${v.codigoUnico} é uma validação de CONTEÚDO da declaração ou uma `
            + `validação anterior a ela (situação cadastral do contribuinte, período de apuração, `
            + `opção pelo Simples Nacional, procuração eletrônica do contratante)? Enviamos seis `
            + `estruturas de declaração diferentes entre si e todas retornaram exatamente este mesmo `
            + `código — o que indica que a recusa ocorre antes da avaliação do conteúdo. Precisamos `
            + `saber o que corrigir do lado do contribuinte.`;
    }

    return `Qual é a estrutura de declaração que o SN-Entregar aceita para o PGDAS-D SEM MOVIMENTO `
        + `(competência sem receita), para o CNPJ ${cnpj} no período de apuração ${pa}?\n\n`
        + `Testamos as formas abaixo em modo de VALIDAÇÃO e cada uma retornou um código diferente, `
        + `o que indica que a estrutura chegou a ser avaliada. Pedimos a especificação do campo que `
        + `expressa "sem movimento" no TRANSDECLARACAO11 — não localizamos essa informação na `
        + `documentação a que temos acesso.`;
}

/**
 * Monta o chamado inteiro, pronto para colar no portal do SERPRO.
 *
 * `podeAbrir = false` quando não há evidência: rodada vazia ou só com
 * indeterminado (rede/credencial). Chamado sem evidência não é chamado.
 */
export function montarChamadoSerpro(dados: DadosChamado): Chamado {
    const candidatos = dados.resultado?.candidatos || [];
    const v = dados.resultado?.veredito || {};
    const cnpj = fmtCnpj(dados.cnpj);
    const pa = fmtPa(dados.competencia);

    const responderam = candidatos.filter((c) => c.situacao !== 'indeterminado');
    if (!candidatos.length || !responderam.length) {
        return {
            assunto: '',
            corpo: '',
            podeAbrir: false,
            motivoDoBloqueio: !candidatos.length
                ? 'A sonda ainda não rodou — não há o que levar ao SERPRO.'
                : 'Nenhuma das formas obteve resposta do SN-Entregar (rede ou credencial). Isso não é '
                + 'recusa: repita a sonda antes de abrir chamado. Chamado sem a resposta do serviço volta '
                + 'como "reenvie com mais detalhes".',
        };
    }
    if (v.destravou) {
        return {
            assunto: '',
            corpo: '',
            podeAbrir: false,
            motivoDoBloqueio: `A sonda ENCONTROU a forma aceita ("${v.forma}"). Não há o que perguntar ao `
                + 'SERPRO — o que falta é implementar essa forma no app.',
        };
    }

    const codigos = [...new Set(candidatos.map((c) => c.codigo).filter(Boolean))] as string[];
    const assunto = `PGDAS-D / SN-Entregar — ${codigos.length === 1 ? codigos[0] + ' na ' : ''}`
        + `validação de declaração sem movimento — CNPJ ${cnpj}, PA ${pa}`;

    const linhas: string[] = [];

    // 1ª linha do corpo, sempre: sem isto o atendente lê "declaração recusada"
    // e responde sobre ENTREGA, que não foi o que aconteceu.
    linhas.push(
        'IMPORTANTE: nenhuma declaração foi transmitida. Todas as chamadas abaixo usaram o serviço '
        + 'TRANSDECLARACAO11 com indicadorTransmissao = false (modo de validação).',
        '',
        '── IDENTIFICAÇÃO ──',
        `Contribuinte: ${dados.razaoSocial || '—'}`,
        `CNPJ: ${cnpj}`,
        `Período de apuração: ${pa}`,
        'API: Integra Contador — Integra-SN',
        'Serviço: TRANSDECLARACAO11 (idSistema SIMPLESNACIONAL / idServico TRANSDECLARACAO11)',
        'Modo: validação (indicadorTransmissao = false) — sem transmissão',
        `Data das chamadas: ${dados.rodadoEm || '—'}`,
        '',
        '── SITUAÇÃO ──',
        'A empresa não teve faturamento na competência. Ao montar a declaração sem receita, a '
        + 'validação é recusada e não conseguimos concluir a entrega pela API.',
        v.resumo ? `\nLeitura do resultado: ${v.resumo}` : '',
        '',
        '── PERGUNTA ──',
        perguntaDoChamado(dados),
        '',
        '── O QUE FOI TESTADO (uma chamada por linha) ──',
    );

    candidatos.forEach((c, i) => {
        linhas.push(
            `${i + 1}. ${c.nome} [${c.situacao}${c.codigo ? ' · ' + c.codigo : ''}]`,
            `   Estrutura testada: ${c.hipotese}`,
            // A mensagem vai INTEIRA. Foi o corte do toast que fez a primeira
            // rodada não servir pra nada.
            `   Retorno do SN-Entregar: ${c.mensagem}`,
        );
    });

    if (v.aEstruturaFoiAvaliada === false && v.codigoUnico) {
        linhas.push(
            '',
            '── POR QUE ACREDITAMOS QUE NÃO É A ESTRUTURA ──',
            `As ${candidatos.length} chamadas usaram estruturas de declaração diferentes entre si `
            + '(com e sem a lista de estabelecimentos, com e sem o campo de atividades, com e sem '
            + 'marcação de ausência de movimento) e todas retornaram o mesmo código '
            + `${v.codigoUnico}. Estruturas diferentes não falham pelo mesmo motivo se o motivo `
            + 'fosse a estrutura.',
        );
    }

    linhas.push(
        '',
        '── O QUE PEDIMOS ──',
        codigos.length === 1
            ? `O significado do código ${codigos[0]} e a condição que precisa ser corrigida para que a `
              + 'declaração sem movimento deste CNPJ possa ser validada e entregue pela API.'
            : 'A especificação do campo que expressa "sem movimento" no TRANSDECLARACAO11, com um '
              + 'exemplo de payload de declaração sem receita.',
        '',
        'Observação: a competência continua vencendo (MAED de R$ 50,00 por competência não entregue), '
        + 'e enquanto isso a entrega está sendo feita manualmente no e-CAC.',
    );

    return {
        assunto,
        corpo: linhas.filter((l) => l !== undefined).join('\n'),
        podeAbrir: true,
        motivoDoBloqueio: null,
    };
}
