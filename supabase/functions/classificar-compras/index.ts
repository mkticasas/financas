// Edge Function: classificar-compras
// Recebe itens da lista de compras e devolve o setor do mercado de cada um.
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
  if (!key) return json({ error: "Falta ANTHROPIC_API_KEY." }, 500);
  const { itens = [], setores = [] } = await req.json().catch(() => ({}));
  const lista = (itens as any[]).slice(0, 100).filter(i => i?.id && i?.nome);
  if (!lista.length || !setores.length) return json({ setores: {} });

  const tool = {
    name: "classificar",
    description: "Setor do supermercado de cada item.",
    input_schema: {
      type: "object",
      properties: { itens: { type: "array", items: { type: "object", properties: { id: { type: "string" }, setor: { type: "string", enum: setores } }, required: ["id", "setor"] } } },
      required: ["itens"],
    },
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
      max_tokens: 2000,
      tools: [tool], tool_choice: { type: "tool", name: "classificar" },
      messages: [{ role: "user", content: "Classifique cada item de uma lista de compras brasileira no setor do supermercado onde ele fica. Use \"Outros\" só se não fizer sentido em nenhum.\n" + lista.map(i => `${i.id}: ${String(i.nome).slice(0, 80)}`).join("\n") }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: out?.error?.message || "Erro na IA" }, 502);
  const res: Record<string, string> = {};
  for (const i of (out.content || []).find((c: any) => c.type === "tool_use")?.input?.itens || []) if (lista.some(x => x.id === i.id)) res[i.id] = i.setor;
  return json({ setores: res });
});
