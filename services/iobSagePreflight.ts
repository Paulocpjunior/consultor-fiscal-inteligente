/**
 * FREIO antes de gerar o .FML (Paulo, 29/07).
 *
 * Cada erro que o E-Fiscal apontou hoje custou um ciclo inteiro: gerar,
 * baixar, importar, ler o demonstrativo, voltar. E o demonstrativo dizia
 * coisas que dava pra saber ANTES — CFOP de saída numa nota de entrada,
 * número zerado, nota sem participante.
 *
 * Aqui a conferência roda sobre o arquivo REAL: geramos em memória e
 * aplicamos as regras que o E-Fiscal já nos ensinou, agrupadas por CAUSA.
 * Não é adivinhação — é o mesmo conteúdo que seria enviado.
 *
 * Honestidade sobre o alcance: isto cobre o que já conhecemos das recusas
 * (e a estrutura do layout, que o gerador valida sozinho). O E-Fiscal tem
 * regras que ainda não vimos; quando aparecer uma nova, ela vira mais um
 * item aqui, e não mais uma rodada perdida.
 */
import type { DocumentoFiscal } from '../types';
import {
    exportarParaIobSage, participanteDoDoc, numeroDaNota, cfopParaEscriturar,
} from './iobSageExportService';

export type GravidadePreflight = 'bloqueia' | 'atencao';

export interface ProblemaPreflight {
    causa: string;
    /** O que o E-Fiscal responde quando isso passa. */
    oQueAconteceLa: string;
    acao: string;
    gravidade: GravidadePreflight;
    qtd: number;
    /** Até 8 exemplos, pra conferir sem abrir o arquivo. */
    exemplos: string[];
}

export interface ResultadoPreflight {
    documentos: number;
    /** Notas que efetivamente entrariam no arquivo. */
    notasNoArquivo: number;
    problemas: ProblemaPreflight[];
    bloqueios: number;
    farol: 'ok' | 'atencao' | 'bloqueado';
    resumo: string;
}

const rotulo = (d: DocumentoFiscal) =>
    `NF ${d.numero || numeroDaNota(d) || '?'}${d.serie ? `/${d.serie}` : ''}`;

/** Acumulador de problemas por causa. */
class Balde {
    private mapa = new Map<string, ProblemaPreflight>();

    add(base: Omit<ProblemaPreflight, 'qtd' | 'exemplos'>, exemplo: string) {
        const atual = this.mapa.get(base.causa) || { ...base, qtd: 0, exemplos: [] };
        atual.qtd++;
        if (atual.exemplos.length < 8 && !atual.exemplos.includes(exemplo)) atual.exemplos.push(exemplo);
        this.mapa.set(base.causa, atual);
    }

    lista(): ProblemaPreflight[] {
        const peso = { bloqueia: 0, atencao: 1 };
        return [...this.mapa.values()].sort(
            (a, b) => peso[a.gravidade] - peso[b.gravidade] || b.qtd - a.qtd,
        );
    }
}

/**
 * Confere o que seria enviado. Roda a geração REAL em memória — o que o
 * gerador não conseguir montar já vem como falha, e as regras de conteúdo
 * abaixo pegam o que ele monta mas o E-Fiscal recusa.
 */
