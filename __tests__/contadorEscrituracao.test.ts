// ============================================================================
// 🚨 O 0100 SAÍA VAZIO NO EFD-CONTRIBUIÇÕES — a segunda cópia da mesma função.
//
// O PVA recusou o EFD ICMS/IPI da PWR em 19/08 com "Campo obrigatório · 13 -
// EMAIL" e "14 - COD_MUN". Corrigi no orquestrador do Fiscal — e o do
// EFD-Contribuições tinha a SEGUNDA CÓPIA do `getContadorPadrao`, que ficou sem
// o e-mail padrão e SEM O CAMPO `codMunIBGE` sequer existir.
//
// Resultado, no arquivo da PWR de 20/08:
//   |0100|Paulo Cesar Pereira Junior|26819016859|1SP238285/O-5|||||||||||
// tudo depois do CRC vazio — a MESMA recusa esperando do outro lado, no
// arquivo que o cliente ia transmitir em seguida.
//
// ⚠️ Nenhum teste pegava: cada orquestrador fazia exatamente o que o próprio
// código dizia, e os dois "funcionavam".
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { getContadorPadrao, CONTADOR_EMAIL_PADRAO, CONTADOR_COD_MUN_PADRAO } from '../sefaz-backend/contador-escrituracao.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

const ler = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('o contabilista do 0100 tem UM dono', () => {
    it('os campos que o PVA cobra vêm preenchidos', () => {
        const c = getContadorPadrao();
        expect(c.email).toBe(CONTADOR_EMAIL_PADRAO);
        expect(c.codMunIBGE).toBe(CONTADOR_COD_MUN_PADRAO);
    });

    it('o env vence o padrão — o contabilista pode mudar sem deploy', () => {
        const antes = { ...process.env };
        process.env.CONTADOR_EMAIL = 'outro@escritorio.com.br';
        process.env.CONTADOR_COD_MUN = '3550309';
        try {
            const c = getContadorPadrao();
            expect(c.email).toBe('outro@escritorio.com.br');
            expect(c.codMunIBGE).toBe('3550309');
        } finally {
            process.env = antes;
        }
    });

    it('🚨 os DOIS orquestradores leem do dono — nenhum tem cópia própria', () => {
        for (const arq of ['sefaz-backend/sped-fiscal-orchestrator.js', 'sefaz-backend/sped-contrib-orchestrator.js']) {
            const f = ler(arq);
            expect(f).toMatch(/from '\.\/contador-escrituracao\.js'/);
            // Uma DECLARAÇÃO local seria a divergência de novo. Chamada, sim.
            expect(f).not.toMatch(/function getContadorPadrao\s*\(/);
        }
    });

    it('e o 0100 do EFD-Contribuições sai com EMAIL e COD_MUN — era o defeito', () => {
        const linhas = buildBloco0Contrib({
            empresa: {
                cnpj: '31947349000169', razaoSocial: 'PWR INDUSTRIA METALURGICA LTDA',
                dadosFiscais: { uf: 'SP', codMunIBGE: '3507605', ie: '225544975114' },
            },
            contador: getContadorPadrao(),
            competencia: '2026-07', competenciaInicio: '2026-07', competenciaFim: '2026-07',
            regimeApuracao: '2', notas: [], itens: [], participantes: [], unidades: [], warnings: [],
        });
        const f = linhas.find((l: string) => l.startsWith('|0100|'))!.split('|');
        expect(f[13]).toBe(CONTADOR_EMAIL_PADRAO);   // 13 - EMAIL
        expect(f[14]).toBe(CONTADOR_COD_MUN_PADRAO); // 14 - COD_MUN
    });
});
