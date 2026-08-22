// ============================================================================
// 🚨 O 0150 E O 0190 ESTAVAM ESCRITOS DUAS VEZES — e a cópia já tinha custado
//
// O bloco 0 das duas famílias é diferente de verdade no **0000** (um tem
// COD_VER e IND_PERFIL, o outro TIPO_ESCRIT e IND_NAT_PJ) — por isso eles
// continuam separados. Mas o **0150** (participante) e o **0190** (unidade)
// têm o MESMO leiaute nos dois, e estavam duplicados byte a byte.
//
// 🔴 E O QUE A CÓPIA CUSTOU: em 18/08 o PVA recusou **30 participantes sem
// COD_MUN** (MANTOAN 0040), e a denúncia — *"o app tem que cobrar ANTES"* —
// entrou **só no EFD-Contribuições**. O 0150 do EFD ICMS/IPI é o MESMO
// registro, com a MESMA obrigatoriedade, e ficava MUDO: a próxima empresa
// gastaria a volta do PVA de novo, com outro CNPJ.
//
// É a régua de 21/08 — trava nasce onde roda para TODOS os arquivos daquela
// família — e a de 20/08: recusa aprendida entra na prevalidação no MESMO PR,
// não em metade dela.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo backend .js sem .d.ts (só o teste o importa daqui)
import { build0150, build0190, avisoParticipantesSemMunicipio } from '../sefaz-backend/sped-bloco0-cadastros.js';

const RAIZ = join(__dirname, '..');

describe('🚨 0150 e 0190 — um leiaute, um dono', () => {
    it('o 0150 sai com os 13 campos, e o país é sempre 1058', () => {
        const linha = build0150({
            codPart: '12345678000199', nome: 'FORNECEDOR LTDA', cnpj: '12.345.678/0001-99',
            ie: '111222333444', codMunIBGE: '3550308', logradouro: 'RUA X', numero: '10', bairro: 'CENTRO',
        });
        expect(linha).toBe('|0150|12345678000199|FORNECEDOR LTDA|1058|12345678000199||111222333444|3550308||RUA X|10||CENTRO|\r\n');
    });

    // IE é de PJ: com CPF preenchido o campo sai vazio.
    it('participante PF não leva IE', () => {
        const linha = build0150({ codPart: '12345678901', nome: 'JOSE', cpf: '123.456.789-01', ie: '999' });
        expect(linha).toContain('|12345678901||');
        expect(linha).not.toContain('999');
    });

    it('o 0190 repete o código quando não há descrição', () => {
        expect(build0190({ codigo: 'UN', descricao: 'UNIDADE' })).toBe('|0190|UN|UNIDADE|\r\n');
        expect(build0190({ codigo: 'BDJ' })).toBe('|0190|BDJ|BDJ|\r\n');
    });
});

describe('🚨 o aviso do COD_MUN vale nas DUAS famílias', () => {
    it('nomeia quem falta, com a contagem', () => {
        const aviso = avisoParticipantesSemMunicipio([
            { nome: 'COM MUNICIPIO', codMunIBGE: '3550308' },
            { nome: 'SEM MUNICIPIO LTDA' },
            { codPart: '99999999000199' },
        ]);
        expect(aviso).toContain('2 participante(s)');
        expect(aviso).toContain('SEM MUNICIPIO LTDA');
        expect(aviso).toContain('99999999000199');
    });

    // ⚠️ A DECISÃO DO PAULO FICA NA FRASE: o app NÃO preenche. Inventar
    // município é afirmar o domicílio de terceiro, e o '9999999' que o PVA
    // sugere significa "NÃO domiciliado no Brasil".
    it('e DIZ por que o app não preenche sozinho', () => {
        const aviso = avisoParticipantesSemMunicipio([{ nome: 'X' }]);
        expect(aviso).toContain('9999999');
        expect(aviso).toMatch(/NÃO preenche/);
    });

    it('sem ninguém faltando, não há aviso — alarme sem alvo é ruído', () => {
        expect(avisoParticipantesSemMunicipio([{ nome: 'X', codMunIBGE: '3550308' }])).toBeNull();
        expect(avisoParticipantesSemMunicipio([])).toBeNull();
    });

    // 🔴 A metade que faltava: era o EFD ICMS/IPI que não avisava nada.
    it('as DUAS famílias chamam o aviso', () => {
        for (const rel of [
            'sefaz-backend/sped-fiscal-bloco0.js',
            'sefaz-backend/sped-contrib-bloco0.js',
        ]) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            expect({ rel, chama: src.includes('avisoParticipantesSemMunicipio') })
                .toEqual({ rel, chama: true });
        }
    });

    it('e nenhuma reimplementa o 0150/0190 por conta própria', () => {
        for (const rel of [
            'sefaz-backend/sped-fiscal-bloco0.js',
            'sefaz-backend/sped-contrib-bloco0.js',
        ]) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            expect({ rel, copia: /function build015?0\(|function build0190\(/.test(src) })
                .toEqual({ rel, copia: false });
        }
    });
});
