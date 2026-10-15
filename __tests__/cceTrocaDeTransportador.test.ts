/**
 * 🚚 CC-e DE TROCA DE TRANSPORTADOR NÃO É "INDEVIDA" (15/10, B & T MATERIAIS).
 *
 * O colaborador: *"a carta de correção estava regular, informava apenas a troca
 * do transportador"* — e a etapa 2 da rotina travava em "1 mencionam algo que a
 * CC-e não pode corrigir". O texto da troca traz o CNPJ do NOVO transportador
 * (e às vezes a quantidade de VOLUMES), e a régua lia "CNPJ"/"quantidade" como
 * dado vedado. Fatos cobrados: dados do transportador não acendem; o que é
 * vedado continua acendendo mesmo num texto de transporte (destinatário, valor
 * do frete, quantidade da mercadoria); e o CFOP segue pedindo conferência.
 */
// @ts-expect-error — módulo .js do backend (sem tipos)
import { classificarCce } from '../sefaz-backend/cce-escrituracao.js';

const classe = (xCorrecao: string) => classificarCce({ xCorrecao }).classe;

it.each([
    'Alteracao da transportadora para TRANSLOG LTDA, CNPJ 12.345.678/0001-90, IE 123456789',
    'Correcao do transportador: CNPJ 11222333000181, placa ABC1D23, quantidade de volumes 3',
    'Fica alterado o transportador para JOAO DA SILVA CPF 123.456.789-09, veiculo placa XYZ9A99',
])('troca de transportador: sem efeito fiscal — %s', (t) => {
    expect(classe(t)).toBe('sem-efeito-fiscal');
});

it.each([
    ['muda o DESTINATÁRIO junto', 'Troca do transportador e do destinatario para CNPJ 11222333000181'],
    ['mexe no VALOR do frete', 'Alteracao do valor do frete da transportadora'],
    ['quantidade da MERCADORIA, sem transporte', 'Corrigir quantidade do produto para 10'],
    ['CNPJ sem transporte (é de remetente/destinatário)', 'Corrigir o CNPJ para 11222333000181'],
])('continua indevida: %s', (_n, t) => {
    expect(classe(t)).toBe('indevida-suspeita');
});

it('CFOP continua pedindo conferência', () => {
    expect(classificarCce({ xCorrecao: 'CFOP de 5102 para 5405' })).toMatchObject({ classe: 'muda-escrituracao', exigeConferencia: true });
});
