export interface CanalPrefeituraSp {
    aplicavel: boolean;
    ccm: string;
    situacao: 'nao-se-aplica' | 'sem-ccm' | 'pronto';
    motivo: string | null;
}
export function canalPrefeituraSp(empresa: unknown): CanalPrefeituraSp;
