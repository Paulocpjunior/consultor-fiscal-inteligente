/**
 * ufsBrasil — siglas de UF aceitas nos registros fiscais.
 *
 * Módulo puro (sem Firebase) porque a validação é usada na gravação do De→Para
 * e precisa ser testável: UF errada no E010 não é erro de digitação inofensivo,
 * é escrituração no estado trocado — o E-Fiscal aceita e o erro só aparece
 * depois.
 *
 * 'EX' entra: participante do exterior existe no leiaute.
 */
export const UFS_VALIDAS = new Set([
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    'EX',
]);

export const ufValida = (uf: string): boolean => UFS_VALIDAS.has(String(uf || '').trim().toUpperCase());
