/**
 * 🚨 REGRAVAR A NOTA DIGITADA NÃO PODE TROCAR O DONO DO DOCUMENTO.
 *
 * As rules de /documentos_fiscais só aceitam UPDATE com `createdBy` igual ao
 * gravado (ou admin). A tela montava a nota com o uid de QUEM ESTÁ LOGADO, e a
 * colega que corrigia a digitação de outra pessoa levava "Missing or
 * insufficient permissions" — erro que manda procurar problema de permissão
 * onde o problema é de AUTORIA (03/09).
 *
 * O padrão certo já existia na importação de NFS-e em PDF (`payloadFinal`
 * preserva `existingSnap.data().createdBy`); aqui ele virou dono puro,
 * `createdByParaRegravar`, e a tela passa por ele.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createdByParaRegravar, montarNotaDigitada } from '../services/notaDigitada';

describe('createdByParaRegravar', () => {
    it('doc novo ⇒ o uid de quem grava', () => {
        expect(createdByParaRegravar(null, 'uid-atual')).toBe('uid-atual');
        expect(createdByParaRegravar(undefined, 'uid-atual')).toBe('uid-atual');
    });

    it('doc existente ⇒ MANTÉM o dono, mesmo sendo outra pessoa', () => {
        expect(createdByParaRegravar({ createdBy: 'uid-da-colega' }, 'uid-atual')).toBe('uid-da-colega');
    });

    it('existente sem dono legível ⇒ uid atual (chave nunca sai undefined)', () => {
        expect(createdByParaRegravar({ createdBy: null }, 'uid-atual')).toBe('uid-atual');
        expect(createdByParaRegravar({ createdBy: '' }, 'uid-atual')).toBe('uid-atual');
        expect(createdByParaRegravar({}, 'uid-atual')).toBe('uid-atual');
    });

    it('o dono preservado chega ao documento montado', () => {
        const dono = createdByParaRegravar({ createdBy: 'uid-da-colega' }, 'uid-atual');
        const doc: any = montarNotaDigitada({
            empresaId: 'e1', empresaNome: 'EMPRESA', empresaCnpj: '11222333000181',
            especie: 'mercadoria', direcao: 'entrada', numero: '10', serie: '1',
            dhEmi: '2026-08-10', valorTotal: 100,
            participanteNome: 'FORNECEDOR', participanteDoc: '99888777000166', participanteUf: 'SP',
            itens: [{ cfop: '1102', xProd: 'X', vProd: 100 }],
            digitadaPorEmail: 'colab@spassessoriacontabil.com.br',
            createdByUid: dono,
        } as any);
        expect(doc.createdBy).toBe('uid-da-colega');
    });
});

describe('a TELA passa pelo dono no caminho de regravar', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/xml/NotaDigitadaForm.tsx'), 'utf8');

    it('chama createdByParaRegravar com o doc existente antes de montar', () => {
        expect(tela).toMatch(/createdByParaRegravar\(\s*atual\.exists\(\)/);
        expect(tela).toMatch(/montarNotaDigitada\(\{ \.\.\.input, createdByUid \}/);
    });

    it('não monta a nota direto do input no setDoc (o uid do logado viraria dono)', () => {
        expect(tela).not.toMatch(/setDoc\(ref, JSON\.parse\(JSON\.stringify\(montarNotaDigitada\(input as any\)\)\)\)/);
    });
});
