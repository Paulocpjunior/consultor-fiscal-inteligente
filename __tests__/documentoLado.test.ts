// ============================================================================
// A MESMA NF-e É SAÍDA DE UMA EMPRESA E ENTRADA DA OUTRA — e agora cada uma
// fica com o SEU documento.
//
// Paulo, 11/09, LEGACY × FEDERAÇÃO: *"fui importar o movimento de saída da
// empresa 360 - Legacy, são notas emitidas para Federação, porém no consultor
// diz que esse XML já está gravado em outra empresa (Federação)"*. A raiz
// estava nomeada desde 17/08 (KROYA × GOLDLOG): o id do documento é a CHAVE,
// então uma chave só comportava um dono. O contorno era lançar pelo ✍️ sem
// chave, nota a nota — e a digitada nunca recebe o cancelamento pela chave.
//
// E o print mostrou uma segunda coisa: a tela nem chegou na frase da
// contraparte. O documento da Federação é um RESUMO (resNFe) só com o
// emitente, e a posse julgada só pelo gravado dizia "dono não é parte".
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    idDoDocumentoDoLado, ehIdDeLado, chaveDoIdDeDocumento, carimboDoLado, ehDocumentoDeLado,
} from '../sefaz-backend/documento-lado.js';
import { decidirPosseDocumento, partesDoDocumento } from '../sefaz-backend/documento-posse.js';
import { lerDuplicado } from '../services/importDuplicadoMotivo';
// @ts-expect-error módulo .js sem .d.ts (I/O)
import { gravarCancelamentoConfirmado } from '../sefaz-backend/cancelamento-gravacao.js';
// @ts-expect-error módulo .js sem .d.ts
import { anexarEventoNaNFe } from '../sefaz-backend/xml-importer.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const CHAVE = '35260814583444000101550010000004821142128437';
const LEGACY = '14583444000101';       // emitente (saída)
const FEDERACAO = '00621930000162';    // destinatária (entrada)
const TERCEIRO = '11111111000191';

describe('o dono do id do outro lado', () => {
    it('id = chave + separador + CNPJ de quem escritura; a chave volta de qualquer id', () => {
        const id = idDoDocumentoDoLado(CHAVE, '14.583.444/0001-01');
        expect(id).toBe(`${CHAVE}__lado_${LEGACY}`);
        expect(ehIdDeLado(id)).toBe(true);
        expect(ehIdDeLado(CHAVE)).toBe(false);
        expect(chaveDoIdDeDocumento(id)).toBe(CHAVE);
        expect(chaveDoIdDeDocumento(CHAVE)).toBe(CHAVE);
    });

    it('chave ou CNPJ ilegível NÃO monta id — id chutado é documento órfão', () => {
        expect(idDoDocumentoDoLado('123', LEGACY)).toBe('');
        expect(idDoDocumentoDoLado(CHAVE, '')).toBe('');
        expect(chaveDoIdDeDocumento('nfsesp-1-2-3')).toBe('');
        expect(chaveDoIdDeDocumento('digitada_x_1_1_2026-08')).toBe('');
    });

    it('o carimbo guarda a chave (é por ela que a propagação acha o lado) e o outro dono', () => {
        const c = carimboDoLado({ chave: CHAVE, outroLadoCnpj: '00.621.930/0001-62', outroLadoEmpresaId: 'fed', agoraIso: '2026-09-11T10:00:00Z' });
        expect(c).toEqual({ chave: CHAVE, outroLadoCnpj: FEDERACAO, outroLadoEmpresaId: 'fed', em: '2026-09-11T10:00:00Z' });
        expect(ehDocumentoDeLado({ ladoDe: c })).toBe(true);
        expect(ehDocumentoDeLado({})).toBe(false);
        expect(carimboDoLado({ chave: 'x' })).toBeNull();
    });
});

