// ============================================================================
// 🚨 "IMPORTADA COM SUCESSO" — E A NOTA NÃO APARECIA EM LUGAR NENHUM
//
// 01/09, Paulo (0257 · MARCOS ANTONIO ZAMBOLIN INFORMATICA): *"fiz a
// importação do PDF da NFSe, ele diz que foi importado com sucesso, porém
// quando eu vou buscar a nota ou tiro livro de serviços prestados não tem
// nenhuma nota"*. A lista respondia **XMLs Capturados (0)** e ainda mandava
// procurar em Status por Empresa — ou seja, o app afirmava a gravação, negava
// a nota e apontava a primeira parada ERRADA (certificado, procuração).
//
// 🔴 A CAUSA É A ARMADILHA DAS DUAS FORMAS, no campo que RECORTA O MÊS. O
// leitor do PDF devolve a competência como o papel a escreve —
// `08/2026` (ABRASF) ou `18/08/2026` (DANFSe nacional, onde o campo
// "Competência da NFS-e" é uma DATA) — e `documentos_fiscais.competencia` é
// gravada em `AAAA-MM` por todo o resto do app. A consulta é
// `where('competencia','==','2026-08')`: a nota ESTÁ no banco e **não casa com
// nenhum recorte de competência** — nem na lista, nem no Livro de Serviços
// Prestados, nem no SPED.
//
// 📌 É a mesma classe do CNPJ em duas formas (22/08), e ela já custou caro
// aqui: a consulta por igualdade de competência liberou a MESMA cobrança duas
// vezes no caso HYPE (17/08) e fez o EFD sair VAZIO dizendo que a empresa não
// teve movimento (22/08). A diferença é o SINTOMA: aqui não há erro nenhum —
// há uma nota que existe e não aparece, que é a ausência PLAUSÍVEL.
//
// ⚠️ E o `dhEmi` saía no mesmo estado: `11/05/2026 14:31:31`. Quem lê pelo dono
// (`dataDeclaradaDoDocumento`) entende a forma brasileira, mas o `new Date()`
// da ordenação lê `11/05` como **5 de novembro** (mês/dia, à americana). A data
// que o documento DECLARA é a do TEXTO (a régua de 22/08) — o que muda aqui é
// só a FORMA de gravar, nunca o dia.
//
// ✂️ Este módulo é PURO de propósito: o importador é um `.tsx` que carrega o
// `pdfjs`, e régua dentro de tela é régua sem prova (a lição do parser do
// e-Fiscal, 17/08).
// ============================================================================
import { normalizarCompetencia } from '../sefaz-backend/competencia.js';

export interface RecorteNfsePdf {
    /** `AAAA-MM` — a forma que TODO leitor de competência deste app espera. */
    competencia: string | null;
    /** `AAAA-MM-DDTHH:MM:SS` (ou `AAAA-MM-DD`) — sem conversão de fuso. */
    dhEmi: string | null;
    /** De onde a competência saiu — número derivado não se apresenta como lido. */
    competenciaOrigem: 'campo-competencia' | 'data-de-emissao' | null;
    /** O que impede o recorte, dito para quem vai clicar em salvar. */
    impedimento: string | null;
}

/**
 * A data que o PDF declara, na forma que o app grava.
 *
 * ⚠️ NÃO converte fuso e NÃO chama `new Date()` sobre a forma brasileira:
 * `new Date('11/05/2026')` devolve 5 de NOVEMBRO. O dia é lido do texto.
 */
export function dhEmiDaNfsePdf(dataEmissao: unknown): string | null {
    const s = String(dataEmissao ?? '').trim();
    if (!s) return null;

    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[\sT]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) {
        const mes = Number(br[2]);
        if (mes < 1 || mes > 12) return null;
        const dia = `${br[3]}-${br[2]}-${br[1]}`;
        return br[4] ? `${dia}T${br[4]}:${br[5]}:${br[6] || '00'}` : dia;
    }

    // Já veio ISO (alguns emissores escrevem assim no PDF).
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return s;

    return null;
}

/**
 * O recorte do documento: em qual mês ele entra e com que data.
 *
 * 🚨 A COMPETÊNCIA NÃO SE CHUTA, mas ela também não pode ficar VAZIA: nota sem
 * competência some de TODO recorte mensal — da lista, do livro e do arquivo
 * fiscal —, que é exatamente o defeito deste caso com outra roupa. Por isso a
 * ordem é: o campo do papel primeiro; na falta dele, a DATA DE EMISSÃO, que é
 * um fato do próprio documento e vai CARIMBADA na origem. Não havendo nem uma
 * nem outra, o módulo RECUSA e diz por quê — gravar sem competência seria
 * repetir a promessa que a tela não cumpre.
 */
export function recorteDaNfsePdf(parsed: {
    competencia?: unknown;
    dataEmissao?: unknown;
}): RecorteNfsePdf {
    const dhEmi = dhEmiDaNfsePdf(parsed?.dataEmissao);

    const doCampo = normalizarCompetencia(parsed?.competencia);
    if (doCampo) {
        return { competencia: doCampo, dhEmi, competenciaOrigem: 'campo-competencia', impedimento: null };
    }

    // ⚠️ Só o DIA vai ao dono: ele reconhece `AAAA-MM-DD` e recusa o que tem
    // hora colada (a âncora é de propósito — é ela que barra lixo). Recortar
    // aqui é ler a data, não afrouxar a régua de quem valida competência.
    const daData = normalizarCompetencia(String(dhEmi || '').slice(0, 10));
    if (daData) {
        return { competencia: daData, dhEmi, competenciaOrigem: 'data-de-emissao', impedimento: null };
    }

    return {
        competencia: null,
        dhEmi,
        competenciaOrigem: null,
        impedimento: 'Não foi possível ler a competência nem a data de emissão deste PDF. '
            + 'Sem competência a nota não aparece em recorte de mês nenhum — nem na lista, nem no Livro '
            + 'de Serviços Prestados, nem no SPED. Preencha a competência (MM/AAAA) no formulário antes de salvar.',
    };
}

/**
 * O id do documento.
 *
 * 🐛 Ele levava `Date.now()` quando a NFS-e não tem chave de acesso (o caso das
 * prefeituras próprias) — então **reimportar o MESMO PDF criava um documento
 * novo**, e a nota passava a contar duas vezes no livro. Id determinístico faz
 * o reimport cair por cima do mesmo documento, que é o que a pessoa espera
 * quando reimporta para corrigir algo.
 */
export function idDaNfsePdf(p: {
    chaveAcesso?: unknown;
    empresaId: string;
    numero?: unknown;
    serie?: unknown;
}): string {
    const chave = String(p?.chaveAcesso ?? '').replace(/\D/g, '');
    if (chave.length >= 40) return chave;

    const limpo = (v: unknown) => String(v ?? '').trim().replace(/[^a-zA-Z0-9-]/g, '_') || 'SEM';
    return `nfse_${p.empresaId}_${limpo(p.numero)}_${limpo(p.serie)}`;
}
