// ============================================================================
// services/issEnvioBotao.ts  (PURO — testável)
// ----------------------------------------------------------------------------
/**
 * Por que o "📤 Enviar guia ao cliente" está apagado — ou `null` quando não
 * está.
 *
 * 🚨 31/08, Paulo: *"A função de enviar o ISS via sistema não está disponível,
 * igual aos outros impostos, certo?"*. **Ela está** — o rito é o mesmo do DAS,
 * do DARF e do DARE (servidor, gestor em cópia oculta, cópia no SharePoint,
 * baixa da obrigação). O botão estava desligado por falta do PDF, e **o app
 * não dizia isso**: botão apagado sem motivo se lê como função inexistente.
 *
 * ⚠️ E a razão de o PDF ser obrigatório AQUI e não nos outros é do imposto, não
 * do app: **a guia do ISS é emitida no portal da Prefeitura** — o CFI não cria
 * número de guia. Sem o anexo não há o que mandar ao cliente nem o que
 * arquivar. A frase diz isso, senão a exigência parece capricho.
 *
 * ⚠️ As duas causas são SEPARADAS de propósito: a ação de uma é anexar o PDF,
 * a da outra é resolver a pendência da apuração. Uma frase só faria a pessoa
 * procurar a coisa errada.
 */
export function motivoDoBotaoDesligado(temPdf: boolean, apta: boolean, opts?: { aRecolher?: number; retido?: number }): string | null {
    // 🚨 02/10 (BOLA N'AGUA): ISS próprio ZERO não é "pendência" — é não ter
    // guia do prestador. Dizer "pendência" mandava procurar defeito onde não
    // há, e escondia que o retido como tomadora tem envio PRÓPRIO.
    if (!apta && opts && Number(opts.aRecolher || 0) === 0) {
        return Number(opts.retido || 0) > 0
            ? 'Não há ISS PRÓPRIO a recolher nesta competência — este botão é da guia do prestador. '
                + 'A guia do ISS RETIDO como tomadora tem anexo e envio próprios, no bloco azul acima.'
            : 'Não há ISS próprio a recolher nesta competência — não há guia do prestador para enviar.';
    }
    if (!apta) {
        return 'A apuração tem pendência (veja os avisos acima) — resolva antes de mandar a guia ao cliente. '
            + 'Guia enviada sobre apuração que o próprio app desmente volta como retrabalho.';
    }
    if (!temPdf) {
        return 'Falta anexar o PDF da guia. O envio pelo sistema EXISTE aqui — igual ao DAS e ao DARF, com '
            + 'gestor em cópia, arquivamento no SharePoint e baixa da obrigação —, mas a guia do ISS é '
            + 'emitida no portal da Prefeitura (o app não cria o número dela). Emita no portal, clique em '
            + '"📎 Anexar PDF da guia" e o botão liga.';
    }
    return null;
}


/** Uma nota do retido, só com o que a régua lê. */
interface NotaRetidoParaEnvio { issRetido: number; semValorGravado: boolean }

/**
 * A guia do ISS RETIDO como tomadora pode ser enviada? (02/10)
 *
 * Colaborador, na BOLA N'AGUA: *"tentei encaminhar o guia de ISS TOMADOS pelo
 * consultor, mas o consultor está habilitado somente para ISS PRESTADOS"*. O
 * botão único conferia só o ISS próprio (`apta` exige `aRecolher > 0`), e a
 * empresa que só deve o retido não tinha como mandar a guia.
 *
 * Régua: há valor retido E nenhuma nota tomada marcada como retida sem o valor
 * gravado (ausência não é zero — guia a menor é multa depois).
 */
export function retidoAptoParaEnvio(tomado: { totalRetido?: number; notas?: NotaRetidoParaEnvio[] } | null | undefined): boolean {
    if (!tomado || !(Number(tomado.totalRetido || 0) > 0)) return false;
    return !(tomado.notas || []).some((n) => n.semValorGravado);
}

/** Por que o envio da guia do RETIDO está desligado — ou null. */
export function motivoDoBotaoRetidoDesligado(temPdf: boolean, apto: boolean): string | null {
    if (!apto) {
        return 'Há nota tomada marcada como RETIDA sem o valor gravado — ausência não é zero. '
            + 'Reimporte a competência antes de mandar a guia do retido.';
    }
    if (!temPdf) {
        return 'Falta anexar o PDF da guia do ISS RETIDO (emitida no portal da Prefeitura). '
            + 'Clique em "📎 Anexar PDF da guia do retido" e o botão liga.';
    }
    return null;
}
