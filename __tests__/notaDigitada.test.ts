// ============================================================================
// NOTA DIGITADA — a terceira porta, no MESMO trilho dos XMLs.
//
// Paulo, 15/08: *"importação de XML — automática ou manual — tem a mesma
// finalidade: abastecer o sistema de lançamentos para que possam ser atendidas
// as obrigações, relatórios, guias. Até mesmo o lançamento de uma nota de
// forma manual, devemos poder fazer."*
//
// ═══ A RÉGUA QUE ESTES TESTES MAIS PROTEGEM: XML VENCE DIGITAÇÃO ════════════
//
// A digitada é o RETRATO que a pessoa fez do documento; o XML é o documento.
// Sem a régua nos DOIS lados, a digitada de hoje travaria como "duplicado" o
// XML verdadeiro de amanhã — a mesma família da lápide que travava a
// reimportação (14/08), só que criada por nós mesmos no dia do lançamento.
// ============================================================================
import {
    validarNotaDigitada, montarNotaDigitada, idNotaDigitada, podeGravarSobre,
    type NotaDigitadaInput,
} from '../services/notaDigitada';
import { decidirGravacaoNFe } from '../sefaz-backend/xml-importer.js';
import { procedenciaDoDocumento } from '../services/documentoProcedencia';
import { classificarNota } from '../sefaz-backend/dipam-produtor-rural.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHAVE = '3'.repeat(44);
const base = (over: Partial<NotaDigitadaInput> = {}): NotaDigitadaInput => ({
    empresaId: 'emp1',
    empresaCnpj: '29.240.822/0001-21',
    empresaNome: 'NOVA ERA',
    direcao: 'entrada',
    numero: '4512',
    serie: '1',
    dhEmi: '2026-07-10',
    participanteNome: 'FORNECEDOR X',
    participanteDoc: '11.222.333/0001-81',
    participanteUf: 'SP',
    valorTotal: 1500,
    itens: [{ cfop: '1102', vProd: 1500 }],
    digitadaPorEmail: 'colab@spassessoriacontabil.com.br',
    ...over,
});

describe('validação: erros em português, com a ação', () => {
    it('nota completa passa', () => {
        expect(validarNotaDigitada(base())).toEqual([]);
    });

    it('valor não tem default — ausente é recusa, não zero', () => {
        expect(validarNotaDigitada(base({ valorTotal: null })).join(' ')).toMatch(/valor total/i);
    });

    it('CFOP de SAÍDA numa entrada é barrado COM a explicação da correlação', () => {
        // O erro clássico: digitar o 5102 do fornecedor. A mensagem ensina que
        // na entrada se lança o CFOP da ESCRITURAÇÃO.
        const erros = validarNotaDigitada(base({ itens: [{ cfop: '5102', vProd: 100 }] }));
        expect(erros.join(' ')).toMatch(/5102 é de SAÍDA/);
        expect(erros.join(' ')).toMatch(/vira 1102/);
    });

    it('chave incompleta é recusada dizendo QUANTOS dígitos vieram', () => {
        const erros = validarNotaDigitada(base({ chave: '123' }));
        expect(erros.join(' ')).toMatch(/44 dígitos.*tem 3/);
    });

    it('entrada sem fornecedor explica ONDE isso morde (DIPAM)', () => {
        expect(validarNotaDigitada(base({ participanteNome: '' })).join(' ')).toMatch(/fornecedor indefinido/i);
    });
});

describe('a nota digitada tem a MESMA forma que o importer grava', () => {
    it('campos chatos E aninhados — metade dos leitores lê cada forma', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.cnpjEmit).toBe('11222333000181');
        expect(d.emitente.cnpjCpf).toBe('11222333000181');
        expect(d.cnpjDest).toBe('29240822000121');
        expect(d.competencia).toBe('2026-07');
        expect(d.valorTotal).toBe(1500);
        expect(d.totais.vNF).toBe(1500);
        expect(d.itens[0]).toMatchObject({ nItem: '1', cfop: '1102', vProd: 1500 });
    });

    it('na ENTRADA o fornecedor é o emitente — igual ao XML de compra', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.emitente.nome).toBe('FORNECEDOR X');
        expect(d.destinatario.nome).toBe('NOVA ERA');
    });

    it('carimbada com quem e quando — dado fiscal digitado sem autor não se audita', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.origem).toBe('digitada');
        expect(d.digitadaPorEmail).toBe('colab@spassessoriacontabil.com.br');
        expect(d.digitadaEm).toBeTruthy();
    });

    it('e os leitores REAIS a enxergam: a DIPAM classifica sem código novo', () => {
        // A prova do "mesmo trilho": classificarNota é um leitor de produção.
        const d: any = montarNotaDigitada(base({
            participanteNome: 'PRODUTOR Y', participanteDoc: '003.419.241-72',
        }));
        const n = classificarNota(d, { empresa: { cnpj: '29240822000121' } });
        expect(n.direcao).toBe('entrada');
        expect(n.fornecedor.doc).toBe('00341924172');
        expect(n.valor).toBe(1500);
    });
});

