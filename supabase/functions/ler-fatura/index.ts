// Edge Function: ler-fatura
// Recebe a fatura do cartão (PDF, prints ou texto de CSV/OFX) e devolve a lista
// de lançamentos num formato fixo para o site revisar antes de salvar.
// Secret necessária: ANTHROPIC_API_KEY  (opcional: ANTHROPIC_MODEL_FATURA)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "A chave ANTHROPIC_API_KEY não está configurada nas Secrets do Supabase." }, 500);
  const model = Deno.env.get("ANTHROPIC_MODEL_FATURA") || Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5";

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida." }, 400); }
  const { arquivos = [], texto = "", categorias = [], cartoes = [], hoje } = body || {};
  if (!arquivos.length && !texto) return json({ error: "Nenhum arquivo recebido." }, 400);
  if (arquivos.length > 10) return json({ error: "Envie no máximo 10 arquivos por vez." }, 400);
  const cats: string[] = Array.isArray(categorias) && categorias.length ? categorias.map(String) : ["Outros"];

  const content: any[] = [];
  for (const a of arquivos) {
    if (!a?.data) continue;
    if (a.mediaType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    else content.push({ type: "image", source: { type: "base64", media_type: a.mediaType || "image/jpeg", data: a.data } });
  }
  if (texto) content.push({ type: "text", text: "Conteúdo do extrato/fatura enviado:\n" + String(texto).slice(0, 200000) });
  content.push({ type: "text", text: `Você lê faturas e extratos de cartão de crédito brasileiros (PDF, prints do app do banco, CSV ou OFX).
Hoje é ${hoje || new Date().toISOString().slice(0, 10)}. Cartões cadastrados (final): ${Array.isArray(cartoes) && cartoes.length ? cartoes.join(", ") : "nenhum"}.
Regras:
- Liste TODOS os lançamentos, um item por linha da fatura. Não repita itens que aparecem em mais de um print.
- valor sempre positivo, em reais (R$ 1.234,56 = 1234.56). Compra internacional: use o valor convertido em R$.
- tipo: "compra" para compras; "encargo" para IOF, juros, multa, anuidade, tarifa, seguro; "estorno" para créditos, estornos e devoluções; "pagamento" para pagamento da fatura anterior.
- Parcelado ("3/10", "Parc 03/10", "Parcela 3 de 10"): parcela=3, parcelas=10, valor = valor DA PARCELA. À vista: parcela=1, parcelas=1.
- data: a data mostrada na linha, formato AAAA-MM-DD; deduza o ano pelo período da fatura.
- descricao: nome do estabelecimento limpo e curto (sem "PARC", sem códigos), como uma pessoa escreveria.
- categoria: a mais adequada da lista.
- Ignore resumos, limites, saldos, totais parciais e propagandas.
- vencimento e total_fatura: se aparecerem.` });

  const tool = {
    name: "registrar_fatura",
    description: "Registra os lançamentos extraídos de uma fatura ou extrato de cartão.",
    input_schema: {
      type: "object",
      properties: {
        legivel: { type: "boolean", description: "false se não for fatura/extrato de cartão ou estiver ilegível" },
        cartao_final: { type: "string", description: "Últimos 4 dígitos do cartão, se aparecerem" },
        vencimento: { type: "string", description: "Data de vencimento da fatura, AAAA-MM-DD" },
        total_fatura: { type: "number", description: "Valor total da fatura, se aparecer" },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              data: { type: "string" },
              descricao: { type: "string" },
              valor: { type: "number" },
              parcela: { type: "integer" },
              parcelas: { type: "integer" },
              tipo: { type: "string", enum: ["compra", "encargo", "estorno", "pagamento"] },
              categoria: { type: "string", enum: cats },
            },
            required: ["data", "descricao", "valor", "parcela", "parcelas", "tipo", "categoria"],
          },
        },
      },
      required: ["legivel", "itens"],
    },
  };

  const chamar = (max_tokens: number) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens, tools: [tool], tool_choice: { type: "tool", name: "registrar_fatura" }, messages: [{ role: "user", content }] }),
  });

  let r: Response, out: any;
  try {
    r = await chamar(16000); out = await r.json().catch(() => ({}));
    if (!r.ok && /max_tokens/i.test(out?.error?.message || "")) { r = await chamar(8192); out = await r.json().catch(() => ({})); }
  } catch (e) { return json({ error: "Não consegui falar com a IA. Tente de novo.", detalhe: String(e) }, 502); }

  if (!r.ok) {
    const msg = out?.error?.message || `Erro ${r.status}`;
    const amigavel = r.status === 401 ? "Chave da Anthropic inválida."
      : /credit|balance/i.test(msg) ? "Créditos da Anthropic acabaram ou venceram."
      : /password|encrypt/i.test(msg) ? "O PDF tem senha. Abra no celular, salve sem senha ou envie prints."
      : /too large|size|pages/i.test(msg) ? "Arquivo grande demais. Envie só as páginas com os lançamentos ou prints."
      : "A IA recusou a leitura.";
    return json({ error: amigavel, detalhe: msg }, 502);
  }
  const bloco = (out.content || []).find((c: any) => c.type === "tool_use");
  if (!bloco) return json({ error: "A IA não devolveu os dados. Tente de novo." }, 502);
  return json({ dados: bloco.input, incompleto: out.stop_reason === "max_tokens", modelo: model });
});
