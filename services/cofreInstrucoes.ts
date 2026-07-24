/**
 * cofreInstrucoes.ts — texto ÚNICO do comunicado ao cliente sobre a captura
 * de saída mod 55 pelo cofre de e-mail (substitui a SIEG).
 *
 * Usado em DOIS lugares (mesma fonte, sem drift):
 *  - CofreChecklistPanel: botão "📋 Instruções" por empresa (nome preenchido);
 *  - CapturaDiagnosticoPanel: card "Saída mod 55 — Cofre" (versão genérica) —
 *    o Paulo não achava o comunicado enterrado na aba Importação Manual.
 */
export function instrucoesMigracaoCofre(nomeEmpresa?: string): string {
    const alvo = nomeEmpresa?.trim() ? nomeEmpresa.trim() : 'sua empresa';
    return [
        `Olá! Somos da SP Assessoria Contábil, contabilidade da ${alvo}.`,
        '',
        'Para recebermos automaticamente os XMLs das notas fiscais emitidas (NF-e modelo 55), pedimos um ajuste único no sistema emissor de notas:',
        '',
        '1. Acesse as configurações do seu sistema emissor (a tela de "envio de XML por e-mail" — a mesma onde hoje pode estar o e-mail da SIEG).',
        '2. Cadastre/substitua o e-mail de envio automático dos XMLs por:',
        '',
        '   xml@spassessoriacontabil.com.br',
        '',
        '3. Se o sistema pedir "quantidade de notas por e-mail" ou periodicidade, pode manter o padrão — nosso sistema processa qualquer volume.',
        '',
        'Alternativa (ou reforço), se o emissor permitir: no campo "Autorizados a obter XML" (tag autXML) da emissão, inclua o CNPJ da contabilidade 44.388.152/0001-89 — com isso a própria SEFAZ nos entrega cada nota nova automaticamente.',
        '',
        'Só isso! A partir daí os XMLs chegam automaticamente para a contabilidade. Qualquer dúvida sobre onde fica essa configuração no seu emissor, respondemos por aqui.',
    ].join('\n');
}
