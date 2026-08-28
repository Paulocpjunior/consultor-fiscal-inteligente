/**
 * 🚦 O PAINEL DE CADASTROS ATACA POR CAUSA — provado por RENDER.
 *
 * A régua de 20/08 (o campo do cérebro do CFOP que a varredura dizia estar
 * certo e o dedo do Paulo não achava): **varredura de fonte prova o CÓDIGO,
 * não a TELA**. Um bloco que agrupa por causa e um filtro que responde ao
 * clique se provam montando, clicando e lendo o que aparece.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CadastrosPanel from '../components/Diagnostico/CadastrosPanel';

const resposta = {
    resumo: { total: 3, criticos: 0, altos: 2, medios: 1, ok: 0 },
    porCampo: [
        {
            campo: 'dadosFiscais.classEstabIpi',
            descricao: 'Contribuinte de IPI sem a classificação do estabelecimento industrial (registro 0002)',
            impacto: 'EFD ICMS/IPI: o 0002 não sai e o PVA RECUSA o arquivo',
            qtd: 2,
            empresas: ['PWR', 'PS VIDROS'],
        },
        {
            campo: 'dadosFiscais.icmsCodRec',
            descricao: 'Contribuinte de ICMS em PR sem o código de receita estadual',
            impacto: 'EFD ICMS/IPI: o E116 sai com o campo do código VAZIO',
            qtd: 1,
            empresas: ['CLIENTE PR'],
        },
    ],
    empresas: [
        {
            cnpj: '11111111000191', nome: 'PWR', regime: 'lucro', gravidade: 'alto',
            pendencias: [{ campo: 'dadosFiscais.classEstabIpi', descricao: 'falta 0002', impacto: 'recusa' }],
        },
        {
            cnpj: '22222222000191', nome: 'PS VIDROS', regime: 'lucro', gravidade: 'alto',
            pendencias: [{ campo: 'dadosFiscais.classEstabIpi', descricao: 'falta 0002', impacto: 'recusa' }],
        },
        {
            cnpj: '33333333000191', nome: 'CLIENTE PR', regime: 'lucro', gravidade: 'medio',
            pendencias: [{ campo: 'dadosFiscais.icmsCodRec', descricao: 'falta código', impacto: 'E116 vazio' }],
        },
    ],
    geradoEm: '2026-08-27T23:00:00.000Z',
};

jest.mock('../services/diagnosticoCadastrosService', () => ({
    getDiagnosticoCadastros: jest.fn(async () => resposta),
}));

const montar = async () => {
    const r = render(<CadastrosPanel />);
    await waitFor(() => expect(screen.getByText(/Por causa/)).toBeTruthy());
    return r;
};

describe('🚦 bloco por causa', () => {
    it('mostra a causa com a contagem e o impacto — "2" é UMA tarefa, não dois mistérios', async () => {
        const { container } = await montar();
        expect(container.textContent).toMatch(/classificação do estabelecimento industrial/);
        expect(container.textContent).toMatch(/o PVA RECUSA o arquivo/);
    });

    // O filtro por causa é o que transforma o número em fila de trabalho: sem
    // ele, "2 empresas" continua sendo um número que ninguém consegue abrir.
    it('clicar na causa mostra as empresas DELA', async () => {
        const { container } = await montar();
        // O painel abre no filtro 'critico', então a lista nasce vazia aqui.
        expect(container.textContent).not.toMatch(/PS VIDROS/);

        fireEvent.click(screen.getByText(/classificação do estabelecimento industrial/));
        await waitFor(() => expect(container.textContent).toMatch(/PS VIDROS/));
        expect(container.textContent).toMatch(/PWR/);
        // ⚠️ E só as dela: a empresa da OUTRA causa fica fora.
        expect(container.textContent).not.toMatch(/CLIENTE PR/);
    });

    // ⚠️ O filtro por causa VENCE o de gravidade: quem clicou em "2" quer as
    // duas, não a interseção com o filtro que estava aberto — interseção
    // silenciosa faria o número da tela desmentir a lista logo abaixo.
    it('a causa vence o filtro de gravidade aberto', async () => {
        const { container } = await montar();
        fireEvent.click(screen.getByText(/código de receita estadual/));
        // 'CLIENTE PR' é MÉDIO e o filtro aberto é 'crítico' — ela aparece.
        await waitFor(() => expect(container.textContent).toMatch(/CLIENTE PR/));
    });

    it('clicar de novo na mesma causa desliga o filtro', async () => {
        const { container } = await montar();
        const causa = screen.getByText(/classificação do estabelecimento industrial/);
        fireEvent.click(causa);
        await waitFor(() => expect(container.textContent).toMatch(/PS VIDROS/));
        fireEvent.click(screen.getByText(/classificação do estabelecimento industrial/));
        await waitFor(() => expect(container.textContent).not.toMatch(/PS VIDROS/));
    });

    // 🚨 Vazio com filtro por causa aberto NÃO é "está tudo certo" — é
    // "ninguém tem esta causa". A frase errada faz alguém concluir o contrário.
    it('a frase do vazio muda com o filtro por causa', async () => {
        const { container } = await montar();
        expect(container.textContent).toMatch(/Nenhuma empresa nessa gravidade/);
        fireEvent.click(screen.getByText(/código de receita estadual/));
        await waitFor(() => expect(container.textContent).toMatch(/CLIENTE PR/));
        fireEvent.change(screen.getByPlaceholderText(/Buscar por nome/), { target: { value: 'zzz' } });
        await waitFor(() => expect(container.textContent).toMatch(/Nenhuma empresa com esta pendência/));
    });
});

// 🐛 DEFEITO PRÉ-EXISTENTE, achado por este teste: `cnpj.includes('')` é
// SEMPRE true, então buscar um texto sem dígitos ("zzz") devolvia a carteira
// INTEIRA — e lista cheia se lê como "achei tudo", quando o certo é "não achei
// nada". É o silêncio falso com outra roupa: o painel respondia o oposto.
describe('🐛 busca por texto sem dígito', () => {
    it('não devolve a carteira inteira', async () => {
        const { container } = await montar();
        fireEvent.click(screen.getByText(/classificação do estabelecimento industrial/));
        await waitFor(() => expect(container.textContent).toMatch(/PWR/));
        fireEvent.change(screen.getByPlaceholderText(/Buscar por nome/), { target: { value: 'zzz' } });
        await waitFor(() => expect(container.textContent).not.toMatch(/PS VIDROS/));
    });

    it('e a busca por CNPJ continua funcionando', async () => {
        const { container } = await montar();
        fireEvent.click(screen.getByText(/classificação do estabelecimento industrial/));
        fireEvent.change(screen.getByPlaceholderText(/Buscar por nome/), { target: { value: '2222' } });
        await waitFor(() => expect(container.textContent).toMatch(/PS VIDROS/));
        expect(container.textContent).not.toMatch(/PWR/);
    });
});
