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
import { filaParaTemplate } from '../services/spConnect';

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

    it('⚠️ a FILA vem da conversa, e a REGRA tem dono fora da tela', () => {
        // 🐛 AS DUAS ASSERÇÕES QUE MORAVAM AQUI PRENDIAM A IMPLEMENTAÇÃO
        // INLINE (`filasChip.some(...)`, `filasChip[0]?.id || ...`) e caíram
        // no minuto em que a regra virou função pura — sobre código MELHOR.
        // Trava que cobra a forma da linha atrapalha justamente o refactor
        // que ela deveria proteger. O que importa é que a tela CONSOME o
        // dono; o comportamento se prova executando `filaParaTemplate`,
        // no bloco do fim deste arquivo.
        expect(tela).toMatch(/filaParaTemplate\(/);
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

// ════════════════════════════════════════════════════════════════════════════
// ✅ A PARTE QUE DÁ PARA PROVAR POR EXECUÇÃO
//
// Os testes acima são VARREDURA DE FONTE: provam que a fiação está escrita,
// não que o botão renderiza. A escolha da fila é a única decisão de verdade
// desta entrega, e ela foi extraída para função pura justamente para sair do
// regex e entrar no exercício real. O clique continua sendo prova da pessoa.
// ════════════════════════════════════════════════════════════════════════════
describe('✅ filaParaTemplate — exercitada, não varrida', () => {
    const filas = [{ id: 'contabil' }, { id: 'fiscal' }];

    it('a fila da conversa é respeitada quando a pessoa a enxerga', () => {
        expect(filaParaTemplate('contabil', filas, 'fiscal')).toBe('contabil');
    });

    it('🚨 conversa na RECEPÇÃO (fila null) não vira select vazio', () => {
        // Caso NORMAL, não exceção: toda conversa nova nasce sem fila.
        expect(filaParaTemplate(null, filas, 'fiscal')).toBe('contabil');
        expect(filaParaTemplate(undefined, filas, 'fiscal')).toBe('contabil');
    });

    it('🚨 fila que a pessoa NÃO enxerga cai na primeira dela', () => {
        // Devolver 'juridico' aqui renderizaria um <select> vazio e o envio
        // falharia sem causa — a lição de 16/08.
        expect(filaParaTemplate('juridico', filas, 'fiscal')).toBe('contabil');
    });

    it('⚠️ sem fila nenhuma visível, devolve o padrão — nunca string vazia', () => {
        // Campo vazio é o que faz o envio morrer calado; o padrão ao menos
        // chega ao backend, que recusa com motivo.
        expect(filaParaTemplate('contabil', [], 'fiscal')).toBe('fiscal');
        expect(filaParaTemplate(null, [], 'fiscal')).toBe('fiscal');
    });

    it('e a tela CONSOME o dono — não reimplementa a escolha', () => {
        expect(tela).toMatch(/filaParaTemplate\(conversa\.fila, filasChip, nc\.departamento\)/);
    });
});
