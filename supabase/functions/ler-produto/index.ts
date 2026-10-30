// Edge Function: ler-produto
// Recebe a foto de uma etiqueta de preço, do produto ou de um cupom do mercado
// e devolve os itens com nome e preço para colocar no carrinho.
// Usa a mesma secret ANTHROPIC_API_KEY.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "A chave ANTHROPIC_API_KEY não está configurada." }, 500);
  const { image, mediaType = "image/jpeg", setores = [], lista = [] } = await req.json().catch(() => ({}));
  if (!image) return json({ error: "Nenhuma imagem recebida." }, 400);
  const sets = setores.length ? setores : ["Outros"];
  const nomes: string[] = (lista as any[]).map(String).slice(0, 200);

  const tool = {
    name: "registrar_produtos",
    description: "Produtos e preços lidos na foto.",
    input_schema: {
      type: "object",
      properties: {
        legivel: { type: "boolean" },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome: { type: "string", description: "Nome curto como uma pessoa escreveria numa lista, com marca e tamanho se aparecerem. Ex.: 'Coca-Cola lata 350ml'" },
              preco: { type: "number", description: "Preço de UMA unidade em reais. Se houver preço promocional válido, use ele." },
              qtd: { type: "number", description: "Quantidade (1 se não estiver claro). Em cupom, a quantidade da linha." },
              setor: { type: "string", enum: sets },
              corresponde: { type: "string", description: "Nome exato do item da lista de compras que é este produto, ou vazio se nenhum" },
            },
            required: ["nome", "preco", "qtd", "setor", "corresponde"],
          },
        },
      },
      required: ["legivel", "itens"],
    },
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
      max_tokens: 4000,
      tools: [tool], tool_choice: { type: "tool", name: "registrar_produtos" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: `A foto foi tirada num supermercado brasileiro: pode ser a etiqueta de preço da prateleira, a embalagem do produto ou um cupom fiscal.
Liste cada produto com o preço unitário em reais (R$ 4,59 = 4.59). Etiqueta de preço por kg: use o preço por kg e qtd 1.
Lista de compras atual (para o campo "corresponde"): ${nomes.length ? nomes.join(" | ") : "vazia"}.
Só preencha "corresponde" se for claramente o mesmo produto (ex.: "Coca lata" = "Coca-Cola lata 350ml").` },
      ] }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = out?.error?.message || `Erro ${r.status}`;
    return json({ error: r.status === 401 ? "Chave da Anthropic inválida." : /credit|balance/i.test(msg) ? "Créditos da Anthropic acabaram ou venceram." : "A IA recusou a leitura.", detalhe: msg }, 502);
  }
  const bloco = (out.content || []).find((c: any) => c.type === "tool_use");
  if (!bloco) return json({ error: "A IA não devolveu os dados." }, 502);
  return json({ dados: bloco.input });
});
