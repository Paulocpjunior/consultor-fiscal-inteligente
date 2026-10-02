#!/usr/bin/env node
// Auditoria das dependências de PRODUÇÃO com a lista de advisories aceitos
// (scripts/audit-aceitos.json). Régua em scripts/audit-aceitos.js.
// Sai 1 quando há advisory high/critical não aceito ou com aceite vencido.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { avaliarAuditoria } from './audit-aceitos.js';

let bruto;
try {
    bruto = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
    // npm audit sai ≠ 0 quando ACHA vulnerabilidade — o JSON vem no stdout.
    bruto = e.stdout || '';
}
let relatorio;
try {
    relatorio = JSON.parse(bruto);
} catch {
    console.error('::error::Não consegui ler o JSON do npm audit — auditoria não conferida, deploy bloqueado.');
    process.exit(1);
}
if (relatorio.error) {
    console.error(`::error::npm audit falhou: ${JSON.stringify(relatorio.error).slice(0, 300)}`);
    process.exit(1);
}
const aceitos = JSON.parse(readFileSync(new URL('./audit-aceitos.json', import.meta.url), 'utf8'));
const hoje = process.env.AUDIT_HOJE || new Date().toISOString().slice(0, 10);
const r = avaliarAuditoria(relatorio, aceitos, hoje);
for (const a of r.aceitos) {
    console.log(`::warning::Advisory ACEITO até ${a.ate}: ${a.pacote} ${a.advisory} (scripts/audit-aceitos.json).`);
}
if (r.bloqueia.length) {
    for (const b of r.bloqueia) {
        console.error(`::error::${b.pacote} ${b.advisory || '(sem GHSA)'} — ${b.titulo} [${b.motivo}]`);
    }
    process.exit(1);
}
console.log(`Auditoria de produção OK (${r.aceitos.length} advisory(s) aceito(s) com prazo).`);
