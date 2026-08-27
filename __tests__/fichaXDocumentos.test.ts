// ============================================================================
// FAROL FICHA × DOCUMENTOS — imposto digitado precisa de documento por trás.
//
// Caso EXPERTE 06/2026 (Paulo, 15/08): IPI de R$ 7.352,90 digitado na ficha,
// imposto e relatório gerados, ZERO documento no banco — e nada acendia,
// porque ficha e escrituração são trilhos independentes. *"a empresa teve IPI,
// geramos o imposto e relatório: como não houve captura de XML?"*
// ============================================================================
import { conferirFichaContraDocumentos } from '../sefaz-backend/ficha-x-documentos.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('o caso EXPERTE: IPI digitado, banco vazio', () => {
    it('acende VERMELHO com a ação — as três portas de abastecer', () => {
        const r = conferirFichaContraDocumentos({ valorApurado: 7352.90, documentos: 0 });
        expect(r.situacao).toBe('sem-documento');
        expect(r.cor).toBe('falha');
        expect(r.mensagem).toMatch(/SEM NENHUM documento/);
        // A ação lista os TRÊS caminhos — captura, importação, nota digitada.
        expect(r.acao).toMatch(/Status por Empresa/);
        expect(r.acao).toMatch(/Lançar nota sem XML/);
    });
});

describe('o que o farol NÃO afirma', () => {
    it('verde é EXISTÊNCIA, e a frase manda o VALOR para o E510', () => {
        // Sem isso, alguém lê o verde como "IPI conferido" — promessa que é
        // da conferência por CFOP+CST, não desta contagem.
        const r = conferirFichaContraDocumentos({ valorApurado: 1000, documentos: 42 });
        expect(r.situacao).toBe('com-lastro');
        expect(r.mensagem).toMatch(/42 documento/);
        expect(r.mensagem).toMatch(/VALOR se confere no E510/);
    });
});

describe('falha de contagem NÃO é zero', () => {
    it('null apaga o farol em vez de acender "sem lastro"', () => {
        // Zero falso com o banco cheio é o alarme que aparece justamente
        // quando está tudo certo — e ensina a equipe a ignorar o farol.
        const r = conferirFichaContraDocumentos({ valorApurado: 1000, documentos: null });
        expect(r.situacao).toBe('contagem-indisponivel');
        expect(r.cor).toBe('neutro');
        expect(r.mensagem).toMatch(/apagado, não verde/);
    });
});

describe('sem valor na ficha, nada a cruzar', () => {
    it('neutro, sem alarme — ficha zerada com banco vazio é "sem movimento", outro assunto', () => {
        expect(conferirFichaContraDocumentos({ valorApurado: 0, documentos: 0 }).situacao).toBe('sem-valor');
        expect(conferirFichaContraDocumentos({ valorApurado: null as any, documentos: 5 }).situacao).toBe('sem-valor');
    });
});

describe('a rota e a tela carregam o farol', () => {
    it('a rota conta por agregação e trata falha como null — nunca zero', () => {
        const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/ipi-varredura-routes.js'), 'utf8');
        expect(rota).toMatch(/\.count\(\)\.get\(\)/);
        expect(rota).toMatch(/conferirFichaContraDocumentos/);
        // O catch NÃO zera: docs permanece null e o veredito diz "apagado".
        expect(rota).not.toMatch(/docs = 0;\s*\}\s*catch/);
    });

    it('a linha da varredura MOSTRA o farol junto do número digitado', () => {
        const painel = readFileSync(join(__dirname, '..', 'components/DCTFWeb/IpiVarreduraPanel.tsx'), 'utf8');
        expect(painel).toMatch(/l\.lastro/);
        expect(painel).toMatch(/l\.lastro\.acao/);
    });
});

