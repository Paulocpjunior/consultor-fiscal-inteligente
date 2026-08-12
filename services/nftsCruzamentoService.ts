/**
 * nftsCruzamentoService — porta do front para a VOLTA da NFTS.
 *
 * A conta não mora aqui: é do núcleo `nfts-cruzamento.js` + `nfts-sp-csv-parser.js`.
 */
import { getAuth } from 'firebase/auth';

export interface NftsDuplicada {
    docPrestador: string;
    nomePrestador: string;
    numeroDocumento: string;
    dataPrestacao: string;
    valorServicos: number;
    valorIss: number;
    numeros: string[];
    acao: string;
}

export interface LinhaCruzamento {
    numero: string;
    data: string;
    participante: string;
    doc: string;
    municipio: string;
    base: number;
    issRetido: number;
    motivo: string;
    nftsNumero?: string;
    issRetidoNaoDeclarado?: number;
}

export interface CruzamentoNftsResposta {
    ok: boolean;
    empresaId: string;
    competencia: string;
    arquivo: {
        nome: string;
        colunas: number;
        nftsLidas: number;
        totalDeclarado: number | null;
        valorServicosDeclarado: number | null;
        valorIssDeclarado: number | null;
        periodoSemNfts: boolean;
        acao: string | null;
        duplicadas: NftsDuplicada[];
    };
    cobertos: LinhaCruzamento[];
    semNfts: LinhaCruzamento[];
    indeterminados: LinhaCruzamento[];
    nftsSemServico: any[];
    resumo: {
        servicosTomados: number;
        nftsEmitidas: number;
        comLacuna: number;
        indeterminados: number;
        totalSemNfts: number;
        issRetidoNaoDeclarado: number;
    };
    /** Frase obrigatória — o cruzamento é parcial por construção. */
    cobertura: string;
    semLacunaMasParcial: boolean;
}

export async function cruzarNfts(
    empresaId: string,
    competencia: string,
    csv: File,
): Promise<CruzamentoNftsResposta> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessão expirada — entre novamente.');
    const fd = new FormData();
    fd.append('csv', csv);
    fd.append('empresaId', empresaId);
    fd.append('competencia', competencia);
    const r = await fetch('/api/admin/nfts/cruzamento', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        body: fd,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((json as any)?.erro || `Falha (${r.status})`);
    return json as CruzamentoNftsResposta;
}
