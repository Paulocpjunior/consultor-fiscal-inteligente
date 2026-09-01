// ============================================================================
// 🚨 "IMPORTADA COM SUCESSO" — E A NOTA NÃO APARECIA EM LUGAR NENHUM
//
// 01/09, Paulo (0257 · MARCOS ANTONIO ZAMBOLIN INFORMATICA): o PDF da NFS-e
// importou, o app disse **PRONTO · importada com sucesso**, e a lista
// respondeu **XMLs Capturados (0)** — mandando conferir certificado e
// procuração, que é a primeira parada ERRADA.
//
// A causa: `documentos_fiscais.competencia` é `AAAA-MM` e a consulta é por
// IGUALDADE; o leitor do PDF devolve o que o PAPEL escreve (`08/2026` no
// ABRASF, `18/08/2026` na DANFSe nacional, onde o campo "Competência da
// NFS-e" é uma DATA). A nota ficava no banco e fora de todo recorte de mês.
// ============================================================================
import { recorteDaNfsePdf, dhEmiDaNfsePdf, idDaNfsePdf } from '../services/nfsePdfRecorte';
import { formasDaCompetencia, normalizarCompetencia } from '../sefaz-backend/competencia.js';
import { getCompetenciaDocumento } from '../services/xmlDocumentosFilter';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('🚨 a competência do PDF entra na forma que o app RECORTA', () => {
    // As duas formas que o `nfsePdfParserService` de fato produz — o regex dele
    // é /(\d{1,2}\/\d{2,4}(?:\/\d{2,4})?)/, que casa as duas.
    it('ABRASF escreve MM/AAAA', () => {
        const r = recorteDaNfsePdf({ competencia: '08/2026', dataEmissao: '18/08/2026 14:31:02' });
        expect(r.competencia).toBe('2026-08');
        expect(r.competenciaOrigem).toBe('campo-competencia');
        expect(r.impedimento).toBeNull();
    });

    it('a DANFSe nacional escreve o campo Competência como DATA', () => {
        const r = recorteDaNfsePdf({ competencia: '10/05/2026', dataEmissao: '11/05/2026 14:31:31' });
        expect(r.competencia).toBe('2026-05');
    });

    // ⚠️ Nota sem competência SOME de todo recorte mensal. Derivar da data de
    // emissão é ler um fato do próprio documento — e a origem vai carimbada,
    // porque número derivado não se apresenta como lido.
    it('sem o campo, a competência sai da DATA DE EMISSÃO — carimbada', () => {
        const r = recorteDaNfsePdf({ competencia: '', dataEmissao: '18/08/2026 14:31:02' });
        expect(r.competencia).toBe('2026-08');
        expect(r.competenciaOrigem).toBe('data-de-emissao');
    });

    // 🚨 E o que não dá para ler NÃO vira competência chutada nem campo vazio:
    // vira RECUSA com o motivo, antes de gravar.
    it('sem competência e sem data legível, RECUSA e diz por quê', () => {
        const r = recorteDaNfsePdf({ competencia: '', dataEmissao: '' });
        expect(r.competencia).toBeNull();
        expect(r.impedimento).toMatch(/não aparece em recorte de mês nenhum/);
        expect(r.impedimento).toMatch(/MM\/AAAA/);
    });

    it('mês impossível não vira competência', () => {
        expect(recorteDaNfsePdf({ competencia: '13/2026', dataEmissao: '' }).competencia).toBeNull();
        expect(recorteDaNfsePdf({ competencia: '', dataEmissao: '18/13/2026' }).competencia).toBeNull();
    });
});

describe('🚨 a data do documento se lê do TEXTO, nunca por new Date()', () => {
    // `new Date('11/05/2026')` devolve 5 de NOVEMBRO — o mês e o dia trocados,
    // com toda a confiança. É a régua de 22/08 na forma do papel.
    it('11/05/2026 é 11 de MAIO', () => {
        expect(dhEmiDaNfsePdf('11/05/2026 14:31:31')).toBe('2026-05-11T14:31:31');
        expect(new Date('11/05/2026').getUTCMonth() + 1).toBe(11); // o que NÃO se faz
    });

    it('sem hora devolve só o dia, e ISO passa direto', () => {
        expect(dhEmiDaNfsePdf('18/08/2026')).toBe('2026-08-18');
        expect(dhEmiDaNfsePdf('2026-08-18T09:00:00')).toBe('2026-08-18T09:00:00');
    });

    it('ausência devolve null — data não recebe default', () => {
        for (const v of ['', null, undefined, 'quinta-feira']) expect(dhEmiDaNfsePdf(v)).toBeNull();
    });
});