describe('🚨 a posse lê as partes do GRAVADO e do que CHEGA — o resumo só tem o emitente', () => {
    const resumoDaFederacao = {
        empresaId: 'fed', empresaCnpj: FEDERACAO, cnpjEmit: LEGACY, // sem cnpjDest: é resNFe
        schema: 'resNFe', tipoDoc: 'resNFe', temItens: false,
    };

    it('só pelo gravado, a destinatária parecia "dono que não é parte" (o defeito do print)', () => {
        const p = decidirPosseDocumento({
            existente: resumoDaFederacao,
            pretendente: { empresaId: 'legacy', empresaCnpj: LEGACY },
            documento: resumoDaFederacao,
        });
        expect(p.situacao).toBe('dono-nao-e-parte');
    });

    it('com o arquivo completo (que traz o destinatário), as duas são partes → contraparte legítima', () => {
        const p = decidirPosseDocumento({
            existente: resumoDaFederacao,
            pretendente: { empresaId: 'legacy', empresaCnpj: LEGACY },
            documento: { cnpjEmit: LEGACY, cnpjDest: FEDERACAO },
        });
        expect(p.situacao).toBe('contraparte-legitima');
        expect(p.reatribuir).toBe(false);
    });

    it('a união não inventa parte: terceiro continua fora', () => {
        expect(partesDoDocumento({ __partesDe: [resumoDaFederacao, { cnpjEmit: LEGACY, cnpjDest: FEDERACAO }] }))
            .toEqual([LEGACY, FEDERACAO]);
        const p = decidirPosseDocumento({
            existente: { empresaId: 'outra', empresaCnpj: TERCEIRO, cnpjEmit: LEGACY },
            pretendente: { empresaId: 'legacy', empresaCnpj: LEGACY },
            documento: { cnpjEmit: LEGACY, cnpjDest: FEDERACAO },
        });
        expect(p.situacao).toBe('dono-nao-e-parte');
    });
});

describe('a leitura da importação manual (o print da LEGACY)', () => {
    const legacy = { id: 'legacy', nome: 'LEGACY COMERCIO DE LIVROS E EDICOES LTDA', cnpj: '14.583.444/0001-01' };
    const resumo = {
        empresaId: 'fed', empresaCnpj: FEDERACAO, cnpjEmit: LEGACY, origem: 'sefaz',
        schema: 'resNFe', tipoDoc: 'resNFe', temItens: false, chave: CHAVE,
        createdAt: { seconds: 1757548800, nanoseconds: 0 }, // 11/09/2026 — Timestamp do Firestore
    };

    it('sem as partes do arquivo, caía em "OUTRA empresa" (o que ele viu)', () => {
        const r = lerDuplicado(resumo as any, legacy);
        expect(r.situacao).toBe('em-outra-empresa');
    });

    it('com as partes do arquivo, é o OUTRO LADO — e a frase diz que ninguém errou', () => {
        const r = lerDuplicado(resumo as any, legacy, { cnpjEmit: LEGACY, cnpjDest: FEDERACAO });
        expect(r.situacao).toBe('contraparte-na-carteira');
        expect(r.gravaOutroLado).toBe(true);
        expect(r.exigeAcao).toBe(false);
        expect(r.permiteReincluir).toBe(false);
        expect(r.mensagem).toMatch(/OUTRO LADO/);
        expect(r.mensagem).not.toMatch(/corrigida na origem/);
        expect(r.mensagem).not.toMatch(/Lançar nota sem XML/);
    });

    it('a data da captura pela SEFAZ (createdAt, Timestamp) deixa de sair "não registrada"', () => {
        const r = lerDuplicado(resumo as any, legacy, { cnpjEmit: LEGACY, cnpjDest: FEDERACAO });
        expect(r.mensagem).not.toMatch(/data não registrada/);
        expect(r.mensagem).toMatch(/em \d{2}\/\d{2}\/\d{4}/);
    });

    it('terceiro na carteira continua "OUTRA empresa" — o lado só nasce para quem é parte', () => {
        const r = lerDuplicado({ ...resumo, empresaCnpj: TERCEIRO, empresaId: 'outra' } as any, legacy,
            { cnpjEmit: LEGACY, cnpjDest: FEDERACAO });
        expect(r.situacao).toBe('em-outra-empresa');
        expect(r.gravaOutroLado).toBeUndefined();
    });
});