export function conferirAntesDeGerar(
    documentos: DocumentoFiscal[],
    opts: { numeroEmpresaEfiscal: number; tipoInventario?: string },
): ResultadoPreflight {
    const balde = new Balde();
    const docs = documentos || [];

    let notasNoArquivo = 0;
    if (docs.length > 0) {
        try {
            const r = exportarParaIobSage({ documentos: docs, ...opts });
            notasNoArquivo = r.estatisticas.notasNoArquivo;
            for (const f of r.falhas) {
                balde.add({
                    causa: 'Nota que o app não consegue montar',
                    oQueAconteceLa: 'A nota simplesmente não vai no arquivo — e o E-Fiscal diz "importação concluída" sem ela.',
                    acao: 'Veja o motivo ao lado de cada nota. Em geral é dado que falta no documento capturado.',
                    gravidade: 'bloqueia',
                }, `${f.documento} — ${f.motivo}`);
            }
        } catch (e: any) {
            balde.add({
                causa: 'Falha ao montar o arquivo',
                oQueAconteceLa: 'Nada é gerado.',
                acao: String(e?.message || e),
                gravidade: 'bloqueia',
            }, 'arquivo inteiro');
        }
    }

    for (const d of docs) {
        const tipo = (d as any).tipoDoc || d.tipo;
        if (tipo && !['NFe', 'NFCe'].includes(tipo)) {
            balde.add({
                causa: `Documento ${tipo} não entra no .FML`,
                oQueAconteceLa: 'O layout Folhamatic Fiscal só recebe NF-e e NFC-e (modelos 55 e 65).',
                acao: 'CT-e, MDF-e e NFS-e têm trilho próprio — tire do recorte ou ignore este aviso.',
                gravidade: 'atencao',
            }, rotulo(d));
            continue;
        }

        if (!participanteDoDoc(d)) {
            balde.add({
                causa: 'Nota sem CNPJ do participante',
                oQueAconteceLa: 'Sem participante não dá pra gerar o E010 nem o E200 — a nota fica de fora.',
                acao: 'Confira o documento na Central de XMLs: emitente (entrada) ou destinatário (saída) sem CNPJ.',
                gravidade: 'bloqueia',
            }, rotulo(d));
        }

        if (numeroDaNota(d) <= 0) {
            balde.add({
                causa: 'Nota sem número',
                oQueAconteceLa: 'E200, campo 06: "só pode conter números e deve ser maior que 0" — a nota é recusada.',
                acao: 'O número sai da chave de acesso quando o campo está vazio; sem chave válida, só corrigindo o documento.',
                gravidade: 'bloqueia',
            }, `${rotulo(d)} · chave ${String(d.chave || '—').slice(0, 12)}…`);
        }

        const itens = d.itens || [];
        if (itens.length === 0) {
            balde.add({
                causa: 'Nota sem itens',
                oQueAconteceLa: 'A nota entra pelo total (E200/E201), mas sem produto nenhum (E221/E222).',
                acao: 'É esperado em resumo da SEFAZ (resNFe). Manifeste a ciência para liberar o XML completo.',
                gravidade: 'atencao',
            }, rotulo(d));
        }

        for (const it of itens) {
            const cfopFinal = cfopParaEscriturar(it.cfop, d.direcao);
            const primeiro = String(cfopFinal || '')[0];
            const esperado = d.direcao === 'entrada' ? ['1', '2', '3'] : ['5', '6', '7'];
            if (!primeiro || !esperado.includes(primeiro)) {
                balde.add({
                    causa: `CFOP inválido para nota de ${d.direcao === 'entrada' ? 'entrada' : 'saída'}`,
                    oQueAconteceLa: `E201, campo 08: "o CFOP é inválido para o tipo de nota. Informe um CFOP de ${d.direcao === 'entrada' ? 'entradas (com início 1, 2 e 3)' : 'saídas (com início 5, 6 e 7)'}".`,
                    acao: 'A conversão automática cobre 5/6/7 → 1/2/3. CFOP fora desse padrão precisa de override na tela Correlação CFOP.',
                    gravidade: 'bloqueia',
                }, `${rotulo(d)} · CFOP ${it.cfop || '(vazio)'} → ${cfopFinal || '(vazio)'}`);
                break; // um aviso por nota basta
            }
        }
    }

    const problemas = balde.lista();
    const bloqueios = problemas.filter((p) => p.gravidade === 'bloqueia').reduce((s, p) => s + p.qtd, 0);
    const farol: ResultadoPreflight['farol'] = bloqueios > 0 ? 'bloqueado'
        : problemas.length > 0 ? 'atencao' : 'ok';

    return {
        documentos: docs.length,
        notasNoArquivo,
        problemas,
        bloqueios,
        farol,
        resumo: docs.length === 0
            ? 'Nenhum documento no recorte.'
            : bloqueios > 0
                ? `${bloqueios} nota(s) seriam recusadas pelo E-Fiscal — ${notasNoArquivo} de ${docs.length} chegariam lá inteiras.`
                : problemas.length > 0
                    ? `As ${docs.length} nota(s) passam, com ${problemas.length} ressalva(s) para conferir.`
                    : `${docs.length} nota(s) conferidas: nada que o E-Fiscal costume recusar.`,
    };
}
