/**
 * MATA-BURRO: COMPRIMENTO NÃO É VALIDAÇÃO.
 *
 * O `cpfTitular` do produtor rural é o número que o R-2055 declara no
 * `ideProdutor`. Enquanto o DV vivia só no frontend, o backend gravava qualquer
 * coisa com 11 dígitos — e um dígito trocado vira declaração em nome de OUTRA
 * PESSOA, sem nada depois que perceba (o CPF errado pode ser de alguém real, a
 * Receita aceita, e entrega ao Reinf não se desfaz).
 *
 * Caso real: VINCENZO GUERRA × ANTONIO DIAS DA SILVA (CNPJ 08.507.490/0001-29),
 * CPF do titular achado no CADESP em 13/08.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validarCpf, validarCnpj, formatarCpf } from '../sefaz-backend/documento-dv.js';

describe('DV de CPF', () => {
    it('aceita o CPF do titular do caso VINCENZO', () => {
        expect(validarCpf('017.868.168-73')).toBe(true);
        expect(validarCpf('01786816873')).toBe(true);
        expect(formatarCpf('01786816873')).toBe('017.868.168-73');
    });

    it('pega DÍGITO TROCADO — o erro de digitação que o comprimento deixa passar', () => {
        // Um dígito a mais no meio: continua com 11 dígitos.
        expect(validarCpf('017.868.169-73')).toBe(false);
        expect(validarCpf('017.868.168-74')).toBe(false);
        expect(validarCpf('018.868.168-73')).toBe(false);
    });

    it('pega DÍGITOS TRANSPOSTOS — o outro erro comum de quem copia do CADESP', () => {
        expect(validarCpf('017.868.186-73')).toBe(false);   // 68 → 86
        expect(validarCpf('071.868.168-73')).toBe(false);   // 01 → 07... 17 → 71
    });

    it('rejeita sequência única, que passa em quase todo algoritmo ingênuo', () => {
        expect(validarCpf('111.111.111-11')).toBe(false);
        expect(validarCpf('000.000.000-00')).toBe(false);
    });

    it('rejeita comprimento errado sem estourar', () => {
        expect(validarCpf('')).toBe(false);
        expect(validarCpf('0178681687')).toBe(false);
        expect(validarCpf('017868168730')).toBe(false);
    });
});

describe('DV de CNPJ', () => {
    it('aceita o CNPJ do escritório e o do estabelecimento rural do caso', () => {
        expect(validarCnpj('44.388.152/0001-89')).toBe(true);
        expect(validarCnpj('08.507.490/0001-29')).toBe(true);
    });

    it('pega dígito trocado e sequência única', () => {
        expect(validarCnpj('44.388.152/0001-88')).toBe(false);
        expect(validarCnpj('00.000.000/0000-00')).toBe(false);
    });

    // IN RFB 2.229/2024 — vigência 07/2026. Os 12 primeiros podem ser [A-Z0-9];
    // o DV continua numérico e é calculado sobre o ASCII menos 48.
    it('aceita CNPJ alfanumérico e mantém o DV numérico', () => {
        expect(validarCnpj('12ABC34501DE35')).toBe(true);
        expect(validarCnpj('12ABC34501DE36')).toBe(false);
    });
});

/**
 * A trava só vale se ela estiver NO CAMINHO da gravação. Validador que existe e
 * ninguém chama é documentação, não mata-burro.
 */
describe('a gravação do produtor rural passa pelo DV', () => {
    const store = readFileSync(join(__dirname, '..', 'sefaz-backend/dipam-store.js'), 'utf8');

    it('o store importa a régua do núcleo — não reimplementa nem só mede comprimento', () => {
        expect(store).toMatch(/from '\.\/documento-dv\.js'/);
        expect(store).toMatch(/validarCpf/);
    });

    it('e a recusa DIZ o que fazer e por que não dá pra corrigir depois', () => {
        expect(store).toMatch(/dígito verificador|digito verificador/);
        expect(store).toMatch(/CADESP/);
        expect(store).toMatch(/não se desfaz/);
    });

    it('a validação acontece ANTES do set() no Firestore', () => {
        const posValidacao = store.indexOf('!validarCpf(cpfTitular)');
        const posGravacao = store.indexOf('.set(registro');
        expect(posValidacao).toBeGreaterThan(-1);
        expect(posGravacao).toBeGreaterThan(posValidacao);
    });
});
