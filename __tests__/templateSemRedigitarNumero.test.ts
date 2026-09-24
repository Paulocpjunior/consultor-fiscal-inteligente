// ============================================================================
// 🚨 A JANELA FECHOU E O AVISO MANDAVA REDIGITAR O NÚMERO
//
// 23/09, achado de um COLABORADOR no atendimento do Eduardo Guerra (Paulo
// trouxe o print): com a janela de 24h fechada, o rodapé do composer dizia
// *"o envio de template direto daqui chega na próxima etapa; por enquanto use
// o envio de guia/template das telas do módulo"* — e nessas telas a pessoa
// **digita de novo** o número de quem já está aberto na tela.
//
// ⚠️ É A MESMA FAMÍLIA DO PREFIXO QUE O PAULO RECUSOU NA LIGAÇÃO (25/08):
// *"mandar a pessoa decorar um prefixo e REDIGITAR o número reintroduz à mão
// um dado que o sistema já tem — e é exatamente aí que um dígito errado liga
// para um estranho"*. Aqui o custo é o mesmo com outra roupa: template de
// cliente saindo para um número trocado.
//
// 📌 E O BACKEND JÁ FAZIA TUDO: `/conversas/iniciar` recebe número, template
// e variáveis desde sempre. Não faltava mecanismo — faltava o BOTÃO. Por isso
// a trava cobra o CAMINHO DO DADO (número, nome e fila saindo da conversa),
// não a existência de um botão bonito.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

describe('🚨 template fora da janela não faz redigitar o número', () => {
    it('o aviso da janela fechada oferece o envio PARA O CONTATO ABERTO', () => {
        expect(tela).toMatch(/Janela de 24h fechada/);
        expect(tela).toMatch(/abrirNovaPara\(sel\)/);
    });

    it('🚨 e o número vem da CONVERSA, nunca de digitação', () => {
        // O ponto inteiro do achado. Se algum dia isto virar um campo vazio
        // de novo, o defeito volta inteiro.
        expect(tela).toMatch(/para: conversa\.numero/);
        expect(tela).toMatch(/nomeContato: conversa\.nome/);
    });

    it('⚠️ a FILA vem da conversa, não do default do módulo', () => {
        // Mandar pelo 'fiscal' um atendimento que está no Contábil trocaria o
        // departamento do protocolo — e o cliente receberia resposta de outra
        // equipe.
        expect(tela).toMatch(/filaDaConversa/);
        expect(tela).toMatch(/filasChip\.some\(\(x\) => x\.id === conversa\.fila\)/);
    });

    it('🐛 e fila que a pessoa NÃO vê cai na dela — select vazio some sem erro', () => {
        // Lição de 16/08 (o dropdown de template vazio culpando a pessoa
        // errada): um <select> cujo value não está entre as options renderiza
        // VAZIO, e o envio falha sem dizer por quê. Conversa na Recepção tem
        // `fila: null`, então este galho é o caso NORMAL, não a exceção.
        expect(tela).toMatch(/filasChip\[0\]\?\.id \|\| nc\.departamento/);
    });

    it('📌 o texto morto saiu — não promete mais "na próxima etapa"', () => {
        // A etapa chegou. Aviso que descreve um futuro que já é presente é a
        // classe que mordeu quatro vezes nesta semana.
        expect(tela).not.toMatch(/chega na próxima etapa/);
        expect(tela).not.toMatch(/use o envio de guia\/template das telas do módulo/);
    });

    it('🔒 e o carregamento de templates tem DONO ÚNICO', () => {
        // Duas portas abrem o mesmo modal (✚ Nova e "enviar para este
        // contato"). Duas cópias do carregamento divergiriam em silêncio no
        // primeiro filtro que mudasse — e o filtro aqui decide QUAIS
        // templates a pessoa pode mandar ao cliente.
        expect(tela).toMatch(/carregarTemplatesSePreciso/);
        expect((tela.match(/listarTemplatesDaMeta\(\)/g) || []).length).toBe(1);
    });
});
