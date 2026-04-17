#!/usr/bin/env python3
# patch_analise_credito_extrato.py
# Integra a 3ª aba "Extrato de Conciliação" no componente AnaliseCreditos.tsx.
# Rodar a partir da raiz do repo (~/consultor-fiscal-inteligente).

import shutil, sys, os

FILE = 'components/AnaliseCreditos.tsx'

if not os.path.exists(FILE):
    print(f'ERRO: {FILE} não encontrado. Rode este script a partir da raiz do repo.')
    sys.exit(1)

# Backup antes de tocar
shutil.copy(FILE, FILE + '.bak')
print(f'Backup criado: {FILE}.bak')

with open(FILE) as f:
    lines = f.readlines()

# ── Patch 1: import do novo componente (após o último import) ────────────────
import_line = "import AnaliseCreditoExtrato from './AnaliseCreditoExtrato';\n"
if import_line not in lines:
    # Insere após a primeira linha (import React)
    lines.insert(1, import_line)
    print('✓ Patch 1: import AnaliseCreditoExtrato adicionado')
else:
    print('  Patch 1: já aplicado, skip')

# ── Patch 2: trocar o tipo da aba e adicionar 'extrato' ─────────────────────
# Localiza o useState das abas
for i, l in enumerate(lines):
    if "useState<'manual'|'upload'>" in l:
        lines[i] = l.replace(
            "useState<'manual'|'upload'>('manual')",
            "useState<'manual'|'upload'|'extrato'>('manual')"
        )
        print(f'✓ Patch 2: linha {i+1} — tipo da aba estendido para incluir "extrato"')
        break
else:
    print('  Patch 2: anchor não encontrado (pode já ter sido aplicado)')

# ── Patch 3: trocar o array de botões de abas para incluir 'extrato' ────────
for i, l in enumerate(lines):
    if "(['manual','upload'] as const).map" in l:
        lines[i] = l.replace(
            "(['manual','upload'] as const)",
            "(['manual','upload','extrato'] as const)"
        )
        print(f'✓ Patch 3: linha {i+1} — botão de aba "extrato" adicionado')
        # O label do botão está nas próximas linhas — varre até 5 linhas
        # frente pra achar o ternário (o anchor muda se o arquivo for formatado).
        patched_label = False
        for j in range(i + 1, min(i + 6, len(lines))):
            if "a==='manual'?'✏️ Digitação Manual':'📂 Upload Excel/XML'" in lines[j]:
                lines[j] = lines[j].replace(
                    "a==='manual'?'✏️ Digitação Manual':'📂 Upload Excel/XML'",
                    "a==='manual'?'✏️ Digitação Manual':a==='upload'?'📂 Upload Excel/XML':'🏦 Extrato de Conciliação'"
                )
                print(f'✓ Patch 3.1: linha {j+1} — label da aba "extrato" adicionado')
                patched_label = True
                break
        if not patched_label:
            print('  Patch 3.1: label da aba não localizado — verificar manualmente')
        break
else:
    print('  Patch 3: anchor não encontrado')

# ── Patch 4: adicionar o bloco de renderização {aba==='extrato' && ...} ─────
# Inserir logo antes de {erro && ... }
marker = '      {erro && <div className='
for i, l in enumerate(lines):
    if l.startswith(marker):
        # Checa se já foi inserido
        already = any("aba==='extrato'" in lines[k] for k in range(max(0, i-8), i))
        if already:
            print('  Patch 4: já aplicado, skip')
            break
        novo_bloco = [
            "\n",
            "      {aba==='extrato' && (\n",
            "        <AnaliseCreditoExtrato />\n",
            "      )}\n",
            "\n",
        ]
        for off, nl in enumerate(novo_bloco):
            lines.insert(i + off, nl)
        print(f'✓ Patch 4: bloco de renderização inserido na linha {i+1}')
        break
else:
    print('  Patch 4: anchor não encontrado')

# Escreve
with open(FILE, 'w') as f:
    f.writelines(lines)

print(f'\nOK. Arquivo modificado: {FILE}')
print('Rollback (se precisar):  mv ' + FILE + '.bak ' + FILE)
