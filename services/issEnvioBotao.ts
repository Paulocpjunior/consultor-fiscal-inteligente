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
export function motivoDoBotaoDesligado(temPdf: boolean, apta: boolean): string | null {
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

