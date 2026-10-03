/**
 * 03/10 — Paulo, NFS-e de SANTANA DE PARNAÍBA (CLINICA VETERINARIA ALPHAVILLE,
 * NFS-e 643: competência 29/08/2026, emissão 09/09/2026): "o sistema está
 * considerando a importação com base na data de emissão da nota, quando o
 * correto seria considerar a competência, pelo fato de alguns clientes
 * emitirem a RPS".
 *
 * O dono (`nfse-nacional-leitura.js`) lia o `dCompet` e o encaixe da
 * importação pela tela o DESCARTAVA. Fatos cobrados: a importação grava o mês
 * do `dCompet` e guarda o campo; a fila "Conferir competências" acusa a nota
 * gravada pela emissão — inclusive lendo o `dCompet` do XML guardado.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseNFeXml, buildDocumentoFiscal } from '../services/xmlParserService';
import { classificarCompetenciaDoAcervo, patchCorrecaoCompetencia } from '../sefaz-backend/competencia-acervo.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { competenciaDeclaradaDoXml, precisaLerCompetenciaDoXml } from '../sefaz-backend/competencia-do-xml.js';

// Fixture nacional que já vive nos testes, com as datas do caso: emitida em
// SETEMBRO (da RPS) e de competência AGOSTO.
const XML = readFileSync(join(__dirname, 'fixtures', 'progress-retencoes', '5747.xml'), 'utf8')
    .replace('<dhEmi>2026-08-01T13:42:59-03:00</dhEmi>', '<dhEmi>2026-09-09T19:26:03-03:00</dhEmi>')
    .replace('<dCompet>2026-08-01</dCompet>', '<dCompet>2026-08-29</dCompet>');

describe('importação da NFS-e nacional pela tela usa o dCompet', () => {
    it('a fixture tem as datas do caso (senão o teste não mede nada)', () => {
        expect(XML).toMatch(/<dhEmi>2026-09-09/);
        expect(XML).toMatch(/<dCompet>2026-08-29/);
    });

    it('o parser repassa a competência declarada', () => {
        expect(parseNFeXml(XML).competenciaDeclarada).toBe('2026-08-29');
    });

    it('o documento gravado vai para AGOSTO e guarda o dCompet', () => {
        const parsed = parseNFeXml(XML);
        const doc: any = buildDocumentoFiscal({
            id: 'x', parsed, xmlHash: 'h', direcao: 'entrada', empresaId: 'e', empresaCnpj: '11775820000171',
            empresaNome: 'E', origem: 'manual', importadoPor: 't',
        });
        expect(doc.competencia).toBe('2026-08');
        expect(doc.competenciaDeclarada).toBe('2026-08-29');
    });
});

describe('a fila "Conferir competências" acusa a nota gravada pela emissão', () => {
    const gravadaPelaEmissao = {
        id: 'n643', tipo: 'NFSe', numero: '643', competencia: '2026-09',
        dhEmi: '2026-09-09T19:26:03-03:00', storagePath: 'empresas/x/643.xml', status: 'autorizado',
    };

    it('sem a competência declarada, continua "sem fato gerador" (não inventa)', () => {
        expect(classificarCompetenciaDoAcervo(gravadaPelaEmissao).situacao).toBe('sem-fato-gerador');
    });

    it('com o dCompet (lido do XML guardado): mês errado, com os dois meses', () => {
        expect(precisaLerCompetenciaDoXml(gravadaPelaEmissao)).toBe(true);
        const comp = competenciaDeclaradaDoXml(XML);
        expect(comp).toBe('2026-08-29');
        const r = classificarCompetenciaDoAcervo({ ...gravadaPelaEmissao, competenciaDeclarada: comp });
        expect(r).toMatchObject({ situacao: 'mes-errado', competenciaGravada: '2026-09', competenciaCerta: '2026-08' });
    });

    it('a correção grava o mês certo, a origem e o dCompet', () => {
        const r = patchCorrecaoCompetencia({
            doc: { ...gravadaPelaEmissao, competenciaDeclarada: '2026-08-29' },
            porEmail: 'paulo@sp', motivo: 'NFS-e emitida da RPS — competência agosto', agoraIso: '2026-10-03T10:00:00Z',
        });
        if (!r.ok) throw new Error(r.erro);
        expect(r.patch).toMatchObject({ competencia: '2026-08', competenciaOrigem: 'declarada', competenciaDeclarada: '2026-08-29' });
    });

    it('ABRASF: o <Competencia> também é lido do XML guardado', () => {
        expect(competenciaDeclaradaDoXml('<CompNfse><Nfse><InfNfse><Competencia>2026-08-01T00:00:00</Competencia></InfNfse></Nfse></CompNfse>'))
            .toBe('2026-08-01T00:00:00');
    });
});
