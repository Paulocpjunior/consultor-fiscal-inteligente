// ============================================================================
// ♻️ RELEITURA DAS NOTAS "VAZIAS" — sem nº, sem CFOP pela régua, sem CST.
//
// Paulo, 19/08 (caso PWR/GLOBAL COMPANY + outra empresa no mesmo dia): a tela
// ✏️ CFOP por nota mostrava notas vazias e o colaborador digitava CFOP no
// escuro. Duas causas com ações OPOSTAS:
//   · só o RESUMO (resNFe) na base → reler não cria item; importe o COMPLETO;
//   · XML completo guardado, importado por leitor antigo → a releitura resolve.
// Fundir as duas num número só seria o "0 recuperadas · 664 já tinham" de
// 13/08 outra vez.
// ============================================================================
import {
    numeroDaChave, ehNotaVazia, classificarParaReleitura, patchDaReleitura,
} from '../sefaz-backend/releitura-notas-vazias.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Chave real do caso GLOBAL COMPANY (PWR): mod 55, nNF 34853.
const CHAVE_PWR = '35260744894688000121550010000348531068615102';

describe('numeroDaChave — a chave não mente', () => {
    it('extrai o nNF das posições 26-34 e tira os zeros à esquerda', () => {
        expect(numeroDaChave(CHAVE_PWR)).toBe('34853');
    });
    it('chave inválida devolve null, nunca um chute', () => {
        expect(numeroDaChave('123')).toBeNull();
        expect(numeroDaChave(null)).toBeNull();
        expect(numeroDaChave('')).toBeNull();
    });
});

describe('classificarParaReleitura — cada causa tem ação própria', () => {
    it('resumo gravado (caso PWR): reler não cria item — a ação é o XML completo', () => {
        expect(classificarParaReleitura({
            tipoDoc: 'resNFe', schema: 'resNFe_v1.01', chave: CHAVE_PWR,
            storagePath: 'xmls/pwr/x.xml', itens: [],
        })).toBe('resumo-gravado');
    });
    it('NF-e sem itens com XML guardado é ALVO — a releitura resolve', () => {
        expect(classificarParaReleitura({
            tipoDoc: 'NFe', chave: CHAVE_PWR, storagePath: 'xmls/pwr/x.xml',
        })).toBe('alvo');
    });
    it('sem storagePath é buraco de CAPTURA, não de leitura', () => {
        expect(classificarParaReleitura({ tipoDoc: 'NFe', chave: CHAVE_PWR }))
            .toBe('sem-arquivo');
    });
    it('nota completa não é tocada', () => {
        expect(classificarParaReleitura({
            tipoDoc: 'NFe', chave: CHAVE_PWR, numero: '34853',
            itens: [{ cfop: '5102' }], storagePath: 'x',
        })).toBe('completa');
    });
    it('NFS-e e CT-e ficam fora — itens não vêm de <det>', () => {
        expect(classificarParaReleitura({ tipoDoc: 'NFSe' })).toBe('fora-do-escopo');
        expect(classificarParaReleitura({ tipo: 'CTe', chave: CHAVE_PWR.slice(0, 20) + '57' + CHAVE_PWR.slice(22) }))
            .toBe('fora-do-escopo');
    });
    it('resumo SEM tipoDoc entra pelo MODELO da chave (mod 55), não fica fora', () => {
        // Doc antigo pode não ter tipoDoc/schema gravados — a chave decide.
        expect(classificarParaReleitura({ chave: CHAVE_PWR, storagePath: 'x' })).toBe('alvo');
    });
});

describe('patchDaReleitura — backfill NÃO apaga', () => {
    it('preenche itens e nº quando estão vazios', () => {
        const p = patchDaReleitura(
            { chave: CHAVE_PWR },
            { itens: [{ cfop: '5102', cst: '00' }], numero: '34853' },
        );
        expect(p.itens).toHaveLength(1);
        expect(p.temItens).toBe(true);
        expect(p.numero).toBe('34853');
    });
    it('nunca sobrescreve itens nem nº já gravados', () => {
        const p = patchDaReleitura(
            { chave: CHAVE_PWR, numero: '999', itens: [{ cfop: '1102' }] },
            { itens: [{ cfop: '5102' }], numero: '34853' },
        );
        expect(p).toEqual({});
    });
    it('sem XML, o nº ainda sai da CHAVE — o resumo deixa de ficar cego', () => {
        const p = patchDaReleitura({ chave: CHAVE_PWR }, {});
        expect(p.numero).toBe('34853');
        expect(p.itens).toBeUndefined();
    });
});

// ─── A FIAÇÃO: núcleo sem leitor não protege (regra da casa) ────────────────
describe('🚨 rota, orquestrador e botão existem — rota sem botão é código morto', () => {
    const raiz = join(__dirname, '..');
    const importer = readFileSync(join(raiz, 'sefaz-backend/xml-importer.js'), 'utf8');
    const rotas = readFileSync(join(raiz, 'sefaz-backend/ipi-varredura-routes.js'), 'utf8');
    const tela = readFileSync(join(raiz, 'components/Relatorios/index.tsx'), 'utf8');
    const service = readFileSync(join(raiz, 'services/ipiVarreduraService.ts'), 'utf8');

    it('o orquestrador usa a régua PURA, nunca uma cópia', () => {
        expect(importer).toMatch(/import \{ classificarParaReleitura, patchDaReleitura, numeroDaChave \} from '\.\/releitura-notas-vazias\.js'/);
        expect(importer).toMatch(/export async function relerNotasVazias/);
    });
    it('a rota escreve em documento fiscal ⇒ requireAdmin', () => {
        expect(rotas).toMatch(/router\.post\('\/reler-notas-vazias', requireAdmin/);
    });
    it('o botão ♻️ está na aba ✏️ CFOP por nota e chama o service', () => {
        expect(tela).toMatch(/relerNotasVazias\(empresa\.id, competencia\)/);
        expect(tela).toMatch(/Reler XMLs guardados/);
        expect(service).toMatch(/\/api\/admin\/sefaz\/reler-notas-vazias/);
    });
    it('o resultado responde POR CAUSA — resumo ≠ sem arquivo ≠ preenchida', () => {
        expect(tela).toMatch(/só têm o RESUMO da SEFAZ na base/);
        expect(tela).toMatch(/sem arquivo guardado/);
    });
});
