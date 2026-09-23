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
import { motivoDoBotaoDesligado } from '../services/issEnvioBotao';

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
