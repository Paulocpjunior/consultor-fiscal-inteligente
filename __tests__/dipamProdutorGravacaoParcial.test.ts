/**
 * MATA-BURRO: GRAVAÇÃO PARCIAL NÃO APAGA O QUE NÃO MENCIONOU.
 *
 * Paulo, 13/08: *"mesmo eu informando o CPF aqui, quando eu gravo ele some,
 * parece que não salva."* — e o CPF salvava. Sumia o CADASTRO INTEIRO.
 *
 * O registro era montado do zero a cada gravação, com valor de fábrica em todo
 * campo. `{ merge: true }` não protege disso: merge preserva campo AUSENTE do
 * objeto, e nenhum estava ausente — todos iam, com null ou string vazia.
 *
 * O bloco do CPF manda só `{ doc, nome, cpfTitular }`, então gravar o CPF
 * apagava natureza, IE, UF, município, regime de FUNRURAL, segurado especial e
 * observação. Como a natureza era a única prova de que o ANTONIO DIAS DA SILVA
 * é produtor rural PF, ele saía da apuração — o CPF ficava num cadastro que já
 * não valia nada.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarRegistroProdutor, assertNaturezaCoerente } from '../sefaz-backend/dipam-store.js';

const CNPJ = '08507490000129';
const USUARIO = { email: 'eunice@spassessoriacontabil.com.br' };

describe('gravação parcial do produtor rural', () => {
    it('gravar SÓ o CPF não menciona natureza, IE, UF nem segurado especial', () => {
        const r: any = montarRegistroProdutor(CNPJ, {
            nome: 'ANTONIO DIAS DA SILVA', cpfTitular: '017.868.168-73',
        }, USUARIO);

        expect(r.cpfTitular).toBe('01786816873');
        expect(r.nome).toBe('ANTONIO DIAS DA SILVA');
        // O que não veio no payload NÃO pode aparecer no objeto gravado — é a
        // presença da chave que faz o Firestore sobrescrever.
        for (const k of ['natureza', 'ie', 'uf', 'municipio', 'codMunIBGE', 'funrural',
            'seguradoEspecial', 'observacao']) {
            expect(Object.prototype.hasOwnProperty.call(r, k)).toBe(false);
        }
    });

    it('o formulário completo continua gravando tudo', () => {
        const r: any = montarRegistroProdutor(CNPJ, {
            nome: 'ANTONIO DIAS DA SILVA', ie: 'p123456789', uf: 'sp',
            codMunIBGE: '3550308', municipio: 'SÃO PAULO',
            natureza: 'produtor-rural-pf', funrural: 'sub-rogado',
            seguradoEspecial: true, observacao: 'conferido no CADESP',
        }, USUARIO);

        expect(r.ie).toBe('P123456789');            // normaliza para maiúscula
        expect(r.uf).toBe('SP');
        expect(r.natureza).toBe('produtor-rural-pf');
        expect(r.seguradoEspecial).toBe(true);
        expect(r.observacao).toBe('conferido no CADESP');
    });

    // Lição do CCM-SP: campo ENVIADO vazio é intenção de apagar; campo AUSENTE
    // é intenção de não mexer. Sem essa distinção não existe como limpar nada.
    it('campo enviado VAZIO apaga — campo ausente preserva', () => {
        const apaga: any = montarRegistroProdutor(CNPJ, { observacao: '' }, USUARIO);
        expect(apaga.observacao).toBe('');
        expect(Object.prototype.hasOwnProperty.call(apaga, 'natureza')).toBe(false);

        const desliga: any = montarRegistroProdutor(CNPJ, { seguradoEspecial: false }, USUARIO);
        expect(desliga.seguradoEspecial).toBe(false);

        const some: any = montarRegistroProdutor(CNPJ, { cpfTitular: '' }, USUARIO);
        expect(some.cpfTitular).toBeNull();
    });

    it('produtor inscrito por CPF nunca recebe cpfTitular', () => {
        const r: any = montarRegistroProdutor('01786816873', { cpfTitular: '01786816873' }, USUARIO);
        expect(r.cpfTitular).toBeNull();
    });

    it('carimba sempre quem gravou — é o que sustenta "ninguém deduz, alguém digita"', () => {
        const r: any = montarRegistroProdutor(CNPJ, { cpfTitular: '01786816873' }, USUARIO);
        expect(r.confirmadoPor).toBe('eunice@spassessoriacontabil.com.br');
        expect(typeof r.confirmadoEm).toBe('number');
        expect(r.doc).toBe(CNPJ);

        const anonimo: any = montarRegistroProdutor(CNPJ, {}, null);
        expect(anonimo.confirmadoPor).toBe('desconhecido');
    });
});

// ============================================================================
// MATA-BURRO NA PORTA: não dá para MARCAR uma LTDA como Produtor Rural (PF).
//
// Paulo, 13/08: *"tem que tirar esses caras"*. O estrago não foi de cálculo —
// foi de cadastro: a fila de pendências oferece três botões e o PRIMEIRO é
// "Produtor Rural (PF)". Limpando centenas de linhas, o clique fácil faz a
// pendência sumir E passa a somar FUNRURAL sobre pessoa jurídica.
//
// Barrar na LEITURA (que é o que o painel faz) conserta o número; barrar na
// GRAVAÇÃO impede o estado errado de existir. As duas coisas, porque o cadastro
// errado também viaja para o R-2055 do EFD-Reinf.
// ============================================================================
describe('MATA-BURRO: LTDA não pode ser gravada como produtor rural PF', () => {
    const marcar = (nome: string, natureza: string, doc = '47120213000110') =>
        () => assertNaturezaCoerente(doc, { nome, natureza });

    it('recusa LTDA marcada como produtor rural PF, e diz a saída certa', () => {
        expect(marcar('BELA VISTA COMERCIO DE FRUTAS E VERDURAS LTDA', 'produtor_rural_pf'))
            .toThrow(/LTDA na razão social/);
        expect(marcar('BELA VISTA COMERCIO DE FRUTAS E VERDURAS LTDA', 'produtor_rural_pf'))
            .toThrow(/Pessoa Jurídica/);
    });

    it('a MESMA empresa passa como pessoa jurídica — a trava tem caminho', () => {
        // Trava sem saída é trava que a equipe contorna.
        expect(marcar('BELA VISTA COMERCIO DE FRUTAS E VERDURAS LTDA', 'pessoa_juridica')).not.toThrow();
    });

    it('pessoa física com CPF segue podendo ser produtor rural PF', () => {
        // A exceção é ESTREITA: só o par CNPJ + tipo societário no nome.
        expect(marcar('JOAO DA SILVA', 'produtor_rural_pf', '12345678909')).not.toThrow();
    });

    it('a trava está na PORTA da gravação, não só no teste', () => {
        const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/dipam-store.js'), 'utf8');
        expect(fonte).toMatch(/assertNaturezaCoerente\(id, dados\);/);
    });
});