describe('o id é determinístico — relançar corrige, não duplica', () => {
    it('sem chave: empresa+número+série+competência', () => {
        expect(idNotaDigitada(base())).toBe('digitada_emp1_4512_1_2026-07');
        expect(idNotaDigitada(base())).toBe(idNotaDigitada(base()));
    });

    it('com chave, o id É a chave — é isso que faz o XML futuro cair no mesmo doc', () => {
        expect(idNotaDigitada(base({ chave: CHAVE }))).toBe(CHAVE);
    });
});

// ─── XML VENCE DIGITAÇÃO — nos DOIS sentidos ────────────────────────────────

describe('XML vence digitação', () => {
    it('digitada NÃO sobrescreve documento com XML — e a recusa diz a saída', () => {
        const r = podeGravarSobre({ origem: 'sefaz', xmlHash: 'abc' });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/XML vence a digitação/);
        expect(r.motivo).toMatch(/Substituir/);
    });

    it('digitada sobre digitada regrava — corrigir a digitação é o uso normal', () => {
        expect(podeGravarSobre({ origem: 'digitada' }).ok).toBe(true);
        expect(podeGravarSobre(null).ok).toBe(true);
    });

    it('🚨 o XML que chega DEPOIS faz upgrade da digitada — nunca "duplicado"', () => {
        // O outro lado da régua, no importer. Sem isto, lançar a nota hoje
        // travaria a captura do XML verdadeiro amanhã — para sempre.
        const digitada: any = montarNotaDigitada(base({ chave: CHAVE }));
        const r = decidirGravacaoNFe({
            existingData: digitada, tipoDoc: 'nfe', schema: 'procNFe_v4.00.xsd', chave: CHAVE,
        });
        expect(r.upgrade).toBe(true);
        expect(r.duplicado).toBe(false);
    });

    it('mas RESUMO não rebaixa a digitada — resumo tem menos que o lançamento', () => {
        const digitada: any = montarNotaDigitada(base({ chave: CHAVE }));
        const r = decidirGravacaoNFe({
            existingData: digitada, tipoDoc: 'resNFe', schema: 'resNFe_v1.01.xsd', chave: CHAVE,
        });
        expect(r.upgrade).toBe(false);
    });
});

describe('a procedência DIZ o que a nota é', () => {
    it('digitada sem XML é natureza, não buraco — com autor e com a régua', () => {
        const p = procedenciaDoDocumento(montarNotaDigitada(base()));
        expect(p.temXml).toBe(false);
        expect(p.explicacao).toMatch(/lançada à mão/);
        expect(p.explicacao).toMatch(/colab@spassessoriacontabil\.com\.br/);
        expect(p.explicacao).toMatch(/SUBSTITUI/);
    });
});

// ═══ A SEGUNDA ESPÉCIE: SERVIÇO ═════════════════════════════════════════════
//
// A porta nasceu só para MERCADORIA — exigia CFOP, que a NFS-e não tem. Ou
// seja: não servia justamente para os ~157 clientes de serviço puro, nem para
// o caso que mais precisa dela (município que ainda não transcreve ao ADN,
// como Jundiaí, onde a cobertura É a digitação).
import { especieDe } from '../services/notaDigitada';
import { ehDocumentoDeServico } from '../sefaz-backend/dipam-produtor-rural.js';
import { idDocumentoNfseSp, patchSubstituiuDigitada } from '../sefaz-backend/nfse-identidade.js';

const servico = (over: any = {}): NotaDigitadaInput => ({
    ...base(),
    especie: 'servico',
    direcao: 'saida',
    itens: [],
    participanteNome: 'CONDOMINIO MONTE CARLO',
    participanteDoc: '11.222.333/0001-81',
    servico: { discriminacao: 'Manutenção mensal de elevadores', codigoServico: '07498', aliquota: 5, valorIss: 75 },
    ...over,
});

