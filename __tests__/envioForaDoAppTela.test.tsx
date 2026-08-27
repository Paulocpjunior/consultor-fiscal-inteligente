// ============================================================================
// 📋 A PORTA DO ENVIO DECLARADO — provada por RENDER, não por varredura
//
// A lição de 20/08 (o campo do cérebro do CFOP): **varredura de fonte prova o
// CÓDIGO, não a TELA**. O que importa aqui é o que o dedo do colaborador
// encontra quando ele bate na trava — e o que a tela DIZ antes do clique.
//
// A trava sem caminho é trava que a equipe contorna (13/08) — e aqui o
// contorno seria mandar a guia DE NOVO ao cliente.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FimDeMesBloco from '../components/FimDeMesBloco';

jest.mock('../services/fimDeMesService', () => ({
    darFimDeMes: jest.fn(),
    reabrirCompetencia: jest.fn(),
}));
jest.mock('../services/envioImpostoService', () => ({
    registrarEnvioForaDoApp: jest.fn(),
    meiosForaDoApp: jest.fn(async () => [
        { id: 'email-pessoal', label: 'E-mail de outra caixa (fora do app)' },
        { id: 'outro', label: 'Outro meio (escreva qual)' },
    ]),
}));

const bloqueio = (id: string, nome: string) => ({ id, ordem: 5, nome, onde: 'Vencimentos', resumo: 'x', acao: 'y' });

const montar = (bloqueios: any[]) => render(
    <FimDeMesBloco
        empresaId="e1" competencia="2026-07"
        empresaCnpj="11111111000191" empresaNome="AC MASON"
        fechamento={null} bloqueios={bloqueios}
    />,
);

describe('📋 a porta do envio declarado', () => {
    it('aparece quando é a GUIA que bloqueia o fim de mês', () => {
        montar([bloqueio('guias', 'Emitir e enviar guias')]);
        expect(screen.getByText(/Já enviei esta guia por fora/)).toBeTruthy();
    });

    // ⚠️ Oferecer a declaração ao lado de "falta capturar" convidaria a
    // declarar o que não foi feito. Ela só existe onde a trava é a guia.
    it('NÃO aparece quando o bloqueio é outra etapa', () => {
        montar([bloqueio('captura', 'Capturar notas')]);
        expect(screen.queryByText(/Já enviei esta guia por fora/)).toBeNull();
    });

    it('sem bloqueio nenhum, não há porta — não há o que declarar', () => {
        const { container } = montar([]);
        expect(container.textContent).not.toMatch(/Já enviei esta guia por fora/);
    });

    // 🚨 27/08, VINCENZO GUERRA (Paulo: *"ESSE FOI ENVIADO PELO SISTEMA, ELE TEM
    // QUE ENTENDER"*): quando o app JÁ enviou a guia e o que falta é o RITO,
    // declarar outro envio não fecha nada — e convida a declarar o que o app
    // fez. Quem decide é a etapa; a tela não reimplementa a pergunta.
    it('NÃO aparece quando o app já enviou e o que falta é o rito', () => {
        montar([{ ...bloqueio('guias', 'Emitir e enviar guias'), podeDeclararEnvio: false }]);
        expect(screen.queryByText(/Já enviei esta guia por fora/)).toBeNull();
    });

    it('continua aparecendo quando a etapa diz que a guia não saiu pelo app', () => {
        montar([{ ...bloqueio('guias', 'Emitir e enviar guias'), podeDeclararEnvio: true }]);
        expect(screen.getByText(/Já enviei esta guia por fora/)).toBeTruthy();
    });

    // 🚨 O QUE A TELA DIZ É METADE DA ENTREGA: quem clica precisa saber, ANTES,
    // que o app não vai enviar nada e que o envio fica sem prova.
    it('ao abrir, DIZ que o app não envia e que fica sem prova de entrega', async () => {
        montar([bloqueio('guias', 'Emitir e enviar guias')]);
        fireEvent.click(screen.getByText(/Já enviei esta guia por fora/));
        // O texto vai partido em <span>, então quem responde é o textContent.
        const caixa = await screen.findByText(/Registrar um envio que já aconteceu/);
        const bloco = caixa.closest('div')!;
        expect(bloco.textContent).toMatch(/não vai enviar nada/);
        expect(bloco.textContent).toMatch(/sem prova de entrega/);
        expect(bloco.textContent).toMatch(/com o seu nome e a data/);
    });

    // A lista de meios vem do BACKEND — a tela não tem a segunda cópia.
    it('os meios são carregados do backend, não escritos na tela', async () => {
        const { meiosForaDoApp } = require('../services/envioImpostoService');
        montar([bloqueio('guias', 'Emitir e enviar guias')]);
        fireEvent.click(screen.getByText(/Já enviei esta guia por fora/));
        await screen.findByText(/Registrar um envio que já aconteceu/);
        expect(meiosForaDoApp).toHaveBeenCalled();
        expect(await screen.findByText('E-mail de outra caixa (fora do app)')).toBeTruthy();
    });

    // A recusa do BACKEND é o que aparece — a tela não valida por conta.
    it('a recusa do backend chega à tela como está', async () => {
        const { registrarEnvioForaDoApp } = require('../services/envioImpostoService');
        registrarEnvioForaDoApp.mockResolvedValueOnce({
            ok: false, error: 'Descreva como a guia chegou ao cliente (mínimo 15 caracteres) — é o que responde a pergunta daqui a três meses.',
        });
        montar([bloqueio('guias', 'Emitir e enviar guias')]);
        fireEvent.click(screen.getByText(/Já enviei esta guia por fora/));
        fireEvent.click(await screen.findByText('Registrar o envio'));
        expect(await screen.findByText(/mínimo 15 caracteres/)).toBeTruthy();
    });

    it('o sucesso mostra a FRASE do backend, que diz que o app não enviou', async () => {
        const { registrarEnvioForaDoApp } = require('../services/envioImpostoService');
        registrarEnvioForaDoApp.mockResolvedValueOnce({
            ok: true,
            declaracao: { texto: 'Envio DECLARADO por ana@x — E-mail em 20/08/2026. "…". O app NÃO enviou esta guia e não tem prova de entrega.' },
        });
        montar([bloqueio('guias', 'Emitir e enviar guias')]);
        fireEvent.click(screen.getByText(/Já enviei esta guia por fora/));
        fireEvent.click(await screen.findByText('Registrar o envio'));
        expect(await screen.findByText(/O app NÃO enviou esta guia/)).toBeTruthy();
    });
});

