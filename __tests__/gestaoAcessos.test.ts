import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
test('gestor possui administração local e cadastro/delegação segura, auditada e retomável', () => {
    expect(execFileSync(process.execPath, [resolve('scripts/test-gestao-acessos.cjs')], { encoding: 'utf8' })).toContain('aprovados nos dois aplicativos');
});
