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
    /**
     * O resultado da IMPORTAÇÃO, quando ela foi pedida.
     *
     * 🚨 Até 03/09 a NFTS **nunca virava documento** — este módulo só CRUZAVA
     * (Paulo: *"ela não aparece pra mim no consultor"*). Nota que não pôde ser
     * gravada volta em `foras`, NOMEADA: "3 importadas" sem dizer que 2 ficaram
     * de fora é o que faz alguém achar que declarou tudo.
     */
    importacao?: {
        gravadas: number;
        atualizadas: number;
        canceladas: number;
        competencias: Record<string, number>;
        foras: Array<{ numero: string; prestador: string; lacunas: string[] }>;
    } | null;
}

/** O que a recusa de LAYOUT devolve — o cabeçalho que o app leu vem junto. */
export interface RecusaLayoutNfts {
    erro: string;
    colunasFaltando?: string[];
    colunasReconhecidas?: string[];
    cabecalhoLido?: string[];
    acao?: string;
}

export async function cruzarNfts(
    empresaId: string,
    competencia: string,
    csv: File,
    /**
     * ⚠️ OPT-IN de propósito: gravar por padrão faria uma CONFERÊNCIA (que é
     * leitura) escrever no banco sem ninguém pedir. Quem grava é o clique.
     */
    importar = false,
): Promise<CruzamentoNftsResposta> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessão expirada — entre novamente.');
    const fd = new FormData();
    fd.append('csv', csv);
    fd.append('empresaId', empresaId);
    fd.append('competencia', competencia);
    if (importar) fd.append('importar', 'true');
    const r = await fetch('/api/admin/nfts/cruzamento', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        body: fd,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
        // 📌 O CABEÇALHO LIDO VIAJA NO ERRO: é ele que mapeia o layout novo sem
        // precisar do arquivo do cliente (a régua do `xmlOndeEstaOCnpj`).
        const e: any = new Error((json as any)?.erro || `Falha (${r.status})`);
        e.detalhe = json as RecusaLayoutNfts;
        throw e;
    }
    return json as CruzamentoNftsResposta;
}