// ─── A MESMA RÉGUA NA ROTINA DO MÊS ────────────────────────────────────────
//
// A doença nunca foi do IPI. A prova saiu da própria Rotina, que é o guia do
// colaborador: a etapa de APURAÇÃO fechava VERDE só por existir ficha — com a
// etapa de CAPTURA logo acima dizendo "nenhuma nota capturada". Duas leituras
// do MESMO mês discordando na MESMA tela, e a de baixo virava "mês fechado".
describe('Rotina do mês: apuração com valor e ZERO documento não é "concluída"', () => {
    const { montarRotinaFiscal } = require('../sefaz-backend/rotina-fiscal.js');
    const empresa = { id: 'e1', nome: 'EXPERTE', cnpj: '11222333000181', regime: 'lucro' };

    const rodar = (apuracao: any, documentos: any[] = []) =>
        montarRotinaFiscal({ empresa, competencia: '2026-06', documentos, apuracao });

    const apurEtapa = (r: any) => r.etapas.find((e: any) => e.id === 'apuracao');

    it('🚨 o caso EXPERTE: imposto na ficha, banco vazio ⇒ ÂMBAR com a ação', () => {
        const e = apurEtapa(rodar({ fonte: 'lucro', totalImpostos: 7352.90, receita: null }));
        expect(e.status).toBe('atencao');
        expect(e.resumo).toMatch(/SEM NENHUM documento/);
        expect(e.acao).toMatch(/Lançar nota sem XML/);
        // Âmbar já impede o "mês fechado" — que é o que decide se alguém pode
        // parar de olhar a competência.
        expect(rodar({ fonte: 'lucro', totalImpostos: 7352.90 }).etapas
            .filter((x: any) => x.id === 'apuracao')[0].status).not.toBe('concluida');
    });

    it('no SIMPLES o número digitado é a RECEITA — e ela também precisa de lastro', () => {
        // `totalImpostos` fica null no Simples (o DAS ainda não foi calculado).
        // Olhar só o imposto deixaria a maior parte da carteira sem farol.
        const e = apurEtapa(rodar({ fonte: 'simples', totalImpostos: null, receita: 63878.60 }));
        expect(e.status).toBe('atencao');
        expect(e.resumo).toMatch(/Receita lançada na ficha SEM NENHUM documento/);
    });

    it('com documento no mês, a apuração fecha normalmente', () => {
        const docs = [{ direcao: 'entrada', valorTotal: 100 }, { direcao: 'saida', valorTotal: 200 }];
        const e = apurEtapa(rodar({ fonte: 'lucro', totalImpostos: 7352.90 }, docs));
        expect(e.status).toBe('concluida');
        expect(e.lastro.situacao).toBe('com-lastro');
    });

    it('🚨 ficha ZERADA com banco vazio NÃO acende — é "sem movimento", outro assunto', () => {
        // Alarme onde não há nada a fazer é o que ensina a equipe a ignorar o
        // farol. Sem movimento tem trilho próprio (declaração ao Fisco).
        const e = apurEtapa(rodar({ fonte: 'simples', totalImpostos: 0, receita: 0 }));
        expect(e.status).toBe('concluida');
        expect(e.lastro.situacao).toBe('sem-valor');
    });

    it('sem apuração nenhuma, a etapa segue pendente pelo motivo de sempre', () => {
        const e = apurEtapa(rodar(null));
        expect(e.status).toBe('pendente');
        expect(e.lastro).toBeUndefined();
    });
});

// ============================================================================
// 🏠 A AUSÊNCIA QUE É DESENHO — receita sem documento por natureza (27/08)
//
// Caso AC MASON: empresa de LOCAÇÃO pura acendia **falha** ("apuração sem
// lastro") todo mês sobre um número certo, mandando "destravar a captura" de
// uma nota que não existe. Aluguel não gera documento — é exatamente a receita
// que o F550 do EFD-Contribuições existe para declarar.
//
// ⚠️ Quem decide se a receita é INTEIRAMENTE de locação é o CHAMADOR
// (`receitaSoDeLocacao`, na Rotina). Aqui só se honra o que ele afirmou:
// empresa que também vende tem documento a capturar.
// ============================================================================
describe('🏠 receita que não gera documento', () => {
    it('não acusa "sem lastro" quando o valor vem de receita sem documento', () => {
        const r = conferirFichaContraDocumentos({
            valorApurado: 1500, documentos: 0, rotulo: 'Imposto apurado',
            receitaSemDocumento: 21811.34,
        });
        expect(r.situacao).toBe('lastro-sem-documento');
        expect(r.mensagem).toMatch(/LOCAÇÃO/);
        expect(r.mensagem).toMatch(/21\.811,34/);
        expect(r.mensagem).toMatch(/F550/);
        expect(r.acao).toBeNull();
    });

    // ⚠️ NEUTRO, nunca 'ok': não há documento para conferir, então dizer
    // "com lastro" seria afirmar uma conferência que não houve.
    it('é NEUTRO, não verde — não houve conferência nenhuma', () => {
        const r = conferirFichaContraDocumentos({
            valorApurado: 1500, documentos: 0, receitaSemDocumento: 100,
        });
        expect(r.cor).toBe('neutro');
        expect(r.cor).not.toBe('ok');
    });

    // 🔒 TRAVA NASCE VERDE: quem não passa o campo (a Varredura de IPI e todos
    // os leitores de antes) continua recebendo exatamente o que recebia.
    it('sem o campo, nada muda — a falha continua sendo falha', () => {
        const r = conferirFichaContraDocumentos({ valorApurado: 1500, documentos: 0 });
        expect(r.situacao).toBe('sem-documento');
        expect(r.cor).toBe('falha');
        expect(conferirFichaContraDocumentos({ valorApurado: 1500, documentos: 0, receitaSemDocumento: 0 }).situacao)
            .toBe('sem-documento');
    });

    // A contagem que FALHOU continua vindo antes: null não é zero, e não é
    // "explicado por locação" — é "não sabemos".
    it('contagem indisponível vence a receita sem documento', () => {
        expect(conferirFichaContraDocumentos({
            valorApurado: 1500, documentos: null, receitaSemDocumento: 100,
        }).situacao).toBe('contagem-indisponivel');
    });
});
