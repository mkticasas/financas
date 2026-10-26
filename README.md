# Finanças a Dois

Controle financeiro do casal: lançamentos, parcelas, fixos, entradas, contas, cartões, lista de compras, relatórios e leitura de comprovante por foto.

- **Site:** `index.html` (GitHub Pages)
- **Banco:** Supabase — estrutura em `supabase/schema.sql`
- **Leitura por foto:** Edge Function em `supabase/functions/ler-comprovante/index.ts` (secret `ANTHROPIC_API_KEY`)
- **Anti-pausa:** `.github/workflows/keepalive.yml` consulta o banco a cada 3 dias

## Configuração (uma vez)
1. Supabase → SQL Editor → colar `supabase/schema.sql` → Run.
2. Supabase → Authentication → URL Configuration → Site URL = `https://mkticasas.github.io/financas/` (e o mesmo em Redirect URLs).
3. Supabase → Edge Functions → Deploy new function → nome `ler-comprovante` → colar o código → Deploy.
4. Supabase → Edge Functions → Secrets → `ANTHROPIC_API_KEY` = sua chave.
5. GitHub → Settings → Pages → Branch `main` / root.

## Publicar uma mudança
Rode `./tools/versao.sh` antes do commit. Ele troca o número da versão no `index.html` e no `version.json`, e é isso que faz o app instalado na tela inicial se atualizar sozinho.