describe('🔒 o documento gravado casa com o recorte da tela', () => {
    // A prova ponta a ponta: o que a gravação produz tem de ser lido pelo DONO
    // da competência da lista. Sem isto, a nota volta a existir e não aparecer.
    it('a competência gravada é a que a lista procura', () => {
        for (const caso of [
            { competencia: '08/2026', dataEmissao: '18/08/2026 14:31:02' },
            { competencia: '10/05/2026', dataEmissao: '11/05/2026 14:31:31' },
            { competencia: '', dataEmissao: '02/01/2027 08:00:00' },
        ]) {
            const r = recorteDaNfsePdf(caso);
            const doc = { competencia: r.competencia, dhEmi: r.dhEmi };
            expect(getCompetenciaDocumento(doc)).toBe(r.competencia);
            expect(r.competencia).toMatch(/^\d{4}-\d{2}$/);
        }
    });

    // ⚠️ E a leitura conhece as formas ANTIGAS: o que já foi gravado como
    // `08/2026` continua sendo achado sem backfill nenhum.
    it('a consulta por formas alcança o que foi gravado antes', () => {
        const formas = formasDaCompetencia('2026-08');
        expect(formas).toContain('2026-08');
        expect(formas).toContain('08/2026');
        expect(formas).toContain('202608');
        // `in` do Firestore aceita até 30 valores — a lista não pode crescer.
        expect(formas.length).toBeLessThanOrEqual(30);
    });
});

describe('🐛 reimportar o MESMO PDF não pode criar uma segunda nota', () => {
    // O id levava `Date.now()` quando a NFS-e não tem chave (prefeitura
    // própria) — reimportar para corrigir algo duplicava a nota no livro.
    it('sem chave, o id é determinístico', () => {
        const p = { empresaId: 'emp1', numero: '4321', serie: 'A' };
        expect(idDaNfsePdf(p)).toBe(idDaNfsePdf(p));
        expect(idDaNfsePdf(p)).not.toMatch(/\d{13}/);
    });

    it('com chave, o id É a chave', () => {
        const chave = '3'.repeat(50);
        expect(idDaNfsePdf({ chaveAcesso: chave, empresaId: 'emp1', numero: '1', serie: '' })).toBe(chave);
    });

    it('empresas diferentes não colidem no mesmo número', () => {
        expect(idDaNfsePdf({ empresaId: 'a', numero: '1', serie: '' }))
            .not.toBe(idDaNfsePdf({ empresaId: 'b', numero: '1', serie: '' }));
    });
});

describe('🔒 a ligação — o importador usa o DONO, não o texto do PDF', () => {
    // Régua da casa: consertar o módulo fecha a INSTÂNCIA; a varredura fecha a
    // CLASSE. Sem isto, a próxima edição do `.tsx` volta a gravar a forma do
    // papel e a nota some de novo, em silêncio.
    const fonte = readFileSync(
        join(__dirname, '..', 'components', 'xml', 'NfsePdfImportacao.tsx'), 'utf8',
    ).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    it('a competência gravada vem do recorte', () => {
        expect(fonte).toMatch(/competencia:\s*recorte\.competencia/);
        expect(fonte).not.toMatch(/competencia:\s*parsed\.competencia/);
    });

    it('o dhEmi também — e sem cair na data de HOJE', () => {
        expect(fonte).toMatch(/dhEmi:\s*recorte\.dhEmi/);
        expect(fonte).not.toMatch(/dhEmi:[^\n]*new Date\(\)/);
    });

    // ⚠️ A assinatura é ESTREITA de propósito: `importadoEm: Date.now()` é
    // código CERTO (é o carimbo de quando a nota entrou). O que não pode é o
    // relógio decidir a IDENTIDADE do documento.
    it('o id é o determinístico, sem Date.now()', () => {
        expect(fonte).toMatch(/const docId = idDaNfsePdf\(/);
        expect(fonte).not.toMatch(/docId[^\n]*Date\.now\(\)/);
    });

    // 🚨 E a leitura pergunta pelas FORMAS: é ela que acha o que já foi gravado
    // como `08/2026` — sem isto a correção só valeria para nota nova.
    it('a consulta da lista usa formasDaCompetencia', () => {
        const servico = readFileSync(join(__dirname, '..', 'services', 'xmlFiscalService.ts'), 'utf8');
        expect(servico).toMatch(/formasDaCompetencia/);
        // ⚠️ O `==` continua existindo como FALLBACK do ilegível, e isso é
        // código certo — o que não pode voltar é a consulta ir direto para as
        // constraints sem passar pelas formas.
        const semComentario = servico.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        expect(semComentario).not.toMatch(/push\(where\('competencia',\s*'==',/);
        expect(semComentario).toMatch(/where\('competencia',\s*'in',\s*formas/);
    });
});

describe('🔒 o dono da competência aprendeu a forma sem perder as outras', () => {
    it('DD/MM/AAAA entrou e nada regrediu', () => {
        expect(normalizarCompetencia('18/08/2026')).toBe('2026-08');
        expect(normalizarCompetencia('2026-08')).toBe('2026-08');
        expect(normalizarCompetencia('08/2026')).toBe('2026-08');
        expect(normalizarCompetencia('202608')).toBe('2026-08');
        expect(normalizarCompetencia('2026-08-31')).toBe('2026-08');
        for (const lixo of ['', null, 'julho/2026', '13/2026', '2026-13', '18/13/2026']) {
            expect(normalizarCompetencia(lixo)).toBeNull();
        }
    });
});
