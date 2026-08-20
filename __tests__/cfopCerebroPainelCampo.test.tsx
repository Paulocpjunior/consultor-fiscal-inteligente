// ============================================================================
// 🚨 "O componente Escriturar como continua desabilitado" (Paulo, 20/08, print).
//
// Este teste NÃO confere texto de código: ele RENDERIZA o painel e DIGITA no
// campo, que é a única forma de responder "dá para preencher?". A varredura de
// fonte que subiu antes provava o placeholder e a mensagem — e não provava o
// que o dedo dele encontrou na tela.
//
// É a régua de sempre: validação por RESULTADO, não por status.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// O painel importa o serviço, que puxa firebase — aqui só interessa a TELA.
jest.mock('../services/cfopEscrituradoService', () => ({
    lerParametrosCfop: jest.fn(async () => []),
    gravarParametroCfop: jest.fn(async () => undefined),
    desligarParametroCfop: jest.fn(async () => undefined),
}));

import CfopCerebroPainel from '../components/CfopCerebroPainel';
import { gravarParametroCfop } from '../services/cfopEscrituradoService';

const FORNECEDORES = [{
    cnpj: '15438711000110',
    nome: 'Parnassa Comercio de Tecidos e Aviamentos Ltda',
    cfops: ['6102'],
    notas: 7,
}];

const montar = () => render(
    <CfopCerebroPainel
        empresaId="emp-1"
        user={{ email: 'colaborador@spassessoriacontabil.com.br' } as never}
        fornecedores={FORNECEDORES}
        parametros={[]}
        onMudou={() => { /* noop */ }}
        competenciaPadrao="2026-07"
    />,
);

const campoDestino = () => screen.getByLabelText('Escriturar como') as HTMLInputElement;
const botao = () => screen.getByRole('button', { name: /Criar parâmetro/ }) as HTMLButtonElement;

describe('🚨 o campo "Escriturar como" ACEITA digitação', () => {
    it('não nasce disabled nem readOnly — é nele que a pessoa digita', () => {
        montar();
        expect(campoDestino().disabled).toBe(false);
        expect(campoDestino().readOnly).toBe(false);
    });

    it('digitar os 4 dígitos muda o valor do campo', () => {
        montar();
        fireEvent.change(campoDestino(), { target: { value: '1556' } });
        expect(campoDestino().value).toBe('1556');
    });

    it('o `—` é PLACEHOLDER, não valor — o campo começa vazio', () => {
        montar();
        expect(campoDestino().value).toBe('');
        expect(campoDestino().placeholder).toBe('—');
    });

    it('com fornecedor escolhido e CFOP digitado, o botão LIGA e grava', () => {
        montar();
        fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: '15438711000110' } });
        fireEvent.change(campoDestino(), { target: { value: '1556' } });
        expect(botao().disabled).toBe(false);
        fireEvent.click(botao());
        expect(gravarParametroCfop).toHaveBeenCalledWith(expect.objectContaining({
            cnpjFornecedor: '15438711000110', cfopDestino: '1556',
        }));
    });

    it('e enquanto falta algo o botão fica desligado DIZENDO o quê', () => {
        montar();
        expect(botao().disabled).toBe(true);
        expect(screen.getByText(/Falta escolher o fornecedor/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: '15438711000110' } });
        expect(screen.getByText(/Falta preencher "Escriturar como"/)).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// E O QUE SOBRAVA ERA A AFFORDANCE. O campo funcionava e PARECIA desligado —
// entre dois <select> com valor, um input com um `—` cinza lê-se como célula
// de saída. Para quem usa, "parece desabilitado" e "está desabilitado" são a
// mesma coisa: nos dois casos ele não digita.
//
// O exemplo fica FORA do campo de propósito: dentro dele já foi o `1556` cinza
// que Paulo leu como valor preenchido, no primeiro print do mesmo dia.
// ═══════════════════════════════════════════════════════════════════════════
describe('o campo vazio DIZ que é de digitação', () => {
    it('com o campo em branco, a linha embaixo explica o que fazer', () => {
        montar();
        expect(screen.getByText(/é campo de digitação/)).toBeTruthy();
        expect(screen.getByText(/uso ou consumo/)).toBeTruthy();
    });

    it('e o campo vazio vem destacado — vazio não pode parecer desligado', () => {
        montar();
        expect(campoDestino().className).toMatch(/ring-1/);
    });

    it('digitado, o destaque sai e a DESCRIÇÃO OFICIAL toma o lugar da dica', () => {
        montar();
        fireEvent.change(campoDestino(), { target: { value: '1556' } });
        expect(campoDestino().className).not.toMatch(/ring-1/);
        expect(screen.queryByText(/é campo de digitação/)).toBeNull();
        // A descrição vem do catálogo oficial (Ajuste SINIEF 03/24), não da dica.
        expect(screen.getByText('Compra de material para uso ou consumo')).toBeTruthy();
    });

    it('sem fornecedor nenhum a dica não aparece — não há o que cadastrar', () => {
        render(
            <CfopCerebroPainel
                empresaId="emp-1" user={null} fornecedores={[]} parametros={[]}
                onMudou={() => { /* noop */ }} competenciaPadrao="2026-07"
            />,
        );
        expect(screen.queryByText(/é campo de digitação/)).toBeNull();
    });
});
