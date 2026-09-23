export interface CompetenciaDaNfse {
    /** `AAAA-MM`, ou `null` quando nada é legível — nunca um chute. */
    competencia: string | null;
    /** De onde ela saiu — número derivado não se apresenta como lido. */
    origem: 'declarada' | 'fato-gerador' | 'emissao' | null;
    /** A competência é de um mês DIFERENTE do da emissão (normal em SP). */
    diverge: boolean;
    /** A frase que EXPLICA a divergência (ou a ausência). `null` no caso trivial. */
    motivo: string | null;
}

/**
 * A que MÊS uma NFS-e pertence — precedência: campo de competência DECLARADO
 * (`<Competencia>` do ABRASF, `dCompet` do nacional) > data do FATO GERADOR >
 * data de EMISSÃO.
 *
 * 🚨 Em SP a nota de 31/08 pode ser emitida até 10/09 (05/09 quando há
 * retenção), e é por isso que o portal filtra por "Incidência": recortar pela
 * emissão põe a nota no mês seguinte e a tira de todo recorte do mês a que ela
 * pertence — sem erro nenhum na tela.
 */
export function competenciaDaNfse(p?: {
    competenciaDeclarada?: unknown;
    dataFatoGerador?: unknown;
    dataEmissao?: unknown;
}): CompetenciaDaNfse;
