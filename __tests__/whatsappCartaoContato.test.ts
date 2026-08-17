/**
 * 📤 Cartão de contato (tipo `contacts` da Cloud API).
 *
 * O detalhe que decide se isso serve pra alguma coisa é o **wa_id**: é ele
 * que faz aparecer o botão "Conversar" no cartão que chega ao cliente. Sem
 * ele o WhatsApp mostra um cartão MORTO — e cartão morto é pior que mandar o
 * número em texto, porque parece que vai funcionar e não funciona.
 */
import { montarMensagemContato } from '../sefaz-backend/whatsapp-cloud';

describe('montarMensagemContato', () => {
    it('monta o cartão com wa_id em dígitos e telefone com +', () => {
        const p = montarMensagemContato({ para: '5511999990000', contatos: [{ numero: '5511988887777', nome: 'Maria Souza' }] });
        expect(p.type).toBe('contacts');
        expect(p.to).toBe('5511999990000');
        expect(p.contacts[0].phones[0]).toEqual({ phone: '+5511988887777', type: 'CELL', wa_id: '5511988887777' });
    });

    it('quebra o nome em primeiro/último — a Meta recusa o payload com só o formatado', () => {
        const c = montarMensagemContato({ para: '55', contatos: [{ numero: '5511988887777', nome: 'Maria Souza Lima' }] }).contacts[0];
        expect(c.name.formatted_name).toBe('Maria Souza Lima');
        expect(c.name.first_name).toBe('Maria');
        expect(c.name.last_name).toBe('Souza Lima');
    });

    it('nome de uma palavra não inventa sobrenome', () => {
        const c = montarMensagemContato({ para: '55', contatos: [{ numero: '5511988887777', nome: 'Maria' }] }).contacts[0];
        expect(c.name.first_name).toBe('Maria');
        expect(c.name.last_name).toBeUndefined();
    });

    it('contato sem nome usa o número — cartão sem nome nenhum a Meta recusa', () => {
        const c = montarMensagemContato({ para: '55', contatos: [{ numero: '5511988887777' }] }).contacts[0];
        expect(c.name.formatted_name).toBe('5511988887777');
    });

    it('máscara no número não vaza pro wa_id', () => {
        const c = montarMensagemContato({ para: '55', contatos: [{ numero: '+55 (11) 98888-7777', nome: 'X' }] }).contacts[0];
        expect(c.phones[0].wa_id).toBe('5511988887777');
    });

    it('empresa vira org; sem empresa, o campo não aparece (campo vazio é ruído no cartão)', () => {
        const com = montarMensagemContato({ para: '55', contatos: [{ numero: '551188', nome: 'X', empresa: 'PADARIA BOM PÃO' }] }).contacts[0];
        expect(com.org).toEqual({ company: 'PADARIA BOM PÃO' });
        expect(montarMensagemContato({ para: '55', contatos: [{ numero: '551188', nome: 'X' }] }).contacts[0].org).toBeUndefined();
    });

    it('lista vazia devolve contacts vazio — quem recusa é a rota, com frase', () => {
        expect(montarMensagemContato({ para: '55', contatos: [] }).contacts).toEqual([]);
        expect(montarMensagemContato({ para: '55' }).contacts).toEqual([]);
    });
});
