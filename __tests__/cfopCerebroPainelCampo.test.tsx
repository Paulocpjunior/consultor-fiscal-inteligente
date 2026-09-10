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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// O painel importa o serviço, que puxa firebase — aqui só interessa a TELA.
jest.mock('../services/cfopEscrituradoService', () => ({
    lerParametrosCfop: jest.fn(async () => ({ parametros: [], erro: null as string | null })),
    gravarParametroCfop: jest.fn(async () => undefined),
    desligarParametroCfop: jest.fn(async () => undefined),
}));

import CfopCerebroPainel from '../components/CfopCerebroPainel';
import { gravarParametroCfop, lerParametrosCfop } from '../services/cfopEscrituradoService';

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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 "QUANDO EU INFORMO O CFOP NÃO GRAVA" (Paulo, 10/09, DISTRIBUIDORA DE
// BANANAS ELS — POSTO BORDO, origem 5656, escriturar como 1407).
//
// Ele digitava, clicava em Criar parâmetro, o campo LIMPAVA e a lista continuava
// em "Parâmetros ativos (0)". O parâmetro ERA GRAVADO: quem falhava era a
// LEITURA de volta — consulta sem `limit`, que a regra do Firestore NEGA, com o
// `catch { return [] }` transformando a recusa em "esta empresa não tem
// parâmetro". Duas leituras do mesmo fato, e a que fala mais alto mentia.
//
// A prova é por RENDER, clicando: a varredura de fonte nunca acharia isto.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 gravou e não leu — a tela DIZ, em vez de parecer que não gravou', () => {
    beforeEach(() => {
        (lerParametrosCfop as jest.Mock).mockReset();
        (gravarParametroCfop as jest.Mock).mockReset();
        (gravarParametroCfop as jest.Mock).mockResolvedValue(undefined);
    });

    it('leitura recusada depois de gravar acende o aviso NOMEANDO a causa', async () => {
        (lerParametrosCfop as jest.Mock).mockResolvedValue({
            parametros: [],
            erro: 'Missing or insufficient permissions.',
        });
        montar();
        fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: '15438711000110' } });
        fireEvent.change(campoDestino(), { target: { value: '1407' } });
        fireEvent.click(botao());

        const aviso = await screen.findByText(/Não deu para/);
        expect(aviso.textContent).toMatch(/Missing or insufficient permissions/);
        // E a consequência que ninguém deduz: criar de novo DUPLICA.
        expect(aviso.textContent).toMatch(/pode ter sido gravado/);
        expect(aviso.textContent).toMatch(/dois parâmetros/);
    });

    it('leitura OK não acende aviso nenhum — alarme sobre tela correta desliga a trava', async () => {
        (lerParametrosCfop as jest.Mock).mockResolvedValue({ parametros: [], erro: null });
        montar();
        fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: '15438711000110' } });
        fireEvent.change(campoDestino(), { target: { value: '1407' } });
        fireEvent.click(botao());

        await waitFor(() => expect(gravarParametroCfop).toHaveBeenCalled());
        expect(screen.queryByText(/Não deu para/)).toBeNull();
    });

    it('e o aviso do carregamento do PAI chega pela prop, sem clique nenhum', () => {
        (lerParametrosCfop as jest.Mock).mockResolvedValue({ parametros: [], erro: null });
        render(
            <CfopCerebroPainel
                empresaId="emp-1" user={null} fornecedores={FORNECEDORES} parametros={[]}
                erroLeitura="Missing or insufficient permissions."
                onMudou={() => { /* noop */ }} competenciaPadrao="2026-07"
            />,
        );
        expect(screen.getByText(/Não deu para/)).toBeTruthy();
    });
});
