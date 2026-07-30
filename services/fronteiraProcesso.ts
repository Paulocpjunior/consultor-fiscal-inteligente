/**
 * fronteiraProcesso.ts — O CORTE oficial CFI × e-Fiscal (SAGE IOB).
 *
 * Paulo, 30/07/2026: "vamos segregar o que o colaborador pode fazer no CFI e o
 * que ainda tem que fazer no e-Fiscal — o colaborador fica perdido: o que
 * fazer, como fazer, onde fazer. Tem que ter um corte."
 *
 * Esta é a FONTE ÚNICA do corte. Cada tarefa fiscal diz ONDE é feita hoje
 * (cfi | efiscal), COMO (a tela/o caminho) e a observação que evita o erro
 * clássico. Quando uma função migrar do e-Fiscal pro CFI, muda AQUI — e a
 * tela da Rotina reflete na hora.
 *
 * Regra de bolso (aparece na tela):
 *   Capturar, conferir, calcular imposto federal, emitir e enviar guia → CFI.
 *   Livro/apuração de ICMS-IPI e SPED → e-Fiscal, SEMPRE alimentado pelo
 *   export do CFI (nunca digitar nota à mão lá).
 */

export type OndeFazer = 'cfi' | 'efiscal';
export type RegimeFronteira = 'simples' | 'lucro';

export interface TarefaFronteira {
    /** Nome da tarefa como o colaborador fala. */
    tarefa: string;
    onde: OndeFazer;
    /** O caminho exato (tela/botão) — sem "procure em". */
    como: string;
    /** Aviso curto que evita o erro clássico. Opcional. */
    obs?: string;
}

export const REGRA_DE_BOLSO =
    'Capturar, conferir, calcular imposto federal, emitir e enviar guia = CFI. '
    + 'Livro/apuração de ICMS-IPI e SPED = e-Fiscal (por enquanto), sempre alimentado pelo export do CFI.';

export const FRONTEIRA: Record<RegimeFronteira, TarefaFronteira[]> = {
    simples: [
        {
            tarefa: 'Captura das notas (entrada e saída)',
            onde: 'cfi',
            como: 'Automática. Acompanhar em Central de Documentos Fiscais → Captura → Diagnóstico / Status por Empresa.',
            obs: 'Não baixar nota em portal nenhum — se faltar, use a Prova de Saída e a Consulta por chave.',
        },
        {
            tarefa: 'Validação das notas do mês',
            onde: 'cfi',
            como: 'Central de Documentos Fiscais → XMLs (filtrar empresa + competência).',
        },
        {
            tarefa: 'Apuração / cálculo do Simples',
            onde: 'cfi',
            como: 'Simples Nacional → empresa → competência (faturamento por CNAE e por filial).',
            obs: 'Filial declara no PRÓPRIO CNPJ — usar o card "Faturamento por Estabelecimento".',
        },
        {
            tarefa: 'Declaração PGDAS-D + emissão do DAS',
            onde: 'cfi',
            como: 'Na própria apuração → botão Emitir DAS (transmite o PGDAS-D e emite a guia).',
        },
        {
            tarefa: 'Envio da guia ao cliente + baixa da obrigação',
            onde: 'cfi',
            como: 'Botão de envio na guia — o rito faz sozinho: SharePoint, gestor em cópia, baixa e auditoria.',
            obs: 'Nunca enviar guia por fora (e-mail avulso não dá baixa nem auditoria).',
        },
        {
            tarefa: 'DeSTDA (só quem tem ICMS-ST/DIFAL)',
            onde: 'efiscal',
            como: 'e-Fiscal, enquanto a migração não chega nessa entrega.',
            obs: 'Exceção única do Simples. Sem ST/DIFAL, o e-Fiscal NÃO se abre para cliente do Simples.',
        },
    ],
    lucro: [
        {
            tarefa: 'Captura das notas (entrada e saída)',
            onde: 'cfi',
            como: 'Automática. Acompanhar em Captura → Diagnóstico / Status por Empresa.',
        },
        {
            tarefa: 'Validação das notas + faturamento do mês (fichas)',
            onde: 'cfi',
            como: 'Central de Documentos → XMLs · Lucro → empresa → ficha da competência.',
        },
        {
            tarefa: 'Conferências (DCTFWeb × apuração · EFD-Reinf · SPED × XMLs)',
            onde: 'cfi',
            como: 'DCTFWeb → Conferência · abas de conferência correspondentes.',
        },
        {
            tarefa: 'MIT / DCTFWeb (encerrar apuração, retificar)',
            onde: 'cfi',
            como: 'DCTFWeb → empresa → competência (encerramento e retificação com os valores do app).',
        },
        {
            tarefa: 'DARF (PIS/COFINS · IRPJ/CSLL · quotas · vencimentos iguais)',
            onde: 'cfi',
            como: 'Aba DARF → guias separadas por vencimento / quotas.',
        },
        {
            tarefa: 'DARE-ICMS (emissão da guia)',
            onde: 'cfi',
            como: 'Lucro → DARE (API credenciada; uma a uma, com preview).',
        },
        {
            tarefa: 'Envio de guias ao cliente + baixa',
            onde: 'cfi',
            como: 'Botão de envio da guia — rito completo (SharePoint, gestor, baixa, auditoria).',
        },
        {
            tarefa: 'Exportar movimento para o e-Fiscal (.FML)',
            onde: 'cfi',
            como: 'Central de Documentos → Integrações → Exportar SAGE (IOB).',
            obs: 'É a PONTE: o e-Fiscal só recebe o que o CFI exporta. Nunca digitar nota à mão lá.',
        },
        {
            tarefa: 'Escrituração dos livros ICMS/IPI',
            onde: 'efiscal',
            como: 'e-Fiscal, importando o .FML exportado do CFI.',
        },
        {
            tarefa: 'Apuração de ICMS (créditos, ST, saldo credor)',
            onde: 'efiscal',
            como: 'e-Fiscal, após importar o movimento do mês.',
        },
        {
            tarefa: 'EFD ICMS/IPI (SPED Fiscal) — geração e entrega',
            onde: 'efiscal',
            como: 'e-Fiscal → gerar arquivo → validar no PVA → transmitir.',
            obs: 'Conferir depois no CFI (Conferência SPED × XMLs).',
        },
        {
            tarefa: 'EFD Contribuições — geração e entrega',
            onde: 'efiscal',
            como: 'e-Fiscal → gerar → PVA → transmitir.',
        },
    ],
};

/** Contagem por destino — o placar do corte (quanto já é CFI). */
export function resumoFronteira(regime: RegimeFronteira): { cfi: number; efiscal: number; total: number } {
    const linhas = FRONTEIRA[regime];
    const cfi = linhas.filter((l) => l.onde === 'cfi').length;
    return { cfi, efiscal: linhas.length - cfi, total: linhas.length };
}