// ============================================================================
// 🚨 UMA AFIRMAÇÃO QUE O APP ACABOU DE DESMENTIR NÃO FICA NA TELA
//
// Print do Paulo (27/08, REGINA CELIA): **"✓ Pronto para dar fim de mês"** em
// VERDE com a recusa em VERMELHO logo abaixo, na mesma caixa.
//
// O `pre.pode` sai das ETAPAS que o painel leu; o ato recusa por OUTRAS razões
// também (competência ilegível, mês já fechado, sem apuração) — e nenhuma é
// bloqueio de etapa, então a caixa continuava se dizendo pronta enquanto a
// linha de baixo dizia o contrário.
//
// ⚠️ Isto é INDEPENDENTE da causa daquele print (o Simples sem ficha, corrigido
// no backend): é a CLASSE. Qualquer recusa futura que não seja bloqueio de
// etapa cairia na mesma contradição.
// ============================================================================
describe('🚨 a caixa para de dizer "pronto" quando o ato recusa', () => {
    // ⚠️ O ato PERGUNTA antes (`window.confirm`) — fechar muda o que o Contábil
    // importa, e só um admin desfaz. Em jsdom o confirm devolve `undefined`, e
    // sem isto o clique nem chega ao backend.
    beforeEach(() => { window.confirm = jest.fn(() => true); });

    const montarPronta = () => render(
        <FimDeMesBloco empresaId="e1" competencia="2026-07" fechamento={null} bloqueios={[]} />,
    );

    it('sem clicar, ela diz que está pronta', () => {
        const { container } = montarPronta();
        expect(container.textContent).toMatch(/Pronto para dar fim de mês/);
    });

    it('recusa SEM bloqueio de etapa apaga o "pronto" e assume a recusa', async () => {
        const { darFimDeMes } = require('../services/fimDeMesService');
        darFimDeMes.mockResolvedValueOnce({
            ok: false,
            erro: 'Sem apuração registrada nesta competência não há valor a fechar.',
            bloqueios: [],
        });
        const { container } = montarPronta();
        fireEvent.click(screen.getByText(/Dar fim de mês/));
        expect(await screen.findByText(/O fim de mês foi RECUSADO/)).toBeTruthy();
        // A afirmação desmentida SAI da tela — não convive com a recusa.
        expect(container.textContent).not.toMatch(/Pronto para dar fim de mês/);
        // E a frase diz que NÃO é etapa, senão a pessoa vai procurar bloqueio
        // que não existe.
        expect(container.textContent).toMatch(/Nenhuma etapa está bloqueando/);
        expect(container.textContent).toMatch(/Sem apuração registrada/);
    });

    // ⚠️ Quando a recusa TEM bloqueio de etapa, nada muda: ali a lista de
    // etapas abertas já é a explicação, e ela é a única saída que a pessoa tem.
    it('recusa COM bloqueio de etapa continua mostrando a lista', async () => {
        const { darFimDeMes } = require('../services/fimDeMesService');
        darFimDeMes.mockResolvedValueOnce({
            ok: false,
            erro: '1 etapa(s) da rotina ainda não fecharam',
            bloqueios: [bloqueio('captura', 'Capturar notas')],
        });
        const { container } = montarPronta();
        fireEvent.click(screen.getByText(/Dar fim de mês/));
        expect(await screen.findByText(/Fim de mês bloqueado/)).toBeTruthy();
        expect(container.textContent).not.toMatch(/O fim de mês foi RECUSADO/);
    });
});
