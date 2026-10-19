# Monitor de Antecâmara

App web para celular que monitora diariamente os lotes e pré-lotes nas antecâmaras dos armazéns refrigerados.
Cada bipagem registra data, hora e local. O app calcula a reincidência e o tempo fora da câmara fria, e grava tudo
numa Planilha Google que funciona como banco de dados central para vários aparelhos.

- **App:** https://williangms97-stack.github.io/Monitoramento-Antec-mara/
- **Painel:** https://williangms97-stack.github.io/Monitoramento-Antec-mara/painel.html
- **Banco de dados:** Planilha Google "Monitoramento Antecâmara" (Apps Script publicado como App da Web)

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | O app inteiro (HTML, CSS e JavaScript em um arquivo). É o que vai para o Netlify. |
| `painel.html` | Painel em tempo real (números do dia, gráficos, lotes ativos), lido da planilha a cada minuto. Mesmo login do app. |
| `apps-script/Codigo.gs` | Script da Planilha Google: recebe as bipagens (POST) e devolve os dados dos outros aparelhos (GET `?acao=dados`). |

## Regras de negócio

1. **Mesmo dia (até 00h):** o mesmo lote bipado de novo exige **outra posição** e **não** conta como reincidência.
2. **Dia seguinte:** o lote é **reincidente**. Tempo fora da câmara fria = hora da bipagem − primeira bipagem da sequência.
3. **Checklist do dia:** ao concluir, os lotes ativos não encontrados naquele dia viram **Finalizado**. Sem checklist, nenhum lote é finalizado. Um lote finalizado que for bipado de novo conta como nova entrada.
4. **Empresa pelo lote:** 2º ao 4º caractere `WML` = Basf · 3º e 4º `DM` = Dois Marcos · demais = Terceiro. Pré-lotes não têm empresa.
5. **Pré-lotes:** identificados pela **foto da etiqueta** (OCR). O QR do pré-lote fica vinculado ao número na primeira foto.
6. **Vários aparelhos:** bipagens, checklists e locais são compartilhados pela planilha. As regras são calculadas sobre a união dos dados.
7. **Exclusão:** uma bipagem excluída por qualquer usuário sai de todos os aparelhos. A planilha registra quem excluiu.
8. **Repetida offline:** se o mesmo lote cair no mesmo local no mesmo dia em mais de uma bipagem (por exemplo, um celular estava sem internet), a planilha mantém a **mais antiga**, exclui as outras em todos os aparelhos e registra o caso na aba **Repetidas offline**.
9. **Login:** cada pessoa entra com usuário e senha ao abrir o app (e de novo após 10 min em segundo plano). Sem internet, vale o último login feito naquele aparelho. Os usuários são cadastrados por um administrador em *Exportar → Usuários*, com usuário e senha de administrador. No primeiro acesso, sem nenhum usuário, o app pede para criar o administrador.

## Leitura das etiquetas

- **Basf (lote):** QR com link `https://oag.cc/t/<LOTE>?ic=...` → o lote é extraído do link.
- **Dois Marcos (lote):** QR contém o próprio lote (ex.: `26DMC92504`).
- **Pré-lote:** QR com número curto (ex.: `288283`). O número do pré-lote, variedade, categoria, peso, safra, origem, data de produção e obs. são lidos do texto da foto (Tesseract.js). Siglas de tecnologia de soja corrigidas automaticamente: IPRO, I2X, CE, E3, RR, RR2, XTD.

## Publicar uma nova versão

**App (Netlify):** coloque o `index.html` numa pasta e arraste a pasta no projeto do Netlify (aba *Implanta*). O link continua o mesmo.

**Script (Planilha Google):** Extensões → Apps Script → cole o `apps-script/Codigo.gs` → Salvar → Implantar → Gerenciar implantações → ✏️ → Versão: *Nova versão* → Implantar.
A URL `/exec` não muda. Ela está na constante `URL_PLANILHA` do `index.html`.

## Abas da planilha

- **Bipagens:** uma linha por leitura (lote/pré-lote, local, reincidência, tempo fora, dados do pré-lote, foto, aparelho).
- **Checklists:** conclusões e reaberturas de checklist.
- **Finalizados:** lotes finalizados em cada checklist.
- **Locais:** posições cadastradas, compartilhadas entre os aparelhos.
- **Usuários:** cadastro de usuários (senha guardada como hash SHA-256 com sal, nunca em texto).
- **Log de usuários:** cadastros, trocas de senha, desativações e logins.
- **Repetidas offline:** histórico das bipagens repetidas removidas automaticamente.

> Use a planilha para consulta. Não edite nem apague linhas manualmente: para corrigir uma bipagem, exclua pelo app.

## Segurança

O `index.html` contém a URL do App da Web da planilha, que fica visível para qualquer pessoa que abre o app publicado.
Senhas nunca ficam no código nem na planilha em texto. A área de usuários só funciona com usuário e senha de administrador.