describe('🚨 os três importadores gravam o outro lado pelo DONO — e a tela diz', () => {
    it('navegador: passa as partes do arquivo à leitura e usa o id do dono', () => {
        const src = ler('services/xmlFiscalService.ts');
        expect(src).toMatch(/from '\.\.\/sefaz-backend\/documento-lado\.js'/);
        expect(src).toMatch(/lerDuplicado\(\s*existing[^;]*empresa,\s*partesDoArquivo,?\s*\)/);
        expect(src).toMatch(/idDoDocumentoDoLado\(chave, empresa\.cnpj\)/);
        expect(src).toMatch(/paraGravar\.ladoDe = ladoDe/);
        // A fórmula à mão está proibida (reguaUnica) — aqui só a delegação.
        expect(src).not.toMatch(/__lado_/);
    });

    it('xml-importer (SEFAZ/cofre/autXML): contraparte legítima vira lado, não recusa', () => {
        const src = ler('sefaz-backend/xml-importer.js');
        expect(src).toMatch(/situacao === 'contraparte-legitima'\s*\?\s*idDoDocumentoDoLado\(meta\.chave, empresaCnpj\)/);
        expect(src).toMatch(/\.\.\.\(ladoDe \? \{ ladoDe \} : \{\}\)/);
        expect(src).toMatch(/outroLado: ladoDe \? true : undefined/);
    });

    it('sharepoint-auto-sync: idem — era um "duplicados++" mudo', () => {
        const src = ler('sefaz-backend/sharepoint-auto-sync.js');
        expect(src).toMatch(/decidirPosseDocumento\(/);
        expect(src).toMatch(/idDoDocumentoDoLado\(parsed\.chave, cnpj\)/);
    });

    it('a tela nomeia o outro lado — um documento "a mais" na base sem frase é susto', () => {
        const src = ler('components/xml/XmlImportacaoManual.tsx');
        expect(src).toMatch(/res\.outroLado/);
        expect(src).toMatch(/importada como o OUTRO LADO/);
    });
});

// ─── Banco falso: coleção única, com where('ladoDe.chave','==') e transação ───
function bancoFalso(inicial: Record<string, any>) {
    const dados: Record<string, any> = JSON.parse(JSON.stringify(inicial));
    const ref = (id: string) => ({
        id,
        get: async () => ({ exists: id in dados, data: () => dados[id], id }),
        set: async (patch: any, opts?: any) => {
            const av = patch.eventos && patch.eventos.__arrayUnion;
            const base = opts?.merge ? { ...(dados[id] || {}) } : {};
            const novo = { ...base, ...patch };
            if (av) novo.eventos = [...((dados[id] || {}).eventos || []), ...av];
            dados[id] = novo;
        },
        update: async (patch: any) => { dados[id] = { ...(dados[id] || {}), ...patch }; },
    });
    const db = {
        collection: () => ({
            doc: ref,
            where: (campo: string, _op: string, valor: any) => ({
                get: async () => ({
                    docs: Object.entries(dados)
                        .filter(([, d]) => campo === 'ladoDe.chave' && d?.ladoDe?.chave === valor)
                        .map(([id]) => ({ id, ref: ref(id) })),
                }),
            }),
        }),
        runTransaction: async (fn: (tx: any) => Promise<any>) => fn({
            get: async (r: any) => r.get(),
            update: (r: any, patch: any) => { dados[r.id] = { ...(dados[r.id] || {}), ...patch }; },
            set: (r: any, v: any) => { dados[r.id] = v; },
        }),
    };
    const FieldValue = { arrayUnion: (...v: any[]) => ({ __arrayUnion: v }) };
    return { db, dados, FieldValue };
}

const LADO = `${CHAVE}__lado_${LEGACY}`;
const doisLados = () => ({
    [CHAVE]: { empresaId: 'fed', empresaCnpj: FEDERACAO, chave: CHAVE, status: 'autorizado', eventos: [] },
    [LADO]: { empresaId: 'legacy', empresaCnpj: LEGACY, chave: CHAVE, status: 'autorizado', eventos: [], ladoDe: { chave: CHAVE, outroLadoCnpj: FEDERACAO } },
});

describe('🚨 o que chega pela CHAVE chega nos DOIS lados', () => {
    it('cancelamento confirmado pela reconferência da LEGACY (id do lado) cancela também o da Federação', async () => {
        const { db, dados, FieldValue } = bancoFalso(doisLados());
        await gravarCancelamentoConfirmado({ db, FieldValue, docId: LADO, evento: { tpEvento: '110111', cStat: '135' }, origem: 'reconferencia-sefaz', usuario: 'x' });
        expect(dados[CHAVE].status).toBe('cancelado');
        expect(dados[LADO].status).toBe('cancelado');
        expect(dados[CHAVE].eventos).toHaveLength(1);
        expect(dados[LADO].eventos).toHaveLength(1);
    });

    it('evento 110111 capturado pela SEFAZ no lado da Federação (id = chave) chega no lado da LEGACY', async () => {
        const { db, dados } = bancoFalso(doisLados());
        const r = await anexarEventoNaNFe({
            db, chaveNFe: CHAVE, empresaId: 'fed',
            evento: { tpEvento: '110111', tipo: 'cancelamento', cStat: '135', nProt: '135260000000001', dhEvento: '2026-09-10T10:00:00-03:00' },
            storagePath: 'x', xmlHash: 'h', schema: 'procEventoNFe', nsu: '1', capturadoPor: null, tipoDocNormalizado: 'NFe',
        });
        expect(r.status).toBe('evento_anexado');
        expect(r.lados).toBe(1);
        expect(dados[CHAVE].status).toBe('cancelado');
        expect(dados[LADO].status).toBe('cancelado');
        expect(dados[LADO].eventos[0].nProt).toBe('135260000000001');
    });

    it('evento repetido não duplica em nenhum dos lados', async () => {
        const { db, dados } = bancoFalso(doisLados());
        const ev = { tpEvento: '110111', tipo: 'cancelamento', cStat: '135', nProt: 'P1', dhEvento: 'd' };
        const args = { db, chaveNFe: CHAVE, empresaId: 'fed', evento: ev, storagePath: 'x', xmlHash: 'h', schema: 's', nsu: '1', capturadoPor: null, tipoDocNormalizado: 'NFe' };
        await anexarEventoNaNFe(args);
        const r2 = await anexarEventoNaNFe(args);
        expect(r2.status).toBe('duplicado_evento');
        expect(dados[CHAVE].eventos).toHaveLength(1);
        expect(dados[LADO].eventos).toHaveLength(1);
    });

    it('sem lado, nada muda: nota só do principal continua igual (e o stub nasce quando não há nota)', async () => {
        const { db, dados } = bancoFalso({ [CHAVE]: { empresaId: 'fed', chave: CHAVE, eventos: [] } });
        const r = await anexarEventoNaNFe({
            db, chaveNFe: CHAVE, empresaId: 'fed',
            evento: { tpEvento: '110110', tipo: 'carta_correcao', cStat: '135', nProt: 'P9', dhEvento: 'd' },
            storagePath: 'x', xmlHash: 'h', schema: 's', nsu: '1', capturadoPor: null, tipoDocNormalizado: 'NFe',
        });
        expect(r.status).toBe('evento_anexado');
        expect(r.lados).toBe(0);
        expect(Object.keys(dados)).toEqual([CHAVE]);
    });

    it('a varredura: todo escritor por chave passa por refsDaChave — escritor novo que grava só em doc(chave) deixa o lado para trás', () => {
        for (const arquivo of ['sefaz-backend/cancelamento-gravacao.js', 'sefaz-backend/manifesto-orchestrator.js']) {
            expect(ler(arquivo)).toMatch(/refsDaChave\(/);
        }
        const importer = ler('sefaz-backend/xml-importer.js');
        const bloco = importer.slice(importer.indexOf('export async function anexarEventoNaNFe'), importer.indexOf('const tipoFinal = tipoDocNormalizado'));
        expect(bloco).toMatch(/refsDaChave\(db, chaveNFe\)/);
        // O carimbo da FILA da reconferência continua por documento — ele é
        // "esta empresa já perguntou?", não um fato da nota.
        expect(ler('sefaz-backend/cancelamento-gravacao.js')).toMatch(/carimbarPerguntaSefaz[\s\S]*doc\(docId\)\.set/);
    });
});
