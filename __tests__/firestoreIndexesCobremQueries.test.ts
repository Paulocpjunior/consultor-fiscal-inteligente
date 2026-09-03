/**
 * 🚨 ÍNDICE COMPOSTO AUSENTE NÃO É "LENTO" — é `failed-precondition`, e a
 * tela engole como lista vazia.
 *
 * Toda query `where(campo) + orderBy(outro)` ou `where(a) + where(b, range)`
 * do web SDK exige índice composto. As sete abaixo estavam no código sem o
 * índice no `firestore.indexes.json` (03/09) — cada uma com o arquivo:linha
 * da query que a exige, para a próxima pessoa saber o que pode APAGAR quando
 * a query sumir. O deploy-firestore.yml só publica o que está no arquivo.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const arquivo = readFileSync(join(__dirname, '..', 'firestore.indexes.json'), 'utf8');

type Campo = { fieldPath: string; order?: string; arrayConfig?: string };
type Indice = { collectionGroup: string; queryScope: string; fields: Campo[] };

const chave = (i: Indice) =>
    `${i.collectionGroup}|${i.queryScope}|${i.fields.map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(',')}`;

const EXIGIDOS: Array<[string, string, string]> = [
    // xmlFiscalService.listCapturas: where(usuarioId) + orderBy(timestamp desc)
    ['xml_capturas', 'usuarioId:ASCENDING,timestamp:DESCENDING', 'services/xmlFiscalService.ts listCapturas'],
    // xmlFiscalService.listErros
    ['xml_erros', 'usuarioId:ASCENDING,timestamp:DESCENDING', 'services/xmlFiscalService.ts listErros'],
    // spedFiscalStorageService.listarSpedArquivos (não-master)
    ['sped_arquivos', 'importadoPorUid:ASCENDING,importadoEm:DESCENDING', 'services/spedFiscalStorageService.ts'],
    // authService: access_logs por usuário
    ['access_logs', 'userId:ASCENDING,timestamp:DESCENDING', 'services/authService.ts'],
    // xmlFiscalService.getDocumentosByCnpjPeriodo: where(campo ==) + where(dhEmi range)
    ['documentos_fiscais', 'empresaCnpj:ASCENDING,dhEmi:ASCENDING', 'services/xmlFiscalService.ts getDocumentosByCnpjPeriodo'],
    ['documentos_fiscais', 'cnpjDest:ASCENDING,dhEmi:ASCENDING', 'services/xmlFiscalService.ts getDocumentosByCnpjPeriodo'],
    ['documentos_fiscais', 'cnpjEmit:ASCENDING,dhEmi:ASCENDING', 'services/xmlFiscalService.ts getDocumentosByCnpjPeriodo'],
];

describe('firestore.indexes.json', () => {
    const json = JSON.parse(arquivo) as { indexes: Indice[] };

    it('é JSON válido com a forma que o firebase-tools espera', () => {
        expect(Array.isArray(json.indexes)).toBe(true);
        for (const i of json.indexes) {
            expect(i.queryScope).toBe('COLLECTION');
            expect(i.fields.length).toBeGreaterThan(1);
        }
    });

    it('não tem índice duplicado (o deploy recusa)', () => {
        const chaves = json.indexes.map(chave);
        expect(new Set(chaves).size).toBe(chaves.length);
    });

    it.each(EXIGIDOS)('%s (%s) — exigido por %s', (col, campos, _motivo) => {
        const existe = json.indexes.some((i) => chave(i) === `${col}|COLLECTION|${campos}`);
        expect(existe).toBe(true);
    });
});
