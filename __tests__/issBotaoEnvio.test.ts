// ============================================================================
// 🚨 "A FUNÇÃO DE ENVIAR O ISS VIA SISTEMA NÃO ESTÁ DISPONÍVEL, IGUAL AOS
// OUTROS IMPOSTOS, CERTO?" (31/08, Paulo, na CLINICA MANTOAN 08/2026).
//
// 🔴 ELA ESTÁ. O rito é o MESMO do DAS, do DARF e do DARE (envio pelo servidor,
// gestor em cópia oculta, cópia no SharePoint, baixa da obrigação). O botão
// estava apagado por falta do PDF e **não dizia isso** — e botão apagado sem
// motivo se lê como função inexistente.
//
// É a classe de 20/08 (o campo do cérebro do CFOP que "parecia desabilitado"):
// para quem usa, "parece desligado" e "está desligado" são a mesma coisa.
// ============================================================================
import { motivoDoBotaoDesligado, motivoDoBotaoRetidoDesligado, retidoAptoParaEnvio } from '../services/issEnvioBotao';
import { guiaIssDoEnvio } from '../sefaz-backend/guia-iss.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { obrigacaoDoTipo } from '../sefaz-backend/envio-imposto.js';

describe('🚨 o botão desligado diz o que falta', () => {
    it('com PDF e apuração apta, o botão liga e não há frase', () => {
        expect(motivoDoBotaoDesligado(true, true)).toBeNull();
    });

    // ⚠️ AS DUAS CAUSAS SÃO SEPARADAS de propósito: a ação de uma é anexar o
    // PDF, a da outra é resolver a apuração. Uma frase só faria a pessoa
    // procurar a coisa errada.
    it('sem PDF, explica que o envio EXISTE e por que o anexo é exigido', () => {
        const m = motivoDoBotaoDesligado(false, true)!;
        expect(m).toMatch(/Falta anexar o PDF/);
        expect(m).toMatch(/EXISTE aqui/);
        expect(m).toMatch(/igual ao DAS e ao DARF/);
        // A razão é do IMPOSTO, não do app — senão a exigência parece capricho.
        expect(m).toMatch(/emitida no portal da Prefeitura/);
        expect(m).toMatch(/Anexar PDF da guia/);
    });

    it('apuração com pendência tem frase PRÓPRIA, e ela vence', () => {
        const m = motivoDoBotaoDesligado(false, false)!;
        expect(m).toMatch(/apuração tem pendência/);
        expect(m).not.toMatch(/Falta anexar o PDF/);
    });
});

// ============================================================================
// ↩ 02/10 — BOLA N'AGUA: "tentei encaminhar o guia de ISS TOMADOS pelo
// consultor, mas está habilitado somente para ISS PRESTADOS". ISS próprio
// R$ 0,00 e retido como tomadora R$ 3,67: o botão único exigia ISS próprio.
// ============================================================================
describe('↩ a guia do ISS RETIDO como tomadora tem envio próprio', () => {
    const nota = (over: any = {}) => ({ issRetido: 3.67, semValorGravado: false, ...over });

    it('retido com valor e sem buraco de dado: apto', () => {
        expect(retidoAptoParaEnvio({ totalRetido: 3.67, notas: [nota()] })).toBe(true);
    });

    it('nota retida sem o valor gravado: não apto (ausência não é zero)', () => {
        expect(retidoAptoParaEnvio({ totalRetido: 3.67, notas: [nota(), nota({ issRetido: 0, semValorGravado: true })] })).toBe(false);
        expect(motivoDoBotaoRetidoDesligado(true, false)).toMatch(/sem o valor gravado/);
    });

    it('sem retido: não apto', () => {
        expect(retidoAptoParaEnvio({ totalRetido: 0, notas: [] })).toBe(false);
        expect(retidoAptoParaEnvio(null)).toBe(false);
    });

    it('apto sem PDF diz o que falta; com PDF liga', () => {
        expect(motivoDoBotaoRetidoDesligado(false, true)).toMatch(/Anexar PDF da guia do retido/);
        expect(motivoDoBotaoRetidoDesligado(true, true)).toBeNull();
    });

    it('ISS próprio zero com retido: o botão do próprio não fala em "pendência" e aponta o do retido', () => {
        const m = motivoDoBotaoDesligado(true, false, { aRecolher: 0, retido: 3.67 })!;
        expect(m).not.toMatch(/pendência/);
        expect(m).toMatch(/ISS RETIDO/);
    });

    it('o tipo que a tela manda ("ISS RETIDO") é a guia do retido e não procura a tarefa do ISS próprio', () => {
        expect(guiaIssDoEnvio({ tipo: 'ISS RETIDO' })).toBe('retido');
        expect(obrigacaoDoTipo('ISS RETIDO')).toBeNull();
    });
});