describe('serviço não é mercadoria com outro rótulo', () => {
    it('passa SEM CFOP e sem itens — exigir CFOP fazia a pessoa inventar um', () => {
        expect(especieDe(servico())).toBe('servico');
        expect(validarNotaDigitada(servico())).toEqual([]);
    });

    it('sem discriminação é recusa — é ela que aparece no livro', () => {
        expect(validarNotaDigitada(servico({ servico: { discriminacao: '' } })).join(' '))
            .toMatch(/Descreva o serviço/);
    });

    it('alíquota fora de 0–100 é recusada DIZENDO que vazio ≠ zero', () => {
        const e = validarNotaDigitada(servico({ servico: { discriminacao: 'x', aliquota: 150 } }));
        expect(e.join(' ')).toMatch(/deixe VAZIO — vazio é diferente de zero/);
    });

    it('grava nos MESMOS campos do importer de NFS-e — sem nomes próprios', () => {
        const d: any = montarNotaDigitada(servico());
        expect(d.tipo).toBe('NFSe');
        expect(d.modelo).toBe('99');
        expect(d.prestadorCnpj).toBe('29240822000121'); // a empresa presta
        expect(d.tomadorCnpj).toBe('11222333000181');
        expect(d.cnpjEmit).toBe(d.prestadorCnpj);       // compat NF-e
        expect(d.valorServicos).toBe(1500);
        expect(d.discriminacaoServicos).toMatch(/elevadores/);
        expect(d.totais.vISS).toBe(75);
    });

    it('🚨 o app RECONHECE a digitada como documento de serviço', () => {
        // Sem isto, uma nota de serviço de prestador PF geraria FUNRURAL —
        // exatamente o buraco fechado hoje de manhã (Lei 8.212/91 art. 25 só
        // alcança a comercialização da PRODUÇÃO RURAL).
        expect(ehDocumentoDeServico(montarNotaDigitada(servico()))).toBe(true);
        expect(ehDocumentoDeServico(montarNotaDigitada(base()))).toBe(false);
    });

    it('🚨 ISS/alíquota que a pessoa não soube ficam AUSENTES, nunca zero', () => {
        // Zero fabricaria uma pendência FALSA de "inconsistente" (a nota diz
        // que tributa e veio zero). Ausente é outra causa, com outra ação.
        const d: any = montarNotaDigitada(servico({ servico: { discriminacao: 'x' } }));
        expect(d.valorIss).toBeUndefined();
        expect(d.aliquotaServicos).toBeUndefined();
        expect(d.issRetido).toBe(false);
    });

    it('na ENTRADA a empresa é a tomadora — prestador é a contraparte', () => {
        const d: any = montarNotaDigitada(servico({ direcao: 'entrada' }));
        expect(d.tomadorCnpj).toBe('29240822000121');
        expect(d.prestadorCnpj).toBe('11222333000181');
    });
});

describe('🚨 a identidade é a MESMA dos importadores — senão a nota entra DUAS vezes', () => {
    it('o id da digitada é o id que o portal usaria para a mesma nota', () => {
        const d: any = montarNotaDigitada(servico({ numero: '375235' }));
        expect(d.id).toBe(idDocumentoNfseSp({
            prestadorCnpj: '29240822000121', tomadorCnpj: '11222333000181', numero: '375235',
        }));
        // É isto que faz a captura substituir a digitada em vez de criar um
        // segundo documento — a duplicidade que o art. 136 causou no FUNRURAL.
        expect(d.id).toMatch(/^nfsesp-11222333000181-29240822000121-375235$/);
    });

    it('nenhum importador escreve a fórmula do id à mão', () => {
        const arquivos = [
            'sefaz-backend/nfse-sp-csv-importer.js',
            'sefaz-backend/nfse-sp-importer.js',
        ];
        for (const f of arquivos) {
            const fonte = readFileSync(join(__dirname, '..', f), 'utf8');
            expect(fonte).toMatch(/idDocumentoNfseSp/);
            expect(fonte).not.toMatch(/`nfsesp-\$\{/);
        }
    });

    it('o documento de verdade NÃO herda o carimbo de digitada', () => {
        // `merge: true` não remove campo que o novo objeto não traz: sem este
        // patch a nota capturada ficaria com os dados reais E `origem:
        // digitada` grudado, mentindo sobre a própria procedência.
        const p = patchSubstituiuDigitada({ origem: 'digitada', digitadaPorEmail: 'colab@x.com' }, '2026-08-15T12:00:00Z');
        expect(p.origem).toBeNull();
        expect(p.digitadaPorEmail).toBeNull();
        // O rastro não some: fica quem lançou e quando foi substituída.
        expect(p.substituiuDigitadaDe).toBe('colab@x.com');
        expect(p.substituiuDigitadaEm).toBe('2026-08-15T12:00:00Z');
    });

    it('sobre documento que NÃO era digitada, o patch não mexe em nada', () => {
        expect(patchSubstituiuDigitada({ origem: 'csv-portal-sp' })).toEqual({});
        expect(patchSubstituiuDigitada(null)).toEqual({});
    });

    it('os três importadores limpam o carimbo ao mesclar', () => {
        for (const f of ['sefaz-backend/nfse-sp-csv-importer.js', 'sefaz-backend/nfse-sp-importer.js', 'sefaz-backend/abrasf/importer.js']) {
            expect(readFileSync(join(__dirname, '..', f), 'utf8')).toMatch(/patchSubstituiuDigitada/);
        }
    });
});

describe('a tela abre a porta de serviço — rota sem botão não é funcionalidade', () => {
    const form = readFileSync(join(__dirname, '..', 'components/xml/NotaDigitadaForm.tsx'), 'utf8');

    it('tem o seletor das duas espécies', () => {
        expect(form).toMatch(/Mercadoria \(NF-e\)/);
        expect(form).toMatch(/Serviço \(NFS-e\)/);
    });

    it('o bloco de CFOP não aparece na espécie serviço', () => {
        // Campo de CFOP numa NFS-e faria a pessoa inventar um para salvar.
        expect(form).toMatch(/especie === 'servico' \? \(/);
    });

    it('a tela DIZ que vazio ≠ zero no ISS, onde a régua morde', () => {
        expect(form).toMatch(/vazio ≠ zero/);
        expect(form).toMatch(/Deixe vazio/);
    });
});
